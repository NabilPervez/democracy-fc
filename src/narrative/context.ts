import type { GameEvent } from '../engine/baseball/types';
import type { NarrativeContext } from './templates';

/** Facts about the game that the event stream doesn't carry. All optional, so tests and old callers still work. */
export interface NarrativeExtras {
  /** Home stadium name. */
  stadium?: string;
  rivalry?: boolean;
  favoriteTeamId?: string | null;
  /** Name of a player's active modifier, or null. */
  modName?: (playerId: string) => string | null;
}

export interface GameSides {
  awayId: string;
  homeId: string;
}

/** Events that resolve a plate appearance; their count is the one before the final pitch. */
const PA_RESULTS = new Set(['walk', 'strikeout', 'hit', 'out', 'error', 'doublePlay', 'hitByPitch']);

/** Runs that score as part of the play at `index` (the engine emits them right after it). */
export function runsOnPlay(events: GameEvent[], index: number): number {
  let n = 0;
  for (let i = index + 1; i < events.length && (events[i].kind === 'run' || events[i].kind === 'envEffect'); i++) if (events[i].kind === 'run') n++;
  return n;
}

/** Pure: the context a template's `when` is matched against (PRD 2 §E10). */
export function buildContext(events: GameEvent[], index: number, sides: GameSides, extras: NarrativeExtras = {}): NarrativeContext {
  const e = events[index];
  const prev = index > 0 ? events[index - 1] : e;
  const battingId = e.half === 'top' ? sides.awayId : sides.homeId;
  const batScore = (s: GameEvent['score']) => (e.half === 'top' ? s.away - s.home : s.home - s.away);

  // Margin from the batting team's view, before this play.
  let before = batScore(e.score);
  let runs = 0;
  if (e.kind === 'run') before -= 1; // run events carry the score after the run
  else if (e.kind !== 'gameEnd') runs = runsOnPlay(events, index);
  if (e.kind === 'run') runs = 1;
  const after = before + runs;

  let walkoff = runs > 0 && e.half === 'bottom' && e.inning >= 9 && before <= 0 && after > 0;
  let goAhead = runs > 0 && !walkoff && before <= 0 && after > 0;
  let tying = runs > 0 && before < 0 && after === 0;
  let margin = before;
  if (e.kind === 'gameEnd') {
    // The game is over: judge it from the winner's view.
    margin = Math.abs(e.score.away - e.score.home);
    walkoff = e.half === 'bottom' && e.winnerId === sides.homeId && prev.kind === 'run';
    goAhead = tying = false;
  }

  const countOf = (x: GameEvent) => `${x.balls}-${x.strikes}`;
  const rawCount = PA_RESULTS.has(e.kind) ? countOf(prev) : countOf(e);
  const count = rawCount === '3-2' ? 'full' : rawCount === '0-2' || rawCount === '3-0' ? rawCount : null;

  const bases = PA_RESULTS.has(e.kind) ? prev.bases : e.bases;
  const onBase = bases.filter(Boolean).length;

  const people = [('batterId' in e && e.batterId) || null, ('pitcherId' in e && e.pitcherId) || null].filter((x): x is string => !!x);
  const mod = !!extras.modName && people.some((id) => extras.modName!(id));

  const fav = extras.favoriteTeamId ?? null;
  const favorite =
    !!fav &&
    (e.kind === 'gameStart' ? fav === sides.awayId || fav === sides.homeId : e.kind === 'gameEnd' ? fav === e.winnerId : e.kind === 'halfStart' ? fav === e.battingTeamId : fav === battingId);

  return {
    inning: e.inning,
    late: e.inning >= 7,
    extra: e.inning >= 10,
    margin,
    close: Math.abs(margin) <= 1,
    blowout: Math.abs(margin) >= 6,
    walkoff,
    goAhead,
    tying,
    rivalry: !!extras.rivalry,
    mod,
    milestone: false, // needs career totals in the event stream (later sprint)
    count,
    basesLoaded: onBase === 3,
    risp: !!(bases[1] || bases[2]),
    favorite,
    env: !!e.cause,
    swinging: e.kind === 'strikeout' ? e.swinging : null,
    sacrifice: e.kind === 'out' ? e.sacrifice : null,
    success: 'success' in e ? (e as { success: boolean }).success : null,
  };
}
