import content from '../../content/personas/personas.json';
import { createRng } from '../engine/core/rng';
import type { Player, RatingKey } from '../engine/baseball/types';

/**
 * Fan personas (PRD §7a, PRD 2 §E4). Chosen once per universe (or changed by a Rebrand). Each earns
 * Devotion XP from actions that fit it and unlocks a second perk at Level 2 and a signature ability
 * at Level 3. Everything here is pure and driven by content/personas/personas.json.
 */
export type PersonaKind = 'diehard' | 'analyst' | 'gambler' | 'prophet' | 'organizer' | 'contrarian' | 'collector' | 'storm-chaser' | 'historian' | 'hype-squad';

export interface Persona {
  kind: PersonaKind;
  fanName: string;
  /** The Diehard's team (others may pick one too, for flavor). */
  favoriteTeamId: string | null;
  /** Devotion XP (never decreases, except on a Rebrand). Missing on saves before Sprint 14 = 0. */
  xp?: number;
}

export type PerkEffect = { type: string } & Record<string, unknown>;
export interface PersonaLevel {
  level: 1 | 2 | 3;
  xpRequired: number;
  perk: string;
  effect: PerkEffect;
}
export interface XpRule {
  on: XpEvent;
  xp: number;
  when?: Record<string, unknown>;
}
export interface PersonaDef {
  id: PersonaKind;
  label: string;
  flavor: string;
  new: boolean;
  xpRules: XpRule[];
  levels: PersonaLevel[];
}

/** Things that earn XP. Each is reported by the universe with the facts its rules can test. */
export const XP_EVENTS = [
  'betWon', 'betPlaced', 'favoriteWin', 'favoriteLoss', 'cardViewed', 'pickPaid', 'weirdEvent', 'envEffect',
  'voteBought', 'electionWon', 'factionOpinionUp', 'cardCollected', 'foilEarned', 'binderPageComplete',
  'storyChapterRead', 'milestone', 'departedVisited', 'watchedLive',
] as const;
export type XpEvent = (typeof XP_EVENTS)[number];
const WHEN_KEYS = ['team', 'oddsAtLeast', 'underdog', 'gameHadEnv', 'watched', 'playerVoted', 'kind', 'againstFavorite', 'home', 'capPerDay'];

/** Every perk effect the game implements (some wait for Sprint 16's binder and stories; see PERK_STUBS). */
export const PERK_TYPES = [
  'betBonusPct', 'betRefundPct', 'teamBoostOnce', 'revealStats', 'showOffseasonProjection', 'underdogPayoutPct', 'freeBet', 'doubleDown',
  'weirdHints', 'envForecast', 'voteDiscountPct', 'opinionGainPct', 'factionPledge', 'fadePayoutPct', 'extraFadeSlot', 'jinx',
  'coinsPerNewCard', 'previewRarity', 'scoutCards', 'stadiumForecast', 'envBetBonusPct', 'addClimate', 'earlyChapter',
  'resurrectionOdds', 'extraPinnedGames', 'homeBoostWhenWatching', 'rallyBoost', 'triggerEnv',
];
/** Perks whose feature arrives in Sprint 16 (card binder, player stories). Shown in the Guide as "coming soon". */
export const PERK_STUBS = new Set(['scoutCards', 'earlyChapter']);

export function validatePersonas(input: unknown): { levelThresholds: number[]; rebrandCost: number; personas: PersonaDef[] } {
  const doc = input as { levelThresholds: number[]; rebrandCost: number; personas: PersonaDef[] };
  if (!Array.isArray(doc?.personas) || doc.personas.length !== 10) throw new Error('personas: expected 10 personas');
  for (const p of doc.personas) {
    if (p.levels.length !== 3) throw new Error(`personas: ${p.id} needs 3 levels`);
    p.levels.forEach((l, i) => {
      if (l.xpRequired !== doc.levelThresholds[i]) throw new Error(`personas: ${p.id} level ${l.level} threshold`);
      if (!PERK_TYPES.includes(l.effect.type)) throw new Error(`personas: ${p.id} unknown perk "${l.effect.type}"`);
    });
    for (const r of p.xpRules) {
      if (!XP_EVENTS.includes(r.on)) throw new Error(`personas: ${p.id} unknown xp event "${r.on}"`);
      for (const k of Object.keys(r.when ?? {})) if (!WHEN_KEYS.includes(k)) throw new Error(`personas: ${p.id} unknown when "${k}"`);
    }
  }
  return doc;
}

const PACK = validatePersonas(content);
export const LEVEL_THRESHOLDS = PACK.levelThresholds;
export const REBRAND_COST = PACK.rebrandCost;
export const PERSONA_DEFS: Record<PersonaKind, PersonaDef> = Object.fromEntries(PACK.personas.map((p) => [p.id, p])) as Record<PersonaKind, PersonaDef>;
export const PERSONA_KINDS = PACK.personas.map((p) => p.id);

/** Short facts for pickers and cards. `perk` is the base (Level 1) perk. */
export const PERSONAS: Record<PersonaKind, { label: string; flavor: string; perk: string; available: boolean; isNew: boolean }> = Object.fromEntries(
  PACK.personas.map((p) => [p.id, { label: p.label, flavor: p.flavor, perk: p.levels[0].perk, available: true, isNew: p.new }]),
) as Record<PersonaKind, { label: string; flavor: string; perk: string; available: boolean; isNew: boolean }>;

export const xpOf = (p: Persona | null) => p?.xp ?? 0;
export function levelOf(xp: number): 1 | 2 | 3 {
  return xp >= LEVEL_THRESHOLDS[2] ? 3 : xp >= LEVEL_THRESHOLDS[1] ? 2 : 1;
}
export const personaLevel = (p: Persona | null) => (p ? levelOf(xpOf(p)) : 1);

/** The perk effect of this type, if this persona has unlocked it. */
export function perk(p: Persona | null, type: string): PerkEffect | null {
  if (!p) return null;
  const lvl = personaLevel(p);
  // Highest level first: a Level 2 upgrade of a Level 1 perk (Analyst, Prophet) wins.
  return PERSONA_DEFS[p.kind]?.levels.slice().reverse().find((l) => l.level <= lvl && l.effect.type === type)?.effect ?? null;
}
export const perkValue = (p: Persona | null, type: string, fallback = 0) => Number(perk(p, type)?.value ?? fallback);

/** What an XP event reports; rules test these. */
export interface XpFacts {
  teamId?: string;
  underdog?: boolean;
  /** The backed side was not favored (win chance ≤ 50%). */
  evenOrBetter?: boolean;
  gameHadEnv?: boolean;
  watched?: boolean;
  playerVoted?: boolean;
  kind?: string;
  home?: boolean;
}

/**
 * XP for one event: every matching rule, honoring per-day caps. `usedToday` counts awards per rule
 * key today; the returned keys should be added to it.
 */
export function xpFor(p: Persona | null, on: XpEvent, facts: XpFacts, usedToday: Record<string, number>): { xp: number; keys: string[] } {
  if (!p) return { xp: 0, keys: [] };
  let xp = 0;
  const keys: string[] = [];
  PERSONA_DEFS[p.kind]?.xpRules.forEach((r, i) => {
    if (r.on !== on) return;
    const w = r.when ?? {};
    if (w.team === 'favorite' && facts.teamId !== p.favoriteTeamId) return;
    if (w.oddsAtLeast === 'even' && !facts.evenOrBetter) return;
    if (w.underdog && !facts.underdog) return;
    if (w.againstFavorite && !facts.underdog) return;
    for (const k of ['gameHadEnv', 'watched', 'playerVoted', 'home', 'kind'] as const) if (k in w && w[k] !== facts[k]) return;
    const key = `${on}#${i}`;
    if (typeof w.capPerDay === 'number' && (usedToday[key] ?? 0) >= w.capPerDay) return;
    xp += r.xp;
    keys.push(key);
  });
  return { xp, keys };
}

// ---------------------------------------------------------------------------
// Base perks that predate levels.

export const DIEHARD_BONUS_PCT = 25;
export const GAMBLER_UNDERDOG_PCT = 20;

/** Multiplier offered to this player, after persona perks. `pm` = the backed team's win chance. */
export function personaMultiplier(persona: Persona | null, baseMult: number, pm: number): number {
  const pct = perkValue(persona, 'underdogPayoutPct');
  if (pct && pm < 500) return Math.floor((baseMult * (100 + pct)) / 100);
  return baseMult;
}

/** Coins returned for a winning bet (stake included), after persona perks. */
export function winningPayout(persona: Persona | null, amount: number, multMilli: number, teamId: string, opts: { home?: boolean; gameHadEnv?: boolean } = {}): number {
  const base = Math.floor((amount * multMilli) / 1000);
  let bonusPct = 0;
  const fav = perk(persona, 'betBonusPct');
  if (fav && persona!.favoriteTeamId === teamId && (!fav.home || opts.home)) bonusPct += Number(fav.value);
  if (opts.gameHadEnv) bonusPct += perkValue(persona, 'envBetBonusPct');
  return base + Math.floor((amount * bonusPct) / 100);
}

const RATING_LABEL: Record<RatingKey, string> = {
  contact: 'Contact', power: 'Power', discipline: 'Discipline', velocity: 'Velocity',
  control: 'Control', stuff: 'Stuff', speed: 'Speed', defense: 'Glove',
};

/** The Analyst's extra hidden stats for a player (1 at Level 1, 2 at Level 2), rolled up inside the stars. */
export function analystReveal(player: Player, count = 1): { label: string; value: number }[] {
  const keys: RatingKey[] = player.role === 'pitcher' ? ['velocity', 'control', 'stuff'] : ['contact', 'power', 'discipline'];
  const rng = createRng(player.id, 'analyst');
  const first = rng.pick(keys);
  const picked = [first, ...keys.filter((k) => k !== first).slice(0, Math.max(0, count - 1))];
  return picked.map((key) => ({ label: RATING_LABEL[key], value: player.ratings[key] }));
}
