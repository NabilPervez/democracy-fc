import { createRng } from '../engine/core/rng';
import type { GameEvent, League, OutKind } from '../engine/baseball/types';
import { envEventDef } from '../world/environment';
import { buildContext, type NarrativeExtras } from './context';
import { PLAY_TEMPLATES, type NarrativeContext, type PlayTemplate, type TemplateKind } from './templates';

export type { NarrativeExtras } from './context';

/**
 * Play-by-play text from data templates (PRD 2 §E10). Of the templates whose `when` matches the
 * play's context, the most specific (weighted, see KEY_RANK) win; ties are drawn by weight. Deterministic per event index.
 */

export interface GameRef {
  id: string;
  awayId: string;
  homeId: string;
}

const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
const BASE_NAMES = ['first', 'second', 'third', 'home'];

/** Positions that field each kind of out, for engine v2 games (which don't name a fielder). */
const FIELDERS: Record<OutKind, string[]> = {
  groundout: ['1B', '2B', '3B', 'SS', 'SS', '2B'],
  popout: ['C', '1B', '2B', '3B', 'SS'],
  lineout: ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'],
  flyout: ['LF', 'CF', 'RF'],
};

export function templateKind(e: GameEvent): TemplateKind {
  if (e.kind === 'hit') return `hit.${e.hit}`;
  if (e.kind === 'out') return `out.${e.out}`;
  return e.kind as TemplateKind;
}

/**
 * How much each `when` key counts toward specificity. A rare, decisive fact (a walk-off) must beat
 * two common ones (late + close), so specificity is a weighted key count rather than a plain one.
 */
const KEY_RANK: Partial<Record<string, number>> = { walkoff: 4, milestone: 4, env: 3, goAhead: 2, tying: 2, basesLoaded: 2 };

const FLAVOR_PER_MILLE = 250;
/** Plays rare enough that mod/favorite lines always apply. */
const SIGNATURE_KINDS = new Set<TemplateKind>(['gameStart', 'gameEnd', 'hit.homeRun', 'hit.triple']);

const matches = (t: PlayTemplate, ctx: NarrativeContext) => Object.entries(t.when ?? {}).every(([k, v]) => ctx[k as keyof NarrativeContext] === v);

/**
 * Most-specific matching templates, one drawn by weight. Templates in `used` are skipped while
 * any of the pool is still fresh, so a game doesn't repeat itself until it runs out of lines.
 */
export function selectTemplate(templates: PlayTemplate[], ctx: NarrativeContext, rng: { int(n: number): number }, used?: ReadonlySet<string>): PlayTemplate | null {
  const ok = templates.filter((t) => matches(t, ctx));
  if (!ok.length) return null;
  const spec = (t: PlayTemplate) => Object.keys(t.when ?? {}).reduce((sum, k) => sum + (KEY_RANK[k] ?? 1), 0);
  const best = Math.max(...ok.map(spec));
  const top = ok.filter((t) => spec(t) === best);
  const fresh = used ? top.filter((t) => !used.has(t.id)) : top;
  const pool = fresh.length ? fresh : top;
  let roll = rng.int(pool.reduce((sum, t) => sum + t.weight, 0));
  for (const t of pool) {
    roll -= t.weight;
    if (roll < 0) return t;
  }
  return pool[pool.length - 1];
}

/** Nearest batter/pitcher at or before `index`, for lines (like halfEnd) whose event doesn't carry one. */
function lastId(events: GameEvent[], index: number, key: 'batterId' | 'pitcherId'): string | null {
  for (let i = index; i >= 0; i--) {
    const e = events[i] as Partial<Record<typeof key, string>>;
    if (e[key]) return e[key]!;
  }
  return null;
}

function chooseTemplate(league: League, game: GameRef, events: GameEvent[], index: number, extras: NarrativeExtras, used: ReadonlySet<string>): PlayTemplate | null {
  const rng = createRng(league.seed, game.id, 'text', index);
  const kind = templateKind(events[index]);
  if (!PLAY_TEMPLATES[kind]) return null; // environment lines come from the environment content
  const ctx = buildContext(events, index, game, extras);
  // Mods and the favorite team are common, so on routine plays their flavor lines appear only
  // about 1 time in 4; otherwise they'd repeat every at-bat.
  if ((ctx.mod || ctx.favorite) && !SIGNATURE_KINDS.has(kind) && !createRng(league.seed, game.id, 'text-flavor', index).chance(FLAVOR_PER_MILLE)) {
    ctx.mod = false;
    ctx.favorite = false;
  }
  return selectTemplate(PLAY_TEMPLATES[kind], ctx, rng, used);
}

/** Every line's template for one game, chosen in order. Cached per event list, since the UI asks one line at a time. */
const gameCache = new WeakMap<GameEvent[], { key: string; templates: (PlayTemplate | null)[] }>();

/** The template a play's line is written from. */
export function templateFor(league: League, game: GameRef, events: GameEvent[], index: number, extras: NarrativeExtras = {}): PlayTemplate | null {
  const key = [league.seed, game.id, extras.stadium, extras.rivalry, extras.favoriteTeamId, !!extras.modName].join('|');
  let hit = gameCache.get(events);
  if (!hit || hit.key !== key) {
    const used = new Set<string>();
    const templates = events.map((_, i) => {
      const t = chooseTemplate(league, game, events, i, extras, used);
      if (t) used.add(t.id);
      return t;
    });
    hit = { key, templates };
    gameCache.set(events, hit);
  }
  return hit.templates[index];
}

export function describeEvent(league: League, game: GameRef, events: GameEvent[], index: number, extras: NarrativeExtras = {}): string {
  const here = events[index];
  // An effect line that follows a changed play talks about that play's people.
  const src = here.kind === 'envEffect' && !here.cause && index > 0 ? index - 1 : index;
  const e = events[src];
  const tpl = here.kind === 'envStart' || here.kind === 'envEffect' || here.kind === 'envEnd' ? null : templateFor(league, game, events, index, extras);

  const name = (id: string | null) => (id ? league.players[id]?.name : null) ?? 'Someone';
  const team = (id: string) => {
    const t = league.teams.find((x) => x.id === id);
    return t ? `${t.city} ${t.name}` : 'Somebody';
  };
  const battingId = e.half === 'top' ? game.awayId : game.homeId;
  const fieldingId = e.half === 'top' ? game.homeId : game.awayId;
  const t = e.kind === 'gameEnd' ? e.winnerId : e.kind === 'halfStart' ? e.battingTeamId : battingId;
  const opp = e.kind === 'gameEnd' ? e.loserId : t === game.awayId ? game.homeId : game.awayId;
  const batterId = lastId(events, src, 'batterId');
  const pitcherId = e.kind === 'gameStart' ? e.awayPitcherId : lastId(events, src, 'pitcherId');
  const modOf = (id: string | null) => (id && extras.modName?.(id)) || null;

  let fielder: string | null = null;
  if (e.kind === 'out' && e.fielderId) fielder = e.fielderId;
  else if (e.kind === 'out') {
    // Engine v2 games don't name a fielder, so the text picks one who could have made the play.
    const pos = createRng(league.seed, game.id, 'text-fielder', src).pick(FIELDERS[e.out]);
    const fielding = league.teams.find((x) => x.id === fieldingId);
    fielder = fielding?.lineup.find((id) => league.players[id]?.position === pos) ?? null;
  } else if ('fielderId' in e) fielder = (e as { fielderId: string }).fielderId;

  const hi = Math.max(e.score.away, e.score.home);
  const lo = Math.min(e.score.away, e.score.home);
  const vars: Record<string, string> = {
    b: name(batterId),
    p: name(pitcherId),
    p2: e.kind === 'gameStart' ? name(e.homePitcherId) : '',
    r: name(here.kind === 'envEffect' && (here.removedId || here.advanced?.length) ? (here.removedId ?? here.advanced![0]) : 'runnerId' in e ? (e as { runnerId: string }).runnerId : null),
    f: fielder ? name(fielder) : 'the fielder',
    t: team(t),
    opp: team(opp),
    stadium: extras.stadium ?? 'the ballpark',
    mod: modOf(batterId) ?? modOf(pitcherId) ?? '',
    env: e.cause ? `the ${envEventDef(e.cause.id)?.name.toLowerCase() ?? 'weather'}` : '',
    n: '',
    score: e.kind === 'gameEnd' ? `${hi}-${lo}` : `${e.score.away}-${e.score.home}`,
    count: `${e.balls}-${e.strikes}`,
    half: e.half,
    inning: ordinal(e.inning),
    base: 'from' in e ? BASE_NAMES[(e as { from: number }).from] : '',
  };

  const envDef = 'envId' in here ? envEventDef(here.envId) : undefined;
  const envText = !envDef
    ? null
    : here.kind === 'envStart'
      ? `${envDef.icon} ${envDef.name}: ${envDef.announce}`
      : here.kind === 'envEnd'
        ? `${envDef.icon} ${envDef.fizzle ?? `The ${envDef.name.toLowerCase()} passes.`}`
        : `${envDef.icon} ${envDef.effectText}`;

  const text = (envText ?? tpl?.text ?? '{b}.').replace(/\{(\w+)\}/g, (_, v: string) => vars[v] ?? '');
  // Variables like {half} are lowercase, so capitalize wherever a sentence starts (an ellipsis doesn't end one).
  return text.replace(/(^|(?<!\.\.)[.!?]\s+)([a-z])/g, (_, lead: string, c: string) => lead + c.toUpperCase());
}

/** Events worth highlighting in the feed. */
export function isBigMoment(e: GameEvent): boolean {
  return e.kind === 'run' || e.kind === 'gameEnd' || e.kind === 'envEffect' || (e.kind === 'hit' && e.hit === 'homeRun');
}
