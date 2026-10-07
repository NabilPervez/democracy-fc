import type { BoxScore } from '../engine/baseball/boxScore';
import type { League } from '../engine/baseball/types';

/**
 * Player picks: back players you believe in, fade players you expect to struggle.
 * After every game, picks pay out coins based on the box score. Pure and deterministic.
 */

export type PickKind = 'back' | 'fade';

export interface Picks {
  back: string[];
  fade: string[];
}

/** Starting slots. More unlock from lifetime pick earnings (see SLOT_UNLOCKS). */
export const MAX_BACKED = 4;
export const MAX_FADED = 3;

/** Coins per event. */
export const PICK_RATES = {
  backHit: 2, // backed hitter: per hit
  backHomeRun: 4, // backed hitter: bonus per home run
  backStrikeout: 2, // backed pitcher: per strikeout thrown
  fadeStrikeout: 2, // faded hitter: per strikeout
  fadeHitless: 4, // faded hitter: hitless game with 3+ at-bats
  fadeHitAllowed: 1, // faded pitcher: per hit allowed
  fadeRunAllowed: 2, // faded pitcher: per run allowed
  backSteal: 2, // backed hitter: per stolen base
  fadeCaught: 3, // faded hitter: per caught stealing / picked off, or grounded into a double play
  fadeWildPitch: 1, // faded pitcher: per wild pitch
} as const;

/** Streak (games in a row a pick paid) → payout multiplier, in percent. Applied to the game after. */
export function streakMultiplierPct(streak: number): number {
  return streak >= 10 ? 200 : streak >= 5 ? 150 : streak >= 3 ? 125 : 100;
}

/** Unlocks from lifetime pick coins (which never go down). */
export const SLOT_UNLOCKS = [
  { at: 300, id: 'back5', text: 'a 5th Back slot' },
  { at: 700, id: 'fade4', text: 'a 4th Fade slot' },
  { at: 1500, id: 'back6', text: 'a 6th Back slot' },
  { at: 3000, id: 'lock', text: 'the Lock: once a season, one pick keeps its streak through a single empty game' },
] as const;

export const maxBacked = (lifetime: number) => MAX_BACKED + (lifetime >= 300 ? 1 : 0) + (lifetime >= 1500 ? 1 : 0);
export const maxFaded = (lifetime: number, extraFade = 0) => MAX_FADED + (lifetime >= 700 ? 1 : 0) + extraFade;
export const lockUnlocked = (lifetime: number) => lifetime >= 3000;
/** Unlocks crossed going from `before` to `after` lifetime coins. */
export const newUnlocks = (before: number, after: number) => SLOT_UNLOCKS.filter((u) => before < u.at && after >= u.at);

export const emptyPicks = (): Picks => ({ back: [], fade: [] });

export interface PickLine {
  playerId: string;
  kind: PickKind;
  /** Coins before multipliers. */
  base: number;
  amount: number;
  why: string;
}

/** What the player's picks earned from one game, before streaks and perks. */
export function pickPayout(picks: Picks, box: BoxScore, league: League): PickLine[] {
  const lines: PickLine[] = [];
  const add = (playerId: string, kind: PickKind, amount: number, why: string) => amount > 0 && lines.push({ playerId, kind, base: amount, amount, why });
  for (const id of picks.back) {
    const s = box[id];
    const p = league.players[id];
    if (!s || !p) continue;
    if (p.role === 'pitcher') add(id, 'back', s.pk * PICK_RATES.backStrikeout, `${s.pk} K`);
    else {
      const sb = s.sb ?? 0;
      const why = [`${s.h} H`, s.hr ? `${s.hr} HR` : '', sb ? `${sb} SB` : ''].filter(Boolean).join(', ');
      add(id, 'back', s.h * PICK_RATES.backHit + s.hr * PICK_RATES.backHomeRun + sb * PICK_RATES.backSteal, why);
    }
  }
  for (const id of picks.fade) {
    const s = box[id];
    const p = league.players[id];
    if (!s || !p) continue;
    if (p.role === 'pitcher') {
      const wp = s.wp ?? 0;
      add(id, 'fade', s.ha * PICK_RATES.fadeHitAllowed + s.ra * PICK_RATES.fadeRunAllowed + wp * PICK_RATES.fadeWildPitch, `${s.ha} H, ${s.ra} R allowed${wp ? `, ${wp} WP` : ''}`);
    } else {
      const hitless = s.ab >= 3 && s.h === 0;
      const caught = (s.cs ?? 0) + (s.gidp ?? 0);
      const why = [hitless ? `0-for-${s.ab}` : '', `${s.k} K`, s.cs ? `${s.cs} CS` : '', s.gidp ? `${s.gidp} GIDP` : ''].filter(Boolean).join(', ');
      add(id, 'fade', s.k * PICK_RATES.fadeStrikeout + (hitless ? PICK_RATES.fadeHitless : 0) + caught * PICK_RATES.fadeCaught, why);
    }
  }
  return lines;
}

export interface StreakContext {
  /** Current streaks by player (missing = 0). */
  streaks: Record<string, number>;
  /** Contrarian: extra percent on fade payouts. */
  fadeBonusPct?: number;
  /** Contrarian's Jinx: this player's fade payouts are doubled. */
  jinxedId?: string | null;
  /** The Lock: this pick survives one empty game this season. */
  lockedId?: string | null;
  lockUsed?: boolean;
}

/**
 * One game's pick payouts with streaks (PRD 2 §E3). A pick that played and paid extends its
 * streak; one that played and paid nothing resets it (unless the Lock saves it once); one that
 * didn't play is paused. The multiplier comes from the streak *before* this game, and all
 * multipliers combine before a single round-down.
 */
export function settlePicks(picks: Picks, box: BoxScore, league: League, ctx: StreakContext): { lines: PickLine[]; streaks: Record<string, number>; lockUsed: boolean } {
  const paid = new Map(pickPayout(picks, box, league).map((l) => [l.playerId, l]));
  const streaks = { ...ctx.streaks };
  let lockUsed = !!ctx.lockUsed;
  const lines: PickLine[] = [];
  for (const [kind, ids] of [['back', picks.back], ['fade', picks.fade]] as const) {
    for (const id of ids) {
      if (!box[id]) continue; // didn't play: streak paused
      const before = streaks[id] ?? 0;
      const line = paid.get(id);
      if (line) {
        let num = line.base * streakMultiplierPct(before);
        let den = 100;
        if (kind === 'fade' && ctx.fadeBonusPct) {
          num *= 100 + ctx.fadeBonusPct;
          den *= 100;
        }
        if (kind === 'fade' && ctx.jinxedId === id) num *= 2;
        const amount = Math.floor(num / den);
        const extras = [before >= 3 ? `🔥${before}` : '', kind === 'fade' && ctx.jinxedId === id ? 'jinxed' : ''].filter(Boolean).join(' ');
        lines.push({ ...line, amount, why: extras ? `${line.why} (${extras})` : line.why });
        streaks[id] = before + 1;
      } else if (ctx.lockedId === id && !lockUsed && before > 0) {
        lockUsed = true; // the Lock holds the streak through one empty game
      } else {
        streaks[id] = 0;
      }
    }
  }
  return { lines, streaks, lockUsed };
}

export const pickOf = (picks: Picks, playerId: string): PickKind | null =>
  picks.back.includes(playerId) ? 'back' : picks.fade.includes(playerId) ? 'fade' : null;
