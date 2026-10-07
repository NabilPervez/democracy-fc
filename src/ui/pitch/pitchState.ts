import type { Block, Phase, SoccerEvent, SoccerPosition, Zone } from '../../engine/soccer/types';

/**
 * The Assembly arena (PRD §B10a, "Arena View" mockup) as a pure function of the event stream:
 * `pitchStateAt(events, i, ctx)`. Coordinates are the mockup's 400 × 240 floor. No physics: each
 * player stands in a shape chosen from their team's phase (attackers) or block (defenders).
 * The viewer's club always attacks left → right.
 */

export const FLOOR = { w: 400, h: 240 };

export interface PitchContext {
  homeId: string;
  awayId: string;
  /** Starting fives, keeper first (K, A, W, W, P). */
  lineups: { home: string[]; away: string[] };
  /** The club drawn attacking left → right (the fan's club, else home). */
  viewClubId: string;
}

export type Role = 'K' | 'A' | 'W1' | 'W2' | 'P';
const ROLES: Role[] = ['K', 'A', 'W1', 'W2', 'P'];
const ROLE_SLOT: Record<Role, SoccerPosition> = { K: 'K', A: 'A', W1: 'W', W2: 'W', P: 'P' };

type Shape = 'buildup' | 'progress' | 'attack' | 'high' | 'mid' | 'low' | 'kickoff';

/** Shapes for a team attacking left → right (the mockup's positions; block shapes stagger A and P off the centre line so they don't sit on the attackers). */
const SHAPE: Record<Shape, Record<Role, [number, number]>> = {
  buildup: { K: [28, 120], A: [75, 150], W1: [150, 48], W2: [150, 192], P: [235, 120] },
  progress: { K: [30, 120], A: [120, 120], W1: [215, 52], W2: [205, 188], P: [285, 118] },
  attack: { K: [32, 120], A: [150, 120], W1: [285, 55], W2: [280, 185], P: [335, 115] },
  high: { K: [35, 120], A: [195, 102], W1: [295, 72], W2: [295, 168], P: [340, 140] },
  mid: { K: [25, 120], A: [105, 102], W1: [185, 75], W2: [185, 165], P: [245, 140] },
  low: { K: [20, 120], A: [55, 102], W1: [85, 80], W2: [85, 160], P: [140, 140] },
  kickoff: { K: [25, 120], A: [100, 120], W1: [160, 60], W2: [160, 180], P: [193, 120] },
};

const ZONE_SHAPE: Record<Zone, Shape> = { def: 'buildup', mid: 'progress', att: 'attack' };

export interface Token {
  id: string;
  teamId: string;
  role: Role;
  slot: SoccerPosition;
  x: number;
  y: number;
  /** Power play: the slot is empty, drawn as a dashed token. */
  empty?: boolean;
  carrier?: boolean;
}

export type Overlay =
  | { kind: 'none' }
  | { kind: 'shot'; outcome: 'goal' | 'saved' | 'wide' | 'blocked' | 'woodwork'; banked: boolean }
  | { kind: 'goal'; teamId: string; scorerId: string }
  | { kind: 'transition'; label: 'COUNTER-PRESS' | 'COUNTER!' | 'TRANSITION' }
  | { kind: 'setPiece'; label: string }
  | { kind: 'signature'; playerId: string; signatureId: string }
  | { kind: 'awakening'; playerId: string }
  | { kind: 'facility'; text: string; eventId?: string }
  | { kind: 'card'; color: 'yellow' | 'red' };

export interface PhaseChip {
  teamId: string;
  phase: Phase | null;
  /** One-line description of what that team is doing right now. */
  sub: string;
}

export interface PitchFrame {
  index: number;
  minute: number;
  /** Match clock, mm:ss. */
  clock: string;
  half: 1 | 2;
  score: { home: number; away: number };
  /** Team fouls this half. */
  fouls: { home: number; away: number };
  /** Possessions so far (chains started). */
  possession: number;
  momentum: number;
  possessionTeamId: string | null;
  phase: Phase | null;
  defPhase: Phase | null;
  /** Chips: [viewer's club, opponent]. */
  chips: [PhaseChip, PhaseChip];
  ball: { x: number; y: number };
  /** Third (0–2, left to right) holding the ball, and whose colour lights it. */
  litThird: { index: number; teamId: string } | null;
  /** The defending team's block as a band. */
  block: { teamId: string; depth: Block; x0: number; x1: number } | null;
  tokens: Token[];
  overlay: Overlay;
  /** A bank off a wall, as a polyline. */
  bank: [number, number][] | null;
  shotLine: { from: [number, number]; to: [number, number]; goal: boolean } | null;
  /** A turnover just happened here (flash ring). */
  flash: [number, number] | null;
  /** Facility effects active on the floor. */
  dark: boolean;
  wallShift: boolean;
  /** Spot Kick mark. */
  spot: [number, number] | null;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const mmss = (second: number) => `${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}`;

const carrierOf = (e: SoccerEvent): string | null => {
  switch (e.kind) {
    case 'possession': return e.playerId;
    case 'pass': return e.success ? e.to : e.interceptorId ?? null;
    case 'dribble': return e.success ? e.playerId : e.defenderId;
    case 'longBall': return e.to;
    case 'wallPass': return e.from;
    case 'shot': return e.playerId;
    case 'goal': return e.scorerId;
    case 'keeperRestart': return e.keeperId;
    case 'scramble': return e.winnerId;
    case 'freeKick': case 'spotKick': return e.takerId;
    case 'penalty': return e.takerId;
    default: return null;
  }
};

/** A new possession starts with a kick-off, a keeper restart or a turnover. */
export const chainStart = (e: SoccerEvent) => e.kind === 'kickoff' || e.kind === 'possession' || e.kind === 'keeperRestart';

/** What a team is doing, in a few words, for the phase chips. */
function subFor(e: SoccerEvent | undefined, teamId: string, attacking: boolean, block: Block, name: (id?: string | null) => string): string {
  if (!e) return '';
  if (e.kind === 'kickoff') return e.teamId === teamId ? 'Kick-off' : 'Shape set';
  if (e.kind === 'transition') {
    if (e.wonBy === teamId) return e.outcome === 'breakaway' ? 'Counter-attack · 2 v 1' : `Won it · choose: ${e.attChoice === 'counter' ? 'COUNTER' : 'SECURE'}`;
    return e.outcome === 'regained' ? 'Counter-press wins it back' : `Lost it · choose: ${e.defChoice === 'counterPress' ? 'COUNTER-PRESS' : 'RETREAT'}`;
  }
  if (e.kind === 'goal') return e.teamId === teamId ? `GOAL · ${name(e.scorerId)}` : '—';
  if (e.kind === 'shot') return attacking ? `Shot · quality ${e.quality}` : e.outcome === 'blocked' ? 'Blocked it' : e.outcome === 'saved' ? 'Saved' : 'Holding the box';
  if (e.kind === 'spotKick' || (e.kind === 'penalty' && e.spot === 'spotKick')) return attacking ? 'Spot Kick from 10m' : 'No wall allowed';
  if (e.kind === 'penalty') return attacking ? 'Penalty' : 'Keeper on the line';
  if (e.kind === 'freeKick') return attacking ? 'Free kick' : 'Setting the wall';
  if (e.kind === 'tackle') return attacking ? 'Fouled' : `Foul · ${name(e.defenderId)}`;
  if (e.kind === 'keeperRestart') return attacking ? 'Keeper restart' : 'Shape set';
  if (!attacking) return block === 'high' ? 'Pressing high' : block === 'mid' ? 'Holding mid depth' : 'Compact around the box';
  if (e.kind === 'pass' && e.advanced) return e.route === 'through' ? 'Through the middle' : 'Going around';
  if (e.kind === 'longBall') return 'Over the top';
  if (e.kind === 'wallPass') return 'One-two off the wall';
  if (e.kind === 'dribble') return e.success ? 'Beating a defender' : 'Dispossessed';
  return e.zone === 'def' ? 'Playing out from the back' : e.zone === 'mid' ? 'Breaking the lines' : 'Working a shot';
}

export function pitchStateAt(events: SoccerEvent[], index: number, ctx: PitchContext, names: Record<string, string> = {}): PitchFrame {
  const five: Record<string, string[]> = { [ctx.homeId]: [...ctx.lineups.home], [ctx.awayId]: [...ctx.lineups.away] };
  const short: Record<string, number | null> = { [ctx.homeId]: null, [ctx.awayId]: null };
  const fouls: Record<string, number> = { [ctx.homeId]: 0, [ctx.awayId]: 0 };
  let carrier: string | null = null;
  let zone: Zone = 'mid';
  let block: Block = 'mid';
  let possession = 0;
  let half: 1 | 2 = 1;
  let lightsUntil = -1;
  let shiftUntil = -1;
  const last = clamp(index, 0, Math.max(0, events.length - 1));
  for (let i = 0; i <= last; i++) {
    const e = events[i];
    if (!e) break;
    if (e.half !== half) {
      half = e.half;
      fouls[ctx.homeId] = 0;
      fouls[ctx.awayId] = 0;
    }
    if (e.zone) zone = e.zone;
    if (e.block) block = e.block;
    const c = carrierOf(e);
    if (c) carrier = c;
    if (chainStart(e)) possession++;
    if (e.kind === 'kickoff') zone = 'mid';
    if (e.kind === 'teamFouls') fouls[e.teamId] = e.count;
    if (e.kind === 'sub' && e.inId) five[e.teamId] = five[e.teamId].map((id) => (id === e.outId ? e.inId : id));
    if (e.kind === 'powerPlay') short[e.teamId] = e.slot;
    if (e.kind === 'powerPlayEnd') {
      const slot = short[e.teamId];
      if (slot !== null && e.inId) five[e.teamId][slot] = e.inId;
      short[e.teamId] = null;
    }
    // Facility effects last five minutes on the floor.
    if (e.kind === 'facilityEvent' && e.eventId === 'lights-out') lightsUntil = e.second + 300;
    if (e.kind === 'facilityEvent' && e.eventId === 'wall-shift') shiftUntil = e.second + 300;
  }
  const e = events[last];
  const name = (id?: string | null) => (id ? (names[id] ?? '').split(' ').slice(-1)[0] : '');
  const attacker = e?.possessionTeamId ?? ctx.homeId;
  const defender = attacker === ctx.homeId ? ctx.awayId : ctx.homeId;
  const rightward = (teamId: string) => teamId === ctx.viewClubId;
  const place = (teamId: string, [x, y]: [number, number]): [number, number] => (rightward(teamId) ? [x, y] : [FLOOR.w - x, y]);

  const kickoff = !e || e.kind === 'kickoff' || e.kind === 'lineups' || e.kind === 'halfTime';
  const attShape: Shape = kickoff ? 'kickoff' : ZONE_SHAPE[zone];
  const defShape: Shape = kickoff ? 'kickoff' : block;

  const tokens: Token[] = [];
  for (const [teamId, shape, attacking] of [[attacker, attShape, true], [defender, defShape, false]] as const) {
    five[teamId].forEach((id, slotIdx) => {
      const role = ROLES[slotIdx];
      const [x, y] = place(teamId, SHAPE[shape][role]);
      const empty = short[teamId] === slotIdx || !id;
      tokens.push({ id, teamId, role, slot: ROLE_SLOT[role], x, y, empty: empty || undefined, carrier: !empty && attacking && id === carrier ? true : undefined });
    });
  }
  const holder = tokens.find((t) => t.carrier);
  const ball = holder ? { x: holder.x + (rightward(attacker) ? 9 : -9), y: holder.y - 9 } : { x: FLOOR.w / 2, y: FLOOR.h / 2 };

  const goalX = rightward(attacker) ? 390 : 10;
  let shotLine: PitchFrame['shotLine'] = null;
  let bank: PitchFrame['bank'] = null;
  if (e?.kind === 'shot' && holder) {
    const to: [number, number] = [goalX, e.outcome === 'wide' ? 92 : e.outcome === 'woodwork' ? 100 : 120];
    if (e.wall) bank = [[holder.x, holder.y], [(holder.x + goalX) / 2, e.wall === 'left' ? 12 : 228], to];
    else shotLine = { from: [holder.x, holder.y], to, goal: e.outcome === 'goal' };
  }
  if (e?.kind === 'goal' && holder) {
    shotLine = { from: [holder.x, holder.y], to: [goalX, 120], goal: true };
    ball.x = goalX;
    ball.y = 120;
  }
  if (e?.kind === 'wallPass' && holder) {
    const back = rightward(attacker) ? -1 : 1;
    bank = [[holder.x + back * 50, holder.y], [holder.x + back * 25, e.wall === 'left' ? 12 : 228], [holder.x, holder.y]];
  }

  let blockBand: PitchFrame['block'] = null;
  if (!kickoff) {
    const xs = tokens.filter((t) => t.teamId === defender && t.role !== 'K').map((t) => t.x);
    blockBand = { teamId: defender, depth: block, x0: Math.min(...xs) - 14, x1: Math.max(...xs) + 14 };
  }

  const viewer = ctx.viewClubId;
  const other = viewer === ctx.homeId ? ctx.awayId : ctx.homeId;
  const phaseFor = (teamId: string) => (!e ? null : teamId === attacker ? e.phase : e.defPhase);
  const chip = (teamId: string): PhaseChip => ({ teamId, phase: phaseFor(teamId), sub: subFor(e, teamId, teamId === attacker, block, name) });

  const second = e?.second ?? 0;
  const bx = clamp(ball.x, 8, FLOOR.w - 8);
  return {
    index: last,
    minute: e?.minute ?? 0,
    clock: mmss(second),
    half: e?.half ?? 1,
    score: e?.score ?? { home: 0, away: 0 },
    fouls: { home: fouls[ctx.homeId], away: fouls[ctx.awayId] },
    possession,
    momentum: e?.momentum ?? 0,
    possessionTeamId: e?.possessionTeamId ?? null,
    phase: e?.phase ?? null,
    defPhase: e?.defPhase ?? null,
    chips: [chip(viewer), chip(other)],
    ball: { x: bx, y: clamp(ball.y, 8, FLOOR.h - 8) },
    litThird: e?.possessionTeamId ? { index: clamp(Math.floor((bx - 8) / 128), 0, 2), teamId: e.possessionTeamId } : null,
    block: blockBand,
    tokens,
    overlay: overlayOf(e),
    bank,
    shotLine,
    flash: e?.kind === 'transition' && holder ? [holder.x, holder.y] : null,
    dark: second < lightsUntil,
    wallShift: second < shiftUntil,
    spot: e && (e.kind === 'spotKick' || (e.kind === 'penalty' && e.spot === 'spotKick')) ? [rightward(attacker) ? 290 : 110, 120] : null,
  };
}

function overlayOf(e: SoccerEvent | undefined): Overlay {
  if (!e) return { kind: 'none' };
  switch (e.kind) {
    case 'shot': return { kind: 'shot', outcome: e.outcome, banked: !!e.wall };
    case 'goal': return { kind: 'goal', teamId: e.teamId, scorerId: e.scorerId };
    case 'transition':
      if (e.outcome === 'regained') return { kind: 'transition', label: 'COUNTER-PRESS' };
      if (e.outcome === 'breakaway') return { kind: 'transition', label: 'COUNTER!' };
      return { kind: 'transition', label: 'TRANSITION' };
    case 'freeKick': return { kind: 'setPiece', label: 'FREE KICK' };
    case 'spotKick': return { kind: 'setPiece', label: 'SPOT KICK' };
    case 'penalty': return { kind: 'setPiece', label: e.spot === 'penalty' ? 'PENALTY' : 'SPOT KICK' };
    case 'kickoff': return { kind: 'setPiece', label: 'KICK-OFF' };
    case 'signature': return { kind: 'signature', playerId: e.playerId, signatureId: e.signatureId };
    case 'awakening': return { kind: 'awakening', playerId: e.playerId };
    case 'facilityEvent': return { kind: 'facility', text: e.text, eventId: e.eventId };
    case 'arenaShift': return { kind: 'facility', text: 'FLOOR ROTATION' };
    case 'card': return { kind: 'card', color: e.color };
    default: return { kind: 'none' };
  }
}
