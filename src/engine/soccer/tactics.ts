import content from '../../../content/soccer/tactics.json';
import type { Block, SoccerRatingKey, Style, TacticId } from './types';

/**
 * Matchday tactics (PRD §B7a): a one-match overlay on top of a club's Style. Data in
 * content/soccer/tactics.json: rating bonuses and penalties, action-weight changes, a block
 * and transition preference, and which tactics each one beats (rock-paper-scissors).
 */

export type TacticAction = 'pass' | 'dribble' | 'longBall' | 'shot' | 'wallPass';
export type TacticLean = 'attack' | 'defence' | 'possession';

export interface TacticDef {
  id: TacticId;
  name: string;
  blurb: string;
  bonus: Partial<Record<SoccerRatingKey, number>>;
  penalty: Partial<Record<SoccerRatingKey, number>>;
  /** Action weights in percent (100 = unchanged). */
  actions: Partial<Record<TacticAction, number>>;
  longShots?: boolean;
  block?: Block;
  transition?: 'secure' | 'counter' | 'press' | 'retreat';
  /** Counter Blitz: a counter from the defensive third skips straight to the attacking third. */
  blitz?: boolean;
  opponentShotQuality?: number;
  staminaPct?: number;
  setPieceBonus?: number;
  /** Styles this tactic fits; anything else carries the −3 "unfamiliar" penalty. */
  styles: Style[];
  beats: TacticId[];
  lean: TacticLean;
}

export interface SupporterBloc {
  id: string;
  name: string;
  lean: TacticLean;
  /** Percent of the club's fans. */
  share: number;
}

export const TACTICS = content.tactics as TacticDef[];
export const SUPPORTER_BLOCS = content.blocs as SupporterBloc[];
const BY_ID = new Map(TACTICS.map((t) => [t.id, t]));
export const getTactic = (id: TacticId | undefined) => (id ? BY_ID.get(id) : undefined);

/** Bonus added to a tactic's bonus stats when it counters the opponent's tactic. */
export const COUNTER_BONUS = 5;
export const UNFAMILIAR_PENALTY = 3;

export const beats = (a: TacticId | undefined, b: TacticId | undefined) => !!a && !!b && (getTactic(a)?.beats.includes(b) ?? false);

/** The rating changes a tactic brings for one match: bonus (+counter), penalty, and the unfamiliar penalty. */
export function tacticDeltas(tactic: TacticDef, style: Style, opponent: TacticId | undefined, countersOn = true): Partial<Record<SoccerRatingKey, number>> {
  const out: Partial<Record<SoccerRatingKey, number>> = {};
  const add = (k: SoccerRatingKey, v: number) => (out[k] = (out[k] ?? 0) + v);
  const counter = countersOn && beats(tactic.id, opponent);
  for (const [k, v] of Object.entries(tactic.bonus) as [SoccerRatingKey, number][]) add(k, v + (counter ? COUNTER_BONUS : 0));
  for (const [k, v] of Object.entries(tactic.penalty) as [SoccerRatingKey, number][]) add(k, v);
  if (!tactic.styles.includes(style)) for (const k of Object.keys(tactic.bonus) as SoccerRatingKey[]) add(k, -UNFAMILIAR_PENALTY);
  return out;
}
