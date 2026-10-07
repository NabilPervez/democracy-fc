import type { GameEvent, GameResult } from './types';

/** Counting stats. Batting and pitching live in one line so any player can do either. */
export interface StatLine {
  g: number; // games appeared
  pa: number;
  ab: number;
  h: number;
  d: number; // doubles
  t: number; // triples
  hr: number;
  r: number;
  bb: number;
  k: number;
  // engine v3: baserunning, fielding, hit by pitch (older saves are back-filled with 0)
  sb: number; // stolen bases
  cs: number; // caught stealing (and picked off)
  gidp: number; // grounded into a double play
  hbp: number; // times hit by a pitch
  e: number; // errors committed in the field
  // pitching
  gs: number;
  outs: number;
  ha: number; // hits allowed
  ra: number; // runs allowed
  pk: number; // strikeouts thrown
  pbb: number; // walks allowed
  w: number;
  l: number;
  wp: number; // wild pitches
  phbp: number; // batters hit
}

export const emptyLine = (): StatLine => ({
  g: 0, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, r: 0, bb: 0, k: 0,
  sb: 0, cs: 0, gidp: 0, hbp: 0, e: 0,
  gs: 0, outs: 0, ha: 0, ra: 0, pk: 0, pbb: 0, w: 0, l: 0, wp: 0, phbp: 0,
});

/** A stat line with every field present (lines saved before a field existed lack it). */
export const fullLine = (s: Partial<StatLine>): StatLine => ({ ...emptyLine(), ...s });

export function addLines(a: StatLine, b: Partial<StatLine>): StatLine {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof StatLine)[]) out[k] = (out[k] ?? 0) + (b[k] ?? 0);
  return out;
}

export type BoxScore = Record<string, StatLine>;

const RESOLVES_PA = new Set<GameEvent['kind']>(['walk', 'strikeout', 'hit', 'out', 'error', 'doublePlay', 'hitByPitch']);

/** Per-player stat lines for one game, derived purely from its events. */
export function boxScore(result: GameResult): BoxScore {
  const box: BoxScore = {};
  const line = (id: string) => (box[id] ??= emptyLine());
  let pitcherId = '';
  /** Batter whose plate appearance hasn't resolved; if the inning ends first (out on the bases), it didn't count. */
  let openPa: string | null = null;
  const unPa = () => {
    if (openPa) line(openPa).pa--;
    openPa = null;
  };
  for (const e of result.events) {
    if (RESOLVES_PA.has(e.kind)) openPa = null;
    switch (e.kind) {
      case 'gameStart':
        for (const id of [e.awayPitcherId, e.homePitcherId]) {
          line(id).g = 1;
          line(id).gs = 1;
        }
        break;
      case 'atBat':
        pitcherId = e.pitcherId;
        line(e.batterId).g = 1;
        line(e.batterId).pa++;
        openPa = e.batterId;
        break;
      case 'halfEnd':
        unPa();
        break;
      case 'walk':
        line(e.batterId).bb++;
        line(e.pitcherId).pbb++;
        break;
      case 'strikeout':
        line(e.batterId).ab++;
        line(e.batterId).k++;
        line(e.pitcherId).pk++;
        line(e.pitcherId).outs++;
        break;
      case 'hit': {
        const b = line(e.batterId);
        b.ab++;
        b.h++;
        if (e.hit === 'double') b.d++;
        if (e.hit === 'triple') b.t++;
        if (e.hit === 'homeRun') b.hr++;
        line(e.pitcherId).ha++;
        break;
      }
      case 'out':
        if (!e.sacrifice) line(e.batterId).ab++;
        line(e.pitcherId).outs++;
        break;
      case 'hitByPitch':
        line(e.batterId).hbp++;
        line(e.pitcherId).phbp++;
        break;
      case 'error':
        line(e.batterId).ab++;
        line(e.fielderId).e++;
        break;
      case 'doublePlay':
        line(e.batterId).ab++;
        line(e.batterId).gidp++;
        line(e.pitcherId).outs += 2;
        break;
      case 'wildPitch':
        line(e.pitcherId).wp++;
        break;
      case 'stealAttempt':
        if (e.success) line(e.runnerId).sb++;
        else {
          line(e.runnerId).cs++;
          line(e.pitcherId).outs++;
        }
        break;
      case 'pickoff':
        line(e.runnerId).cs++;
        line(e.pitcherId).outs++;
        break;
      case 'run':
        line(e.runnerId).r++;
        if (pitcherId) line(pitcherId).ra++;
        break;
      case 'gameEnd': {
        unPa();
        const start = result.events[0];
        if (start.kind === 'gameStart') {
          const winnerIsHome = e.winnerId === result.homeId;
          line(winnerIsHome ? start.homePitcherId : start.awayPitcherId).w = 1;
          line(winnerIsHome ? start.awayPitcherId : start.homePitcherId).l = 1;
        }
        break;
      }
      default:
        break;
    }
  }
  return box;
}

export const avg = (s: StatLine) => (s.ab ? (s.h / s.ab).toFixed(3).replace(/^0/, '') : '.000');
export const era = (s: StatLine) => (s.outs ? ((s.ra * 27) / s.outs).toFixed(2) : '—');
export const inningsPitched = (s: StatLine) => `${Math.floor(s.outs / 3)}.${s.outs % 3}`;
