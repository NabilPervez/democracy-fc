import type { Rng } from '../core/rng';
import type { Block, Lane, Phase, SoccerEvent, SoccerResult, Style, Zone } from './types';

/**
 * The Phase Engine (Democracy FC PRD §B5a). Phases are a deterministic label derived from the
 * chain engine's state, plus three small decisions that feed back into the sim: the defending
 * block, the transition choices after a turnover, and the defensive set-piece setup.
 * Single source of truth: the UI never infers phases itself.
 */

export const ALL_PHASES: readonly Phase[] = [
  'buildUp', 'progression', 'creation',
  'highBlock', 'midBlock', 'lowBlock',
  'defTransition', 'attTransition',
  'attSetPiece', 'defSetPiece',
];

export const IN_POSSESSION: Record<Zone, Phase> = { def: 'buildUp', mid: 'progression', att: 'creation' };
export const BLOCK_PHASE: Record<Block, Phase> = { high: 'highBlock', mid: 'midBlock', low: 'lowBlock' };

export type Moment = 'open' | 'transition' | 'setPiece';

/** Phase from the attacking and defending perspectives. Pure. */
export function phaseOf(state: { zone: Zone; block: Block; moment: Moment }): { phase: Phase; defPhase: Phase } {
  if (state.moment === 'setPiece') return { phase: 'attSetPiece', defPhase: 'defSetPiece' };
  if (state.moment === 'transition') return { phase: 'attTransition', defPhase: 'defTransition' };
  return { phase: IN_POSSESSION[state.zone], defPhase: BLOCK_PHASE[state.block] };
}

/** Block weights [high, mid, low] by Style, in percent. */
const BLOCK_WEIGHTS: Record<Style, [number, number, number]> = {
  allOutAttack: [55, 35, 10],
  counterPunch: [15, 45, 40],
  possessionWall: [40, 45, 15],
  longBallSiege: [25, 50, 25],
  parkTheBus: [5, 30, 65],
};

export interface BlockContext {
  style: Style;
  /** Defending team's goal difference (positive = leading). */
  lead: number;
  /** Seconds left in the match. */
  secondsLeft: number;
  /** Tactic preference (S6b): forces a lean toward one block. */
  prefer?: Block;
}

/** The defending team's block for one chain: Style, then score state, seeded. Integer weights. */
export function chooseBlock(rng: Rng, ctx: BlockContext): Block {
  const w = [...BLOCK_WEIGHTS[ctx.style]];
  if (ctx.prefer) w[ctx.prefer === 'high' ? 0 : ctx.prefer === 'mid' ? 1 : 2] += 60;
  // Late in the match a leading side sits deeper; a trailing side presses.
  if (ctx.secondsLeft <= 600) {
    if (ctx.lead >= 2) w[2] += 60;
    else if (ctx.lead >= 1) w[2] += 30;
    else if (ctx.lead <= -1) w[0] += 40;
  }
  const r = rng.int(w[0] + w[1] + w[2]);
  return r < w[0] ? 'high' : r < w[0] + w[1] ? 'mid' : 'low';
}

export type AttChoice = 'counter' | 'secure';
export type DefChoice = 'counterPress' | 'retreat';
export type TransitionOutcome = 'regained' | 'breakaway' | 'settled';

/** Per mille, a team that just won the ball goes straight forward. */
const COUNTER_PM: Record<Style, number> = { allOutAttack: 650, counterPunch: 850, possessionWall: 250, longBallSiege: 600, parkTheBus: 550 };
/** Per mille, a team that just lost the ball presses to win it back. */
const PRESS_PM: Record<Style, number> = { allOutAttack: 700, counterPunch: 300, possessionWall: 600, longBallSiege: 350, parkTheBus: 150 };

export interface TransitionInput {
  winnerStyle: Style;
  loserStyle: Style;
  loserBlock: Block;
  /** Winner's carrier Pace vs the presser's Tackling (ratings already adjusted). */
  pace: number;
  tackling: number;
  /** Tactic overrides (S6b). */
  forceCounter?: boolean;
  forceSecure?: boolean;
  forcePress?: boolean;
  forceRetreat?: boolean;
}

/**
 * The 1-step mini-resolution at the start of every turnover chain (§B5a). Counter vs retreat
 * usually settles into Progression; counter vs counter-press is a duel: instant regain or a breakaway.
 */
export function rollTransition(rng: Rng, t: TransitionInput): { attChoice: AttChoice; defChoice: DefChoice; outcome: TransitionOutcome } {
  const counterPm = t.forceCounter ? 950 : t.forceSecure ? 100 : COUNTER_PM[t.winnerStyle];
  const pressPm = t.forcePress ? 950 : t.forceRetreat ? 100 : PRESS_PM[t.loserStyle] + (t.loserBlock === 'high' ? 150 : t.loserBlock === 'low' ? -100 : 0);
  const attChoice: AttChoice = rng.chance(counterPm) ? 'counter' : 'secure';
  const defChoice: DefChoice = rng.chance(pressPm) ? 'counterPress' : 'retreat';
  let outcome: TransitionOutcome = 'settled';
  if (defChoice === 'counterPress') {
    const duel = 500 + (t.tackling - t.pace) * 5;
    if (attChoice === 'counter') outcome = rng.chance(Math.max(150, Math.min(850, duel))) ? 'regained' : 'breakaway';
    else outcome = rng.chance(Math.max(80, Math.min(500, duel - 200))) ? 'regained' : 'settled';
  }
  return { attChoice, defChoice, outcome };
}

export type SetPieceSetup = 'wall' | 'man' | 'zonal';

/** The defending side's free-kick setup. A wall only forms when the kick is in shooting range. */
export function chooseSetup(rng: Rng, zone: Zone): SetPieceSetup {
  const r = rng.int(100);
  if (zone === 'att') return r < 50 ? 'wall' : r < 75 ? 'man' : 'zonal';
  return r < 50 ? 'man' : 'zonal';
}

/** Shot-quality modifier on a direct free kick against each setup. */
export const SETUP_SHOT_BONUS: Record<SetPieceSetup, number> = { wall: -8, man: 0, zonal: 4 };

export const laneOfSlot = (slot: number): Lane => (slot === 2 ? 'left' : slot === 3 ? 'right' : 'center');

export interface TeamPhaseStats {
  /** Seconds spent in each phase (from this team's perspective). */
  seconds: Record<Phase, number>;
  /** Balls won while defending in each block. */
  regainsByBlock: Record<Block, number>;
  countersLaunched: number;
  countersScored: number;
  setPieceGoals: number;
  transitionGoals: number;
}

const emptyPhaseSeconds = () => Object.fromEntries(ALL_PHASES.map((p) => [p, 0])) as Record<Phase, number>;
const emptyTeamStats = (): TeamPhaseStats => ({
  seconds: emptyPhaseSeconds(),
  regainsByBlock: { high: 0, mid: 0, low: 0 },
  countersLaunched: 0,
  countersScored: 0,
  setPieceGoals: 0,
  transitionGoals: 0,
});

/**
 * Phase stats for a match (recaps and the Analyst persona). Time between consecutive events is
 * credited to the attacking team's phase and the defending team's defPhase.
 */
export function phaseStats(r: SoccerResult): Record<string, TeamPhaseStats> {
  const stats: Record<string, TeamPhaseStats> = { [r.homeId]: emptyTeamStats(), [r.awayId]: emptyTeamStats() };
  const other = (id: string) => (id === r.homeId ? r.awayId : r.homeId);
  // How the current chain started, for crediting goals.
  let chainOrigin: 'open' | 'counter' | 'setPiece' = 'open';
  for (let i = 0; i < r.events.length; i++) {
    const e = r.events[i];
    const next = r.events[i + 1];
    const team = e.possessionTeamId;
    if (team && next && next.half === e.half && next.second > e.second) {
      const dt = next.second - e.second;
      stats[team].seconds[e.phase] += dt;
      stats[other(team)].seconds[e.defPhase] += dt;
    }
    if (e.kind === 'kickoff' || e.kind === 'keeperRestart' || e.kind === 'possession') chainOrigin = 'open';
    if (e.kind === 'freeKick' || e.kind === 'spotKick') chainOrigin = 'setPiece';
    if (e.kind === 'transition') {
      if (e.outcome !== 'regained') stats[e.wonBy].regainsByBlock[e.wonByBlock]++;
      if (e.attChoice === 'counter' && e.outcome !== 'regained') {
        stats[e.wonBy].countersLaunched++;
        chainOrigin = 'counter';
      } else chainOrigin = 'open';
    }
    if (e.kind === 'goal') {
      const prev = r.events[i - 1];
      if (prev?.kind === 'penalty' || chainOrigin === 'setPiece') stats[e.teamId].setPieceGoals++;
      else if (chainOrigin === 'counter') {
        stats[e.teamId].countersScored++;
        stats[e.teamId].transitionGoals++;
      }
    }
  }
  return stats;
}

/** Every event's phases are valid and consistent with each other. */
export function validPhases(e: SoccerEvent): boolean {
  if (!ALL_PHASES.includes(e.phase) || !ALL_PHASES.includes(e.defPhase)) return false;
  const pairs: Record<string, Phase[]> = {
    attSetPiece: ['defSetPiece'],
    defSetPiece: ['attSetPiece'],
    attTransition: ['defTransition'],
    buildUp: ['highBlock', 'midBlock', 'lowBlock'],
    progression: ['highBlock', 'midBlock', 'lowBlock'],
    creation: ['highBlock', 'midBlock', 'lowBlock'],
  };
  return pairs[e.phase]?.includes(e.defPhase) ?? false;
}
