import { createRng } from '../../engine/core/rng';
import type { SoccerPlayer, SoccerRatingKey, SoccerTeam } from '../../engine/soccer/types';
import { soccerMod, type ActiveMod } from './weird';

/**
 * Identity and careers (ideas ported from Blastball, rebuilt for 5v5 soccer):
 * - every club has a unique power-up its players always get, and its home arena a pitch power-up;
 * - clubs have a seeded bio (founded, origin, quirk, motto);
 * - players age through a career arc (rising → prime → fading → declining) and retire;
 * - player cards have a rarity tier from performance and powers.
 * All seeded, so the same world always tells the same story.
 */

type Delta = Partial<Record<SoccerRatingKey, number>>;

export interface ClubPerk {
  id: string;
  name: string;
  icon: string;
  description: string;
  delta: Delta;
  /** Only in home matches. */
  homeOnly?: boolean;
}

/** One per club, distinct across the league: what every player in that shirt gets. */
export const CLUB_PERKS: ClubPerk[] = [
  { id: 'night-owls', name: 'Night Owls', icon: '🦉', description: 'The whole squad is nocturnal. +4 vision.', delta: { vision: 4 } },
  { id: 'sticky-boots', name: 'Sticky Boots', icon: '🥾', description: 'Nobody asks what is on them. +5 first touch.', delta: { firstTouch: 5 } },
  { id: 'jet-studs', name: 'Jet Studs', icon: '👟', description: 'Illegal in three facilities. +5 pace.', delta: { pace: 5 } },
  { id: 'cold-blood', name: 'Cold Blood', icon: '🧊', description: 'Nobody blinks. +5 composure.', delta: { composure: 5 } },
  { id: 'iron-wall', name: 'Iron Wall', icon: '🧱', description: 'A club tradition of throwing bodies at the ball. +4 tackling and positioning.', delta: { tackling: 4, positioning: 4 } },
  { id: 'sharpshooters', name: 'Sharpshooters', icon: '🎯', description: 'Penalty practice before breakfast. +5 finishing.', delta: { finishing: 5 } },
  { id: 'string-quartet', name: 'String Quartet', icon: '🎻', description: 'They pass like they rehearsed it. +5 passing.', delta: { passing: 5 } },
  { id: 'marathoners', name: 'Marathoners', icon: '🏃', description: 'They train on the facility stairs. +6 stamina.', delta: { stamina: 6 } },
  { id: 'sky-kings', name: 'Sky Kings', icon: '🪁', description: 'Everything in the air is theirs. +6 aerial.', delta: { aerial: 6 } },
  { id: 'safe-hands', name: 'Safe Hands', icon: '🧤', description: 'A keeper academy older than the facility. +5 reflexes and handling.', delta: { reflexes: 5, handling: 5 } },
  { id: 'all-rounders', name: 'All-Rounders', icon: '🎲', description: 'Good at everything, great at nothing. +2 to everything.', delta: { finishing: 2, passing: 2, tackling: 2, pace: 2, composure: 2, vision: 2, reflexes: 2 } },
  { id: 'chaos-engine', name: 'Chaos Engine', icon: '⚙', description: 'Run on pure nerves. +6 finishing, −2 composure.', delta: { finishing: 6, composure: -2 } },
  { id: 'glass-cannons', name: 'Glass Cannons', icon: '🔮', description: 'Strike first, ask later. +5 finishing and dribbling, −3 tackling.', delta: { finishing: 5, dribbling: 5, tackling: -3 } },
  { id: 'tricksters', name: 'Tricksters', icon: '🦊', description: 'They nutmeg their own coaches. +4 dribbling, +2 vision.', delta: { dribbling: 4, vision: 2 } },
  { id: 'home-cooking', name: 'Home Cooking', icon: '🍲', description: 'The Wing kitchen is legendary. +4 finishing and passing at home.', delta: { finishing: 4, passing: 4 }, homeOnly: true },
  { id: 'fortress', name: 'The Fortress', icon: '🏰', description: 'Visitors get lost in the corridors. +5 tackling and reflexes at home.', delta: { tackling: 5, reflexes: 5 }, homeOnly: true },
];

/** Every arena also gives its home club a permanent pitch power-up in home matches. */
export const PITCH_PERKS: ClubPerk[] = [
  { id: 'true-glass', name: 'True Glass', icon: '🪟', description: 'Perfectly flat panels. Wall passes land where they should.', delta: { passing: 3, vision: 3 }, homeOnly: true },
  { id: 'fast-floor', name: 'Fast Floor', icon: '🟩', description: 'The ball skips like a stone on a pond.', delta: { pace: 4, firstTouch: 2 }, homeOnly: true },
  { id: 'home-echo', name: 'Home Echo', icon: '📣', description: 'The home chants bounce around forever.', delta: { composure: 5 }, homeOnly: true },
  { id: 'tight-corners', name: 'Tight Corners', icon: '📐', description: 'Locals know exactly where the rebounds go.', delta: { positioning: 5 }, homeOnly: true },
  { id: 'warm-floor', name: 'Heated Floor', icon: '🔥', description: 'Warm muscles, sharp finishing.', delta: { finishing: 3, stamina: 3 }, homeOnly: true },
  { id: 'low-ceiling', name: 'Low Ceiling', icon: '▣', description: 'Long balls die; short passing thrives.', delta: { passing: 4, aerial: -2 }, homeOnly: true },
  { id: 'mirror-net', name: 'Mirror Net', icon: '🪞', description: 'Visiting shooters see too many goals.', delta: { reflexes: 5 }, homeOnly: true },
  { id: 'lucky-paint', name: 'Lucky Paint', icon: '🍀', description: 'The lines were painted on a four-leaf-clover morning.', delta: { finishing: 2, tackling: 2, pace: 2 }, homeOnly: true },
  { id: 'dim-lights', name: 'Dim Lights', icon: '💡', description: 'The home side trained in the dark.', delta: { vision: 5 }, homeOnly: true },
];

function seededOrder<T>(seed: string, tag: string, items: readonly T[]): T[] {
  const order = [...items];
  const rng = createRng(seed, tag);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** A club's power-up. Stable for a club id, distinct across the first 16 clubs. */
export function clubPerk(seed: string, clubId: string): ClubPerk {
  const order = seededOrder(seed, 'club-perks', CLUB_PERKS);
  const n = Number(clubId.replace(/\D/g, '')) || 0;
  return order[n % order.length];
}

/** The home arena's pitch power-up. */
export function pitchPerk(seed: string, clubId: string): ClubPerk {
  const order = seededOrder(seed, 'pitch-perks', PITCH_PERKS);
  const n = Number(clubId.replace(/\D/g, '')) || 0;
  return order[(n * 7) % order.length];
}

/** Rating deltas a club's players get in one match. */
export function perkDeltas(seed: string, clubId: string, home: boolean): Delta {
  const out: Delta = {};
  for (const perk of [clubPerk(seed, clubId), pitchPerk(seed, clubId)]) {
    if (perk.homeOnly && !home) continue;
    for (const [k, v] of Object.entries(perk.delta) as [SoccerRatingKey, number][]) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Club bios

const ORIGINS = [
  'a bet between two night-shift guards at the facility gates',
  'a youth team that refused to leave the old gymnasium when it closed',
  'a flood that left one dry five-a-side court in the whole city',
  'a sleepwalking mayor signing the charter',
  'a meteor landing on the founder’s garage',
  'a misprinted tournament poster that everyone believed',
  'an argument about whether walls count as teammates',
  'bakers on the early shift with nothing to do at noon',
  'a ghost who wanted somewhere to sit on Sundays',
  'a hailstorm that spelled out PLAY ON across the car park',
];
const QUIRKS = [
  'Fans bring a live goat to the first match of every season.',
  'Every player must learn to whistle before their debut.',
  'They have never worn the same kit two seasons in a row.',
  'Their mascot has not been seen without the costume in decades.',
  'Before each match they roll a single marble across the floor for luck.',
  'The Wing kitchen only cooks one dish, and cooks it beautifully.',
  'Their team photo always has one more person in it than the squad list.',
  'Supporters hum instead of cheering. Visitors find it unsettling.',
  'They tap the glass three times on the way out of the tunnel.',
  'The club anthem is in a key nobody can identify.',
];
const MOTTOS = ['Pass First, Wonder Later', 'Ever Onward, Mostly', 'We Were Here Before the Walls', 'The Glass Remembers', 'Nobody Knows Why, and That Is Fine', 'Bright Lights, Strange Nights', 'Hold the Line', 'Five Is Enough'];

export function clubBio(seed: string, team: SoccerTeam): { founded: number; text: string; motto: string } {
  const rng = createRng(seed, 'club-bio', team.id);
  const founded = rng.range(1889, 2015);
  return {
    founded,
    text: `The ${team.city} ${team.name} were founded in ${founded} after ${rng.pick(ORIGINS)}. ${rng.pick(QUIRKS)}`,
    motto: rng.pick(MOTTOS),
  };
}

// ---------------------------------------------------------------------------
// Careers: soccer careers peak a little earlier than Blastball's.

export type CareerPhase = 'rising' | 'prime' | 'fading' | 'declining';
export const PHASE_LABEL: Record<CareerPhase, string> = { rising: 'Rising', prime: 'In their prime', fading: 'Fading', declining: 'Declining' };

export const initialAge = (playerId: string) => 18 + createRng(playerId, 'age').int(15);
export const rookieAge = (playerId: string) => 17 + createRng(playerId, 'age').int(3);

export function careerPhase(age: number): CareerPhase {
  if (age <= 23) return 'rising';
  if (age <= 28) return 'prime';
  if (age <= 31) return 'fading';
  return 'declining';
}

/** How far from peak a player starts at a given age (shapes a brand-new league). */
export function ageRatingOffset(age: number): number {
  if (age <= 20) return -6;
  if (age <= 23) return -2;
  if (age <= 28) return 3;
  if (age <= 31) return 0;
  return -4;
}

/** Ageing traits on a player: total shift and delay (years). */
export function agingOf(mods: ActiveMod[] | undefined): { shift: number; delay: number } {
  let shift = 0;
  let delay = 0;
  for (const m of mods ?? []) {
    const def = soccerMod(m.id);
    shift += def?.aging?.shift ?? 0;
    delay += def?.aging?.delay ?? 0;
  }
  return { shift, delay };
}

/** One season of development: the young improve, the prime peak, then the fade. */
export function development(age: number, rng: ReturnType<typeof createRng>): number {
  switch (careerPhase(age)) {
    case 'rising': return rng.range(2, 6);
    case 'prime': return rng.range(-1, 3);
    case 'fading': return rng.range(-4, 0);
    case 'declining': return rng.range(-7, -2);
  }
}

/** Per-mille chance of retiring at a given (new) age. */
export function retirementChance(age: number): number {
  if (age >= 36) return 1000;
  if (age >= 34) return 550;
  if (age >= 32) return 200;
  if (age >= 30) return 40;
  return 0;
}

export function agePlayer(p: SoccerPlayer, d: number): SoccerPlayer {
  const ratings = { ...p.ratings };
  for (const k of Object.keys(ratings) as SoccerRatingKey[]) ratings[k] = Math.max(1, Math.min(100, ratings[k] + d));
  return { ...p, ratings };
}

// ---------------------------------------------------------------------------
// Card rarity: performance and powers.

export type Tier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const TIER_LABEL: Record<Tier, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
export const TIER_AT: [Tier, number][] = [['uncommon', 3], ['rare', 6], ['epic', 9], ['legendary', 13]];

export interface RarityInput {
  player: SoccerPlayer;
  mods: ActiveMod[] | undefined;
  career?: { apps: number; goals: number; assists: number; cleanSheets: number };
  titles: number;
  captaincies: number;
  returned: boolean;
}

/** Points toward the next tier, with the reasons (for the card's tooltip). */
export function rarityScore(r: RarityInput): { score: number; why: string[] } {
  const why: string[] = [];
  let score = 0;
  const add = (n: number, reason: string) => {
    if (!n) return;
    score += n;
    why.push(`${reason} +${n}`);
  };
  let powers = 0;
  for (const m of r.mods ?? []) {
    const def = soccerMod(m.id);
    if (!def) continue;
    powers += def.comboOnly || def.returnedOnly ? 3 : m.untilDay === null ? 2 : 1;
  }
  add(powers, 'Powers');
  add(r.player.signatureId ? 1 : 0, 'Signature move');
  add(r.player.awakened ? 3 : 0, 'Awakened');
  add(r.returned ? 2 : 0, 'Returned from the Sub-Levels');
  const c = r.career;
  if (c) {
    const output = r.player.position === 'K' ? c.cleanSheets * 2 + Math.floor(c.apps / 10) : c.goals + c.assists;
    add(Math.min(5, Math.floor(output / 12)), 'Career output');
  }
  add(Math.min(3, r.titles * 2), 'Championships');
  add(r.captaincies >= 10 ? 1 : 0, 'Fan Favorite captain');
  return { score, why };
}

export function tierFor(score: number): Tier {
  let tier: Tier = 'common';
  for (const [t, at] of TIER_AT) if (score >= at) tier = t;
  return tier;
}

// ---------------------------------------------------------------------------
// Player flavour: a dorm bio and a fun fact, fixed per player.

const FACTS = [
  'Has never once seen their own feet while dribbling.',
  'Keeps a lucky marble. The marble is unlucky.',
  'Can hear the arena walls humming.',
  'Was born during a floodlight failure.',
  'Talks to the ball between halves. It answers.',
  'Owns forty identical training tops and one strange one.',
  'Signs autographs in invisible ink.',
  'Sleeps standing up, like a horse.',
  'Writes letters to future seasons.',
  'Refuses to touch the centre circle on Tuesdays.',
  'Swears the Director owes them money.',
  'Trained with a goalkeeper who was secretly two goalkeepers.',
  'Arrives at every match by unexplained means.',
  'Their shadow has better passing numbers.',
  'Hates the number seven. Nobody knows why.',
  'Once nutmegged a vending machine.',
];
const DORM = [
  'Bunks next to the boiler room and likes it.',
  'Has the tidiest locker in the Wing.',
  'Leaves the dorm lights on for whoever is out late.',
  'Runs a secret card game in the laundry room.',
  'Cooks for the whole floor on Sundays.',
  'Never seems to sleep. Never seems tired.',
];

export function playerFlavor(playerId: string): { fact: string; dorm: string } {
  const rng = createRng(playerId, 'flavor');
  return { fact: rng.pick(FACTS), dorm: rng.pick(DORM) };
}

/** A player's card tier in a universe: powers + performance + titles + story. */
export function cardRarity(
  u: { mods: Record<string, ActiveMod[]>; careerStats: Record<string, { apps: number; goals: number; assists: number; cleanSheets: number }>; archive: { championId: string | null }[]; captaincy: Record<string, { total: number }>; vanished: { player: { id: string } }[] },
  player: SoccerPlayer,
  titlesFor: (teamId: string) => number = (teamId) => u.archive.filter((a) => a.championId === teamId).length,
): { tier: Tier; score: number; why: string[]; next: { tier: Tier; at: number } | null } {
  const returned = (u.mods[player.id] ?? []).some((m) => soccerMod(m.id)?.returnedOnly);
  const { score, why } = rarityScore({
    player,
    mods: u.mods[player.id],
    career: u.careerStats[player.id],
    titles: titlesFor(player.teamId),
    captaincies: u.captaincy[player.id]?.total ?? 0,
    returned,
  });
  const next = TIER_AT.find(([, at]) => score < at);
  return { tier: tierFor(score), score, why, next: next ? { tier: next[0], at: next[1] } : null };
}
