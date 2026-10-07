export type RatingKey =
  | 'contact' | 'power' | 'discipline' // batting
  | 'velocity' | 'control' | 'stuff'  // pitching
  | 'speed'                            // baserunning
  | 'defense';                         // defense

/** Hidden ratings, integers 0–100. */
export type Ratings = Record<RatingKey, number>;

export type StarGroup = 'batting' | 'pitching' | 'baserunning' | 'defense';

export type Role = 'batter' | 'pitcher';

export interface Player {
  id: string;
  name: string;
  teamId: string;
  role: Role;
  position: string;
  ratings: Ratings;
}

export interface Team {
  id: string;
  city: string;
  name: string;
  abbr: string;
  colors: [string, string];
  /** 9 batters, batting order. */
  lineup: string[];
  /** 4 pitchers, rotation order. */
  rotation: string[];
}

export interface League {
  seed: string;
  name: string;
  teams: Team[];
  players: Record<string, Player>;
}

export interface ScheduledGame {
  id: string;
  day: number;
  awayId: string;
  homeId: string;
}

export type Half = 'top' | 'bottom';
export type Bases = [string | null, string | null, string | null];

export type HitKind = 'single' | 'double' | 'triple' | 'homeRun';
export type OutKind = 'groundout' | 'flyout' | 'lineout' | 'popout';

interface EventBase {
  inning: number;
  half: Half;
  outs: number;
  balls: number;
  strikes: number;
  bases: Bases;
  score: { away: number; home: number };
  /** Set when an environment event changed this play (engine v4+). */
  cause?: CauseRef;
}

export type GameEvent = EventBase & (
  | { kind: 'gameStart'; awayPitcherId: string; homePitcherId: string }
  | { kind: 'halfStart'; battingTeamId: string }
  | { kind: 'atBat'; batterId: string; pitcherId: string }
  | { kind: 'ball' | 'calledStrike' | 'swingingStrike' | 'foul'; batterId: string; pitcherId: string }
  | { kind: 'walk'; batterId: string; pitcherId: string }
  | { kind: 'strikeout'; batterId: string; pitcherId: string; swinging: boolean }
  | { kind: 'hit'; batterId: string; pitcherId: string; hit: HitKind }
  | { kind: 'out'; batterId: string; pitcherId: string; out: OutKind; sacrifice: boolean; /** Engine v3+: who made the play. */ fielderId?: string }
  | { kind: 'run'; runnerId: string; teamId: string }
  | { kind: 'halfEnd' }
  | { kind: 'gameEnd'; winnerId: string; loserId: string }
  // Engine v3 (Sprint 12).
  | { kind: 'stealAttempt'; runnerId: string; from: 1 | 2; pitcherId: string; success: boolean }
  | { kind: 'pickoff'; runnerId: string; base: 1 | 2; pitcherId: string }
  | { kind: 'error'; fielderId: string; batterId: string; pitcherId: string; onKind: OutKind; bases: number }
  | { kind: 'doublePlay'; batterId: string; pitcherId: string; runnerOutId: string; fielderId: string }
  | { kind: 'wildPitch'; pitcherId: string; advanced: string[] }
  | { kind: 'hitByPitch'; batterId: string; pitcherId: string }
  // Engine v4 (Sprint 13): stadium environment events. A changed play carries `cause` and is
  // followed by an envEffect line; effects that aren't a play (a runner sent home) are the envEffect itself.
  | { kind: 'envStart'; envId: string }
  | { kind: 'envEffect'; envId: string; changed: string; advanced?: string[]; removedId?: string }
  | { kind: 'envEnd'; envId: string }
);

export type EnvPhase = 'prePitch' | 'onContact' | 'afterPlay';
export type EnvEffectType =
  | 'forceBall' | 'forceStrike' | 'wildPitch' | 'runnersAdvance' | 'pickoff'
  | 'upgradeHit' | 'downgradeHit' | 'outToHit' | 'hitToOut' | 'induceError' | 'homeRunToOut' | 'outToHomeRun'
  | 'extraRun' | 'runnerHome' | 'runnerRemoved';

/** What the engine needs to know about one environment event (the full definition lives in content). */
export interface EnvEventDef {
  id: string;
  name: string;
  icon: string;
  /** Per mille, each plate appearance, before chaos scaling. */
  chancePerMille: number;
  phase: EnvPhase;
  effect: { type: EnvEffectType; from?: string[]; to?: string; chancePerMille: number };
  /** Effects before it's spent (default 1). */
  maxEffects?: number;
  /** Plate appearances it lasts (default: the rest of the half-inning). */
  durationPA?: number;
  announce: string;
  effectText: string;
  fizzle?: string;
}

/** The events that can happen in one game, and the chaos multiplier (×1000). */
export interface GameEnvironment {
  events: EnvEventDef[];
  chaosPerMille: number;
  /** Starts at the first plate appearance of the bottom of the 1st, no roll (Hype Squad's Wave). */
  forcedEnv?: EnvEventDef;
  /** Late home rally while the fan watches (Hype Squad L2): +1 Contact per run behind from the 8th, up to `max`. */
  rally?: { teamId: string; max: number };
}

/** Why an event happened differently than the engine first rolled (environment events, Sprint 13). */
export interface CauseRef {
  type: 'env';
  id: string;
  original: string;
}

export interface GameResult {
  gameId: string;
  awayId: string;
  homeId: string;
  awayScore: number;
  homeScore: number;
  innings: number;
  events: GameEvent[];
}
