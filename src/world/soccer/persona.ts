/**
 * Fan personas (PRD §B2, §B7a, §B8): who you are as a fan. One small, readable perk each.
 * Perks only ever touch the player's own credibility and information — never the simulation.
 */

export type PersonaId = 'diehard' | 'analyst' | 'prophet' | 'contrarian' | 'organizer';

export interface PersonaDef {
  id: PersonaId;
  name: string;
  icon: string;
  tagline: string;
  perk: string;
}

export const PERSONAS: PersonaDef[] = [
  { id: 'diehard', name: 'The Diehard', icon: '♥', tagline: 'Your club, win or lose.', perk: '+20% credibility for correct calls that back your own club.' },
  { id: 'analyst', name: 'The Analyst', icon: '▤', tagline: 'Reads the crowd to the decimal.', perk: "See rival fans' tactic lean exactly (others see it rounded to the nearest 10%)." },
  { id: 'prophet', name: 'The Prophet', icon: '◎', tagline: 'Hears the dorm rumours first.', perk: "See tomorrow's Director facility events a day early." },
  { id: 'contrarian', name: 'The Contrarian', icon: '◐', tagline: 'Sees what the crowd misses.', perk: '+15% credibility for correct calls the facility gave under a 35% chance.' },
  { id: 'organizer', name: 'The Organizer', icon: '✦', tagline: 'Gets the vote out.', perk: 'Facility election votes cost 20% less credibility.' },
];

export const personaDef = (id: PersonaId | null | undefined) => PERSONAS.find((p) => p.id === id) ?? null;

/** Reward multiplier (thousandths) after persona perks. */
export function personaReward(persona: PersonaId | null, multMilli: number, pm: number, backsOwnClub: boolean): number {
  if (persona === 'diehard' && backsOwnClub) return Math.floor((multMilli * 120) / 100);
  if (persona === 'contrarian' && pm < 350) return Math.floor((multMilli * 115) / 100);
  return multMilli;
}

/** Election vote cost after persona perks. */
export const personaVoteCost = (persona: PersonaId | null, coins: number) => (persona === 'organizer' ? Math.ceil((coins * 80) / 100) : coins);

/** How precisely a fan sees a rival crowd's lean (percent). */
export const leanAsSeen = (persona: PersonaId | null, pct: number) => (persona === 'analyst' ? pct : Math.round(pct / 10) * 10);
