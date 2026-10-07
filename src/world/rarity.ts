import { createRng } from '../engine/core/rng';
import { findPlayerMod, isActiveMod } from './weird';
import { RULES, type UniverseState } from './universe';

/** Card status reflects a player's story: where they are in their career and in the afterlife. */
export type Rarity = 'rookie' | 'veteran' | 'legend' | 'departed' | 'returned';

export const RARITY_LABEL: Record<Rarity, string> = {
  rookie: 'Rookie',
  veteran: 'Veteran',
  legend: 'Legend',
  departed: 'Departed',
  returned: 'Returned',
};

const LEGEND_MOMENTS = 8;

export function rarityOf(u: UniverseState, playerId: string): Rarity {
  const status = u.weird.playerStatus[playerId];
  if (status === 'departed') return 'departed';
  if (status === 'returned') return 'returned';
  const moments = u.playerLog[playerId]?.length ?? 0;
  if (moments >= LEGEND_MOMENTS) return 'legend';
  return (u.experience?.[playerId] ?? 0) === 0 ? 'rookie' : 'veteran';
}

/** Card tier sets the border. The weirder a player's story, the rarer the card. */
export type Tier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const TIER_LABEL: Record<Tier, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

/**
 * Weirdness score: modifiers count most (permanent ones double, afterlife ones triple),
 * then notable moments, a trip to the Departed and a long career.
 */
export function weirdnessScore(u: UniverseState, playerId: string): number {
  let score = 0;
  for (const m of u.weird.playerMods[playerId] ?? []) {
    if (!isActiveMod(m, u.season, u.currentDay)) continue;
    const def = findPlayerMod(RULES, m.id);
    score += def?.returnedOnly ? 3 : m.until === null ? 2 : 1;
  }
  score += Math.min(3, Math.floor((u.playerLog[playerId]?.length ?? 0) / 3));
  const status = u.weird.playerStatus[playerId];
  if (status === 'returned') score += 2;
  if (status === 'departed') score += 1;
  if ((u.experience?.[playerId] ?? 0) >= 12) score += 1;
  return score;
}

const TIER_AT: [Tier, number][] = [['uncommon', 2], ['rare', 4], ['epic', 6], ['legendary', 9]];

/** The Collector's preview (Level 2): the next tier up and the weirdness score it needs. */
export function nextTier(u: UniverseState, playerId: string): { tier: Tier; at: number; now: number } | null {
  const now = weirdnessScore(u, playerId);
  const next = TIER_AT.find(([, at]) => now < at);
  return next ? { tier: next[0], at: next[1], now } : null;
}

export function tierOf(u: UniverseState, playerId: string): Tier {
  const s = weirdnessScore(u, playerId);
  if (s >= 9) return 'legendary';
  if (s >= 6) return 'epic';
  if (s >= 4) return 'rare';
  if (s >= 2) return 'uncommon';
  return 'common';
}

const FLAVOR = [
  'Has never seen their own feet.',
  'Once struck out a cloud.',
  'Eats sunflower seeds shell and all.',
  'Claims to be "mostly" human.',
  'Hums the same note for nine innings.',
  'Was born during a rain delay.',
  'Keeps a lucky pebble. The pebble is unlucky.',
  'Can hear the scoreboard thinking.',
  'Has a pet moth named Doubleheader.',
  'Refuses to touch second base on Tuesdays.',
  'Swears the moon owes them money.',
  'Signs autographs in invisible ink.',
  'Was raised by a pitching machine.',
  'Sleeps standing up, like a horse.',
  'Has stolen a base. Literally. It is in their garage.',
  'Talks to the foul poles. They listen.',
  'Owns forty identical caps and one weird one.',
  'Rumored to be two years old.',
  'Bats with their eyes closed. Says it helps.',
  'Once caught a fly ball that was a bird.',
  'Arrives at every game by unexplained means.',
  'Their shadow has a better batting average.',
  'Hates the number seven. Nobody knows why.',
  'Writes letters to future seasons.',
];

/** A fixed fun fact per player: same player, same line, forever. */
export const flavorOf = (playerId: string) => createRng(playerId, 'flavor').pick(FLAVOR);
