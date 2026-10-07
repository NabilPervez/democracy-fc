import templates from '../../content/soccer/templates.json';
import { hashSeed } from '../engine/core/rng';
import { getSignature } from '../engine/soccer/arenas';
import type { SoccerEvent, SoccerLeague } from '../engine/soccer/types';

/**
 * Soccer play-by-play (PRD §B9): one line per engine event, from original templates. Variant
 * choice is seeded by (match, event index), so a replay always reads the same.
 */

export type SoccerTone = 'goal' | 'chance' | 'card' | 'facility' | 'transition' | 'setPiece' | 'signature' | 'plain';

export interface SoccerLine {
  text: string;
  tone: SoccerTone;
  /** Lines worth showing in Key Moments mode (§B10). */
  key: boolean;
}

export interface SoccerNarrationContext {
  league: SoccerLeague;
  gameId: string;
  homeId: string;
  awayId: string;
}

const T = templates as Record<string, string[]>;
export const SOCCER_TEMPLATE_COUNT = Object.values(T).reduce((n, list) => n + list.length, 0);

const surname = (name: string) => name.split(' ').slice(1).join(' ') || name;

function pick(key: string, ctx: SoccerNarrationContext, index: number): string {
  const list = T[key] ?? [];
  if (!list.length) return '';
  const [h] = hashSeed(ctx.gameId, index, key);
  return list[h % list.length];
}

const fill = (text: string, vars: Record<string, string | number | undefined>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/** Which template key an event uses (null = not narrated). */
function keyFor(e: SoccerEvent, ctx: SoccerNarrationContext): string | null {
  switch (e.kind) {
    case 'pass':
      if (!e.success) return 'pass.fail';
      if (e.bond) return 'pass.bond';
      if (e.advanced) return e.route === 'through' ? 'pass.through' : 'pass.around';
      return 'pass';
    case 'dribble':
      if (e.rivals) return 'dribble.rivals';
      return e.success ? 'dribble.success' : 'dribble.fail';
    case 'longBall':
      return e.success ? 'longBall.success' : 'longBall.fail';
    case 'wallPass':
      return e.success ? 'wallPass.success' : 'wallPass.fail';
    case 'shot':
      if (e.outcome === 'goal') return e.wall ? 'shot.wall' : null;
      return `shot.${e.outcome}`;
    case 'goal': {
      const drive = ctx.league.players[e.scorerId]?.drive;
      if (drive === 'selfish' && !e.assistId) return 'goal.selfish';
      if (drive === 'predator') return 'goal.predator';
      return e.assistId ? 'goal.assist' : 'goal';
    }
    case 'penalty':
      return e.scored ? 'penalty.scored' : 'penalty.missed';
    case 'card':
      return `card.${e.color}`;
    case 'fullTime':
      return e.winnerId ? 'fullTime.win' : 'fullTime.draw';
    case 'transition':
      if (e.outcome === 'regained') return 'transition.regained';
      if (e.outcome === 'breakaway') return 'transition.breakaway';
      return e.attChoice === 'counter' ? 'transition.counter' : 'transition.secure';
    case 'blockChange':
      return `blockChange.${e.block}`;
    case 'teamFouls':
      return e.count >= 5 ? 'teamFouls' : null;
    case 'possession':
      return null; // the transition line that follows says it better
    case 'sub':
      return e.inId ? 'sub' : 'sub.makeWay';
    case 'facilityEvent':
      return 'facilityEvent';
    default:
      return T[e.kind] ? e.kind : null;
  }
}

const TONE: Partial<Record<SoccerEvent['kind'], SoccerTone>> = {
  goal: 'goal', shot: 'chance', card: 'card', powerPlay: 'card', facilityEvent: 'facility', arenaShift: 'facility',
  transition: 'transition', freeKick: 'setPiece', spotKick: 'setPiece', penalty: 'setPiece', signature: 'signature', awakening: 'signature',
};

/** One narrated line for an event, or null when the event isn't narrated on its own. */
export function describeSoccerEvent(e: SoccerEvent, index: number, ctx: SoccerNarrationContext): SoccerLine | null {
  const key = keyFor(e, ctx);
  if (!key) return null;
  const P = ctx.league.players;
  const n = (id: string | null | undefined) => (id ? surname(P[id]?.name ?? '?') : '');
  const club = (id: string | undefined) => {
    const t = ctx.league.teams.find((x) => x.id === id);
    return t ? t.name : '';
  };
  const attackers = e.possessionTeamId;
  const defenders = attackers === ctx.homeId ? ctx.awayId : ctx.homeId;
  const vars: Record<string, string | number | undefined> = {
    team: club(attackers),
    opp: club(defenders),
    min: e.minute,
    score: `${club(ctx.homeId)} ${e.score.home}–${e.score.away} ${club(ctx.awayId)}`,
    wall: e.lane === 'right' ? 'right' : 'left',
  };
  switch (e.kind) {
    case 'kickoff': vars.team = club(e.teamId); break;
    case 'possession': vars.p = n(e.playerId); break;
    case 'pass': Object.assign(vars, { p: n(e.from), p2: n(e.to), d: n(e.interceptorId) }); break;
    case 'dribble': Object.assign(vars, { p: n(e.playerId), d: n(e.defenderId) }); break;
    case 'longBall': Object.assign(vars, { p: n(e.from), p2: n(e.to) }); break;
    case 'wallPass': Object.assign(vars, { p: n(e.from), wall: e.wall }); break;
    case 'shot': Object.assign(vars, { p: n(e.playerId), k: n(e.keeperId), d: n(e.blockerId), wall: e.wall ?? vars.wall }); break;
    case 'goal': Object.assign(vars, { p: n(e.scorerId), p2: n(e.assistId), team: club(e.teamId), score: `${club(ctx.homeId)} ${e.score.home}–${e.score.away} ${club(ctx.awayId)}` }); break;
    case 'keeperRestart': Object.assign(vars, { k: n(e.keeperId), team: club(e.teamId) }); break;
    case 'tackle': Object.assign(vars, { d: n(e.defenderId), p: n(e.victimId) }); break;
    case 'teamFouls': Object.assign(vars, { team: club(e.teamId), count: e.count }); break;
    case 'freeKick': case 'spotKick': Object.assign(vars, { team: club(e.teamId), p: n(e.takerId) }); break;
    case 'penalty': Object.assign(vars, { p: n(e.takerId), k: n(e.keeperId) }); break;
    case 'card': Object.assign(vars, { d: n(e.playerId), team: club(e.teamId) }); break;
    case 'powerPlay': case 'powerPlayEnd': vars.team = club(e.teamId); break;
    case 'injury': Object.assign(vars, { p: n(e.playerId), team: club(e.teamId), count: e.matches }); break;
    case 'sub': Object.assign(vars, { p: n(e.outId), p2: n(e.inId), team: club(e.teamId) }); break;
    case 'fullTime': vars.team = club(e.winnerId ?? undefined); break;
    case 'shootout': {
      const home = e.kicks.filter((k) => k.teamId === ctx.homeId && k.scored).length;
      const away = e.kicks.filter((k) => k.teamId === ctx.awayId && k.scored).length;
      Object.assign(vars, { team: club(e.winnerId), count: `${home}–${away}` });
      break;
    }
    case 'transition': Object.assign(vars, { team: club(e.wonBy), opp: club(e.lostBy) }); break;
    case 'blockChange': vars.opp = club(e.teamId); break;
    case 'setPieceSetup': Object.assign(vars, { opp: club(e.teamId), setup: e.setup === 'wall' ? 'a wall' : e.setup === 'man' ? 'man-marking' : 'zonal marking' }); break;
    case 'scramble': vars.p = n(e.winnerId); break;
    case 'signature': {
      const sig = getSignature(e.signatureId);
      Object.assign(vars, { p: n(e.playerId), sig: sig?.name, sigText: sig?.text });
      break;
    }
    case 'awakening': vars.p = n(e.playerId); break;
    case 'facilityEvent':
      return { text: e.text, tone: 'facility', key: true };
  }
  let text = fill(pick(key, ctx, index), vars);
  // Now and then a scorer's catchphrase follows the goal.
  if (e.kind === 'goal') {
    const phrase = P[e.scorerId]?.catchphrase;
    const [h] = hashSeed(ctx.gameId, index, 'phrase');
    if (phrase && h % 4 === 0) text += ` ${fill(T['goal.catchphrase'][0], { p: n(e.scorerId), phrase })}`;
  }
  const tone = TONE[e.kind] ?? 'plain';
  const key_ = ['goal', 'shot', 'card', 'penalty', 'spotKick', 'signature', 'awakening', 'facilityEvent', 'arenaShift', 'powerPlay', 'halfTime', 'fullTime', 'shootout', 'injury'].includes(e.kind)
    || (e.kind === 'transition' && e.outcome === 'breakaway');
  return { text, tone, key: key_ };
}

/** A whole match as narrated lines (in order). */
export function narrateSoccerMatch(events: SoccerEvent[], ctx: SoccerNarrationContext): (SoccerLine & { minute: number; index: number })[] {
  const out: (SoccerLine & { minute: number; index: number })[] = [];
  events.forEach((e, i) => {
    const line = describeSoccerEvent(e, i, ctx);
    if (line && line.text) out.push({ ...line, minute: e.minute, index: i });
  });
  return out;
}
