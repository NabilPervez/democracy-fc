import type { SoccerLeague, SoccerPlayer, SoccerPosition, SoccerRatingKey, SoccerTeam } from './types';

/** Ratings that matter most for each position (used to pick the five and the bench order). */
export const POSITION_KEYS: Record<SoccerPosition, SoccerRatingKey[]> = {
  K: ['reflexes', 'handling', 'positioning'],
  A: ['tackling', 'positioning', 'passing', 'aerial'],
  W: ['pace', 'dribbling', 'passing', 'stamina'],
  P: ['finishing', 'firstTouch', 'composure', 'aerial'],
};

/** How well a player fits a slot: average of the slot's key ratings, −15 when out of position. */
export function slotScore(p: SoccerPlayer, slot: SoccerPosition): number {
  const keys = POSITION_KEYS[slot];
  const avg = Math.trunc(keys.reduce((s, k) => s + p.ratings[k], 0) / keys.length);
  if (p.position === slot) return avg;
  // A keeper never plays outfield, and outfielders only keep in an emergency.
  return p.position === 'K' || slot === 'K' ? avg - 40 : avg - 15;
}

export const SLOTS: readonly SoccerPosition[] = ['K', 'A', 'W', 'W', 'P'];

/**
 * The AI picks the five automatically (PRD §B4): for each slot in order, the best available fit.
 * `unavailable` = injured / vanished / sealed out. Deterministic: ties break on squad order.
 * Returns ids in slot order K, A, W, W, P; a slot can't be filled only if the squad is short.
 */
export function selectLineup(team: SoccerTeam, league: SoccerLeague, unavailable: ReadonlySet<string> = new Set()): string[] {
  const pool = team.squad.filter((id) => !unavailable.has(id) && league.players[id]);
  const five: string[] = [];
  for (const slot of SLOTS) {
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const id of pool) {
      if (five.includes(id)) continue;
      const s = slotScore(league.players[id], slot);
      if (s > bestScore) {
        best = id;
        bestScore = s;
      }
    }
    if (best) five.push(best);
  }
  return five;
}
