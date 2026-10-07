import { createRng, type Rng } from '../core/rng';
import { getArena, getSignature, type ArenaEffects, type SignatureDef, type SignatureTrigger } from './arenas';
import { selectLineup } from './lineup';
import { BLOCK_PHASE, chooseBlock, chooseSetup, IN_POSSESSION, laneOfSlot, rollTransition, SETUP_SHOT_BONUS } from './phase';
import type {
  Block, Lane, Phase, ShotOutcome, SoccerEvent, SoccerFixture, SoccerLeague, SoccerPlayer, SoccerPosition, SoccerRatingKey,
  SoccerResult, SoccerTeam, Style, Zone,
} from './types';

/**
 * Soccer engine (Democracy FC PRD §B5): possession chains on a 3×3 grid inside a walled 5v5 arena.
 * Pure and deterministic — seeded PRNG only, integer math only. Bump on any outcome change.
 */
export const SOCCER_ENGINE_VERSION = 1; // pre-release: no saved soccer seasons exist yet

export const HALF_SECONDS = 20 * 60;
const MAX_STEPS = 8;
const HOME_BONUS = 2;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

type Action = 'pass' | 'dribble' | 'longBall' | 'shot' | 'wallPass';
const ACTIONS: readonly Action[] = ['pass', 'dribble', 'longBall', 'shot', 'wallPass'];

/** Base action weights by zone (relative to the team in possession). */
const ZONE_WEIGHTS: Record<Zone, Record<Action, number>> = {
  def: { pass: 70, dribble: 15, longBall: 15, shot: 0, wallPass: 0 },
  mid: { pass: 50, dribble: 24, longBall: 13, shot: 4, wallPass: 9 },
  att: { pass: 28, dribble: 20, longBall: 0, shot: 46, wallPass: 6 },
};

/** Style = the club's long-term identity: action-weight multipliers in percent (§B5). */
export const STYLE_WEIGHTS: Record<Style, Record<Action, number>> = {
  allOutAttack: { pass: 90, dribble: 115, longBall: 90, shot: 125, wallPass: 110 },
  counterPunch: { pass: 90, dribble: 110, longBall: 125, shot: 105, wallPass: 100 },
  possessionWall: { pass: 135, dribble: 90, longBall: 65, shot: 90, wallPass: 125 },
  longBallSiege: { pass: 80, dribble: 85, longBall: 175, shot: 105, wallPass: 70 },
  parkTheBus: { pass: 105, dribble: 85, longBall: 110, shot: 85, wallPass: 90 },
};

const DRIVE_WEIGHTS: Partial<Record<SoccerPlayer['drive'], Partial<Record<Action, number>>>> = {
  selfish: { shot: 165, pass: 80 },
  conductor: { pass: 130, shot: 75, wallPass: 120 },
  wall: { shot: 0, pass: 120 },
  showboat: { dribble: 175, wallPass: 130 },
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

/** Pass success modifier (per mille) by the defending block and the passer's zone. */
const PASS_VS_BLOCK: Record<Block, Record<Zone, number>> = {
  high: { def: -90, mid: 40, att: 0 },
  mid: { def: 20, mid: 0, att: 0 },
  low: { def: 60, mid: 60, att: -30 },
};

const ADVANCE: Record<Zone, Zone> = { def: 'mid', mid: 'att', att: 'att' };
const MIRROR: Record<Zone, Zone> = { def: 'att', mid: 'mid', att: 'def' };


interface Side {
  team: SoccerTeam;
  home: boolean;
  /** On the floor, slot order K, A, W, W, P. */
  five: string[];
  bench: string[];
  /** Per-player match swing (Spark drive), fixed at kickoff. */
  swing: Record<string, number>;
  /** Fouls this half (from the 6th, every foul gives a Spot Kick). */
  fouls: number;
  yellows: Record<string, number>;
  /** Red card power play: the emptied slot (shown as '' in `five`) and when a reserve may come on. */
  short: { slot: number; until: number } | null;
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
  /** −10..+10, home perspective (§B5 Momentum). */
  momentum: number;
  /** Each team's current defensive block (Phase Engine). */
  blocks: Record<string, Block>;
  /** Lane of the ball (for the pitch view). */
  lane: Lane;
  /** Last free kick's defensive setup. */
  setup: 'wall' | 'man' | 'zonal' | null;
  arenaId: string;
  arena: ArenaEffects;
  /** Signature Move uses this match (max 2 each). */
  sigUses: Record<string, number>;
  awakenings: string[];
  allowAwakening: boolean;
  teamDeltas: Record<string, Partial<Record<SoccerRatingKey, number>>>;
  playerDeltas: Record<string, Partial<Record<SoccerRatingKey, number>>>;
  injuries: Record<string, number>;
  events: SoccerEvent[];
}

export function soccerSeed(universeSeed: string, seasonId: number, gameId: string): (string | number)[] {
  return ['soccer', universeSeed, seasonId, gameId];
}

const sideIndex = (s: MatchState, teamId: string) => (s.sides[0].team.id === teamId ? 0 : 1);
const otherSide = (s: MatchState, side: Side) => (s.sides[0] === side ? s.sides[1] : s.sides[0]);

/** Shift momentum toward one side, bounded to −10..+10. Integer math. */
function swingMomentum(s: MatchState, toward: Side, amount: number) {
  if (s.arena.noMomentum) return;
  s.momentum = clamp(s.momentum + (toward.home ? amount : -amount), -10, 10);
}

function rating(s: MatchState, side: Side, id: string, key: SoccerRatingKey): number {
  const p = s.league.players[id];
  let v = p.ratings[key] + (side.swing[id] ?? 0) + (side.home ? HOME_BONUS : 0);
  v += (s.teamDeltas['*']?.[key] ?? 0) + (s.teamDeltas[side.team.id]?.[key] ?? 0) + (s.playerDeltas[id]?.[key] ?? 0);
  // Fatigue: below 60 stamina, every 4 points lost costs 1.
  const st = s.stamina[id] ?? 100;
  if (st < 60) v -= Math.trunc((60 - st) / 4);
  // Ice: composure bonus in the last 10 minutes of the match.
  if (key === 'composure' && p.drive === 'ice' && s.half === 2 && s.second >= s.halfEnd - 600) v += 15;
  if (key === 'composure' && p.drive === 'showboat') v += s.arena.showboatComposure ?? 0;
  // Momentum lifts the side that has it (±2 at the extremes).
  v += Math.trunc((side.home ? s.momentum : -s.momentum) / 4);
  // Power play: four can't cover the floor, and everyone has more room against them.
  if (side.short) v -= 6;
  if (otherSide(s, side).short) v += 5;
  return clamp(v, 1, 110);
}

const avg2 = (s: MatchState, side: Side, id: string, a: SoccerRatingKey, b: SoccerRatingKey) =>
  Math.trunc((rating(s, side, id, a) + rating(s, side, id, b)) / 2);

function playerAt(s: MatchState, side: Side, positions: readonly SoccerPosition[], exclude?: string): string {
  const pos = s.rng.pick(positions);
  const candidates = side.five.filter((id, i) => id && id !== exclude && slotOf(i) === pos);
  if (candidates.length) return s.rng.pick(candidates);
  const outfield = side.five.filter((id, i) => id && id !== exclude && i > 0);
  return outfield.length ? s.rng.pick(outfield) : side.five[0];
}

const slotOf = (i: number): SoccerPosition => (i === 0 ? 'K' : i === 1 ? 'A' : i === 4 ? 'P' : 'W');

/** Omit that keeps each member of the event union separate. */
type EventInput = SoccerEvent extends infer E ? (E extends SoccerEvent ? Omit<E, 'second' | 'minute' | 'half' | 'score' | 'phase' | 'defPhase'> & { phase?: Phase; defPhase?: Phase } : never) : never;

function emit(s: MatchState, attacking: Side, zone: Zone | undefined, e: EventInput) {
  const z = zone ?? 'mid';
  const block = s.blocks[otherSide(s, attacking).team.id] ?? 'mid';
  s.events.push({
    second: s.second,
    minute: Math.floor(s.second / 60) + 1,
    half: s.half,
    score: { ...s.score },
    possessionTeamId: attacking.team.id,
    zone,
    momentum: s.momentum,
    lane: s.lane,
    block,
    phase: e.phase ?? IN_POSSESSION[z],
    defPhase: e.defPhase ?? BLOCK_PHASE[block],
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
    // Wall passes are a Wing specialty.
    if (a === 'wallPass' && side.five.indexOf(carrier) !== 2 && side.five.indexOf(carrier) !== 3) w = 0;
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
      if (!id) continue;
      // Keepers barely tire; outfielders lose more the lower their Stamina rating.
      const base = side.five[0] === id ? 1 : 3 + Math.trunc((100 - rating(s, side, id, 'stamina')) / 20);
      const press = s.blocks[side.team.id] === 'high' ? 5 : 4; // High Block: ×1.25
      const cold = s.arena.staminaPct ?? 100;
      s.stamina[id] = Math.max(0, (s.stamina[id] ?? 100) - Math.trunc((base * seconds * press * cold) / 33000));
    }
    for (const id of side.bench) s.stamina[id] = Math.min(100, (s.stamina[id] ?? 100) + Math.trunc(seconds / 6));
  }
}

/** Rolling substitutions (§B4): a tired outfielder swaps with the freshest outfield reserve. */
function rollingSubs(s: MatchState) {
  for (const side of s.sides) {
    for (let i = 1; i < side.five.length; i++) {
      const out = side.five[i];
      if (!out || (s.stamina[out] ?? 100) >= 45) continue;
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

/** A goal: score, momentum, and a short-handed conceding side gets its fifth player back. */
function scoreGoal(s: MatchState, att: Side, def: Side, zone: Zone, scorerId: string, assistId: string | undefined) {
  const trailing = (att.home ? s.score.home - s.score.away : s.score.away - s.score.home) < 0;
  if (att.home) s.score.home++;
  else s.score.away++;
  emit(s, att, zone, { kind: 'goal', scorerId, assistId, teamId: att.team.id });
  swingMomentum(s, att, 4);
  if (def.short) endPowerPlay(s, def);
  // Awakening (§B4): scoring while trailing late. Rare; the world caps it per season.
  if (s.allowAwakening && trailing && s.half === 2 && s.second >= s.halfEnd - 600 && !s.awakenings.length && s.rng.chance(AWAKEN_PM)) {
    s.awakenings.push(scorerId);
    emit(s, att, zone, { kind: 'awakening', playerId: scorerId, teamId: att.team.id });
  }
}

/** The freshest reserve for a slot (keepers only for the keeper slot). */
function bestReserve(s: MatchState, side: Side, slot: number): string | null {
  const keeper = slot === 0;
  const pool = side.bench.filter((id) => (s.league.players[id].position === 'K') === keeper);
  if (!pool.length) return null;
  return pool.reduce((best, id) => ((s.stamina[id] ?? 100) > (s.stamina[best] ?? 100) ? id : best));
}

function endPowerPlay(s: MatchState, side: Side) {
  if (!side.short) return;
  const { slot } = side.short;
  const inId = bestReserve(s, side, slot);
  if (inId) {
    side.five[slot] = inId;
    side.bench = side.bench.filter((id) => id !== inId);
  }
  side.short = null;
  emit(s, side, undefined, { kind: 'powerPlayEnd', teamId: side.team.id, inId, phase: 'attSetPiece', defPhase: 'defSetPiece' });
}

/** Take a player off for good (red card or injury). A red leaves the side short for 2 minutes (§B5). */
function removePlayer(s: MatchState, side: Side, id: string, red: boolean) {
  let slot = side.five.indexOf(id);
  if (slot < 0) return;
  side.five[slot] = '';
  if (slot === 0) {
    // The backup keeper has to come on; an outfielder makes way instead.
    const k = bestReserve(s, side, 0);
    if (k) {
      side.five[0] = k;
      side.bench = side.bench.filter((x) => x !== k);
      const giveUp = side.five.findIndex((x, i) => i > 0 && x);
      if (red && giveUp > 0) {
        side.bench.push(side.five[giveUp]);
        side.five[giveUp] = '';
        slot = giveUp;
      } else slot = -1;
    }
  }
  if (slot < 0) return;
  if (red && !side.short) {
    side.short = { slot, until: s.second + 120 };
    emit(s, side, undefined, { kind: 'powerPlay', teamId: side.team.id, untilSecond: side.short.until, phase: 'defSetPiece', defPhase: 'attSetPiece' });
    return;
  }
  const inId = bestReserve(s, side, slot);
  if (inId) {
    side.five[slot] = inId;
    side.bench = side.bench.filter((x) => x !== inId);
    emit(s, side, undefined, { kind: 'sub', teamId: side.team.id, outId: id, inId, phase: 'attSetPiece', defPhase: 'defSetPiece' });
  }
}

/** Best spot-kick taker on the floor: Finishing + Composure. */
function penaltyTaker(s: MatchState, side: Side): string {
  const outfield = side.five.filter((id, i) => id && i > 0);
  const score = (id: string) => rating(s, side, id, 'finishing') + rating(s, side, id, 'composure');
  return outfield.reduce((best, id) => (score(id) > score(best) ? id : best));
}

function kickScores(s: MatchState, att: Side, def: Side, taker: string, base: number): boolean {
  const skill = Math.trunc((rating(s, att, taker, 'finishing') + rating(s, att, taker, 'composure')) / 2);
  const keeper = def.five[0];
  return s.rng.chance(clamp(base + (skill - 50) * 3 - (rating(s, def, keeper, 'reflexes') - 50) * 2, 450, 930));
}

export const FOUL_RATES = {
  /** Per mille, a beaten defender brings the dribbler down. */
  beaten: 350,
  /** Per mille, a winning tackle is a foul anyway. */
  won: 90,
  /** Per mille of fouls in the attacking third that are in the box (penalty). */
  inBox: 70,
  yellow: 90,
  red: 4,
  injury: 14,
  /** Team fouls per half before Spot Kicks start (the 6th foul and every one after). */
  spotKickFrom: 6,
};

/** A foul by `fouler` on `victim`. Returns the next chain, or 'continue' when the attack keeps the ball. */
function foul(s: MatchState, att: Side, def: Side, zone: Zone, victim: string, fouler: string): ChainStart | 'continue' {
  const attI = sideIndex(s, att.team.id);
  emit(s, att, zone, { kind: 'tackle', defenderId: fouler, victimId: victim, foul: true });
  def.fouls++;
  emit(s, att, zone, { kind: 'teamFouls', teamId: def.team.id, count: def.fouls });

  const yellows = def.yellows[fouler] ?? 0;
  const straightRed = s.rng.chance(FOUL_RATES.red);
  const yellow = !straightRed && s.rng.chance(FOUL_RATES.yellow);
  if (yellow) {
    def.yellows[fouler] = yellows + 1;
    emit(s, att, zone, { kind: 'card', playerId: fouler, teamId: def.team.id, color: 'yellow' });
    swingMomentum(s, att, 1);
  }
  if (straightRed || (yellow && yellows >= 1)) {
    emit(s, att, zone, { kind: 'card', playerId: fouler, teamId: def.team.id, color: 'red' });
    swingMomentum(s, att, 2);
    removePlayer(s, def, fouler, true);
  }
  if (s.rng.chance(FOUL_RATES.injury) && att.five.includes(victim)) {
    const matches = s.rng.range(1, 4);
    s.injuries[victim] = matches;
    emit(s, att, zone, { kind: 'injury', playerId: victim, teamId: att.team.id, matches });
    removePlayer(s, att, victim, false);
  }

  const keeper = def.five[0];
  const spot = zone === 'att' && s.rng.chance(FOUL_RATES.inBox) ? 'penalty' : def.fouls >= FOUL_RATES.spotKickFrom ? 'spotKick' : null;
  if (spot) {
    const taker = penaltyTaker(s, att);
    if (spot === 'spotKick') emit(s, att, zone, { kind: 'spotKick', teamId: att.team.id, takerId: taker, phase: 'attSetPiece', defPhase: 'defSetPiece' });
    const scored = kickScores(s, att, def, taker, spot === 'penalty' ? 760 : 640);
    emit(s, att, 'att', { kind: 'penalty', takerId: taker, keeperId: keeper, scored, spot, phase: 'attSetPiece', defPhase: 'defSetPiece' });
    if (scored) {
      scoreGoal(s, att, def, 'att', taker, undefined);
      return { attacking: 1 - attI, zone: 'mid', kind: 'kickoff' };
    }
    swingMomentum(s, def, 1);
    return { attacking: 1 - attI, zone: 'def', carrier: keeper, kind: 'restart' };
  }
  const taker = att.five.includes(victim) ? victim : penaltyTaker(s, att);
  emit(s, att, zone, { kind: 'freeKick', teamId: att.team.id, takerId: taker, phase: 'attSetPiece', defPhase: 'defSetPiece' });
  s.setup = chooseSetup(s.rng, zone);
  emit(s, att, zone, { kind: 'setPieceSetup', teamId: def.team.id, setup: s.setup, phase: 'attSetPiece', defPhase: 'defSetPiece' });
  return 'continue';
}

export const SIGNATURE_PM = 90;
export const BOND_ACTIVE = 3;
export const RIVAL_ACTIVE = 3;
/** Per mille, a late goal by a trailing side Awakens the scorer (the world caps it per season). */
export const AWAKEN_PM = 25;

const bonded = (s: MatchState, a: string, b: string) => (s.league.players[a]?.bonds?.[b] ?? 0) >= BOND_ACTIVE;
const rivals = (s: MatchState, a: string, b: string) => (s.league.players[a]?.rivals?.[b] ?? 0) >= RIVAL_ACTIVE;
const wallSide = (s: MatchState): 'left' | 'right' => (s.lane === 'right' ? 'right' : 'left');

/** A Signature Move fires: rare, at most twice a match per player, logged with its own event. */
function trySignature(s: MatchState, attacking: Side, zone: Zone, id: string, trigger: SignatureTrigger): SignatureDef | null {
  const sig = getSignature(s.league.players[id]?.signatureId);
  if (!sig || sig.trigger !== trigger || (s.sigUses[id] ?? 0) >= 2) return null;
  if (sig.lateOnlySeconds && !(s.half === 2 && s.second >= s.halfEnd - sig.lateOnlySeconds)) return null;
  if (!s.rng.chance(SIGNATURE_PM)) return null;
  s.sigUses[id] = (s.sigUses[id] ?? 0) + 1;
  emit(s, attacking, zone, { kind: 'signature', playerId: id, signatureId: sig.id });
  return sig;
}

/** A loose ball off the walls: Pace + First Touch decide who comes away with it. */
function scramble(s: MatchState, a: Side, b: Side, zone: Zone): { side: Side; playerId: string } {
  const pa = playerAt(s, a, RECEIVERS_BY_ZONE[zone]);
  const pb = playerAt(s, b, DEFENDERS_BY_ZONE[zone]);
  const aWins = s.rng.chance(clamp(500 + (avg2(s, a, pa, 'pace', 'firstTouch') - avg2(s, b, pb, 'pace', 'firstTouch')) * 4, 200, 800));
  const [winSide, win, lose] = aWins ? [a, pa, pb] : [b, pb, pa];
  emit(s, a, zone, { kind: 'scramble', winnerId: win, loserId: lose, winnerTeamId: winSide.team.id });
  return { side: winSide, playerId: win };
}

/** The downhill side on The Slope: home in the 1st half, away in the 2nd. */
const downhill = (s: MatchState, side: Side) => (s.half === 1) === side.home;

interface ChainStart {
  attacking: number; // side index
  zone: Zone;
  carrier?: string;
  kind: 'kickoff' | 'turnover' | 'restart';
}

/** What happens to the ball after a shot: a new chain, or the attackers keep it after a scramble. */
type AfterShot = { next: ChainStart } | { keep: string };

/** Resolve a shot (or a banked wallShot). */
function shoot(s: MatchState, att: Side, def: Side, shooter: string, zone: Zone, bonus: number, assistId: string | undefined, wall = false): AfterShot {
  const p = s.league.players[shooter];
  let defender = playerAt(s, def, DEFENDERS_BY_ZONE[zone]);
  const keeper = def.five[0];
  let quality = (zone === 'att' ? 34 : 10) + Math.trunc((rating(s, att, shooter, 'finishing') - 50) / 3) + bonus;
  quality += Math.trunc((rating(s, att, shooter, 'composure') - 50) / 6);
  quality -= Math.trunc((rating(s, def, defender, 'positioning') - 50) / 4);
  if (p.drive === 'predator') quality += zone === 'att' ? 10 : -10;
  if (p.drive === 'selfish') quality -= 3;
  const lowBlock = s.blocks[def.team.id] === 'low';
  if (lowBlock) quality -= 8;
  if (wall) quality += -6 + (s.arena.wallShotQuality ?? 0);
  if (downhill(s, att)) quality += s.arena.downhillQuality ?? 0;
  const sig = trySignature(s, att, zone, shooter, wall ? 'wallShot' : 'shot');
  if (sig) quality += sig.effect.quality ?? 0;
  quality = clamp(quality, 3, 92);

  // The Closing Door: a defender's signature block.
  const closer = def.five.find((id) => id && getSignature(s.league.players[id].signatureId)?.trigger === 'defendShot');
  const doorShut = closer ? trySignature(s, def, MIRROR[zone], closer, 'defendShot') : null;
  if (doorShut && closer) defender = closer;

  const blockPm = clamp(110 + (lowBlock ? 50 : 0) + (rating(s, def, defender, 'positioning') - 50) * 2 - quality, 40, 300);
  let outcome: ShotOutcome;
  let blockerId: string | undefined;
  if (doorShut || s.rng.chance(blockPm)) {
    outcome = 'blocked';
    blockerId = defender;
  } else if (!s.rng.chance(clamp(430 + quality * 5, 300, 920))) {
    outcome = !wall && s.rng.int(9) === 0 ? 'woodwork' : 'wide';
  } else {
    // Banked shots are unpredictable: Reflexes count for less.
    const reflexes = rating(s, def, keeper, 'reflexes') + (wall ? s.arena.wallShotReflexes ?? 0 : 0);
    const keeping = wall ? Math.trunc((reflexes + rating(s, def, keeper, 'handling') * 2) / 3) - 6 : Math.trunc((reflexes * 2 + rating(s, def, keeper, 'handling')) / 3);
    outcome = s.rng.chance(clamp(Math.trunc((quality * 17) / 2) - (keeping - 50) * 2, 30, 900)) ? 'goal' : 'saved';
    if (outcome === 'goal' && trySignature(s, def, MIRROR[zone], keeper, 'save')) outcome = 'saved';
  }
  emit(s, att, zone, { kind: 'shot', playerId: shooter, assistId, quality, outcome, keeperId: keeper, blockerId, wall: wall ? wallSide(s) : undefined });

  const attI = sideIndex(s, att.team.id);
  const defI = 1 - attI;
  if (outcome === 'goal') {
    scoreGoal(s, att, def, zone, shooter, assistId);
    return { next: { attacking: defI, zone: 'mid', kind: 'kickoff' } };
  }
  if (outcome === 'saved') swingMomentum(s, def, 1);
  // The walls keep the ball live: blocks, woodwork and parried saves rebound into a scramble.
  const reboundPm = (outcome === 'blocked' ? 520 : outcome === 'woodwork' ? 650 : outcome === 'saved' ? 360 : 0) + (outcome === 'wide' ? 0 : s.arena.reboundPm ?? 0);
  if (reboundPm && s.rng.chance(reboundPm)) {
    const loose = scramble(s, att, def, 'att');
    if (loose.side === att) return { keep: loose.playerId };
    return { next: { attacking: defI, zone: 'def', carrier: loose.playerId, kind: 'turnover' } };
  }
  if (outcome === 'blocked') return { next: { attacking: defI, zone: MIRROR[zone], carrier: blockerId, kind: 'turnover' } };
  return { next: { attacking: defI, zone: 'def', carrier: keeper, kind: 'restart' } };
}

function runChain(s: MatchState, start: ChainStart): ChainStart {
  const att = s.sides[start.attacking];
  const def = s.sides[1 - start.attacking];
  const attI = start.attacking;
  const defI = 1 - attI;
  let zone = start.zone;
  let carrier = '';
  const hold = (id: string) => {
    carrier = id;
    s.lane = laneOfSlot(att.five.indexOf(id));
  };
  hold(start.carrier && att.five.includes(start.carrier) ? start.carrier : playerAt(s, att, RECEIVERS_BY_ZONE[zone]));

  // The defending block for this chain (Style + score state).
  const lead = (def.home ? 1 : -1) * (s.score.home - s.score.away);
  const block = chooseBlock(s.rng, { style: def.team.style, lead, secondsLeft: s.half === 2 ? s.halfEnd - s.second : s.halfEnd - s.second + HALF_SECONDS });
  if (s.blocks[def.team.id] !== block) {
    s.blocks[def.team.id] = block;
    emit(s, att, zone, { kind: 'blockChange', teamId: def.team.id, block });
  }

  let assist: string | undefined;
  let bonus = 0;
  if (start.kind === 'kickoff') emit(s, att, zone, { kind: 'kickoff', teamId: att.team.id, phase: 'attSetPiece', defPhase: 'defSetPiece' });
  else if (start.kind === 'restart') emit(s, att, zone, { kind: 'keeperRestart', teamId: att.team.id, keeperId: att.five[0], phase: 'attSetPiece', defPhase: 'defSetPiece' });
  else {
    emit(s, att, zone, { kind: 'possession', teamId: att.team.id, playerId: carrier, zone, phase: 'attTransition', defPhase: 'defTransition' });
    // Transition (§B5a): the winners counter or secure; the losers counter-press or retreat.
    const presser = playerAt(s, def, DEFENDERS_BY_ZONE[zone]);
    const t = rollTransition(s.rng, {
      winnerStyle: att.team.style,
      loserStyle: def.team.style,
      loserBlock: s.blocks[def.team.id],
      pace: rating(s, att, carrier, 'pace'),
      tackling: rating(s, def, presser, 'tackling'),
    });
    emit(s, att, zone, { kind: 'transition', wonBy: att.team.id, lostBy: def.team.id, wonByBlock: s.blocks[att.team.id] ?? 'mid', ...t, phase: 'attTransition', defPhase: 'defTransition' });
    if (t.outcome === 'regained') {
      s.second += s.rng.range(2, 5);
      return { attacking: defI, zone: MIRROR[zone], carrier: presser, kind: 'turnover' };
    }
    if (t.outcome === 'breakaway') {
      // A failed counter-press in 5v5 leaves a 2v1 or a run at the keeper.
      zone = 'att';
      bonus = 10;
    } else if (t.attChoice === 'counter') zone = ADVANCE[zone];
    else zone = 'def';
  }
  s.second += s.rng.range(8, 16);
  for (let step = 0; step < MAX_STEPS; step++) {
    const action = pickAction(s, att, carrier, zone, step);
    s.second += s.rng.range(3, 8);
    const defender = playerAt(s, def, DEFENDERS_BY_ZONE[zone]);

    if (action === 'shot') {
      // Wings and Showboats like to bank it off the glass.
      const slot = att.five.indexOf(carrier);
      const banks = zone === 'att' && (slot === 2 || slot === 3 || s.league.players[carrier].drive === 'showboat') && s.rng.chance(220);
      const after = shoot(s, att, def, carrier, zone, bonus, assist, banks);
      if ('next' in after) return after.next;
      hold(after.keep);
      zone = 'att';
      assist = undefined;
      bonus = 4;
      continue;
    }

    if (action === 'pass') {
      const atk = Math.trunc((rating(s, att, carrier, 'passing') * 2 + rating(s, att, carrier, 'vision')) / 3);
      const dfn = avg2(s, def, defender, 'positioning', 'tackling');
      const to0 = playerAt(s, att, RECEIVERS_BY_ZONE[ADVANCE[zone]], carrier);
      const through = att.five.indexOf(to0) === 4 || att.five.indexOf(to0) === 1;
      const bond = bonded(s, carrier, to0);
      const routePm = zone === 'att' ? 0 : through ? s.arena.throughPassPm ?? 0 : s.arena.aroundPassPm ?? 0;
      const silk = trySignature(s, att, zone, carrier, 'pass');
      const success = !!silk || s.rng.chance(clamp(820 + (atk - dfn) * 3 - (zone === 'att' ? 90 : 0) + PASS_VS_BLOCK[block][zone] + (block === 'mid' && zone === 'mid' ? (through ? -60 : 20) : 0) + routePm + (bond ? 50 : 0), 450, 960));
      const advancePm = (zone === 'def' ? 520 : zone === 'mid' ? 360 : 0) + (block === 'high' && zone === 'mid' ? 120 : 0);
      const advanced = success && advancePm > 0 && (!!silk?.effect.advance || s.rng.chance(advancePm));
      const nextZone = advanced ? ADVANCE[zone] : zone;
      const to = advanced ? to0 : playerAt(s, att, RECEIVERS_BY_ZONE[nextZone], carrier);
      emit(s, att, zone, { kind: 'pass', from: carrier, to, success, advanced, interceptorId: success ? undefined : defender, route: advanced ? (through ? 'through' : 'around') : undefined, bond: bond && to === to0 ? true : undefined });
      if (!success) {
        // A deflected pass can cannon off the walls into a scramble.
        if (s.rng.chance(150 + (s.arena.scramblePm ?? 0))) {
          const loose = scramble(s, att, def, zone);
          if (loose.side === def) return { attacking: defI, zone: MIRROR[zone], carrier: loose.playerId, kind: 'turnover' };
          hold(loose.playerId);
          assist = undefined;
          bonus = 0;
          continue;
        }
        return { attacking: defI, zone: MIRROR[zone], carrier: defender, kind: 'turnover' };
      }
      const conductor = s.league.players[carrier].drive === 'conductor';
      assist = carrier;
      bonus = nextZone === 'att' ? 6 + (conductor ? 6 : 0) + (bond ? 4 : 0) + (silk?.effect.quality ?? 0) + Math.trunc((rating(s, att, carrier, 'vision') - 50) / 8) : 0;
      hold(to);
      zone = nextZone;
      continue;
    }

    if (action === 'dribble') {
      const atk = avg2(s, att, carrier, 'dribbling', 'pace');
      const dfn = avg2(s, def, defender, 'tackling', 'pace');
      const showboat = s.league.players[carrier].drive === 'showboat';
      const rivalry = rivals(s, carrier, defender);
      const turn = trySignature(s, att, zone, carrier, 'dribble');
      const success = !!turn || s.rng.chance(clamp(560 + (atk - dfn) * 4 + (showboat ? 40 : 0) + (block === 'high' && zone === 'def' ? -80 : 0), 250, 860));
      // Rivals go at each other: more fouls when they duel.
      if (!turn && s.rng.chance((success ? FOUL_RATES.beaten : FOUL_RATES.won) + (rivalry ? 120 : 0))) {
        const next = foul(s, att, def, zone, carrier, defender);
        if (next !== 'continue') return next;
        if (!att.five.includes(carrier)) carrier = penaltyTaker(s, att);
        // Free kick: in the attacking third the taker may go straight for goal.
        if (zone === 'att' && s.rng.chance(550)) {
          const shot = shoot(s, att, def, carrier, zone, -10 + SETUP_SHOT_BONUS[s.setup ?? 'man'], undefined);
          if ('next' in shot) return shot.next;
          hold(shot.keep);
        }
        assist = undefined;
        bonus = 0;
        continue;
      }
      emit(s, att, zone, { kind: 'dribble', playerId: carrier, defenderId: defender, success, rivals: rivalry || undefined });
      if (!success) return { attacking: defI, zone: MIRROR[zone], carrier: defender, kind: 'turnover' };
      assist = undefined;
      bonus = (zone === 'att' ? 8 + (showboat ? 4 : 0) : 0) + (turn?.effect.quality ?? 0);
      zone = ADVANCE[zone];
      continue;
    }

    if (action === 'wallPass') {
      // A one-two off the side wall: Passing + Vision vs the defender's Positioning.
      const atk = avg2(s, att, carrier, 'passing', 'vision');
      const ghost = trySignature(s, att, zone, carrier, 'wallPass');
      const success = !!ghost || s.rng.chance(clamp(640 + (atk - rating(s, def, defender, 'positioning')) * 4 + (s.arena.wallPassPm ?? 0), 300, 900));
      const wall = wallSide(s);
      emit(s, att, zone, { kind: 'wallPass', from: carrier, to: carrier, wall, success, route: 'around' });
      if (!success) {
        const loose = scramble(s, att, def, zone);
        if (loose.side === def) return { attacking: defI, zone: MIRROR[zone], carrier: loose.playerId, kind: 'turnover' };
        hold(loose.playerId);
        assist = undefined;
        bonus = 0;
        continue;
      }
      assist = undefined;
      bonus = (zone === 'att' ? 8 : 0) + (ghost?.effect.quality ?? 0);
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
    hold(target);
    zone = 'att';
  }
  return { attacking: defI, zone: MIRROR[zone], kind: 'turnover' };
}

export interface SoccerSimOptions {
  /** Players who can't play this match (injured, vanished, sealed out). */
  unavailable?: ReadonlySet<string>;
  /** Knockout match: a draw goes to a penalty shootout. */
  knockout?: boolean;
  /** Override the home team's arena (Facility rules, S5+). */
  arenaId?: string;
  /** False once the season's Awakening cap is reached (default true). */
  allowAwakening?: boolean;
  /** Rating changes for this match by team id ('*' = everyone): mods, Facility rules, Director events. Integer deltas. */
  teamDeltas?: Record<string, Partial<Record<SoccerRatingKey, number>>>;
  /** Per-player rating changes (player mods). */
  playerDeltas?: Record<string, Partial<Record<SoccerRatingKey, number>>>;
  /** Director announcements logged at kickoff. */
  facilityEvents?: { eventId: string; text: string }[];
}

/** 5 kicks each, then sudden death; every player on the floor takes one before anyone goes twice. */
function penaltyShootout(s: MatchState): { home: number; away: number; winnerId: string } {
  const order = (side: Side) => {
    const on = side.five.filter((id) => id);
    const score = (id: string) => rating(s, side, id, 'finishing') + rating(s, side, id, 'composure');
    return [...on].sort((a, b) => score(b) - score(a) || on.indexOf(a) - on.indexOf(b));
  };
  const takers = [order(s.sides[0]), order(s.sides[1])];
  const goals = [0, 0];
  const kicks: { teamId: string; takerId: string; scored: boolean }[] = [];
  let decided = false;
  for (let round = 0; round < 50 && !decided; round++) {
    for (const i of [0, 1]) {
      const att = s.sides[i];
      const taker = takers[i][round % takers[i].length];
      const scored = kickScores(s, att, s.sides[1 - i], taker, 720);
      if (scored) goals[i]++;
      kicks.push({ teamId: att.team.id, takerId: taker, scored });
      if (round < 5) {
        // Best of five: over as soon as one side can't catch up with the kicks it has left.
        const homeLeft = 4 - round;
        const awayLeft = i === 0 ? 5 - round : 4 - round;
        if (goals[0] > goals[1] + awayLeft || goals[1] > goals[0] + homeLeft) {
          decided = true;
          break;
        }
      }
    }
    if (round >= 4 && goals[0] !== goals[1]) decided = true;
  }
  // 50 rounds level is practically impossible; the home side takes it so there is always a winner.
  const winnerI = goals[1] > goals[0] ? 1 : 0;
  const winnerId = s.sides[winnerI].team.id;
  emit(s, s.sides[winnerI], undefined, { kind: 'shootout', kicks, winnerId, phase: 'attSetPiece', defPhase: 'defSetPiece' });
  return { home: goals[0], away: goals[1], winnerId };
}

export function simulateSoccer(league: SoccerLeague, game: SoccerFixture, seasonId = 1, opts: SoccerSimOptions = {}): SoccerResult {
  const rng = createRng(...soccerSeed(league.seed, seasonId, game.id));
  const makeSide = (teamId: string, home: boolean): Side => {
    const team = league.teams.find((t) => t.id === teamId)!;
    const five = selectLineup(team, league, opts.unavailable);
    const bench = team.squad.filter((id) => !five.includes(id) && !opts.unavailable?.has(id) && league.players[id]);
    const swing: Record<string, number> = {};
    for (const id of [...five, ...bench]) if (league.players[id].drive === 'spark') swing[id] = rng.range(-12, 12);
    return { team, home, five, bench, swing, fouls: 0, yellows: {}, short: null };
  };
  const home = league.teams.find((t) => t.id === game.homeId)!;
  const arena = getArena(opts.arenaId ?? home.arenaId);
  const s: MatchState = {
    rng,
    league,
    sides: [makeSide(game.homeId, true), makeSide(game.awayId, false)],
    score: { home: 0, away: 0 },
    half: 1,
    second: 0,
    halfEnd: HALF_SECONDS + rng.int(3) * 60,
    stamina: {},
    momentum: 0,
    blocks: {},
    lane: 'center',
    setup: null,
    arenaId: arena.id,
    arena: arena.effects,
    sigUses: {},
    awakenings: [],
    allowAwakening: opts.allowAwakening ?? true,
    teamDeltas: opts.teamDeltas ?? {},
    playerDeltas: opts.playerDeltas ?? {},
    injuries: {},
    events: [],
  };
  const lineups = { home: [...s.sides[0].five], away: [...s.sides[1].five] };
  for (const f of opts.facilityEvents ?? []) emit(s, s.sides[0], undefined, { kind: 'facilityEvent', eventId: f.eventId, text: f.text, phase: 'attSetPiece', defPhase: 'defSetPiece' });

  // Home kicks off the first half, away the second.
  for (const half of [1, 2] as const) {
    s.half = half;
    if (half === 2) {
      for (const side of s.sides) side.fouls = 0;
      s.second = HALF_SECONDS;
      s.halfEnd = HALF_SECONDS * 2 + rng.int(3) * 60;
    }
    let next: ChainStart = { attacking: half === 1 ? 0 : 1, zone: 'mid', kind: 'kickoff' };
    const rotate = s.arena.rotateEverySeconds ?? 0;
    let nextRotation = rotate ? s.second + rotate : Infinity;
    while (s.second < s.halfEnd) {
      const before = s.second;
      if (s.second >= nextRotation) {
        // Rotating Floor: play stops, the floor turns, and the ball is fought for in the middle.
        nextRotation += rotate;
        emit(s, s.sides[0], 'mid', { kind: 'arenaShift', arenaId: s.arenaId, phase: 'attSetPiece', defPhase: 'defSetPiece' });
        const loose = scramble(s, s.sides[0], s.sides[1], 'mid');
        next = { attacking: s.sides.indexOf(loose.side), zone: 'mid', carrier: loose.playerId, kind: 'turnover' };
      }
      for (const side of s.sides) if (side.short && s.second >= side.short.until) endPowerPlay(s, side);
      // Momentum fades a little every possession.
      s.momentum -= Math.sign(s.momentum);
      next = runChain(s, next);
      drainStamina(s, s.second - before);
      rollingSubs(s);
    }
    if (half === 1) emit(s, s.sides[0], undefined, { kind: 'halfTime', phase: 'attSetPiece', defPhase: 'defSetPiece' });
  }
  const winnerId = s.score.home > s.score.away ? game.homeId : s.score.away > s.score.home ? game.awayId : null;
  emit(s, s.sides[0], undefined, { kind: 'fullTime', winnerId, phase: 'attSetPiece', defPhase: 'defSetPiece' });
  const shootout = winnerId === null && opts.knockout ? penaltyShootout(s) : undefined;
  return { gameId: game.id, homeId: game.homeId, awayId: game.awayId, homeScore: s.score.home, awayScore: s.score.away, lineups, shootout, injuries: s.injuries, awakenings: s.awakenings, arenaId: s.arenaId, events: s.events };
}
