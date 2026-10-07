import type { Block, Lane, Phase, SoccerEvent, SoccerPosition, Zone } from '../../engine/soccer/types';

/**
 * The live pitch (PRD §B10a) as a pure function of the event stream: `pitchStateAt(events, i)`.
 * No physics: every player sits at a spot derived from their role, the ball zone/lane and the
 * defending block. Coordinates are 0–100 along the arena (x) and across it (y). The viewer's
 * club always attacks left → right.
 */

export interface PitchContext {
  homeId: string;
  awayId: string;
  /** Starting fives, keeper first (K, A, W, W, P). */
  lineups: { home: string[]; away: string[] };
  /** The club drawn attacking left → right (the fan's club, else home). */
  viewClubId: string;
}

export interface Token {
  id: string;
  teamId: string;
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
  | { kind: 'goal'; teamId: string }
  | { kind: 'transition'; label: 'COUNTER-PRESS' | 'RETREAT' | 'COUNTER!' | 'RESET' }
  | { kind: 'setPiece'; label: string }
  | { kind: 'signature'; playerId: string; signatureId: string }
  | { kind: 'awakening'; playerId: string }
  | { kind: 'facility'; text: string }
  | { kind: 'card'; color: 'yellow' | 'red' };

export interface PitchFrame {
  index: number;
  minute: number;
  half: 1 | 2;
  score: { home: number; away: number };
  momentum: number;
  possessionTeamId: string | null;
  phase: Phase | null;
  defPhase: Phase | null;
  ball: { x: number; y: number };
  /** Third holding the ball (0–2, left to right on screen) and whose colour lights it. */
  litThird: { index: number; teamId: string } | null;
  /** The defending team's block as a band (x range on screen). */
  block: { teamId: string; depth: Block; x0: number; x1: number } | null;
  tokens: Token[];
  overlay: Overlay;
  /** Draw a bank line off this wall. */
  bank: 'left' | 'right' | null;
}

const SLOTS: SoccerPosition[] = ['K', 'A', 'W', 'W', 'P'];
const LANE_Y: Record<Lane, number> = { left: 22, center: 50, right: 78 };
const ZONE_INDEX: Record<Zone, number> = { def: 0, mid: 1, att: 2 };
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The x (0–100 on screen) of a zone-relative depth for a team, given which way it attacks. */
function screenX(rightward: boolean, depth: number) {
  return rightward ? depth : 100 - depth;
}

/** Depth (0 = own goal, 100 = opponent goal) of each third's centre. */
const THIRD_DEPTH = [17, 50, 83];

interface Tracker {
  five: Record<string, string[]>;
  short: Record<string, number | null>;
  carrier: string | null;
  zone: Zone;
  lane: Lane;
  block: Block;
}

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

export function pitchStateAt(events: SoccerEvent[], index: number, ctx: PitchContext): PitchFrame {
  const t: Tracker = {
    five: { [ctx.homeId]: [...ctx.lineups.home], [ctx.awayId]: [...ctx.lineups.away] },
    short: { [ctx.homeId]: null, [ctx.awayId]: null },
    carrier: null,
    zone: 'mid',
    lane: 'center',
    block: 'mid',
  };
  const last = Math.max(0, Math.min(index, events.length - 1));
  for (let i = 0; i <= last; i++) {
    const e = events[i];
    if (!e) break;
    if (e.zone) t.zone = e.zone;
    if (e.lane) t.lane = e.lane;
    if (e.block) t.block = e.block;
    const c = carrierOf(e);
    if (c) t.carrier = c;
    if (e.kind === 'kickoff') t.zone = 'mid';
    if (e.kind === 'sub' && e.inId) t.five[e.teamId] = t.five[e.teamId].map((id) => (id === e.outId ? e.inId : id));
    if (e.kind === 'powerPlay') t.short[e.teamId] = e.slot;
    if (e.kind === 'powerPlayEnd') {
      const slot = t.short[e.teamId];
      if (slot !== null && e.inId) t.five[e.teamId][slot] = e.inId;
      t.short[e.teamId] = null;
    }
  }
  const e = events[last];
  const possession = e?.possessionTeamId ?? null;
  const rightward = (teamId: string) => teamId === ctx.viewClubId;
  const attacker = possession ?? ctx.homeId;
  const defender = attacker === ctx.homeId ? ctx.awayId : ctx.homeId;

  // Ball: depth of the attacking team's zone, across at the lane.
  const ballDepth = THIRD_DEPTH[ZONE_INDEX[t.zone]];
  const ball = { x: screenX(rightward(attacker), ballDepth), y: LANE_Y[t.lane] };

  const tokens: Token[] = [];
  const place = (teamId: string, attacking: boolean) => {
    const right = rightward(teamId);
    t.five[teamId].forEach((id, slotIdx) => {
      const slot = SLOTS[slotIdx];
      const empty = t.short[teamId] === slotIdx;
      let depth: number;
      let y: number;
      if (slot === 'K') {
        depth = 4;
        y = 50;
      } else if (attacking) {
        // In possession: spread around the ball's third.
        const d = ballDepth;
        depth = slot === 'A' ? d - 26 : slot === 'P' ? d + 14 : d - 4;
        y = slot === 'W' ? (slotIdx === 2 ? 18 : 82) : slot === 'P' ? 46 : 54;
      } else {
        // Out of possession: the block decides how high the line sits.
        const line = t.block === 'high' ? 62 : t.block === 'mid' ? 42 : 20;
        depth = slot === 'A' ? line - 10 : slot === 'P' ? line + 16 : line + 2;
        // Defenders stand goal-side and a little off the attackers' lines so tokens don't stack.
        y = slot === 'W' ? (slotIdx === 2 ? 30 : 70) : slot === 'P' ? 62 : 38;
      }
      depth = clamp(depth, 3, 97);
      tokens.push({ id, teamId, slot, x: screenX(right, depth), y, empty: empty || undefined, carrier: !empty && id === t.carrier && teamId === attacker ? true : undefined });
    });
  };
  place(attacker, true);
  place(defender, false);
  const carrierToken = tokens.find((k) => k.carrier);
  if (carrierToken) {
    // The ball sits at the carrier's feet, nudged toward the ball's lane.
    ball.x = carrierToken.x + (rightward(attacker) ? 2 : -2);
    ball.y = clamp(Math.round((carrierToken.y + ball.y) / 2), 6, 94);
  }

  const blockDepth = t.block === 'high' ? [55, 80] : t.block === 'mid' ? [35, 60] : [8, 32];
  const defRight = rightward(defender);
  const bx = [screenX(defRight, blockDepth[0]), screenX(defRight, blockDepth[1])].sort((a, b) => a - b);

  return {
    index: last,
    minute: e?.minute ?? 0,
    half: e?.half ?? 1,
    score: e?.score ?? { home: 0, away: 0 },
    momentum: e?.momentum ?? 0,
    possessionTeamId: possession,
    phase: e?.phase ?? null,
    defPhase: e?.defPhase ?? null,
    ball,
    litThird: possession ? { index: Math.floor(Math.min(99, ball.x) / (100 / 3)), teamId: possession } : null,
    block: possession ? { teamId: defender, depth: t.block, x0: bx[0], x1: bx[1] } : null,
    tokens,
    overlay: overlayOf(e),
    bank: e && ((e.kind === 'shot' && e.wall) || (e.kind === 'wallPass')) ? (e.kind === 'shot' ? e.wall! : e.wall) : null,
  };
}

function overlayOf(e: SoccerEvent | undefined): Overlay {
  if (!e) return { kind: 'none' };
  switch (e.kind) {
    case 'shot': return { kind: 'shot', outcome: e.outcome, banked: !!e.wall };
    case 'goal': return { kind: 'goal', teamId: e.teamId };
    case 'transition':
      if (e.outcome === 'regained') return { kind: 'transition', label: 'COUNTER-PRESS' };
      if (e.outcome === 'breakaway') return { kind: 'transition', label: 'COUNTER!' };
      return { kind: 'transition', label: e.attChoice === 'counter' ? 'COUNTER!' : e.defChoice === 'retreat' ? 'RETREAT' : 'RESET' };
    case 'freeKick': return { kind: 'setPiece', label: 'FREE KICK' };
    case 'spotKick': return { kind: 'setPiece', label: 'SPOT KICK' };
    case 'penalty': return { kind: 'setPiece', label: e.spot === 'penalty' ? 'PENALTY' : 'SPOT KICK' };
    case 'kickoff': return { kind: 'setPiece', label: 'KICK-OFF' };
    case 'signature': return { kind: 'signature', playerId: e.playerId, signatureId: e.signatureId };
    case 'awakening': return { kind: 'awakening', playerId: e.playerId };
    case 'facilityEvent': return { kind: 'facility', text: e.text };
    case 'arenaShift': return { kind: 'facility', text: 'The floor turns 90°.' };
    case 'card': return { kind: 'card', color: e.color };
    default: return { kind: 'none' };
  }
}
