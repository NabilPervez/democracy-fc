import { addLines, boxScore, emptyLine, type BoxScore, type StatLine } from '../engine/baseball/boxScore';
import { getSport } from '../engine/core/registry';
import type { SportId } from '../engine/core/sport';
import { oddsForGame } from '../engine/odds';
import { computeStandings, generateSchedule } from '../engine/season';
import type { GameEnvironment, GameEvent, GameResult, League, RatingKey, ScheduledGame } from '../engine/baseball/types';
import type { Clock, DayLengthMinutes } from './clock';
import { applyEffect, marginalCost, openElection, playerVoteTotal, tally, winnerOf, type Election } from './elections';
import { createFactions, type Faction } from './factions';
import { reactToChampion, reactToDeath, reactToElection, reactToPatron, reactToReturn, type FactionNews, type FanContext } from './factionNews';
import { generateLeague } from './generate';
import { levelOf, perk, perkValue, personaMultiplier, PERSONA_DEFS, PERSONAS, REBRAND_COST, winningPayout, xpFor, xpOf, type Persona, type PersonaKind, type XpEvent, type XpFacts } from './persona';
import { emptyPicks, lockUnlocked, maxBacked, maxFaded, newUnlocks, pickOf, settlePicks, type PickKind, type Picks } from './picks';
import { advancePlayoffs, ageRatingOffset, initialAge, initialExperience, isPlayoffGame, rookieAge, runOffseason, seasonAwards, startPlayoffs, type Phase, type Playoffs, type SeasonRecord } from './seasons';
import { createRng } from '../engine/core/rng';
import { relegate } from './relegation';
import { isRivalry, recordWithWin, RIVALRY_BONUS, stadiumPerk, teamPerk, type HeadToHead } from './teams';
import { ENVIRONMENT, envEventDef, gameEnvironment } from './environment';
import { agingTraits, applyHappening, isActiveMod, birthTraits, createStadiums, DEFAULT_PACKS, effectiveLeague, expireMods, mergePacks, resurrect, rollDay, type WeirdHappening, type WeirdState } from './weird';

/** The active rule packs (data-driven weirdness). */
export const RULES = mergePacks(DEFAULT_PACKS);

/**
 * A universe is one save: settings + league + season progress. All changes go through
 * `reduce(state, event)`, so the same events always produce the same state.
 */

export const SAVE_VERSION = 14;

/** Out of coins with nothing riding? The league office tops you back up (once a day). */
export const BAILOUT_COINS = 100;
/** Bonus every time your favorite team wins. */
export const FAVORITE_WIN_BONUS = 15;
/** Favorite team can be chosen or changed until this season ends. */
export const FAVORITE_LOCKS_AFTER_SEASON = 1;

/** Patron tier (PRD §8): unlocked from Season 2. */
export const PATRON_COST = 150;
export const PATRON_BLESSING = 3;
export const PATRON_FROM_SEASON = 2;

export const STARTING_COINS = 100;
/** Small daily allowance so a broke fan can always get back in the game. */
export const DAILY_STIPEND = 10;
const LEDGER_KEPT = 200;

export type ChaosLevel = 'calm' | 'normal' | 'weird' | 'unhinged';
export type TimeMode = 'manual' | 'living';
export const LEAGUE_SIZES = [4, 8, 12, 16] as const;
export const SEASON_LENGTHS = [20, 50, 99] as const;

export interface UniverseSettings {
  name: string;
  seed: string;
  leagueSize: (typeof LEAGUE_SIZES)[number];
  seasonLength: (typeof SEASON_LENGTHS)[number];
  chaos: ChaosLevel;
  timeMode: TimeMode;
  /** Living mode: real minutes per in-game day. */
  dayLengthMinutes: DayLengthMinutes;
  /** Living mode: % of each day before all games start together (default 25). */
  firstPitchPct?: number;
}

export type TimelineKind = 'election' | 'death' | 'return' | 'weird' | 'champion' | 'retirement' | 'rivalry' | 'relegation' | 'persona';

/** Notable world events, kept forever (unlike the capped news feed). */
export interface TimelineEntry {
  season: number;
  day: number;
  kind: TimelineKind;
  text: string;
}

export interface GameSummary {
  gameId: string;
  day: number;
  awayId: string;
  homeId: string;
  awayScore: number;
  homeScore: number;
  innings: number;
  /** Plays an environment event changed (engine v4+). */
  envChanged?: number;
}

export interface LogEntry {
  season: number;
  day: number;
  text: string;
}

export interface Bet {
  id: string;
  gameId: string;
  day: number;
  teamId: string;
  amount: number;
  /** Payout multiplier in thousandths, locked when the bet is placed. */
  multMilli: number;
  /** The backed team's public win chance (per mille) when the bet was placed (Sprint 14+). */
  pm?: number;
  /** The Gambler's weekly free bet: no stake taken, and only the winnings are paid. */
  free?: boolean;
  /** The Gambler's Double Down was used on this bet. */
  doubled?: boolean;
  status: 'open' | 'won' | 'lost';
  payout: number;
  season: number;
}

export interface LedgerEntry {
  season: number;
  day: number;
  amount: number;
  reason: string;
}

export interface UniverseState {
  saveVersion: number;
  /** Which match engine this universe runs (Democracy FC S1). Old saves are baseball. */
  sport: SportId;
  /** Engine the current season is simmed with. Saves from before Sprint 12 move to the new engine at their next season. */
  engineVersion: number;
  id: string;
  createdAt: number;
  settings: UniverseSettings;
  league: League;
  season: number;
  schedule: ScheduledGame[];
  results: Record<string, GameSummary>;
  /** Games the player has started watching (locks them from changes such as bets). */
  started: string[];
  currentDay: number;
  seasonStats: Record<string, StatLine>;
  careerStats: Record<string, StatLine>;
  playerLog: Record<string, LogEntry[]>;
  coins: number;
  bets: Bet[];
  persona: Persona | null;
  /** Most recent coin movements, newest last. */
  ledger: LedgerEntry[];
  factions: Faction[];
  /** Every election this universe has held; the last one is open while result === null. */
  elections: Election[];
  /** Headlines: faction reactions, election results. Newest last. */
  news: NewsItem[];
  /** Modifiers, stadiums, the Departed. */
  weird: WeirdState;
  /** Living mode clock; null in Manual mode. */
  clock: Clock | null;
  timeline: TimelineEntry[];
  /** Day the player last exported (or dismissed the backup reminder). */
  lastBackupDay: number;
  phase: Phase;
  /** Days elapsed since the universe began (never resets) — the Living clock counts these. */
  dayCount: number;
  ages: Record<string, number>;
  playoffs: Playoffs | null;
  /** Patron sponsorship for the current season, if any. */
  patron: { season: number; teamId: string } | null;
  archive: SeasonRecord[];
  /** Finished seasons' stat lines: season → player → line. */
  statsBySeason: Record<number, Record<string, StatLine>>;
  /** Each faction's opinion of the player, -5..5. */
  factionOpinion: Record<string, number>;
  /** Players the fan backs or fades. */
  picks: Picks;
  /** Coins earned from picks this season. */
  pickEarnings: number;
  /** dayCount of the last bailout, so it happens at most once a day. */
  lastBailoutDay: number;
  /** Seasons each player had finished before the current one (0 = rookie). */
  experience: Record<string, number>;
  /** The fan's keepsake cards: favorite players, oldest first. No gameplay effect. */
  collection: CollectedCard[];
  /** All-time head-to-head wins: h2h[a][b] = games a has won against b. */
  h2h: HeadToHead;
  // Sprint 14: pick streaks, slot unlocks, persona levels and signature abilities.
  /** Coins earned from picks, ever. Never goes down; unlocks slots. */
  picksLifetime: number;
  /** Games in a row each current pick has paid. */
  pickStreaks: Record<string, number>;
  /** The Lock (3,000 lifetime pick coins): one pick per season survives one empty game. */
  pickLock: { season: number; playerId: string; used: boolean } | null;
  /** Once-per-season/week abilities: ability → the period it was last used in ("s3", "s3w2"). */
  perkUses: Record<string, string>;
  /** XP awarded today per rule, for daily caps. */
  xpToday: { dayCount: number; counts: Record<string, number> };
  /** Games the fan was watching from the first pitch (logged before the game is simulated). */
  watched: string[];
  /** Diehard's Rally Cry: +3 for the favorite team in this game. */
  rallyCry: { gameId: string; teamId: string } | null;
  /** Contrarian's Jinx: doubled fade payouts on this player until the day passes. */
  jinx: { season: number; playerId: string; untilDay: number } | null;
  /** Hype Squad's Wave: a Crowd Surge at this game. */
  waveGameId: string | null;
  /** Storm Chaser's Seed the Clouds: a stadium's extra climate for a week. */
  tempClimates: Record<string, { climate: string; season: number; untilDay: number }>;
  /** Players whose card already paid the Collector's new-card coins. */
  collectorPaid: string[];
  /** The Prophet's Forecast for today. */
  forecastReveal: { season: number; day: number; text: string } | null;
}

export interface CollectedCard {
  playerId: string;
  season: number;
  day: number;
}

export interface NewsItem {
  season: number;
  day: number;
  text: string;
  /** Set when a faction is talking. */
  factionId?: string;
}

export type WorldEvent =
  | { type: 'gameStarted'; gameId: string }
  | { type: 'gamePlayed'; summary: GameSummary; box: BoxScore }
  | { type: 'dayEnded'; day: number }
  | { type: 'personaChosen'; persona: Persona }
  | { type: 'betPlaced'; gameId: string; teamId: string; amount: number; free?: boolean }
  | { type: 'votesBought'; electionId: number; proposal: number; count: number }
  | { type: 'weird'; happening: WeirdHappening }
  | { type: 'timeSettingsChanged'; timeMode: TimeMode; dayLengthMinutes: DayLengthMinutes; nowMs: number }
  | { type: 'clockSet'; clock: Clock }
  | { type: 'firstPitchSet'; pct: number }
  | { type: 'backupNoted'; day: number }
  | { type: 'patronSponsored'; teamId: string }
  | { type: 'favoriteTeamSet'; teamId: string }
  | { type: 'pickSet'; playerId: string; kind: PickKind | null }
  | { type: 'collectionToggled'; playerId: string }
  | { type: 'massBet'; side: 'favorite' | 'underdog'; amount: number }
  | { type: 'watchedLive'; gameId: string }
  | { type: 'cardViewed'; playerId: string }
  | { type: 'departedVisited'; playerId: string }
  | { type: 'pickLocked'; playerId: string }
  | { type: 'perkUsed'; ability: Ability; target?: string; proposal?: number; climate?: string }
  | { type: 'rebranded'; kind: PersonaKind };

/** Level 3 signature abilities (and the Gambler's Level 2 free bet, which goes through betPlaced). */
export type Ability = 'rallyCry' | 'doubleDown' | 'forecast' | 'backroomDeal' | 'jinx' | 'seedClouds' | 'wave';

/** Born-with traits for new players (only those who have any). */
export function bornWith(seed: string, playerIds: string[]): Record<string, { id: string; until: null }[]> {
  const out: Record<string, { id: string; until: null }[]> = {};
  for (const id of playerIds) {
    const mods = birthTraits(seed, id, RULES) as { id: string; until: null }[];
    if (mods.length) out[id] = mods;
  }
  return out;
}

/** A new league is mid-history: ratings reflect where each player is in their career arc. */
function shapeByAge(league: League, ages: Record<string, number>): League {
  const players = Object.fromEntries(
    Object.values(league.players).map((p) => {
      const d = ageRatingOffset(ages[p.id]);
      const ratings = Object.fromEntries(Object.entries(p.ratings).map(([k, v]) => [k, Math.max(0, Math.min(100, v + d))])) as typeof p.ratings;
      return [p.id, { ...p, ratings }];
    }),
  );
  return { ...league, players };
}

export function createUniverse(id: string, settings: UniverseSettings, now: number, persona: Persona | null = null): UniverseState {
  const generated = generateLeague({ seed: settings.seed, name: settings.name, teamCount: settings.leagueSize });
  const ages = Object.fromEntries(Object.keys(generated.players).map((id) => [id, initialAge(id)]));
  const league = shapeByAge(generated, ages);
  const base: UniverseState = {
    saveVersion: SAVE_VERSION,
    sport: 'baseball',
    engineVersion: getSport('baseball').engineVersion,
    id,
    createdAt: now,
    settings,
    league,
    season: 1,
    schedule: generateSchedule(league.teams, settings.seasonLength),
    results: {},
    started: [],
    currentDay: 1,
    seasonStats: {},
    careerStats: {},
    playerLog: {},
    coins: STARTING_COINS,
    bets: [],
    persona: persona ? { ...persona, xp: persona.xp ?? 0 } : null,
    picksLifetime: 0,
    pickStreaks: {},
    pickLock: null,
    perkUses: {},
    xpToday: { dayCount: 1, counts: {} },
    watched: [],
    rallyCry: null,
    jinx: null,
    waveGameId: null,
    tempClimates: {},
    collectorPaid: [],
    forecastReveal: null,
    ledger: [],
    factions: createFactions(settings.seed, league.teams.map((t) => t.id)),
    elections: [],
    news: [],
    weird: { playerStatus: {}, playerMods: bornWith(settings.seed, Object.keys(league.players)), stadiums: createStadiums(settings.seed, league), departed: [] },
    clock: settings.timeMode === 'living' ? { anchorMs: now, anchorDay: 1 } : null,
    timeline: [],
    lastBackupDay: 1,
    phase: 'regular',
    dayCount: 1,
    ages,
    experience: Object.fromEntries(Object.keys(league.players).map((id) => [id, initialExperience(id, ages[id])])),
    collection: [],
    h2h: {},
    playoffs: null,
    patron: null,
    archive: [],
    statsBySeason: {},
    factionOpinion: {},
    picks: emptyPicks(),
    pickEarnings: 0,
    lastBailoutDay: 0,
  };
  return withNewElection(base, 1);
}

export const seasonDays = (s: UniverseState) => s.settings.seasonLength;
/** The season (regular season + playoffs) is finished and the offseason has begun. */
export const isSeasonOver = (s: UniverseState) => s.phase === 'offseason';
/** Regular-season results only (standings ignore the playoffs). */
export const regularResults = (s: UniverseState) => Object.values(s.results).filter((r) => !isPlayoffGame(r.gameId));
export const standingsOf = (s: UniverseState) => computeStandings(s.league.teams, regularResults(s));
export const lastScheduledDay = (s: UniverseState) => s.schedule.reduce((m, g) => Math.max(m, g.day), 0);
export const betsThisSeason = (s: UniverseState) => s.bets.filter((b) => b.season === s.season);
export const gamesOn = (s: UniverseState, day: number) => s.schedule.filter((g) => g.day === day);
export const unplayedToday = (s: UniverseState) => gamesOn(s, s.currentDay).filter((g) => !s.results[g.id]);

export function teamRecords(s: UniverseState): Record<string, { wins: number; losses: number }> {
  return Object.fromEntries(
    standingsOf(s).map((r) => [r.teamId, { wins: r.wins, losses: r.losses }]),
  );
}

/** Odds a bettor sees for a game right now (public info only). */
export function currentOdds(s: UniverseState, gameId: string) {
  const game = s.schedule.find((g) => g.id === gameId)!;
  // Odds see the same ratings the game will be played with: traits, perks, stadium, rivalry, patron.
  return oddsForGame(gameLeague(s, game), game, teamRecords(s));
}

/** The multiplier this player would get backing `teamId` (after persona perks). */
export function offeredMultiplier(s: UniverseState, gameId: string, teamId: string): number {
  const game = s.schedule.find((g) => g.id === gameId)!;
  const odds = currentOdds(s, gameId);
  const home = teamId === game.homeId;
  return personaMultiplier(s.persona, home ? odds.homeMult : odds.awayMult, home ? odds.homePm : odds.awayPm);
}

/** Why a bet can't be placed, or null if it can. Bets lock when a game starts. */
export function betError(s: UniverseState, gameId: string, teamId: string, amount: number): string | null {
  const game = s.schedule.find((g) => g.id === gameId);
  if (!game) return 'No such game.';
  if (game.day !== s.currentDay) return "You can only bet on today's games.";
  if (s.results[gameId] || s.started.includes(gameId)) return 'Betting is closed — this game has started.';
  if (teamId !== game.awayId && teamId !== game.homeId) return "That team isn't playing in this game.";
  if (!Number.isInteger(amount) || amount < 1) return 'Bet at least 1 coin.';
  if (amount > s.coins) return 'Not enough coins.';
  if (betsThisSeason(s).some((b) => b.gameId === gameId && b.teamId !== teamId)) return 'You already backed the other team in this game.';
  return null;
}

/**
 * Today's open games and the side a one-tap mass bet would back: the favorite (lower payout)
 * or the underdog. Games already bet on the other side, or with even odds, are skipped.
 */
export function massBetTargets(s: UniverseState, side: 'favorite' | 'underdog'): { gameId: string; teamId: string }[] {
  const out: { gameId: string; teamId: string }[] = [];
  for (const g of s.schedule) {
    if (g.day !== s.currentDay || s.results[g.id] || s.started.includes(g.id)) continue;
    const away = offeredMultiplier(s, g.id, g.awayId);
    const home = offeredMultiplier(s, g.id, g.homeId);
    if (away === home) continue;
    const favorite = away < home ? g.awayId : g.homeId;
    const teamId = side === 'favorite' ? favorite : favorite === g.awayId ? g.homeId : g.awayId;
    if (betsThisSeason(s).some((b) => b.gameId === g.id && b.teamId !== teamId)) continue;
    out.push({ gameId: g.id, teamId });
  }
  return out;
}

/** Why the player can't become this season's Patron, or null if they can. */
export function patronError(s: UniverseState, teamId: string): string | null {
  if (s.season < PATRON_FROM_SEASON) return `Patrons unlock in Season ${PATRON_FROM_SEASON}.`;
  if (s.phase === 'offseason') return 'Sponsorships open when the new season starts.';
  if (s.patron?.season === s.season) return 'You already sponsor a team this season.';
  if (!s.league.teams.some((t) => t.id === teamId)) return 'No such team.';
  if (s.coins < PATRON_COST) return `Sponsoring costs ${PATRON_COST} coins.`;
  return null;
}

/** Apply the Patron's blessing to a game's league view. */
function withPatron(s: UniverseState, league: League, game: ScheduledGame): League {
  const p = s.patron;
  if (!p || p.season !== s.season || (game.awayId !== p.teamId && game.homeId !== p.teamId)) return league;
  const team = league.teams.find((t) => t.id === p.teamId)!;
  const players = { ...league.players };
  for (const id of [...team.lineup, ...team.rotation]) {
    const ratings = { ...players[id].ratings };
    for (const k of Object.keys(ratings) as (keyof typeof ratings)[]) ratings[k] = Math.min(100, ratings[k] + PATRON_BLESSING);
    players[id] = { ...players[id], ratings };
  }
  return { ...league, players };
}

/** Each team's unique perk, the home stadium's perk, plus the rivalry bonus when rivals meet. */
function withTeamIdentity(s: UniverseState, league: League, game: ScheduledGame): League {
  const rivals = isRivalry(s.h2h ?? {}, game.awayId, game.homeId);
  const players = { ...league.players };
  for (const teamId of [game.awayId, game.homeId]) {
    const perk = teamPerk(s.settings.seed, s.league, teamId);
    const home = teamId === game.homeId;
    const park = home ? stadiumPerk(s.settings.seed, s.league, teamId, s.weird.stadiums[teamId]?.rebuilt).delta : null;
    const deltas = [...(!perk.homeOnly || home ? [perk.delta] : []), ...(park ? [park] : []), ...(rivals ? [RIVALRY_BONUS] : [])];
    if (!deltas.length) continue;
    const team = league.teams.find((t) => t.id === teamId)!;
    for (const id of [...team.lineup, ...team.rotation]) {
      const ratings = { ...players[id].ratings };
      for (const d of deltas) {
        for (const [k, v] of Object.entries(d)) {
          const key = k as keyof typeof ratings;
          ratings[key] = Math.max(0, Math.min(100, ratings[key] + (v ?? 0)));
        }
      }
      players[id] = { ...players[id], ratings };
    }
  }
  return { ...league, players };
}

/** The home stadium's environment for a game: its climates, active stadium mods, and the chaos level. */
export function stadiumEnvironment(s: UniverseState, game: ScheduledGame): GameEnvironment {
  const st = s.weird.stadiums[game.homeId];
  const mods = (st?.mods ?? []).filter((m) => isActiveMod(m, s.season, game.day)).map((m) => m.id);
  const env = gameEnvironment(stadiumClimates(s, game.homeId, game.day), mods, s.settings.chaos);
  // Hype Squad: the Wave forces a Crowd Surge; crowd energy fuels late home rallies while you watch.
  const wave = s.waveGameId === game.id ? envEventDef(String(perk(s.persona, 'triggerEnv')?.envId ?? 'crowd-surge')) : undefined;
  const fav = s.persona?.favoriteTeamId;
  const rally = perk(s.persona, 'rallyBoost');
  const watching = (s.watched ?? []).includes(game.id) && fav === game.homeId;
  return { ...env, ...(wave && { forcedEnv: wave }), ...(rally && watching && { rally: { teamId: fav!, max: Number(rally.maxValue ?? 3) } }) };
}

/** A stadium's climates today, including a Storm Chaser's seeded clouds. */
export function stadiumClimates(s: UniverseState, teamId: string, day = s.currentDay): string[] {
  const base = s.weird.stadiums[teamId]?.climates ?? [];
  const t = s.tempClimates?.[teamId];
  return t && t.season === s.season && day <= t.untilDay && !base.includes(t.climate) ? [...base, t.climate] : base;
}

export const gameLeague = (s: UniverseState, game: ScheduledGame) =>
  withFanBoosts(s, withTeamIdentity(s, withPatron(s, effectiveLeague(s.league, s.weird, game, s.season, RULES), game), game), game);

/** Rating boosts the fan earned: the Diehard's Rally Cry, the Hype Squad watching a home game. Both are logged before the game. */
function withFanBoosts(s: UniverseState, league: League, game: ScheduledGame): League {
  const boosts: { teamId: string; value: number }[] = [];
  if (s.rallyCry?.gameId === game.id) boosts.push({ teamId: s.rallyCry.teamId, value: perkValue(s.persona, 'teamBoostOnce', 3) || 3 });
  const hype = perkValue(s.persona, 'homeBoostWhenWatching');
  const fav = s.persona?.favoriteTeamId;
  if (hype && fav === game.homeId && (s.watched ?? []).includes(game.id)) boosts.push({ teamId: fav, value: hype });
  if (!boosts.length) return league;
  const players = { ...league.players };
  for (const b of boosts) {
    const team = league.teams.find((t) => t.id === b.teamId);
    for (const id of team ? [...team.lineup, ...team.rotation] : []) {
      const ratings = { ...players[id].ratings };
      for (const k of Object.keys(ratings) as (keyof typeof ratings)[]) ratings[k] = Math.min(100, ratings[k] + b.value);
      players[id] = { ...players[id], ratings };
    }
  }
  return { ...league, players };
}

/** Why the favorite team can't be set, or null if it can. */
export function favoriteTeamError(s: UniverseState, teamId: string): string | null {
  if (!s.persona) return 'Choose your fan persona first.';
  if (s.season > FAVORITE_LOCKS_AFTER_SEASON) return `Your favorite team was locked in after Season ${FAVORITE_LOCKS_AFTER_SEASON}.`;
  if (!s.league.teams.some((t) => t.id === teamId)) return 'No such team.';
  return null;
}

const ENV_CLIMATES = ENVIRONMENT.climates.map((c) => c.id);

/** The Gambler's weekly free bet (Level 2): why it can't be placed, or null. */
export function freeBetError(s: UniverseState, gameId: string, teamId: string, amount: number): string | null {
  const eff = perk(s.persona, 'freeBet');
  if (!eff) return 'Free bets unlock at Gambler Level 2.';
  if (s.perkUses?.freeBet === periodKey(s, 'week')) return 'You already used this week’s free bet.';
  const max = Number(eff.max ?? 25);
  if (amount > max) return `A free bet can be up to ${max} coins.`;
  // The usual rules, except the stake isn't taken from your coins.
  return betError({ ...s, coins: Math.max(s.coins, amount) }, gameId, teamId, amount);
}

/** Why a pick can't be made, or null if it can. kind null = clear the pick. */
export function pickError(s: UniverseState, playerId: string, kind: PickKind | null): string | null {
  if (!s.league.players[playerId]) return 'No such player.';
  if (kind === null) return null;
  const status = s.weird.playerStatus[playerId];
  if (status === 'departed' || status === 'retired') return "That player isn't playing any more.";
  const current = pickOf(s.picks, playerId);
  if (current === kind) return null;
  const backs = maxBacked(s.picksLifetime ?? 0);
  const fades = fadeSlots(s);
  if (kind === 'back' && s.picks.back.length >= backs) return `You can back up to ${backs} players. Drop one first.`;
  if (kind === 'fade' && s.picks.fade.length >= fades) return `You can fade up to ${fades} players. Drop one first.`;
  return null;
}

export const backSlots = (s: UniverseState) => maxBacked(s.picksLifetime ?? 0);
export const fadeSlots = (s: UniverseState) => maxFaded(s.picksLifetime ?? 0, perkValue(s.persona, 'extraFadeSlot'));

// ---------------------------------------------------------------------------
// Persona XP and abilities (PRD 2 §E4).

/** The period an ability's limit counts in: "s3" (season) or "s3w2" (week of the season). */
const periodKey = (s: UniverseState, per: 'season' | 'week') => (per === 'season' ? `s${s.season}` : `s${s.season}w${Math.floor((s.currentDay - 1) / 7)}`);

/** Award XP for one happening (`times` repeats it). Announces a new level in the news and timeline. */
function gainXp(s: UniverseState, on: XpEvent, facts: XpFacts = {}, times = 1): UniverseState {
  if (!s.persona || times <= 0) return s;
  const today = s.xpToday?.dayCount === s.dayCount ? s.xpToday : { dayCount: s.dayCount, counts: {} };
  const counts = { ...today.counts };
  let gained = 0;
  for (let i = 0; i < times; i++) {
    const r = xpFor(s.persona, on, facts, counts);
    if (!r.xp) break;
    gained += r.xp;
    for (const k of r.keys) counts[k] = (counts[k] ?? 0) + 1;
  }
  if (!gained) return s;
  const before = xpOf(s.persona);
  const persona = { ...s.persona, xp: before + gained };
  let next: UniverseState = { ...s, persona, xpToday: { dayCount: s.dayCount, counts } };
  const was = levelOf(before);
  const now = levelOf(persona.xp);
  if (now > was) {
    const def = PERSONA_DEFS[persona.kind];
    const lvl = def.levels[now - 1];
    const text = `${persona.fanName || 'You'} reached Level ${now} as ${def.label}! New: ${lvl.perk}`;
    next = { ...next, news: withNews(next, [text]), timeline: withTimeline(next, 'persona', text) };
  }
  return next;
}

/** Why an ability can't be used right now, or null if it can. */
export function abilityError(s: UniverseState, ability: Ability, target?: string, proposal?: number, climate?: string): string | null {
  const need: Record<Ability, string> = {
    rallyCry: 'teamBoostOnce', doubleDown: 'doubleDown', forecast: 'envForecast', backroomDeal: 'factionPledge', jinx: 'jinx', seedClouds: 'addClimate', wave: 'triggerEnv',
  };
  const eff = perk(s.persona, need[ability]);
  if (!eff) return 'Your persona has not unlocked this.';
  const per = (eff.per as 'season' | 'week') ?? 'season';
  if (s.perkUses?.[ability] === periodKey(s, per)) return `Already used this ${per}.`;
  if (s.phase === 'offseason') return 'Wait for the new season.';
  switch (ability) {
    case 'rallyCry':
    case 'wave':
      if (!s.persona?.favoriteTeamId) return 'Choose a favorite team first.';
      return nextFavoriteGame(s, ability === 'wave') ? null : `No upcoming ${ability === 'wave' ? 'home ' : ''}game for your team.`;
    case 'doubleDown': {
      const bet = s.bets.find((b) => b.id === target);
      if (!bet || bet.status !== 'won' || bet.season !== s.season || bet.day !== s.currentDay) return "Pick one of today's winning bets.";
      return bet.doubled ? 'Already doubled.' : null;
    }
    case 'forecast':
      return s.engineVersion < 4 ? 'Environment events begin next season.' : unplayedToday(s).length ? null : 'No games left today.';
    case 'backroomDeal': {
      const e = currentElection(s);
      if (!e) return 'No election is open.';
      if ((s.factionOpinion?.[target ?? ''] ?? 0) < Number(eff.minOpinion ?? 3)) return 'That faction needs to like you more (+3 or better).';
      if (proposal === undefined || proposal < 0 || proposal >= e.proposals.length) return 'Choose a proposal.';
      return e.factionVotes[target!] ? null : 'No such faction.';
    }
    case 'jinx':
      return s.league.players[target ?? ''] ? null : 'Choose a player.';
    case 'seedClouds':
      if (!s.league.teams.some((t) => t.id === target)) return 'Choose a stadium.';
      return climate && ENV_CLIMATES.includes(climate) ? null : 'Choose a climate.';
  }
}

/** The favorite team's next game that hasn't started (home only for the Wave). */
function nextFavoriteGame(s: UniverseState, homeOnly: boolean): ScheduledGame | null {
  const fav = s.persona?.favoriteTeamId;
  if (!fav) return null;
  return (
    s.schedule
      .filter((g) => g.day >= s.currentDay && !s.results[g.id] && !s.started.includes(g.id) && (g.homeId === fav || (!homeOnly && g.awayId === fav)))
      .sort((a, b) => a.day - b.day)[0] ?? null
  );
}

/**
 * The Analyst's Projection (Level 3): what the offseason would do to a player if it started now —
 * the same deterministic roll the real offseason makes, on today's league.
 */
export function offseasonProjection(s: UniverseState, playerId: string): { retires: boolean; change: Partial<Record<RatingKey, number>> } | null {
  const p = s.league.players[playerId];
  if (!p) return null;
  const off = runOffseason(s.league, s.ages, s.settings.seed, s.season + 1, s.experience, agingTraits(s.weird, RULES, s.season, s.currentDay));
  if (off.retired.some((r) => r.playerId === playerId)) return { retires: true, change: {} };
  const after = off.league.players[playerId];
  const change = Object.fromEntries((Object.keys(p.ratings) as RatingKey[]).map((k) => [k, after.ratings[k] - p.ratings[k]]).filter(([, d]) => d !== 0));
  return { retires: false, change };
}

/** The Prophet's Forecast: the first environment event today's remaining games will see. */
function todaysForecast(s: UniverseState): string {
  for (const g of unplayedToday(s)) {
    const events = simulate(s, g).events;
    const e = events.find((x) => x.kind === 'envStart');
    if (e && e.kind === 'envStart') {
      const def = envEventDef(e.envId);
      return `${def?.icon ?? ''} ${def?.name ?? 'Something'} will stir at ${s.weird.stadiums[g.homeId]?.name ?? 'a stadium'} in the ${e.half} of inning ${e.inning} (${teamName(s, g.awayId)} at ${teamName(s, g.homeId)}).`;
    }
  }
  return 'The skies are clear: no environment events in the rest of today’s games.';
}

const openBetsThisSeason = (s: UniverseState) => s.bets.some((b) => b.status === 'open' && b.season === s.season);

/** Broke, with nothing riding on a game: the league office hands back some coins (once a day). */
function withBailout(s: UniverseState): UniverseState {
  if (s.coins >= 1 || openBetsThisSeason(s) || s.lastBailoutDay === s.dayCount) return s;
  const fan = s.persona?.fanName || 'A broke fan';
  return {
    ...s,
    coins: s.coins + BAILOUT_COINS,
    lastBailoutDay: s.dayCount,
    ledger: withLedger(s, BAILOUT_COINS, 'League office bailout'),
    news: withNews(s, [`The league office takes pity on ${fan}: +${BAILOUT_COINS} coins to get back in the game.`]),
  };
}

/** After a game: favorite-team bonus, pick payouts, then the bailout check. */
function afterGame(s: UniverseState, summary: GameSummary, box: BoxScore): UniverseState {
  const winnerId = summary.homeScore > summary.awayScore ? summary.homeId : summary.awayId;
  const loserId = winnerId === summary.homeId ? summary.awayId : summary.homeId;
  const h2h = recordWithWin(s.h2h ?? {}, winnerId, loserId);
  let next: UniverseState = { ...s, h2h };
  if (!isRivalry(s.h2h ?? {}, winnerId, loserId) && isRivalry(h2h, winnerId, loserId)) {
    const met = h2h[winnerId][loserId] + (h2h[loserId]?.[winnerId] ?? 0);
    const text = `A rivalry is born: the ${teamLabel(s, winnerId)} and the ${teamLabel(s, loserId)} have met ${met} times and neither will back down.`;
    next = { ...next, news: withNews(next, [text], summary.day), timeline: withTimeline(next, 'rivalry', text, summary.day) };
  }
  const fav = s.persona?.favoriteTeamId;
  if (fav && fav === winnerId) {
    next = { ...next, coins: next.coins + FAVORITE_WIN_BONUS, ledger: withLedger(next, FAVORITE_WIN_BONUS, `Your ${teamName(next, fav)} won`, summary.day) };
  }
  if (fav && (fav === winnerId || fav === loserId)) next = gainXp(next, fav === winnerId ? 'favoriteWin' : 'favoriteLoss', { home: fav === summary.homeId });

  const jinx = next.jinx && next.jinx.season === next.season && summary.day <= next.jinx.untilDay ? next.jinx.playerId : null;
  const lock = next.pickLock?.season === next.season ? next.pickLock : null;
  const settled = settlePicks(next.picks, box, next.league, {
    streaks: next.pickStreaks ?? {},
    fadeBonusPct: perkValue(next.persona, 'fadePayoutPct'),
    jinxedId: jinx,
    lockedId: lock?.playerId ?? null,
    lockUsed: lock?.used ?? false,
  });
  next = { ...next, pickStreaks: settled.streaks, pickLock: lock ? { ...lock, used: settled.lockUsed } : next.pickLock };
  const total = settled.lines.reduce((sum, l) => sum + l.amount, 0);
  if (total > 0) {
    const detail = settled.lines.map((l) => `${next.league.players[l.playerId].name} ${l.why}`).join(', ');
    const before = next.picksLifetime ?? 0;
    const lifetime = before + total;
    next = { ...next, coins: next.coins + total, pickEarnings: next.pickEarnings + total, picksLifetime: lifetime, ledger: withLedger(next, total, `Picks: ${detail}`, summary.day) };
    for (const u of newUnlocks(before, lifetime)) {
      const text = `Unlocked ${u.text} (${u.at.toLocaleString()} lifetime pick coins).`;
      next = { ...next, news: withNews(next, [text], summary.day), timeline: withTimeline(next, 'persona', text, summary.day) };
    }
    for (const l of settled.lines) next = gainXp(next, 'pickPaid', { kind: l.kind });
  }
  for (const [id, n] of Object.entries(settled.streaks)) {
    const was = s.pickStreaks?.[id] ?? 0;
    if ((n === 5 || n === 10) && was < n) next = { ...next, news: withNews(next, [`Hot hand: ${next.league.players[id]?.name} has paid your pick ${n} games in a row.`], summary.day) };
  }
  return withBailout(next);
}

const teamName = (s: UniverseState, id: string) => s.league.teams.find((t) => t.id === id)?.name ?? id;

const withLedger = (s: UniverseState, amount: number, reason: string, day = s.currentDay): LedgerEntry[] =>
  [...s.ledger, { season: s.season, day, amount, reason }].slice(-LEDGER_KEPT);

const NEWS_KEPT = 120;
const withNews = (s: UniverseState, texts: string[], day = s.currentDay): NewsItem[] =>
  [...s.news, ...texts.map((text) => ({ season: s.season, day, text }))].slice(-NEWS_KEPT);

const withFactionNews = (s: UniverseState, items: FactionNews[], day = s.currentDay): NewsItem[] =>
  [...s.news, ...items.map((n) => ({ season: s.season, day, text: n.text, factionId: n.factionId }))].slice(-NEWS_KEPT);

export const lifetimeVotes = (s: UniverseState) => s.elections.reduce((sum, e) => sum + e.playerVotes.reduce((a, b) => a + b, 0), 0);
const fanContext = (s: UniverseState): FanContext => ({ persona: s.persona, lifetimeVotes: lifetimeVotes(s), opinion: s.factionOpinion });

const withTimeline = (s: UniverseState, kind: TimelineKind, text: string, day = s.currentDay): TimelineEntry[] => [...s.timeline, { season: s.season, day, kind, text }];

/** The election currently accepting votes, if any. */
export const currentElection = (s: UniverseState): Election | null => {
  const e = s.elections[s.elections.length - 1];
  return e && !e.result ? e : null;
};

const publicStandings = (s: UniverseState) =>
  standingsOf(s).map((r) => ({ teamId: r.teamId, wins: r.wins, losses: r.losses }));

/** Open the next weekly election starting on `openedDay` (no-op past the end of the season). */
export function withNewElection(s: UniverseState, openedDay: number): UniverseState {
  if (openedDay > seasonDays(s)) return s;
  const departed = s.weird.departed
    .filter((d) => s.weird.playerStatus[d.playerId] === 'departed')
    .map((d) => ({ playerId: d.playerId, name: s.league.players[d.playerId].name, teamId: d.teamId }));
  const resurrectionPm = perkValue(s.persona, 'resurrectionOdds') || undefined;
  const e = openElection(s.league, s.factions, publicStandings(s), s.elections.length + 1, s.season, openedDay, seasonDays(s), departed, resurrectionPm);
  // The faction most committed to a single proposal makes the headline.
  let loudest = s.factions[0];
  let loudestPick = 0;
  for (const f of s.factions) {
    const votes = e.factionVotes[f.id];
    const pick = votes.indexOf(Math.max(...votes));
    if (votes[pick] > e.factionVotes[loudest.id][loudestPick]) {
      loudest = f;
      loudestPick = pick;
    }
  }
  return {
    ...s,
    elections: [...s.elections, e],
    news: withNews(
      s,
      [
        `Election #${e.id} is open until the end of day ${e.closesDay}: ${e.proposals.map((p) => p.title).join(' · ')}.`,
        `${loudest.name} throw their weight behind “${e.proposals[loudestPick].title}”.`,
      ],
      openedDay,
    ),
  };
}

/** Why votes can't be bought, or null if they can. */
export function voteError(s: UniverseState, electionId: number, proposal: number, count: number): string | null {
  const e = currentElection(s);
  if (!e || e.id !== electionId) return 'This election is closed.';
  if (!Number.isInteger(proposal) || proposal < 0 || proposal >= e.proposals.length) return 'No such proposal.';
  if (!Number.isInteger(count) || count < 1) return 'Buy at least 1 vote.';
  const cost = marginalCost(playerVoteTotal(e), count, s.persona?.kind === 'organizer');
  if (cost > s.coins) return `Not enough coins (needs ${cost}).`;
  return null;
}

/** The Organizer's Level 2: each faction whose opinion of you rose has a 50% chance (seeded) of rising one more. */
export function withOpinionGain(s: UniverseState, before: Record<string, number>, after: Record<string, number>, tag: string): Record<string, number> {
  const pct = perkValue(s.persona, 'opinionGainPct');
  if (!pct) return after;
  const out = { ...after };
  for (const id of Object.keys(after)) {
    if ((after[id] ?? 0) > (before[id] ?? 0) && createRng(s.settings.seed, 'organizer', tag, id).chance(pct * 10)) out[id] = Math.min(5, out[id] + 1);
  }
  return out;
}

function resolveElection(s: UniverseState, e: Election, day: number): UniverseState {
  const totals = tally(e);
  const winner = winnerOf(totals);
  const proposal = e.proposals[winner];
  let { league, notes } = applyEffect(s.league, proposal.effect);
  let weird = s.weird;
  const headlines = [`Election #${e.id}: “${proposal.title}” wins with ${totals[winner]} votes.`];
  if (proposal.effect.kind === 'resurrect') {
    const back = resurrect(league, weird, proposal.effect.playerId, s.settings.seed, RULES);
    league = back.league;
    weird = back.weird;
    const name = league.players[proposal.effect.playerId].name;
    notes = [...notes, { playerId: proposal.effect.playerId, text: `Returned from the Departed by election — changed: ${back.modName}.` }];
    headlines.push(`${name} has returned. They are not quite the same: ${back.modName}.`);
  }
  const playerLog = { ...s.playerLog };
  for (const n of notes) playerLog[n.playerId] = [...(playerLog[n.playerId] ?? []), { season: s.season, day, text: n.text }];

  if (playerVoteTotal(e) > 0) {
    const without = tally({ ...e, playerVotes: e.playerVotes.map(() => 0) });
    const fan = s.persona?.fanName || 'A mysterious fan';
    if (winnerOf(without) !== winner) headlines.push(`${fan}'s ${e.playerVotes[winner]} votes swung the election!`);
    else headlines.push(`${fan} cast ${playerVoteTotal(e)} votes.`);
  }

  const elections = s.elections.map((x) => (x.id === e.id ? { ...x, result: { winner, totals } } : x));
  let timeline = withTimeline(s, 'election', headlines[0], day);
  if (proposal.effect.kind === 'resurrect') timeline = [...timeline, { season: s.season, day, kind: 'return', text: headlines[1] }];
  const swung = playerVoteTotal(e) > 0 && winnerOf(tally({ ...e, playerVotes: e.playerVotes.map(() => 0) })) !== winner;
  const reaction = reactToElection(s.factions, e, winner, swung, fanContext(s), s.settings.seed);
  const opinion = withOpinionGain(s, s.factionOpinion ?? {}, reaction.opinion, `election-${e.id}`);
  let next: UniverseState = { ...s, league, weird, playerLog, elections, timeline, factionOpinion: opinion, news: withNews(s, headlines, day) };
  if (e.playerVotes[winner] > 0) next = gainXp(next, 'electionWon', { playerVoted: true });
  next = gainXp(next, 'factionOpinionUp', {}, Object.keys(opinion).filter((id) => (opinion[id] ?? 0) > (s.factionOpinion?.[id] ?? 0)).length);
  next = { ...next, news: withFactionNews(next, reaction.news, day) };
  if (proposal.effect.kind === 'resurrect') {
    next = { ...next, news: withFactionNews(next, reactToReturn(s.factions, league.players[proposal.effect.playerId].name, s.settings.seed, s.season, day), day) };
  }
  return next;
}

/** Career milestones crossed in one game (10th/25th/50th/100th home run, 100th/250th/500th/1000th hit). */
export function milestonesFor(before: StatLine | undefined, after: StatLine): string[] {
  const out: string[] = [];
  for (const n of [10, 25, 50, 100, 200]) if ((before?.hr ?? 0) < n && after.hr >= n) out.push(`Hit career home run #${n}.`);
  for (const n of [100, 250, 500, 1000]) if ((before?.h ?? 0) < n && after.h >= n) out.push(`Collected career hit #${n}.`);
  return out;
}

/** Story-worthy notes for a player's life timeline, from one game's box score. */
function notesFor(line: StatLine, career: StatLine | undefined): string[] {
  const notes: string[] = [];
  if (line.hr > 0 && !career?.hr) notes.push('Hit their first career home run.');
  if (line.hr >= 2) notes.push(`Hit ${line.hr} home runs in one game.`);
  if (line.h >= 4) notes.push(`Went ${line.h}-for-${line.ab}.`);
  if (line.pk >= 10) notes.push(`Struck out ${line.pk} batters.`);
  if (line.gs && line.w && line.ra === 0 && line.outs >= 27) notes.push('Threw a shutout.');
  return notes;
}

function settleBets(state: UniverseState, summary: GameSummary): UniverseState {
  if (!state.bets.some((b) => b.gameId === summary.gameId && b.status === 'open')) return state;
  const winnerId = summary.homeScore > summary.awayScore ? summary.homeId : summary.awayId;
  let next = state;
  const bets = state.bets.map((b): Bet => {
    if (b.gameId !== summary.gameId || b.status !== 'open') return b;
    if (b.teamId !== winnerId) {
      const refund = perk(state.persona, 'betRefundPct');
      if (refund && !b.free && b.teamId === state.persona?.favoriteTeamId) {
        const back = Math.floor((b.amount * Number(refund.value)) / 100);
        if (back > 0) next = { ...next, coins: next.coins + back, ledger: withLedger(next, back, `Refund on your ${teamName(state, b.teamId)}`, summary.day) };
      }
      return { ...b, status: 'lost', payout: 0 };
    }
    const full = winningPayout(state.persona, b.amount, b.multMilli, b.teamId, { home: b.teamId === summary.homeId, gameHadEnv: (summary.envChanged ?? 0) > 0 });
    const payout = b.free ? full - b.amount : full;
    next = { ...next, coins: next.coins + payout, ledger: withLedger(next, payout, `${b.free ? 'Free bet' : 'Bet'} won: ${teamName(state, b.teamId)}`, summary.day) };
    const pm = b.pm ?? 500;
    next = gainXp(next, 'betWon', { teamId: b.teamId, underdog: pm < 500, evenOrBetter: pm <= 500, gameHadEnv: (summary.envChanged ?? 0) > 0, home: b.teamId === summary.homeId });
    return { ...b, status: 'won', payout };
  });
  return { ...next, bets };
}

export function reduce(state: UniverseState, event: WorldEvent): UniverseState {
  switch (event.type) {
    case 'gameStarted':
      return state.started.includes(event.gameId) ? state : { ...state, started: [...state.started, event.gameId] };

    case 'gamePlayed': {
      const { summary, box } = event;
      if (state.results[summary.gameId]) return state;
      const seasonStats = { ...state.seasonStats };
      const careerStats = { ...state.careerStats };
      const playerLog = { ...state.playerLog };
      let milestones = 0;
      for (const [pid, line] of Object.entries(box)) {
        const was = careerStats[pid];
        for (const text of notesFor(line, was)) {
          playerLog[pid] = [...(playerLog[pid] ?? []), { season: state.season, day: summary.day, text }];
        }
        seasonStats[pid] = addLines(seasonStats[pid] ?? emptyLine(), line);
        careerStats[pid] = addLines(careerStats[pid] ?? emptyLine(), line);
        for (const text of milestonesFor(was, careerStats[pid])) {
          milestones++;
          playerLog[pid] = [...(playerLog[pid] ?? []), { season: state.season, day: summary.day, text }];
        }
      }
      let next = settleBets({ ...state, results: { ...state.results, [summary.gameId]: summary }, seasonStats, careerStats, playerLog }, summary);
      next = gainXp(next, 'milestone', {}, milestones);
      const env = summary.envChanged ?? 0;
      next = gainXp(next, 'envEffect', { watched: (state.watched ?? []).includes(summary.gameId) }, env);
      return afterGame(next, summary, box);
    }

    case 'dayEnded':
    {
      if (event.day !== state.currentDay) return state;
      if (state.phase === 'offseason') return newSeason(withBailout(state));
      const settled = withBailout(state);
      let next: UniverseState = {
        ...settled,
        currentDay: state.currentDay + 1,
        dayCount: state.dayCount + 1,
        coins: settled.coins + DAILY_STIPEND,
        ledger: withLedger(settled, DAILY_STIPEND, 'Daily fan stipend'),
        weird: expireMods(state.weird, state.season, state.currentDay + 1),
      };
      const open = currentElection(next);
      if (open && open.closesDay <= event.day) {
        next = resolveElection(next, open, event.day);
        next = withNewElection(next, event.day + 1);
      } else if (!open) {
        next = withNewElection(next, event.day + 1); // e.g. saves from before elections existed
      }
      if (state.phase === 'regular' && next.currentDay > seasonDays(next)) next = beginPlayoffs(next, event.day);
      else if (state.phase === 'playoffs') next = continuePlayoffs(next, event.day);
      return next;
    }

    case 'timeSettingsChanged': {
      const settings = { ...state.settings, timeMode: event.timeMode, dayLengthMinutes: event.dayLengthMinutes };
      // Switching modes or day length restarts the clock from now.
      const clock = event.timeMode === 'living' ? { anchorMs: event.nowMs, anchorDay: state.dayCount } : null;
      return { ...state, settings, clock };
    }

    case 'clockSet':
      return state.settings.timeMode === 'living' ? { ...state, clock: event.clock } : state;

    case 'firstPitchSet':
      return { ...state, settings: { ...state.settings, firstPitchPct: Math.max(0, Math.min(100, event.pct)) } };

    case 'backupNoted':
      return { ...state, lastBackupDay: Math.max(state.lastBackupDay, event.day) };

    case 'massBet': {
      let next = state;
      for (const g of massBetTargets(state, event.side)) {
        if (!betError(next, g.gameId, g.teamId, event.amount)) next = reduce(next, { type: 'betPlaced', gameId: g.gameId, teamId: g.teamId, amount: event.amount });
      }
      return next;
    }

    case 'collectionToggled': {
      if (!state.league.players[event.playerId]) return state;
      const has = state.collection.some((c) => c.playerId === event.playerId);
      const collection = has
        ? state.collection.filter((c) => c.playerId !== event.playerId)
        : [...state.collection, { playerId: event.playerId, season: state.season, day: state.currentDay }];
      let next: UniverseState = { ...state, collection };
      const paid = state.collectorPaid ?? [];
      if (!has && !paid.includes(event.playerId)) {
        next = gainXp({ ...next, collectorPaid: [...paid, event.playerId] }, 'cardCollected');
        const coins = perkValue(state.persona, 'coinsPerNewCard');
        if (coins) next = { ...next, coins: next.coins + coins, ledger: withLedger(next, coins, `New card: ${state.league.players[event.playerId].name}`) };
      }
      return next;
    }

    case 'favoriteTeamSet': {
      if (favoriteTeamError(state, event.teamId)) return state;
      return { ...state, persona: { ...state.persona!, favoriteTeamId: event.teamId } };
    }

    case 'pickSet': {
      const { playerId, kind } = event;
      if (pickError(state, playerId, kind)) return state;
      const back = state.picks.back.filter((id) => id !== playerId);
      const fade = state.picks.fade.filter((id) => id !== playerId);
      if (kind === 'back') back.push(playerId);
      if (kind === 'fade') fade.push(playerId);
      // Dropping or switching a pick resets its streak (and frees the Lock).
      const pickStreaks = { ...(state.pickStreaks ?? {}) };
      delete pickStreaks[playerId];
      const pickLock = state.pickLock?.playerId === playerId && kind === null ? null : state.pickLock;
      return { ...state, picks: { back, fade }, pickStreaks, pickLock };
    }

    case 'patronSponsored': {
      if (patronError(state, event.teamId)) return state;
      const t = state.league.teams.find((x) => x.id === event.teamId)!;
      const fan = state.persona?.fanName || 'A generous fan';
      const sponsored: UniverseState = {
        ...state,
        coins: state.coins - PATRON_COST,
        patron: { season: state.season, teamId: event.teamId },
        ledger: withLedger(state, -PATRON_COST, `Patron of the ${t.name}`),
        news: withNews(state, [`${fan} becomes Patron of the ${t.city} ${t.name}. The players feel blessed (+${PATRON_BLESSING} to everything this season).`]),
      };
      const reaction = reactToPatron(state.factions, t.id, `${t.city} ${t.name}`, fanContext(state), state.settings.seed, state.season);
      return { ...sponsored, factionOpinion: reaction.opinion, news: withFactionNews(sponsored, reaction.news) };
    }

    case 'weird': {
      const h = event.happening;
      const { league, weird } = applyHappening(state.league, state.weird, h, state.season, state.currentDay);
      const playerLog = { ...state.playerLog };
      const note = (id: string, text: string) => (playerLog[id] = [...(playerLog[id] ?? []), { season: state.season, day: state.currentDay, text }]);
      for (const c of h.changes) {
        if (c.kind === 'addPlayerMod') note(c.playerId, h.text);
        if (c.kind === 'ratings' && c.playerIds.length === 1) note(c.playerIds[0], h.text);
        if (c.kind === 'death') {
          note(c.playerId, `Departed: ${c.cause}`);
          note(c.replacement.id, `Called up to replace ${state.league.players[c.playerId].name}.`);
        }
      }
      const kind: TimelineKind = h.eventId === 'death' ? 'death' : 'weird';
      const ages = { ...state.ages };
      const experience = { ...state.experience };
      let born = weird;
      for (const c of h.changes) if (c.kind === 'death') {
        ages[c.replacement.id] = rookieAge(c.replacement.id);
        experience[c.replacement.id] = 0;
        born = { ...born, playerMods: { ...born.playerMods, ...bornWith(state.settings.seed, [c.replacement.id]) } };
      }
      let next: UniverseState = { ...state, league, weird: born, ages, experience, playerLog, news: withNews(state, [h.text]), timeline: withTimeline(state, kind, h.text) };
      next = gainXp(next, 'weirdEvent');
      for (const c of h.changes) {
        if (c.kind !== 'death') continue;
        const t = state.league.teams.find((x) => x.id === c.teamId)!;
        next = { ...next, news: withFactionNews(next, reactToDeath(state.factions, state.league.players[c.playerId].name, t.id, `${t.city} ${t.name}`, state.settings.seed, state.season, state.currentDay)) };
      }
      return next;
    }

    case 'votesBought': {
      const { electionId, proposal, count } = event;
      if (voteError(state, electionId, proposal, count)) return state;
      const e = currentElection(state)!;
      const cost = marginalCost(playerVoteTotal(e), count, state.persona?.kind === 'organizer');
      const updated: Election = {
        ...e,
        playerVotes: e.playerVotes.map((v, i) => (i === proposal ? v + count : v)),
        coinsSpent: e.coinsSpent + cost,
      };
      return gainXp({
        ...state,
        coins: state.coins - cost,
        elections: state.elections.map((x) => (x.id === e.id ? updated : x)),
        ledger: withLedger(state, -cost, `${count} vote${count === 1 ? '' : 's'}: ${e.proposals[proposal].title}`),
      }, 'voteBought');
    }

    case 'personaChosen':
      if (state.persona) return state; // chosen once per universe
      return { ...state, persona: { ...event.persona, xp: event.persona.xp ?? 0 } };

    case 'watchedLive': {
      // Only counts from the first pitch: logged before the game is simulated, so replays stay exact.
      const g = state.schedule.find((x) => x.id === event.gameId);
      if (!g || g.day !== state.currentDay || state.results[g.id] || state.started.includes(g.id) || (state.watched ?? []).includes(g.id)) return state;
      return gainXp({ ...state, watched: [...(state.watched ?? []), g.id] }, 'watchedLive');
    }

    case 'cardViewed':
      return state.league.players[event.playerId] ? gainXp(state, 'cardViewed') : state;

    case 'departedVisited':
      return state.weird.playerStatus[event.playerId] === 'departed' ? gainXp(state, 'departedVisited') : state;

    case 'pickLocked': {
      if (!lockUnlocked(state.picksLifetime ?? 0) || !pickOf(state.picks, event.playerId)) return state;
      if (state.pickLock?.season === state.season) return state; // one Lock per season
      return { ...state, pickLock: { season: state.season, playerId: event.playerId, used: false } };
    }

    case 'rebranded': {
      if (!state.persona || state.persona.kind === event.kind || state.coins < REBRAND_COST || !PERSONAS[event.kind]) return state;
      const text = `${state.persona.fanName || 'A fan'} rebrands from ${PERSONAS[state.persona.kind].label} to ${PERSONAS[event.kind].label}.`;
      return {
        ...state,
        coins: state.coins - REBRAND_COST,
        persona: { ...state.persona, kind: event.kind, xp: 0 },
        ledger: withLedger(state, -REBRAND_COST, 'Rebrand'),
        news: withNews(state, [text]),
        timeline: withTimeline(state, 'persona', text),
      };
    }

    case 'perkUsed': {
      const { ability, target, proposal, climate } = event;
      if (abilityError(state, ability, target, proposal, climate)) return state;
      const eff = perk(state.persona, { rallyCry: 'teamBoostOnce', doubleDown: 'doubleDown', forecast: 'envForecast', backroomDeal: 'factionPledge', jinx: 'jinx', seedClouds: 'addClimate', wave: 'triggerEnv' }[ability])!;
      const used: UniverseState = { ...state, perkUses: { ...state.perkUses, [ability]: periodKey(state, (eff.per as 'season' | 'week') ?? 'season') } };
      switch (ability) {
        case 'rallyCry': {
          const g = nextFavoriteGame(state, false)!;
          return { ...used, rallyCry: { gameId: g.id, teamId: state.persona!.favoriteTeamId! }, news: withNews(used, [`Rally Cry! The ${teamName(state, state.persona!.favoriteTeamId!)} will play their next game with +${eff.value} to everything.`]) };
        }
        case 'wave': {
          const g = nextFavoriteGame(state, true)!;
          return { ...used, waveGameId: g.id, news: withNews(used, [`The Wave is coming: a Crowd Surge will break out at the ${teamName(state, g.homeId)}' next home game.`]) };
        }
        case 'doubleDown': {
          const bet = state.bets.find((b) => b.id === target)!;
          const extra = bet.payout - (bet.free ? 0 : bet.amount);
          return {
            ...used,
            coins: used.coins + extra,
            bets: used.bets.map((b) => (b.id === bet.id ? { ...b, doubled: true, payout: b.payout + extra } : b)),
            ledger: withLedger(used, extra, `Double Down: ${teamName(state, bet.teamId)}`),
          };
        }
        case 'forecast':
          return { ...used, forecastReveal: { season: state.season, day: state.currentDay, text: todaysForecast(state) } };
        case 'backroomDeal': {
          const e = currentElection(state)!;
          const votes = [...e.factionVotes[target!]];
          let moved = 0;
          const want = Number(eff.votes ?? 5);
          while (moved < want) {
            // Take from the faction's biggest other pile first.
            let from = -1;
            votes.forEach((v, i) => i !== proposal && v > 0 && (from < 0 || v > votes[from]) && (from = i));
            if (from < 0) break;
            votes[from]--;
            votes[proposal!]++;
            moved++;
          }
          const f = state.factions.find((x) => x.id === target);
          const updated = { ...e, factionVotes: { ...e.factionVotes, [target!]: votes } };
          return { ...used, elections: used.elections.map((x) => (x.id === e.id ? updated : x)), news: withNews(used, [`A backroom deal: ${f?.name ?? 'a faction'} quietly moves ${moved} votes to “${e.proposals[proposal!].title}”.`]) };
        }
        case 'jinx':
          return { ...used, jinx: { season: state.season, playerId: target!, untilDay: state.currentDay + Number(eff.days ?? 7) - 1 }, news: withNews(used, [`You put a jinx on ${state.league.players[target!].name}. Fade payouts doubled for a week.`]) };
        case 'seedClouds':
          return {
            ...used,
            tempClimates: { ...(state.tempClimates ?? {}), [target!]: { climate: climate!, season: state.season, untilDay: state.currentDay + Number(eff.days ?? 7) - 1 } },
            news: withNews(used, [`Clouds seeded over ${state.weird.stadiums[target!]?.name}: it's ${climate} there for a week.`]),
          };
      }
      return state;
    }

    case 'betPlaced': {
      const { gameId, teamId, amount } = event;
      if (event.free) {
        if (freeBetError(state, gameId, teamId, amount)) return state;
        const game = state.schedule.find((g) => g.id === gameId)!;
        const odds = currentOdds(state, gameId);
        const pm = teamId === game.homeId ? odds.homePm : odds.awayPm;
        const bet: Bet = { id: `${state.season}-${gameId}-${teamId}-free`, gameId, day: state.currentDay, teamId, amount, multMilli: offeredMultiplier(state, gameId, teamId), pm, free: true, status: 'open', payout: 0, season: state.season };
        return gainXp({ ...state, bets: [...state.bets, bet], perkUses: { ...state.perkUses, freeBet: periodKey(state, 'week') } }, 'betPlaced');
      }
      if (betError(state, gameId, teamId, amount)) return state;
      const multMilli = offeredMultiplier(state, gameId, teamId);
      const game = state.schedule.find((g) => g.id === gameId)!;
      const odds = currentOdds(state, gameId);
      const pm = teamId === game.homeId ? odds.homePm : odds.awayPm;
      const existing = betsThisSeason(state).find((b) => b.gameId === gameId && b.teamId === teamId && b.status === 'open');
      const bets: Bet[] = existing
        ? state.bets.map((b) =>
            b === existing
              ? { ...b, amount: b.amount + amount, multMilli: Math.floor((b.amount * b.multMilli + amount * multMilli) / (b.amount + amount)) }
              : b,
          )
        : [...state.bets, { id: `${state.season}-${gameId}-${teamId}`, gameId, day: state.currentDay, teamId, amount, multMilli, pm, status: 'open', payout: 0, season: state.season }];
      return gainXp({ ...state, coins: state.coins - amount, bets, ledger: withLedger(state, -amount, `Bet on ${teamName(state, teamId)}`) }, 'betPlaced');
    }
  }
}

export const reduceAll = (state: UniverseState, events: WorldEvent[]) => events.reduce(reduce, state);

// ---------------------------------------------------------------------------
// Commands: pure functions that run the simulation and return the events to apply.

export type Command =
  | { type: 'playGame'; gameId: string }
  | { type: 'nextGame' }
  | { type: 'endDay' }
  | { type: 'simDays'; count: number }
  | { type: 'simToSeasonEnd' };

export interface PlayByPlay {
  gameId: string;
  day: number;
  season: number;
  /** Engine that simmed it; rows saved before Sprint 12 have none (engine v2 or older). */
  engineVersion: number;
  events: GameEvent[];
}

export interface CommandResult {
  state: UniverseState;
  events: WorldEvent[];
  /** Play-by-play for games simulated by this command (only the most recent days are kept). */
  pbp: PlayByPlay[];
}

/** How many days of play-by-play are kept (older games keep only their box score). */
export const PBP_DAYS_KEPT = 7;

export function runCommand(start: UniverseState, cmd: Command): CommandResult {
  let state = start;
  const events: WorldEvent[] = [];
  const pbp: PlayByPlay[] = [];

  const apply = (e: WorldEvent) => {
    state = reduce(state, e);
    events.push(e);
  };

  const play = (game: ScheduledGame) => {
    if (state.results[game.id]) return;
    const result = simulate(state, game);
    apply({
      type: 'gamePlayed',
      summary: {
        gameId: game.id,
        day: game.day,
        awayId: result.awayId,
        homeId: result.homeId,
        awayScore: result.awayScore,
        homeScore: result.homeScore,
        innings: result.innings,
        envChanged: result.events.filter((e) => e.cause?.type === 'env' && e.kind !== 'envEffect').length + result.events.filter((e) => e.kind === 'envEffect' && e.cause).length,
      },
      box: boxScore(result),
    });
    pbp.push({ gameId: game.id, day: game.day, season: state.season, engineVersion: state.engineVersion, events: result.events });
  };

  const endDay = () => {
    if (state.phase !== 'offseason') {
      unplayedToday(state).forEach(play);
      for (const happening of rollDay(rollInput(state), RULES)) apply({ type: 'weird', happening });
    }
    apply({ type: 'dayEnded', day: state.currentDay });
  };

  switch (cmd.type) {
    case 'playGame': {
      const game = state.schedule.find((g) => g.id === cmd.gameId);
      if (!game || game.day !== state.currentDay) throw new Error(`Game ${cmd.gameId} is not playable today`);
      play(game);
      break;
    }
    case 'nextGame': {
      const next = unplayedToday(state)[0];
      if (next) play(next);
      else endDay();
      break;
    }
    case 'endDay':
      endDay();
      break;
    case 'simDays':
      for (let i = 0; i < cmd.count; i++) endDay();
      break;
    case 'simToSeasonEnd':
      // Through the regular season and the playoffs, stopping at the offseason.
      for (let guard = 0; state.phase !== 'offseason' && guard < 1000; guard++) endDay();
      break;
  }

  const minDay = state.currentDay - PBP_DAYS_KEPT;
  return { state, events, pbp: pbp.filter((p) => p.day >= minDay) };
}

/** Every match goes through the universe's sport engine (Democracy FC S1). */
function simulate(state: UniverseState, game: ScheduledGame): GameResult {
  return getSport(state.sport).simulate(gameLeague(state, game), game, {
    seasonId: state.season,
    engineVersion: state.engineVersion,
    env: stadiumEnvironment(state, game),
  });
}

/** Recreate a game's play-by-play from its seed (works for any game, since the sim is deterministic). */
export function replayGame(state: UniverseState, gameId: string): GameEvent[] {
  const game = state.schedule.find((g) => g.id === gameId)!;
  return simulate(state, game).events;
}

const rollInput = (s: UniverseState) => ({
  league: s.league,
  weird: s.weird,
  seed: s.settings.seed,
  season: s.season,
  day: s.currentDay,
  seasonDays: seasonDays(s),
  chaos: s.settings.chaos,
});

/** The Prophet persona's hint: what is gathering tonight (an exact preview of today's roll). */
export function prophecy(s: UniverseState): string | null {
  if (s.persona?.kind !== 'prophet' || isSeasonOver(s)) return null;
  const happenings = rollDay(rollInput(s), RULES);
  const weather = s.engineVersion >= 4 ? forecastLine(s) : '';
  if (!happenings.length) return `The air is still. Nothing strange is gathering tonight.${weather}`;
  return (
    happenings
    .map((h) => {
      const t = s.league.teams.find((x) => x.id === h.teamId)!;
      const detail = perk(s.persona, 'weirdHints')?.detail === 'target';
      const who = detail ? h.changes.map((c) => ('playerId' in c ? s.league.players[c.playerId as string]?.name : null)).find(Boolean) : null;
      if (h.eventId === 'death') return `A cold wind blows through the ${t.city} ${t.name} dugout. ${who ? `${who} may not see tomorrow.` : 'Someone may not see tomorrow.'}`;
      return detail
        ? `Something strange is gathering around ${who ?? `${s.weird.stadiums[t.id]?.name ?? 'the stadium'}`} (${t.city} ${t.name}) tonight.`
        : `Something strange is gathering around the ${t.city} ${t.name} tonight.`;
    })
    .join(' ') + weather
  );
}

/** The Prophet's weather sense: what could stir at today's stadiums (possibilities, not the roll). */
function forecastLine(s: UniverseState): string {
  const parts = unplayedToday(s).flatMap((g) => {
    const env = stadiumEnvironment(s, g);
    if (!env.events.length) return [];
    const names = env.events.slice(0, 3).map((e) => e.name.toLowerCase());
    return [`${s.weird.stadiums[g.homeId]?.name ?? 'a stadium'}: ${names.join(', ')}`];
  });
  return parts.length ? ` The skies whisper of ${parts.join('; ')}.` : '';
}

// ---------------------------------------------------------------------------
// Playoffs and new seasons.

const teamLabel = (s: UniverseState, id: string) => {
  const t = s.league.teams.find((x) => x.id === id)!;
  return `${t.city} ${t.name}`;
};

function beginPlayoffs(s: UniverseState, lastRegularDay: number): UniverseState {
  const table = standingsOf(s);
  const top = table[0];
  const { playoffs, games } = startPlayoffs(table.map((r) => r.teamId), s.currentDay);
  const seeds = playoffs.series.flatMap((x) => [x.highSeed, x.lowSeed]).map((id) => s.league.teams.find((t) => t.id === id)!.name);
  return {
    ...s,
    phase: 'playoffs',
    playoffs,
    schedule: [...s.schedule, ...games],
    news: withNews(s, [`The regular season is over. The ${teamLabel(s, top.teamId)} finish first at ${top.wins}–${top.losses}.`, `Playoffs begin: ${seeds.join(', ')}.`], lastRegularDay),
  };
}

function continuePlayoffs(s: UniverseState, dayEnded: number): UniverseState {
  const winner = (gameId: string) => {
    const r = s.results[gameId];
    return r ? (r.homeScore > r.awayScore ? r.homeId : r.awayId) : null;
  };
  const before = s.playoffs!;
  const { playoffs, games } = advancePlayoffs(before, winner, s.currentDay);
  let next: UniverseState = { ...s, playoffs, schedule: [...s.schedule, ...games] };
  const news: string[] = [];
  for (const series of playoffs.series) {
    const was = before.series.find((x) => x.id === series.id);
    if (series.winner && !was?.winner) {
      const loser = series.winner === series.highSeed ? series.lowSeed : series.highSeed;
      news.push(`The ${teamLabel(s, series.winner)} beat the ${teamLabel(s, loser)} ${series.wins[series.winner]}–${series.wins[loser]}.`);
    }
  }
  if (playoffs.championId) {
    const { mvpId, aceId } = seasonAwards(next.seasonStats, next.league);
    const champ = teamLabel(next, playoffs.championId);
    const playerLog = { ...next.playerLog };
    const note = (id: string | null, text: string) => id && (playerLog[id] = [...(playerLog[id] ?? []), { season: next.season, day: dayEnded, text }]);
    note(mvpId, `Named Season ${next.season} MVP.`);
    note(aceId, `Named Season ${next.season} Ace (best pitcher).`);
    const awards = [mvpId && `MVP: ${next.league.players[mvpId].name}`, aceId && `Ace: ${next.league.players[aceId].name}`].filter(Boolean).join(' · ');
    news.push(`The ${champ} win the Blastball Cup!`, awards);
    next = {
      ...next,
      phase: 'offseason',
      playerLog,
      archive: [...next.archive, { season: next.season, standings: standingsOf(next).map((r) => ({ teamId: r.teamId, wins: r.wins, losses: r.losses })), championId: playoffs.championId, mvpId, aceId, teamNames: Object.fromEntries(next.league.teams.map((t) => [t.id, t.name])) }],
      timeline: withTimeline(next, 'champion', `The ${champ} win the Season ${next.season} Blastball Cup. ${awards}.`, dayEnded),
    };
    next = { ...next, news: withFactionNews(next, reactToChampion(next.factions, playoffs.championId, champ, next.settings.seed, next.season), dayEnded) };
  }
  return news.length ? { ...next, news: withNews(next, news.filter(Boolean), dayEnded) } : next;
}

function withoutTeam(h: HeadToHead, teamId: string): HeadToHead {
  return Object.fromEntries(Object.entries(h).filter(([id]) => id !== teamId).map(([id, vs]) => [id, Object.fromEntries(Object.entries(vs).filter(([o]) => o !== teamId))]));
}

/** The offseason ends: everyone ages, veterans retire, rookies arrive and Season N+1 begins. */
function newSeason(s: UniverseState): UniverseState {
  const season = s.season + 1;
  const off = runOffseason(s.league, s.ages, s.settings.seed, season, s.experience, agingTraits(s.weird, RULES, s.season, s.currentDay));

  // Relegation: last place in the regular season is dissolved and replaced by a brand-new team.
  const last = standingsOf(s).at(-1);
  const rel = last && s.league.teams.length > 1 ? relegate(off.league, last.teamId, s.settings.seed, season) : null;
  if (rel) {
    off.league = rel.league;
    for (const id of rel.added) {
      off.ages[id] = initialAge(id);
      off.experience[id] = initialExperience(id, off.ages[id]);
    }
  }
  const playerLog = { ...s.playerLog };
  for (const n of off.notes) playerLog[n.playerId] = [...(playerLog[n.playerId] ?? []), { season, day: 1, text: n.text }];
  const playerStatus = { ...s.weird.playerStatus };
  for (const r of off.retired) playerStatus[r.playerId] = 'retired';
  // Relegated players leave the league (their stats stay in the record books).
  for (const id of rel?.removed ?? []) playerStatus[id] = 'retired';

  // A fresh schedule: same league, new order of opponents each season.
  const order = [...off.league.teams];
  const rng = createRng(s.settings.seed, season, 'schedule');
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const notable = off.retired.filter((r) => (s.playerLog[r.playerId]?.length ?? 0) >= 3);
  const relegationText = rel
    ? `The ${rel.oldTeam.city} ${rel.oldTeam.name} finished last and have been relegated out of existence. The ${rel.newTeam.city} ${rel.newTeam.name} take their place with a brand-new roster.`
    : null;
  const retireNews = off.retired.length ? [`${off.retired.length} player${off.retired.length === 1 ? '' : 's'} retired this offseason; rookies take their places.`] : [];

  let next: UniverseState = {
    ...s,
    // A new season is the only time the engine changes, so bets and picks never straddle two engines.
    engineVersion: getSport(s.sport).engineVersion,
    watched: [],
    rallyCry: null,
    waveGameId: null,
    jinx: null,
    tempClimates: {},
    forecastReveal: null,
    season,
    phase: 'regular',
    currentDay: 1,
    dayCount: s.dayCount + 1,
    league: off.league,
    ages: off.ages,
    experience: off.experience,
    schedule: generateSchedule(order, s.settings.seasonLength),
    results: {},
    started: [],
    playoffs: null,
    patron: null,
    pickEarnings: 0,
    picks: {
      back: s.picks.back.filter((id) => !['departed', 'retired'].includes(playerStatus[id] ?? '')),
      fade: s.picks.fade.filter((id) => !['departed', 'retired'].includes(playerStatus[id] ?? '')),
    },
    seasonStats: {},
    statsBySeason: { ...s.statsBySeason, [s.season]: s.seasonStats },
    playerLog,
    coins: s.coins + DAILY_STIPEND,
    weird: {
      ...expireMods(s.weird, season, 1),
      playerStatus,
      playerMods: { ...expireMods(s.weird, season, 1).playerMods, ...bornWith(s.settings.seed, [...off.retired.map((r) => r.rookieId), ...(rel?.added ?? [])]) },
      stadiums: rel ? { ...s.weird.stadiums, [rel.newTeam.id]: { ...createStadiums(`${s.settings.seed}:${season}`, { ...off.league, teams: [rel.newTeam] })[rel.newTeam.id], rebuilt: season } } : s.weird.stadiums,
    },
    // A new franchise starts with a clean head-to-head record.
    h2h: rel ? withoutTeam(s.h2h ?? {}, rel.newTeam.id) : s.h2h,
    news: withNews({ ...s, season }, [`Season ${season} begins!`, ...(relegationText ? [relegationText] : []), ...retireNews], 1),
    timeline: [
      ...s.timeline,
      ...(relegationText ? [{ season, day: 1, kind: 'relegation' as const, text: relegationText }] : []),
      ...notable.map((r) => ({ season, day: 1, kind: 'retirement' as const, text: `${s.league.players[r.playerId].name} retired at ${r.age}.` })),
    ],
  };
  next = withNewElection(next, 1);
  return next;
}
