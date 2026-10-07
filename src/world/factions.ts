import { createRng } from '../engine/core/rng';

/**
 * Simulated fan factions (PRD §7). They vote with a fixed budget each election and only ever
 * see public information: standings and the proposals themselves (see FactionView).
 */

export type Tag = 'chaos' | 'order' | 'underdog' | 'power' | 'pitching' | 'history';

export interface Faction {
  id: string;
  name: string;
  ideology: string;
  /** How much the faction likes each proposal tag (-3..3). */
  prefs: Partial<Record<Tag, number>>;
  /** 0 = cautious, 3 = loves a gamble. Adds spread to their vote split. */
  riskTolerance: number;
  favoriteTeams: string[];
}

export const FACTION_BUDGET = 60;

const BASE: Omit<Faction, 'favoriteTeams'>[] = [
  { id: 'statheads', name: 'The Statheads', ideology: 'Numbers first. Wants a fair, measurable game.', prefs: { order: 2, pitching: 1, chaos: -2 }, riskTolerance: 0 },
  { id: 'loyalists', name: 'The Loyalists', ideology: 'Ride or die for their teams.', prefs: { history: 1 }, riskTolerance: 1 },
  { id: 'chaos', name: 'The Chaos Choir', ideology: 'Burn the rulebook. Sing while it burns.', prefs: { chaos: 3, order: -2, power: 1 }, riskTolerance: 3 },
  { id: 'purists', name: 'The Purists', ideology: 'The game was perfect. Leave it alone.', prefs: { order: 3, chaos: -3, power: -1 }, riskTolerance: 0 },
  { id: 'lore', name: 'The Lore Divers', ideology: 'Every rule change is a new chapter.', prefs: { history: 2, chaos: 1, underdog: 1 }, riskTolerance: 2 },
  { id: 'casuals', name: 'The Casuals', ideology: 'More home runs, please.', prefs: { power: 3, underdog: 1 }, riskTolerance: 2 },
];

/** Factions for a universe; favorite teams are picked from the seed so every world differs. */
export function createFactions(seed: string, teamIds: string[]): Faction[] {
  return BASE.map((f) => {
    const rng = createRng(seed, 'faction', f.id);
    const picks = new Set<string>();
    const count = f.id === 'loyalists' ? 2 : 1;
    while (picks.size < Math.min(count, teamIds.length)) picks.add(rng.pick(teamIds));
    return { ...f, favoriteTeams: [...picks] };
  });
}
