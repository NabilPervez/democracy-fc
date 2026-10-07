/** Democracy FC — 5v5 walled-arena soccer (PRD §B4, §B5, §C3). */

export type SoccerRatingKey =
  | 'finishing' | 'dribbling' | 'firstTouch'
  | 'passing' | 'vision'
  | 'tackling' | 'positioning' | 'aerial'
  | 'pace' | 'stamina' | 'composure'
  | 'reflexes' | 'handling';

export type SoccerRatings = Record<SoccerRatingKey, number>;

export type SoccerStarGroup = 'attack' | 'playmaking' | 'defense' | 'engine' | 'keeping';

/** Keeper, Anchor, Wing, Pivot. */
export type SoccerPosition = 'K' | 'A' | 'W' | 'P';
export type Drive = 'selfish' | 'conductor' | 'predator' | 'wall' | 'showboat' | 'ice' | 'spark';
export type Style = 'allOutAttack' | 'counterPunch' | 'possessionWall' | 'longBallSiege' | 'parkTheBus';
export type Zone = 'def' | 'mid' | 'att';
export type Lane = 'left' | 'center' | 'right';
export type Route = 'around' | 'through' | 'over';
export type Block = 'high' | 'mid' | 'low';
export type Phase =
  | 'buildUp' | 'progression' | 'creation'
  | 'highBlock' | 'midBlock' | 'lowBlock'
  | 'defTransition' | 'attTransition'
  | 'attSetPiece' | 'defSetPiece';
export type TacticId = 'shootOnSight' | 'tikiTaka' | 'lockTheDoor' | 'counterBlitz' | 'highPress' | 'airRaid' | 'showtime';

export interface SoccerPlayer {
  id: string;
  name: string;
  teamId: string;
  position: SoccerPosition;
  drive: Drive;
  /** Hidden, 0–100. */
  ratings: SoccerRatings;
  catchphrase?: string;
}

export interface SoccerTeam {
  id: string;
  city: string;
  name: string;
  abbr: string;
  colors: [string, string];
  style: Style;
  /** 8 player ids: the first five are the default starters (K, A, W, W, P), then 3 reserves. */
  squad: string[];
  /** Drives the fan-base vote budget (S6). */
  fanSize: number;
}

export interface SoccerLeague {
  seed: string;
  name: string;
  teams: SoccerTeam[];
  players: Record<string, SoccerPlayer>;
}

export interface SoccerFixture {
  id: string;
  day: number;
  awayId: string;
  homeId: string;
}

interface SEventBase {
  /** Match second (0–2400 plus stoppage). Display minute = floor(second / 60) + 1. */
  second: number;
  minute: number;
  half: 1 | 2;
  score: { home: number; away: number };
  possessionTeamId?: string;
  zone?: Zone;
  lane?: Lane;
  route?: Route;
  /** −10..+10, home perspective. */
  momentum?: number;
  /** Attacking-team perspective. */
  phase: Phase;
  /** Defending-team perspective. */
  defPhase: Phase;
}

export type ShotOutcome = 'goal' | 'saved' | 'wide' | 'blocked' | 'woodwork';

export type SoccerEvent = SEventBase & (
  | { kind: 'kickoff'; teamId: string }
  | { kind: 'possession'; teamId: string; playerId: string; zone: Zone }
  | { kind: 'pass'; from: string; to: string; success: boolean; advanced: boolean; interceptorId?: string }
  | { kind: 'dribble'; playerId: string; defenderId: string; success: boolean }
  | { kind: 'longBall'; from: string; to: string | null; success: boolean }
  | { kind: 'shot'; playerId: string; assistId?: string; quality: number; outcome: ShotOutcome; keeperId: string; blockerId?: string }
  | { kind: 'goal'; scorerId: string; assistId?: string; teamId: string }
  | { kind: 'keeperRestart'; teamId: string; keeperId: string }
  | { kind: 'sub'; teamId: string; outId: string; inId: string }
  | { kind: 'halfTime' }
  | { kind: 'fullTime'; winnerId: string | null }
);

export interface SoccerResult {
  gameId: string;
  awayId: string;
  homeId: string;
  awayScore: number;
  homeScore: number;
  /** Starting fives, keeper first. */
  lineups: { home: string[]; away: string[] };
  events: SoccerEvent[];
}
