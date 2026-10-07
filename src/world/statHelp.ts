import type { RatingKey, StarGroup } from '../engine/baseball/types';

/**
 * Plain-language help for every rating, matching what src/engine/game.ts actually does with it.
 * Keep these in step with the engine: if a formula changes, change its line here.
 */
export const RATING_HELP: Record<RatingKey, { label: string; who: string; text: string }> = {
  contact: { label: 'Contact', who: 'Batters', text: 'Makes contact more often when swinging (against the pitcher’s Stuff) and turns more balls in play into hits (against Velocity). The biggest single driver of runs.' },
  power: { label: 'Power', who: 'Batters', text: 'When they get a hit, how often it’s a home run or a double instead of a single.' },
  discipline: { label: 'Discipline', who: 'Batters', text: 'Lays off bad pitches, so more balls and more walks (against the pitcher’s Control).' },
  velocity: { label: 'Velocity', who: 'Pitchers (and fielders’ arms)', text: 'Pitching: fewer of the batter’s balls in play fall for hits. On a batter it’s their throwing arm: every 5 points above 50 adds 1 to their Defense in the field.' },
  control: { label: 'Control', who: 'Pitchers (and batters’ eyes)', text: 'Pitching: throws strikes, so fewer walks, fewer wild pitches and hit batters, and it holds runners (fewer steals, more pickoffs). On a batter it’s their eye: every 5 points above 50 adds 1 to Discipline.' },
  stuff: { label: 'Stuff', who: 'Pitchers (and batters’ bats)', text: 'Pitching: more swings and misses, so more strikeouts (and slightly more wild pitches). On a batter it’s bat wizardry: every 5 points above 50 adds 1 to Power.' },
  speed: { label: 'Speed', who: 'Batters', text: 'Takes the extra base on hits, scores from third on fly balls and ground outs, and hits more triples. Fast runners steal more often and more successfully, are harder to pick off, and beat out more double plays.' },
  defense: { label: 'Defense', who: 'The nine batters', text: 'The lineup’s average Defense turns balls in play into outs and turns more double plays. Each fielder’s own Defense (plus arm) decides how often they make an error, and the catcher’s throws out base stealers. Pitchers’ Defense doesn’t count.' },
};

export const GROUP_HELP: Record<StarGroup, string> = {
  batting: 'Batting stars: the average of Contact, Power and Discipline.',
  pitching: 'Pitching stars: the average of Velocity, Control and Stuff. Starters rotate, so each pitches every 4th day.',
  baserunning: 'Running stars: Speed.',
  defense: 'Defense stars. Only the nine batters’ defense counts in games; a pitcher’s doesn’t.',
};

const ROLE_KEYS: Record<'batter' | 'pitcher', RatingKey[]> = {
  batter: ['contact', 'power', 'discipline', 'speed', 'defense', 'velocity', 'control', 'stuff'],
  pitcher: ['velocity', 'control', 'stuff'],
};

/** "+6 Contact, +6 Power" for a rating delta. */
export function describeDelta(delta: Partial<Record<RatingKey, number>>): string {
  return Object.entries(delta)
    .map(([k, v]) => `${v! > 0 ? '+' : '−'}${Math.abs(v!)} ${RATING_HELP[k as RatingKey].label}`)
    .join(', ');
}

/** Which parts of a delta actually matter for this kind of player. */
export function deltaNote(delta: Partial<Record<RatingKey, number>>, role: 'batter' | 'pitcher'): string | null {
  const keys = Object.keys(delta) as RatingKey[];
  if (!keys.length) return null;
  const used = keys.filter((k) => ROLE_KEYS[role].includes(k));
  if (used.length === keys.length) return null;
  if (!used.length) return `No effect on a ${role} — it only changes ratings ${role === 'pitcher' ? 'batters' : 'pitchers'} use.`;
  return `On a ${role}, only ${used.map((k) => RATING_HELP[k].label).join(', ')} matter${used.length === 1 ? 's' : ''}.`;
}
