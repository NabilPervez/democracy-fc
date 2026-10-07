import { createRng } from '../engine/core/rng';
import type { League, RatingKey, Team } from '../engine/baseball/types';

/**
 * Team identity: a seeded bio, one unique perk that only that team gets, head-to-head records
 * and rivalries. Bios and perks are derived from the seed (no saved state); records are saved.
 */

export interface TeamPerk {
  id: string;
  name: string;
  icon: string;
  description: string;
  delta: Partial<Record<RatingKey, number>>;
  /** Only in home games? Otherwise always. */
  homeOnly?: boolean;
}

export const TEAM_PERKS: TeamPerk[] = [
  { id: 'night-owls', name: 'Night Owls', icon: '🦉', description: 'The whole roster is nocturnal. +4 contact.', delta: { contact: 4 } },
  { id: 'sticky-gloves', name: 'Sticky Gloves', icon: '🧤', description: 'Nobody asks what is on them. +5 defense.', delta: { defense: 5 } },
  { id: 'jet-cleats', name: 'Jet Cleats', icon: '👟', description: 'Illegal in three leagues. +5 speed.', delta: { speed: 5 } },
  { id: 'heavy-bats', name: 'Heavy Bats', icon: '🪵', description: 'Carved from a meteor-struck oak. +4 power.', delta: { power: 4 } },
  { id: 'cold-blood', name: 'Cold Blood', icon: '🧊', description: 'Pitchers who never blink. +4 control.', delta: { control: 4 } },
  { id: 'cannon-arms', name: 'Cannon Arms', icon: '💥', description: 'A club tradition of throwing too hard. +4 velocity.', delta: { velocity: 4 } },
  { id: 'trick-pitches', name: 'Trick Pitches', icon: '🌀', description: 'A secret grip passed down for generations. +4 stuff.', delta: { stuff: 4 } },
  { id: 'patient-eyes', name: 'Patient Eyes', icon: '👁', description: 'They will wait all night for their pitch. +5 discipline.', delta: { discipline: 5 } },
  { id: 'home-cooking', name: 'Home Cooking', icon: '🍲', description: 'The stadium kitchen is legendary. +4 contact and power at home.', delta: { contact: 4, power: 4 }, homeOnly: true },
  { id: 'fortress', name: 'The Fortress', icon: '🏰', description: 'Visitors get lost in the tunnels. +5 defense and control at home.', delta: { defense: 5, control: 5 }, homeOnly: true },
  { id: 'all-rounders', name: 'All-Rounders', icon: '🎲', description: 'Good at everything, great at nothing. +2 to everything.', delta: { contact: 2, power: 2, discipline: 2, velocity: 2, control: 2, stuff: 2, speed: 2, defense: 2 } },
  { id: 'chaos-engine', name: 'Chaos Engine', icon: '⚙', description: 'Run on pure nerves. +6 power, −2 control.', delta: { power: 6, control: -2 } },
  { id: 'glass-cannons', name: 'Glass Cannons', icon: '🔮', description: 'Strike first, ask later. +5 velocity and stuff, −3 defense.', delta: { velocity: 5, stuff: 5, defense: -3 } },
  { id: 'base-thieves', name: 'Base Thieves', icon: '🦊', description: 'They have stolen bases from the parking lot. +4 speed, +2 contact.', delta: { speed: 4, contact: 2 } },
  { id: 'iron-lungs', name: 'Iron Lungs', icon: '🫁', description: 'They train at the top of a volcano. +3 stuff and discipline.', delta: { stuff: 3, discipline: 3 } },
  { id: 'lucky-charm', name: 'Lucky Charm', icon: '🍀', description: 'A four-leaf clover is sewn into every cap. +3 contact and defense.', delta: { contact: 3, defense: 3 } },
];

/** Each team's perk; distinct across the league (up to the number of perks). */
export function teamPerk(seed: string, league: League, teamId: string): TeamPerk {
  const order = [...TEAM_PERKS];
  const rng = createRng(seed, 'team-perks');
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const idx = league.teams.findIndex((t) => t.id === teamId);
  return order[idx % order.length];
}

/** Every home stadium has its own permanent edge, enjoyed by the home team in home games. */
export const STADIUM_PERKS: TeamPerk[] = [
  { id: 'short-porch', name: 'Short Porch', icon: '📏', description: 'The right-field wall is suspiciously close.', delta: { power: 5 }, homeOnly: true },
  { id: 'deep-alleys', name: 'Deep Alleys', icon: '🏟', description: 'Gaps you could park a bus in.', delta: { speed: 4, contact: 2 }, homeOnly: true },
  { id: 'thin-air', name: 'Thin Air', icon: '⛰', description: 'Built on a plateau. The ball just keeps going.', delta: { power: 3, contact: 3 }, homeOnly: true },
  { id: 'fog-bank', name: 'Fog Bank', icon: '🌫', description: 'Visitors lose the ball in the mist; the locals don’t.', delta: { defense: 5 }, homeOnly: true },
  { id: 'tall-mound', name: 'Tall Mound', icon: '🗻', description: 'The mound is a bit higher than the rules allow.', delta: { velocity: 5 }, homeOnly: true },
  { id: 'crooked-lights', name: 'Crooked Lights', icon: '💡', description: 'Shadows fall exactly where the home pitchers want them.', delta: { stuff: 5 }, homeOnly: true },
  { id: 'quiet-crowd', name: 'Library Crowd', icon: '🤫', description: 'Total silence. Perfect for concentrating.', delta: { control: 4, discipline: 3 }, homeOnly: true },
  { id: 'fast-turf', name: 'Fast Turf', icon: '🟩', description: 'Grounders skip like stones on a pond.', delta: { speed: 3, defense: 3 }, homeOnly: true },
  { id: 'wind-tunnel', name: 'Wind Tunnel', icon: '🌬', description: 'The wind always blows out — when the home team bats.', delta: { power: 4, discipline: 2 }, homeOnly: true },
  { id: 'echo-chamber', name: 'Echo Chamber', icon: '📣', description: 'The cheering never stops bouncing around.', delta: { contact: 4 }, homeOnly: true },
  { id: 'old-grass', name: 'Ancient Grass', icon: '🌿', description: 'The groundskeeper talks to it. It listens.', delta: { defense: 3, control: 3 }, homeOnly: true },
  { id: 'heated-benches', name: 'Heated Benches', icon: '🔥', description: 'Warm muscles, loud bats.', delta: { contact: 2, power: 2, velocity: 2 }, homeOnly: true },
  { id: 'hall-of-mirrors', name: 'Hall of Mirrors', icon: '🪞', description: 'The batter’s eye is a mirror. Nobody knows why it’s allowed.', delta: { stuff: 3, velocity: 3 }, homeOnly: true },
  { id: 'lucky-dirt', name: 'Lucky Dirt', icon: '🍀', description: 'Soil from a four-leaf-clover farm.', delta: { contact: 2, defense: 2, speed: 2 }, homeOnly: true },
  { id: 'night-market', name: 'Night Market', icon: '🏮', description: 'The concourse food is so good the home team plays inspired.', delta: { discipline: 3, contact: 3 }, homeOnly: true },
  { id: 'iron-backstop', name: 'Iron Backstop', icon: '🧱', description: 'Nothing gets by. Ever.', delta: { control: 5 }, homeOnly: true },
];

/** The home stadium's perk; distinct across the league. A new stadium (after relegation) draws a new one. */
export function stadiumPerk(seed: string, league: League, teamId: string, rebuilt?: number): TeamPerk {
  const order = [...STADIUM_PERKS];
  const rng = createRng(seed, 'stadium-perks');
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const idx = league.teams.findIndex((t) => t.id === teamId);
  // Relegated slots get a new stadium: shift by a hash of its name so the perk changes too.
  const shift = rebuilt ? createRng(seed, 'rebuilt', teamId, rebuilt).int(order.length) : 0;
  return order[(idx + shift) % order.length];
}

const SURFACES = ['natural grass', 'ancient grass', 'artificial turf', 'packed clay', 'moss', 'blue fescue', 'sand-and-ash'];
const ROOFS = ['open-air', 'retractable roof', 'domed', 'half-roofed', 'open to the stars'];

/** Seeded stadium facts: capacity, year it opened, surface and roof. */
export function stadiumDetails(seed: string, teamId: string, stadiumName: string): { capacity: number; opened: number; surface: string; roof: string; fence: number } {
  const rng = createRng(seed, 'stadium-details', teamId, stadiumName);
  return {
    capacity: rng.range(18, 52) * 1000 + rng.range(0, 9) * 100,
    opened: rng.range(1890, 2024),
    surface: rng.pick(SURFACES),
    roof: rng.pick(ROOFS),
    fence: rng.range(310, 420),
  };
}

const ORIGINS = [
  'a bet between two lighthouse keepers',
  'a riot at a pie-eating contest',
  'the town flood, when the only dry land was the infield',
  'a sleepwalking mayor signing the charter',
  'a meteor landing in the founder’s backyard',
  'a misprinted circus poster',
  'an argument about the shape of the moon',
  'a group of night-shift bakers with nothing to do at noon',
  'a ghost who wanted somewhere to sit on Sundays',
  'a hailstorm that spelled out "PLAY BALL"',
];
const QUIRKS = [
  'Fans bring a live goat to every opening day.',
  'The dugout is said to be haunted by a polite former manager.',
  'Every player must learn to whistle before their debut.',
  'They have never once worn the same uniform two seasons in a row.',
  'The scoreboard occasionally shows tomorrow’s weather instead.',
  'Their mascot has not been seen without the costume in decades.',
  'Before each game they toss a single peanut into the outfield for luck.',
  'The stadium organist only knows one song, and plays it beautifully.',
  'Their team photo always has one more person in it than the roster.',
  'Fans hum instead of cheering. It is unsettling for visitors.',
];
const MOTTOS = ['Swing First, Wonder Later', 'Ever Onward, Mostly', 'We Were Here Before the Fog', 'Fear the Bunt', 'Nobody Knows Why, and That Is Fine', 'Bright Lights, Strange Nights', 'Hold the Line, Hold the Mustard', 'The Ball Remembers'];

/** A short seeded bio: same seed, same story. */
export function teamBio(seed: string, team: Team): { founded: number; text: string; motto: string } {
  const rng = createRng(seed, 'bio', team.id);
  const founded = rng.range(1871, 1989);
  return {
    founded,
    text: `The ${team.city} ${team.name} were founded in ${founded} after ${rng.pick(ORIGINS)}. ${rng.pick(QUIRKS)}`,
    motto: rng.pick(MOTTOS),
  };
}

// ---------------------------------------------------------------------------
// Head-to-head records and rivalries

/** wins[a][b] = games team a has won against team b, all time. */
export type HeadToHead = Record<string, Record<string, number>>;

export const RIVAL_MIN_GAMES = 8;
/** Both teams must have won at least this share of their meetings. */
export const RIVAL_MIN_SHARE = 0.4;
/** Both teams play a little harder in rivalry games. */
export const RIVALRY_BONUS: Partial<Record<RatingKey, number>> = { contact: 3, power: 3, velocity: 3, stuff: 3 };

export const winsVs = (h: HeadToHead, a: string, b: string) => h[a]?.[b] ?? 0;

export function recordWithWin(h: HeadToHead, winner: string, loser: string): HeadToHead {
  return { ...h, [winner]: { ...(h[winner] ?? {}), [loser]: winsVs(h, winner, loser) + 1 } };
}

export function isRivalry(h: HeadToHead, a: string, b: string): boolean {
  const aw = winsVs(h, a, b);
  const bw = winsVs(h, b, a);
  const total = aw + bw;
  return total >= RIVAL_MIN_GAMES && Math.min(aw, bw) / total >= RIVAL_MIN_SHARE;
}

export function rivalsOf(h: HeadToHead, teams: Team[], teamId: string): string[] {
  return teams.filter((t) => t.id !== teamId && isRivalry(h, teamId, t.id)).map((t) => t.id);
}

export function allTimeRecord(h: HeadToHead, teams: Team[], teamId: string): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const t of teams) {
    wins += winsVs(h, teamId, t.id);
    losses += winsVs(h, t.id, teamId);
  }
  return { wins, losses };
}
