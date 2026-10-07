/**
 * The sport abstraction (Democracy FC PRD §C2). The shell — seasons, economy, elections, storage —
 * talks to a match engine only through this interface, so a universe can run baseball (legacy
 * saves) or soccer. Every engine must be pure and deterministic: same inputs ⇒ same output.
 */

export type SportId = 'baseball' | 'soccer';

/** Pre-match win/draw/loss chances in per-mille (they sum to 1000). `draw` is 0 for sports without draws. */
export interface Outcome3Way {
  homePm: number;
  drawPm: number;
  awayPm: number;
}

export interface SimContext<Env = unknown> {
  seasonId: number;
  /** Engine major version the season is simmed with (determinism is per version, per sport). */
  engineVersion: number;
  env?: Env;
  knockout?: boolean;
}

export interface MatchSummary {
  homeScore: number;
  awayScore: number;
  /** null = draw. */
  winnerId: string | null;
}

export interface SportEngine<L, G, R, P> {
  id: SportId;
  /** The newest engine version; new seasons are simmed with it. */
  engineVersion: number;
  allowsDraws: boolean;
  /** Pure, deterministic. */
  simulate(league: L, game: G, ctx: SimContext): R;
  /** Score + winner of a finished match, whatever the sport's result shape. */
  summarize(result: R): MatchSummary;
  /** Visible star groups (0–5 in half steps) from hidden ratings. */
  starGroups(player: P): Record<string, number>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySportEngine = SportEngine<any, any, any, any>;
