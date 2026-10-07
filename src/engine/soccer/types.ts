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
  /** Signature Move id (content/soccer/signatures.json). */
  signatureId?: string;
  /** Pair strengths built from events (assists → bonds, duels and fouls → rivalries). */
  bonds?: Record<string, number>;
  rivals?: Record<string, number>;
  awakened?: { seasonId: number; boost: SoccerRatingKey };
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
  /** Home arena (content/soccer/arenas.json). */
  arenaId?: string;
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
  /** The defending team's block. */
  block?: Block;
}

export type ShotOutcome = 'goal' | 'saved' | 'wide' | 'blocked' | 'woodwork';

export type SoccerEvent = SEventBase & (
  | { kind: 'lineups'; home: string[]; away: string[] }
  | { kind: 'kickoff'; teamId: string }
  | { kind: 'possession'; teamId: string; playerId: string; zone: Zone }
  | { kind: 'pass'; from: string; to: string; success: boolean; advanced: boolean; interceptorId?: string; bond?: boolean }
  | { kind: 'dribble'; playerId: string; defenderId: string; success: boolean; rivals?: boolean }
  | { kind: 'longBall'; from: string; to: string | null; success: boolean }
  | { kind: 'shot'; playerId: string; assistId?: string; quality: number; outcome: ShotOutcome; keeperId: string; blockerId?: string; /** Banked off a wall (wallShot, §B5). */ wall?: 'left' | 'right' }
  | { kind: 'goal'; scorerId: string; assistId?: string; teamId: string; /** Points when a Facility rule makes it count extra. */ value?: number }
  | { kind: 'keeperRestart'; teamId: string; keeperId: string }
  // S4: fouls, set pieces, cards, injuries, shootouts.
  | { kind: 'tackle'; defenderId: string; victimId: string; foul: true }
  | { kind: 'teamFouls'; teamId: string; count: number }
  | { kind: 'freeKick' | 'spotKick'; teamId: string; takerId: string }
  | { kind: 'penalty'; takerId: string; keeperId: string; scored: boolean; spot: 'penalty' | 'spotKick' }
  | { kind: 'card'; playerId: string; teamId: string; color: 'yellow' | 'red' }
  | { kind: 'powerPlay'; teamId: string; untilSecond: number; /** The emptied slot (0 K … 4 P). */ slot: number }
  | { kind: 'powerPlayEnd'; teamId: string; inId: string | null }
  | { kind: 'injury'; playerId: string; teamId: string; matches: number }
  | { kind: 'shootout'; kicks: { teamId: string; takerId: string; scored: boolean }[]; winnerId: string }
  | { kind: 'sub'; teamId: string; outId: string; inId: string }
  // S4b: Phase Engine.
  | { kind: 'transition'; wonBy: string; lostBy: string; wonByBlock: Block;
      attChoice: 'counter' | 'secure'; defChoice: 'counterPress' | 'retreat'; outcome: 'regained' | 'breakaway' | 'settled' }
  | { kind: 'blockChange'; teamId: string; block: Block }
  | { kind: 'setPieceSetup'; teamId: string; setup: 'wall' | 'man' | 'zonal' }
  // S4c: walls, arena, personality.
  | { kind: 'wallPass'; from: string; to: string; wall: 'left' | 'right'; success: boolean }
  | { kind: 'scramble'; winnerId: string; loserId: string; winnerTeamId: string }
  | { kind: 'signature'; playerId: string; signatureId: string }
  | { kind: 'awakening'; playerId: string; teamId: string }
  | { kind: 'arenaShift'; arenaId: string }
  // S5: Director facility events and the world's rating changes.
  | { kind: 'facilityEvent'; eventId: string; text: string }
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
  /** Knockout matches level after 40 minutes go to penalties (§B5). */
  shootout?: { home: number; away: number; winnerId: string };
  /** Players hurt this match and how many matches they miss. */
  injuries: Record<string, number>;
  /** Players who Awakened this match (the world applies the change and caps it per season). */
  awakenings: string[];
  arenaId: string;
  events: SoccerEvent[];
}
