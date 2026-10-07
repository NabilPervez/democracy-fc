import { createRng, type Rng } from '../core/rng';
import { selectLineup } from './lineup';
import type {
  Block, Phase, ShotOutcome, SoccerEvent, SoccerFixture, SoccerLeague, SoccerPlayer, SoccerPosition, SoccerRatingKey,
  SoccerResult, SoccerTeam, Style, Zone,
} from './types';

/**
 * Soccer engine (Democracy FC PRD §B5): possession chains on a 3×3 grid inside a walled 5v5 arena.
 * Pure and deterministic — seeded PRNG only, integer math only. Bump on any outcome change.
 */
export const SOCCER_ENGINE_VERSION = 1;

export const HALF_SECONDS = 20 * 60;
const MAX_STEPS = 8;
const HOME_BONUS = 2;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

type Action = 'pass' | 'dribble' | 'longBall' | 'shot';
const ACTIONS: readonly Action[] = ['pass', 'dribble', 'longBall', 'shot'];

/** Base action weights by zone (relative to the team in possession). */
const ZONE_WEIGHTS: Record<Zone, Record<Action, number>> = {
  def: { pass: 70, dribble: 15, longBall: 15, shot: 0 },
  mid: { pass: 56, dribble: 26, longBall: 14, shot: 4 },
  att: { pass: 32, dribble: 22, longBall: 0, shot: 46 },
};

/** Style = the club's long-term identity: action-weight multipliers in percent (§B5). */
export const STYLE_WEIGHTS: Record<Style, Record<Action, number>> = {
  allOutAttack: { pass: 90, dribble: 115, longBall: 90, shot: 125 },
  counterPunch: { pass: 90, dribble: 110, longBall: 125, shot: 105 },
  possessionWall: { pass: 135, dribble: 90, longBall: 65, shot: 90 },
  longBallSiege: { pass: 80, dribble: 85, longBall: 175, shot: 105 },
  parkTheBus: { pass: 105, dribble: 85, longBall: 110, shot: 85 },
};

const DRIVE_WEIGHTS: Partial<Record<SoccerPlayer['drive'], Partial<Record<Action, number>>>> = {
  selfish: { shot: 165, pass: 80 },
  conductor: { pass: 130, shot: 75 },
  wall: { shot: 0, pass: 120 },
  showboat: { dribble: 175 },
  predator: { shot: 120 },
};

/** Which defender (by position, weighted) meets the ball in each of the attacker's zones. */
const DEFENDERS_BY_ZONE: Record<Zone, SoccerPosition[]> = {
  def: ['P', 'P', 'W', 'W'],
  mid: ['W', 'W', 'A', 'P'],
  att: ['A', 'A', 'A', 'W', 'W'],
};

/** Which teammate receives the ball in each zone. */
const RECEIVERS_BY_ZONE: Record<Zone, SoccerPosition[]> = {
  def: ['A', 'A', 'W', 'K'],
  mid: ['W', 'W', 'A', 'P'],
  att: ['P', 'P', 'W', 'W', 'W'],
};

const ADVANCE: Record<Zone, Zone> = { def: 'mid', mid: 'att', att: 'att' };
const MIRROR: Record<Zone, Zone> = { def: 'att', mid: 'mid', att: 'def' };

const IN_POSSESSION: Record<Zone, Phase> = { def: 'buildUp', mid: 'progression', att: 'creation' };
const BLOCK_OF: Record<Zone, Block> = { def: 'high', mid: 'mid', att: 'low' };
const BLOCK_PHASE: Record<Block, Phase> = { high: 'highBlock', mid: 'midBlock', low: 'lowBlock' };

interface Side {
  team: SoccerTeam;
  home: boolean;
  /** On the floor, slot order K, A, W, W, P. */
  five: string[];
  bench: string[];
  /** Per-player match swing (Spark drive), fixed at kickoff. */
  swing: Record<string, number>;
}

interface MatchState {
  rng: Rng;
  league: SoccerLeague;
  sides: [Side, Side]; // [home, away]
  score: { home: number; away: number };
  half: 1 | 2;
  second: number;
  halfEnd: number;
  stamina: Record<string, number>;
  events: SoccerEvent[];
}

export function soccerSeed(universeSeed: string, seasonId: number, gameId: string): (string | number)[] {
  return ['soccer', universeSeed, seasonId, gameId];
}

const sideIndex = (s: MatchState, teamId: string) => (s.sides[0].team.id === teamId ? 0 : 1);

function rating(s: MatchState, side: Side, id: string, key: SoccerRatingKey): number {
  const p = s.league.players[id];
  let v = p.ratings[key] + (side.swing[id] ?? 0) + (side.home ? HOME_BONUS : 0);
  // Fatigue: below 60 stamina, every 4 points lost costs 1.
  const st = s.stamina[id] ?? 100;
  if (st < 60) v -= Math.trunc((60 - st) / 4);
  // Ice: composure bonus in the last 10 minutes of the match.
  if (key === 'composure' && p.drive === 'ice' && s.half === 2 && s.second >= s.halfEnd - 600) v += 15;
  return clamp(v, 1, 110);
}

const avg2 = (s: MatchState, side: Side, id: string, a: SoccerRatingKey, b: SoccerRatingKey) =>
  Math.trunc((rating(s, side, id, a) + rating(s, side, id, b)) / 2);

function playerAt(s: MatchState, side: Side, positions: readonly SoccerPosition[], exclude?: string): string {
  const pos = s.rng.pick(positions);
  const candidates = side.five.filter((id, i) => id !== exclude && slotOf(i) === pos);
  if (candidates.length) return s.rng.pick(candidates);
  const outfield = side.five.filter((id, i) => id !== exclude && i > 0);
  return outfield.length ? s.rng.pick(outfield) : side.five[0];
}

const slotOf = (i: number): SoccerPosition => (i === 0 ? 'K' : i === 1 ? 'A' : i === 4 ? 'P' : 'W');

/** Omit that keeps each member of the event union separate. */
type EventInput = SoccerEvent extends infer E ? (E extends SoccerEvent ? Omit<E, 'second' | 'minute' | 'half' | 'score' | 'phase' | 'defPhase'> & { phase?: Phase; defPhase?: Phase } : never) : never;

function emit(s: MatchState, attacking: Side, zone: Zone | undefined, e: EventInput) {
  const z = zone ?? 'mid';
  s.events.push({
    second: s.second,
    minute: Math.floor(s.second / 60) + 1,
    half: s.half,
    score: { ...s.score },
    possessionTeamId: attacking.team.id,
    zone,
    phase: e.phase ?? IN_POSSESSION[z],
    defPhase: e.defPhase ?? BLOCK_PHASE[BLOCK_OF[z]],
    ...e,
  } as SoccerEvent);
}

function pickAction(s: MatchState, side: Side, carrier: string, zone: Zone, step: number): Action {
  if (step >= MAX_STEPS - 1) return zone === 'att' && s.league.players[carrier].drive !== 'wall' ? 'shot' : 'pass';
  const style = STYLE_WEIGHTS[side.team.style];
  const drive = DRIVE_WEIGHTS[s.league.players[carrier].drive] ?? {};
  const isKeeper = side.five[0] === carrier;
  const weights = ACTIONS.map((a) => {
    let w = ZONE_WEIGHTS[zone][a] * style[a] * (drive[a] ?? 100);
    if (isKeeper && a !== 'pass' && a !== 'longBall') w = 0;
    return w;
  });
  const total = weights.reduce((x, y) => x + y, 0);
  let r = s.rng.int(total);
  for (let i = 0; i < ACTIONS.length; i++) {
    if (r < weights[i]) return ACTIONS[i];
    r -= weights[i];
  }
  return 'pass';
}

function drainStamina(s: MatchState, seconds: number) {
  for (const side of s.sides) {
    for (const id of side.five) {
      // Keepers barely tire; outfielders lose more the lower their Stamina rating.
      const base = side.five[0] === id ? 1 : 3 + Math.trunc((100 - rating(s, side, id, 'stamina')) / 20);
      s.stamina[id] = Math.max(0, (s.stamina[id] ?? 100) - Math.trunc((base * seconds) / 25));
    }
    for (const id of side.bench) s.stamina[id] = Math.min(100, (s.stamina[id] ?? 100) + Math.trunc(seconds / 6));
  }
}

/** Rolling substitutions (§B4): a tired outfielder swaps with the freshest outfield reserve. */
function rollingSubs(s: MatchState) {
  for (const side of s.sides) {
    for (let i = 1; i < side.five.length; i++) {
      const out = side.five[i];
      if ((s.stamina[out] ?? 100) >= 45) continue;
      const fresh = side.bench
        .filter((id) => s.league.players[id].position !== 'K' && (s.stamina[id] ?? 100) >= 75)
        .sort((a, b) => (s.stamina[b] ?? 100) - (s.stamina[a] ?? 100) || side.bench.indexOf(a) - side.bench.indexOf(b))[0];
      if (!fresh) continue;
      side.five[i] = fresh;
      side.bench = [...side.bench.filter((id) => id !== fresh), out];
      emit(s, side, undefined, { kind: 'sub', teamId: side.team.id, outId: out, inId: fresh, phase: 'attSetPiece', defPhase: 'defSetPiece' });
    }
  }
}

interface ChainStart {
  attacking: number; // side index
  zone: Zone;
  carrier?: string;
  kind: 'kickoff' | 'turnover' | 'restart';
}

/** Resolve a shot. Returns the outcome and who (if anyone) has the ball next. */
function shoot(s: MatchState, att: Side, def: Side, shooter: string, zone: Zone, bonus: number, assistId: string | undefined): { outcome: ShotOutcome; next: ChainStart | 'continue' } {
  const p = s.league.players[shooter];
  const defender = playerAt(s, def, DEFENDERS_BY_ZONE[zone]);
  const keeper = def.five[0];
  let quality = (zone === 'att' ? 34 : 10) + Math.trunc((rating(s, att, shooter, 'finishing') - 50) / 3) + bonus;
  quality += Math.trunc((rating(s, att, shooter, 'composure') - 50) / 6);
  quality -= Math.trunc((rating(s, def, defender, 'positioning') - 50) / 4);
  if (p.drive === 'predator') quality += zone === 'att' ? 10 : -10;
  if (p.drive === 'selfish') quality -= 3;
  quality = clamp(quality, 3, 92);

  const blockPm = clamp(110 + (rating(s, def, defender, 'positioning') - 50) * 2 - quality, 40, 260);
  let outcome: ShotOutcome;
  let blockerId: string | undefined;
  if (s.rng.chance(blockPm)) {
    outcome = 'blocked';
    blockerId = defender;
  } else if (!s.rng.chance(clamp(430 + quality * 5, 300, 920))) {
    outcome = s.rng.int(9) === 0 ? 'woodwork' : 'wide';
  } else {
    const keeping = Math.trunc((rating(s, def, keeper, 'reflexes') * 2 + rating(s, def, keeper, 'handling')) / 3);
    outcome = s.rng.chance(clamp(Math.trunc((quality * 17) / 2) - (keeping - 50) * 2, 30, 900)) ? 'goal' : 'saved';
  }
  emit(s, att, zone, { kind: 'shot', playerId: shooter, assistId, quality, outcome, keeperId: keeper, blockerId });

  const attI = sideIndex(s, att.team.id);
  const defI = 1 - attI;
  if (outcome === 'goal') {
    if (att.home) s.score.home++;
    else s.score.away++;
    emit(s, att, zone, { kind: 'goal', scorerId: shooter, assistId, teamId: att.team.id });
    return { outcome, next: { attacking: defI, zone: 'mid', kind: 'kickoff' } };
  }
  // The walls keep the ball live: blocks, woodwork and parried saves can fall back to the attack.
  const reboundPm = outcome === 'blocked' ? 380 : outcome === 'woodwork' ? 450 : outcome === 'saved' ? 260 : 0;
  if (reboundPm && s.rng.chance(reboundPm)) return { outcome, next: 'continue' };
  if (outcome === 'blocked') return { outcome, next: { attacking: defI, zone: MIRROR[zone], carrier: blockerId, kind: 'turnover' } };
  return { outcome, next: { attacking: defI, zone: 'def', carrier: keeper, kind: 'restart' } };
}

function runChain(s: MatchState, start: ChainStart): ChainStart {
  const att = s.sides[start.attacking];
  const def = s.sides[1 - start.attacking];
  const attI = start.attacking;
  const defI = 1 - attI;
  let zone = start.zone;
  let carrier = start.carrier && att.five.includes(start.carrier) ? start.carrier : playerAt(s, att, RECEIVERS_BY_ZONE[zone]);

  if (start.kind === 'kickoff') emit(s, att, zone, { kind: 'kickoff', teamId: att.team.id, phase: 'attSetPiece', defPhase: 'defSetPiece' });
  else if (start.kind === 'restart') emit(s, att, zone, { kind: 'keeperRestart', teamId: att.team.id, keeperId: att.five[0], phase: 'attSetPiece', defPhase: 'defSetPiece' });
  else emit(s, att, zone, { kind: 'possession', teamId: att.team.id, playerId: carrier, zone, phase: 'attTransition', defPhase: 'defTransition' });
  s.second += s.rng.range(6, 14);

  let assist: string | undefined;
  let bonus = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const action = pickAction(s, att, carrier, zone, step);
    s.second += s.rng.range(3, 8);
    const defender = playerAt(s, def, DEFENDERS_BY_ZONE[zone]);

    if (action === 'shot') {
      const { next } = shoot(s, att, def, carrier, zone, bonus, assist);
      if (next !== 'continue') return next;
      // Rebound: a scramble in the attacking zone, the attackers win it.
      carrier = playerAt(s, att, RECEIVERS_BY_ZONE.att);
      zone = 'att';
      assist = undefined;
      bonus = 4;
      continue;
    }

    if (action === 'pass') {
      const atk = Math.trunc((rating(s, att, carrier, 'passing') * 2 + rating(s, att, carrier, 'vision')) / 3);
      const dfn = avg2(s, def, defender, 'positioning', 'tackling');
      const success = s.rng.chance(clamp(820 + (atk - dfn) * 3 - (zone === 'att' ? 90 : 0), 500, 960));
      const advancePm = zone === 'def' ? 520 : zone === 'mid' ? 360 : 0;
      const advanced = success && advancePm > 0 && s.rng.chance(advancePm);
      const nextZone = advanced ? ADVANCE[zone] : zone;
      const to = playerAt(s, att, RECEIVERS_BY_ZONE[nextZone], carrier);
      emit(s, att, zone, { kind: 'pass', from: carrier, to, success, advanced, interceptorId: success ? undefined : defender, route: advanced ? (to === att.five[4] ? 'through' : 'around') : undefined });
      if (!success) return { attacking: defI, zone: MIRROR[zone], carrier: defender, kind: 'turnover' };
      const conductor = s.league.players[carrier].drive === 'conductor';
      assist = carrier;
      bonus = nextZone === 'att' ? 6 + (conductor ? 6 : 0) + Math.trunc((rating(s, att, carrier, 'vision') - 50) / 8) : 0;
      carrier = to;
      zone = nextZone;
      continue;
    }

    if (action === 'dribble') {
      const atk = avg2(s, att, carrier, 'dribbling', 'pace');
      const dfn = avg2(s, def, defender, 'tackling', 'pace');
      const showboat = s.league.players[carrier].drive === 'showboat';
      const success = s.rng.chance(clamp(560 + (atk - dfn) * 4 + (showboat ? 40 : 0), 250, 860));
      emit(s, att, zone, { kind: 'dribble', playerId: carrier, defenderId: defender, success });
      if (!success) return { attacking: defI, zone: MIRROR[zone], carrier: defender, kind: 'turnover' };
      assist = undefined;
      bonus = zone === 'att' ? 8 + (showboat ? 4 : 0) : 0;
      zone = ADVANCE[zone];
      continue;
    }

    // Long ball: skip a zone, high risk.
    const aerial = playerAt(s, def, ['A', 'A', 'W']);
    const atk = Math.trunc((rating(s, att, carrier, 'passing') * 2 + rating(s, att, carrier, 'vision')) / 3);
    const success = s.rng.chance(clamp(470 + (atk - rating(s, def, aerial, 'aerial')) * 4, 200, 800));
    const target = success ? playerAt(s, att, ['P', 'P', 'W']) : null;
    emit(s, att, zone, { kind: 'longBall', from: carrier, to: target, success, route: 'over' });
    if (!target) return { attacking: defI, zone: 'def', carrier: aerial, kind: 'turnover' };
    assist = carrier;
    bonus = 2;
    carrier = target;
    zone = 'att';
  }
  return { attacking: defI, zone: MIRROR[zone], kind: 'turnover' };
}

export interface SoccerSimOptions {
  /** Players who can't play this match (injured, vanished, sealed out). */
  unavailable?: ReadonlySet<string>;
}

export function simulateSoccer(league: SoccerLeague, game: SoccerFixture, seasonId = 1, opts: SoccerSimOptions = {}): SoccerResult {
  const rng = createRng(...soccerSeed(league.seed, seasonId, game.id));
  const makeSide = (teamId: string, home: boolean): Side => {
    const team = league.teams.find((t) => t.id === teamId)!;
    const five = selectLineup(team, league, opts.unavailable);
    const bench = team.squad.filter((id) => !five.includes(id) && !opts.unavailable?.has(id) && league.players[id]);
    const swing: Record<string, number> = {};
    for (const id of [...five, ...bench]) if (league.players[id].drive === 'spark') swing[id] = rng.range(-12, 12);
    return { team, home, five, bench, swing };
  };
  const s: MatchState = {
    rng,
    league,
    sides: [makeSide(game.homeId, true), makeSide(game.awayId, false)],
    score: { home: 0, away: 0 },
    half: 1,
    second: 0,
    halfEnd: HALF_SECONDS + rng.int(3) * 60,
    stamina: {},
    events: [],
  };
  const lineups = { home: [...s.sides[0].five], away: [...s.sides[1].five] };

  // Home kicks off the first half, away the second.
  for (const half of [1, 2] as const) {
    s.half = half;
    if (half === 2) {
      s.second = HALF_SECONDS;
      s.halfEnd = HALF_SECONDS * 2 + rng.int(3) * 60;
    }
    let next: ChainStart = { attacking: half === 1 ? 0 : 1, zone: 'mid', kind: 'kickoff' };
    while (s.second < s.halfEnd) {
      const before = s.second;
      next = runChain(s, next);
      drainStamina(s, s.second - before);
      rollingSubs(s);
    }
    if (half === 1) emit(s, s.sides[0], undefined, { kind: 'halfTime', phase: 'attSetPiece', defPhase: 'defSetPiece' });
  }
  const winnerId = s.score.home > s.score.away ? game.homeId : s.score.away > s.score.home ? game.awayId : null;
  emit(s, s.sides[0], undefined, { kind: 'fullTime', winnerId, phase: 'attSetPiece', defPhase: 'defSetPiece' });
  return { gameId: game.id, homeId: game.homeId, awayId: game.awayId, homeScore: s.score.home, awayScore: s.score.away, lineups, events: s.events };
}
