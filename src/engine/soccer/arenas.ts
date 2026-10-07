import arenaContent from '../../../content/soccer/arenas.json';
import signatureContent from '../../../content/soccer/signatures.json';
import type { Drive, SoccerPosition } from './types';

/**
 * Arena architecture and Signature Moves are data (content/soccer/*.json), PRD §B4 and §B6.
 * The engine reads only the numbers below; names and text are for the log and the pitch view.
 */

export interface ArenaEffects {
  /** Banked-shot quality bonus. */
  wallShotQuality?: number;
  /** Per mille extra chance a lost ball becomes a loose-ball scramble. */
  scramblePm?: number;
  /** Shot-quality bonus for the side attacking downhill (home in the 1st half, away in the 2nd). */
  downhillQuality?: number;
  /** Pass success modifiers (per mille) by route, and for wall passes. */
  throughPassPm?: number;
  aroundPassPm?: number;
  wallPassPm?: number;
  /** Per mille extra chance a shot rebounds into a scramble. */
  reboundPm?: number;
  /** Stamina drain, percent of normal. */
  staminaPct?: number;
  /** Keeper Reflexes change against banked shots. */
  wallShotReflexes?: number;
  /** Showboats' Composure change. */
  showboatComposure?: number;
  /** Silent arena: no crowd, no momentum. */
  noMomentum?: boolean;
  /** The floor turns every N seconds: play stops and the ball is scrambled for. */
  rotateEverySeconds?: number;
}

export interface ArenaDef {
  id: string;
  name: string;
  shape: 'rect' | 'narrow' | 'octagon';
  wall: string;
  traits: string[];
  effects: ArenaEffects;
}

export type SignatureTrigger = 'shot' | 'wallShot' | 'dribble' | 'pass' | 'wallPass' | 'defendShot' | 'save';

export interface SignatureDef {
  id: string;
  name: string;
  text: string;
  positions: SoccerPosition[];
  drives: Drive[];
  trigger: SignatureTrigger;
  effect: { quality?: number; success?: boolean; advance?: boolean; block?: boolean; save?: boolean };
  /** Only in the last N seconds of the match. */
  lateOnlySeconds?: number;
}

export const ARENAS = arenaContent.arenas as ArenaDef[];
export const SIGNATURES = signatureContent.signatures as SignatureDef[];

const ARENA_BY_ID = new Map(ARENAS.map((a) => [a.id, a]));
const SIGNATURE_BY_ID = new Map(SIGNATURES.map((s) => [s.id, s]));

export const DEFAULT_ARENA_ID = 'glass-box';
export const getArena = (id: string | undefined): ArenaDef => ARENA_BY_ID.get(id ?? DEFAULT_ARENA_ID) ?? ARENA_BY_ID.get(DEFAULT_ARENA_ID)!;
export const getSignature = (id: string | undefined): SignatureDef | undefined => (id ? SIGNATURE_BY_ID.get(id) : undefined);

/** Signature moves a player qualifies for (position and Drive). */
export const signaturesFor = (position: SoccerPosition, drive: Drive) =>
  SIGNATURES.filter((s) => s.positions.includes(position) && s.drives.includes(drive));
