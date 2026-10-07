import { createRng } from '../../engine/core/rng';
import { computeStandings, generateSchedule, matchWinner, type StandingRow } from '../../engine/season';
import { emptySoccerLine, soccerBoxScore, type SoccerStatLine } from '../../engine/soccer/boxScore';
import { simulateSoccer, SOCCER_ENGINE_VERSION, type SoccerSimOptions } from '../../engine/soccer/game';
import type { SoccerEvent, SoccerFixture, SoccerLeague, SoccerPlayer, SoccerResult, SoccerTeam } from '../../engine/soccer/types';
import { createFactions, type Faction } from '../factions';
import { abbrOf, generateSoccerLeague, makeSoccerPlayer, SQUAD_POSITIONS, STYLES } from './generate';
import { soccerOdds, type SoccerRecord } from './odds';
import { applyRelationPairs, awaken, AWAKENINGS_PER_SEASON, relationPairs, type RelationPairs } from './personality';
import { facilityEventsFor, modDeltas, rollSoccerDay, type ActiveMod, type Chaos, type SoccerHappening } from './weird';
import names from '../../../content/soccer/names.json';
import { ARENAS } from '../../engine/soccer/arenas';

/**
 * Democracy FC world (PRD Part B): The Assembly's league, run as an event-sourced state like the
 * Blastball universe. Every change is a WorldEvent applied by `reduceSoccer`, so a save can be
 * rebuilt from its events and every match replays from its seed.
 */

export const SOCCER_SAVE_VERSION = 1;
export const SOCCER_LEAGUE_SIZES = [8, 12, 16] as const;
export const STARTING_COINS = 100;
export const DAILY_STIPEND = 10;
export const FAVORITE_WIN_BONUS = 15;
export const DRAW_PICK = 'draw';
export const PBP_DAYS_KEPT = 7;
/** Clubs Ejected at the end of each season (elections may change this, S6). */
export const DEFAULT_EJECTIONS = 1;

export interface SoccerSettings {
  name: string;
  seed: string;
  leagueSize: (typeof SOCCER_LEAGUE_SIZES)[number];
  chaos: Chaos;
  timeMode: 'manual' | 'living';
  dayLengthMinutes: number;
}

export interface SoccerMatchSummary {
  gameId: string;
  day: number;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  shootout?: { home: number; away: number; winnerId: string };
  knockout?: boolean;
  /** Director facility events at this match. */
  facility?: string[];
  arenaId: string;
}

export interface SoccerBet {
  id: string;
  gameId: string;
  day: number;
  /** A club id, or DRAW_PICK. */
  teamId: string;
  amount: number;
  multMilli: number;
  pm: number;
  status: 'open' | 'won' | 'lost';
  payout: number;
  season: number;
}

export interface VanishedPlayer {
  player: SoccerPlayer;
  season: number;
  day: number;
  cause: string;
}

export interface NewsLine {
  season: number;
  day: number;
  text: string;
  /** The Director speaks in monospace (§B11). */
  director?: boolean;
}

export type SoccerTimelineKind = 'vanish' | 'return' | 'awakening' | 'champion' | 'ejection' | 'clubSwitch' | 'election';

export interface SoccerSeasonRecord {
  season: number;
  standings: StandingRow[];
  championId: string | null;
  ejected: { id: string; name: string }[];
}

export interface SoccerPlayoffs {
  semis: string[];
  final: string | null;
  championId: string | null;
}

export interface SoccerUniverse {
  saveVersion: number;
  sport: 'soccer';
  engineVersion: number;
  id: string;
  createdAt: number;
  settings: SoccerSettings;
  league: SoccerLeague;
  season: number;
  phase: 'regular' | 'playoffs' | 'offseason';
  schedule: SoccerFixture[];
  results: Record<string, SoccerMatchSummary>;
  started: string[];
  currentDay: number;
  dayCount: number;
  seasonStats: Record<string, SoccerStatLine>;
  careerStats: Record<string, SoccerStatLine>;
  statsBySeason: Record<number, Record<string, SoccerStatLine>>;
  coins: number;
  bets: SoccerBet[];
  ledger: { season: number; day: number; amount: number; reason: string }[];
  news: NewsLine[];
  timeline: { season: number; day: number; kind: SoccerTimelineKind; text: string }[];
  /** The club the fan supports (§B2). */
  favoriteClubId: string;
  lastClubSwitchSeason: number | null;
  clubHistory: { clubId: string; fromSeason: number }[];
  mods: Record<string, ActiveMod[]>;
  /** Matches each injured player still misses. */
  injuries: Record<string, number>;
  /** The Sub-Level Archive. */
  vanished: VanishedPlayer[];
  awakenings: { playerId: string; season: number; day: number }[];
  playoffs: SoccerPlayoffs | null;
  archive: SoccerSeasonRecord[];
  factions: Faction[];
  /** Clubs Ejected each season. */
  ejections: number;
  /** Next new-club number (ids stay unique after Ejections). */
  nextClub: number;
}

export type SoccerWorldEvent =
  | { type: 'matchStarted'; gameId: string }
  | { type: 'matchPlayed'; summary: SoccerMatchSummary; box: Record<string, SoccerStatLine>; injuries: Record<string, number>; awakenings: string[]; relations: RelationPairs }
  | { type: 'happening'; happening: SoccerHappening }
  | { type: 'betPlaced'; gameId: string; teamId: string; amount: number }
  | { type: 'clubSwitched'; clubId: string }
  | { type: 'dayEnded'; day: number };

export type SoccerCommand =
  | { type: 'playGame'; gameId: string }
  | { type: 'nextGame' }
  | { type: 'endDay' }
  | { type: 'simDays'; count: number }
  | { type: 'simToSeasonEnd' };

export interface SoccerPlayByPlay {
  gameId: string;
  day: number;
  season: number;
  events: SoccerEvent[];
}

export interface SoccerCommandResult {
  state: SoccerUniverse;
  events: SoccerWorldEvent[];
  pbp: SoccerPlayByPlay[];
}

/** Factions rethemed for the facility (§B7): ideological swing voters. */
const FACTION_NAMES: Record<string, { name: string; ideology: string }> = {
  statheads: { name: 'The Analysts', ideology: 'Numbers first. Wants a fair, measurable game.' },
  loyalists: { name: 'The Loyal End', ideology: 'Ride or die for their clubs.' },
  chaos: { name: 'The Chaos Choir', ideology: 'Burn the rulebook. Sing while it burns.' },
  purists: { name: 'The Purists', ideology: 'The game was perfect. Leave it alone.' },
  lore: { name: 'The Lore Hunters', ideology: 'Every rule change is a new chapter.' },
  casuals: { name: 'The Casuals', ideology: 'More goals, please.' },
};

export const roundsFor = (clubs: number) => (clubs - 1) * 2;
export const regularDays = (s: SoccerUniverse) => roundsFor(s.league.teams.length);

export function createSoccerUniverse(id: string, settings: SoccerSettings, favoriteClubId: string | null, now: number): SoccerUniverse {
  const league = generateSoccerLeague({ seed: settings.seed, name: settings.name, teamCount: settings.leagueSize });
  const fav = favoriteClubId && league.teams.some((t) => t.id === favoriteClubId) ? favoriteClubId : league.teams[0].id;
  return {
    saveVersion: SOCCER_SAVE_VERSION,
    sport: 'soccer',
    engineVersion: SOCCER_ENGINE_VERSION,
    id,
    createdAt: now,
    settings,
    league,
    season: 1,
    phase: 'regular',
    schedule: generateSchedule(league.teams, roundsFor(league.teams.length)),
    results: {},
    started: [],
    currentDay: 1,
    dayCount: 1,
    seasonStats: {},
    careerStats: {},
    statsBySeason: {},
    coins: STARTING_COINS,
    bets: [],
    ledger: [],
    news: [{ season: 1, day: 1, text: 'Director: Welcome to The Assembly. The doors are sealed. The season begins.', director: true }],
    timeline: [],
    favoriteClubId: fav,
    lastClubSwitchSeason: null,
    clubHistory: [{ clubId: fav, fromSeason: 1 }],
    mods: {},
    injuries: {},
    vanished: [],
    awakenings: [],
    playoffs: null,
    archive: [],
    factions: createFactions(settings.seed, league.teams.map((t) => t.id)).map((f) => ({ ...f, ...FACTION_NAMES[f.id] })),
    ejections: DEFAULT_EJECTIONS,
    nextClub: league.teams.length + 1,
  };
}

// ---------------------------------------------------------------------------
// Queries

export const clubOf = (s: SoccerUniverse, id: string): SoccerTeam | undefined => s.league.teams.find((t) => t.id === id);
export const clubName = (s: SoccerUniverse, id: string) => (id === DRAW_PICK ? 'Draw' : (() => {
  const t = clubOf(s, id);
  return t ? `${t.city} ${t.name}` : id;
})());
export const isKnockout = (s: SoccerUniverse, gameId: string) => !!s.playoffs && (s.playoffs.semis.includes(gameId) || s.playoffs.final === gameId);
export const regularResults = (s: SoccerUniverse) => Object.values(s.results).filter((r) => !r.knockout);
export const soccerStandings = (s: SoccerUniverse) => computeStandings(s.league.teams, regularResults(s));
export const fixturesOn = (s: SoccerUniverse, day: number) => s.schedule.filter((g) => g.day === day);
export const unplayedToday = (s: SoccerUniverse) => fixturesOn(s, s.currentDay).filter((g) => !s.results[g.id]);

export function clubRecords(s: SoccerUniverse): Record<string, SoccerRecord> {
  return Object.fromEntries(soccerStandings(s).map((r) => [r.teamId, { wins: r.wins, draws: r.draws, losses: r.losses }]));
}

/** Players who can't play today: injured or sealed out. Vanished players are already off the squads. */
export function unavailable(s: SoccerUniverse): Set<string> {
  return new Set(Object.entries(s.injuries).filter(([, n]) => n > 0).map(([id]) => id));
}

export function matchOdds(s: SoccerUniverse, gameId: string) {
  const game = s.schedule.find((g) => g.id === gameId)!;
  return soccerOdds(s.league, game, clubRecords(s), unavailable(s));
}

/** Everything the engine needs for one match, derived only from the state (so replays match). */
export function matchInputs(s: SoccerUniverse, game: SoccerFixture): { opts: SoccerSimOptions; facility: string[] } {
  const facility = facilityEventsFor(s.settings.seed, s.season, game, s.settings.chaos, s.league);
  const out = unavailable(s);
  for (const id of facility.sealed) out.add(id);
  return {
    opts: {
      unavailable: out,
      knockout: isKnockout(s, game.id),
      allowAwakening: s.awakenings.filter((a) => a.season === s.season).length < AWAKENINGS_PER_SEASON,
      teamDeltas: facility.teamDeltas,
      playerDeltas: modDeltas(s.mods, s.season, s.currentDay),
      facilityEvents: facility.events,
    },
    facility: facility.events.map((e) => e.eventId),
  };
}

export function simulateMatch(s: SoccerUniverse, gameId: string): SoccerResult {
  const game = s.schedule.find((g) => g.id === gameId)!;
  return simulateSoccer(s.league, game, s.season, matchInputs(s, game).opts);
}

/** Recreate a match's play-by-play (valid for today's matches; earlier ones live in the pbp store). */
export const replaySoccerMatch = (s: SoccerUniverse, gameId: string) => simulateMatch(s, gameId).events;

export function betError(s: SoccerUniverse, gameId: string, teamId: string, amount: number): string | null {
  const game = s.schedule.find((g) => g.id === gameId);
  if (!game) return 'No such match.';
  if (game.day !== s.currentDay) return "You can only make predictions on today's matches.";
  if (s.results[gameId] || s.started.includes(gameId)) return 'Predictions are closed: this match has kicked off.';
  if (teamId !== DRAW_PICK && teamId !== game.homeId && teamId !== game.awayId) return "That club isn't in this match.";
  if (isKnockout(s, gameId) && teamId === DRAW_PICK) return 'Knockout matches always have a winner.';
  if (!Number.isInteger(amount) || amount < 1) return 'Stake at least 1 coin.';
  if (amount > s.coins) return 'Not enough coins.';
  if (s.bets.some((b) => b.season === s.season && b.gameId === gameId && b.teamId !== teamId)) return 'You already made a different prediction for this match.';
  return null;
}

/** §B2: switch supported club at most once per season; it costs every coin. */
export function clubSwitchError(s: SoccerUniverse, clubId: string): string | null {
  if (!clubOf(s, clubId)) return 'No such club.';
  if (clubId === s.favoriteClubId) return 'You already support this club.';
  if (s.lastClubSwitchSeason === s.season) return "You've already switched clubs this season.";
  return null;
}

// ---------------------------------------------------------------------------
// Reducer

const withLedger = (s: SoccerUniverse, amount: number, reason: string) => [...s.ledger, { season: s.season, day: s.currentDay, amount, reason }].slice(-200);
const withNews = (s: SoccerUniverse, lines: (string | { text: string; director?: boolean })[], day = s.currentDay): NewsLine[] =>
  [...s.news, ...lines.map((l) => (typeof l === 'string' ? { season: s.season, day, text: l } : { season: s.season, day, ...l }))].slice(-150);
const withTimeline = (s: SoccerUniverse, kind: SoccerTimelineKind, text: string) => [...s.timeline, { season: s.season, day: s.currentDay, kind, text }];

function addLines(a: SoccerStatLine | undefined, b: SoccerStatLine): SoccerStatLine {
  const out = { ...(a ?? emptySoccerLine()) };
  for (const k of Object.keys(b) as (keyof SoccerStatLine)[]) out[k] += b[k];
  return out;
}

function settleBets(s: SoccerUniverse, summary: SoccerMatchSummary): SoccerUniverse {
  if (!s.bets.some((b) => b.gameId === summary.gameId && b.status === 'open')) return s;
  const winner = summary.shootout?.winnerId ?? matchWinner(summary) ?? DRAW_PICK;
  let next = s;
  const bets = s.bets.map((b): SoccerBet => {
    if (b.gameId !== summary.gameId || b.status !== 'open') return b;
    if (b.teamId !== winner) return { ...b, status: 'lost', payout: 0 };
    const payout = Math.floor((b.amount * b.multMilli) / 1000);
    next = { ...next, coins: next.coins + payout, ledger: withLedger(next, payout, `Prediction right: ${clubName(s, b.teamId)}`) };
    return { ...b, status: 'won', payout };
  });
  return { ...next, bets };
}

/** A new player for a squad slot (Vanish replacement or a new club). */
function freshPlayer(s: SoccerUniverse, seedTag: string, id: string, teamId: string, position: SoccerPlayer['position']): SoccerPlayer {
  const used = new Set(Object.values(s.league.players).map((p) => p.name));
  return makeSoccerPlayer(createRng(s.settings.seed, seedTag, id), id, teamId, position, used);
}

function applyHappening(s: SoccerUniverse, h: SoccerHappening): SoccerUniverse {
  const player = s.league.players[h.playerId];
  if (!player) return s;
  if (h.type === 'mod') {
    return { ...s, mods: { ...s.mods, [h.playerId]: [...(s.mods[h.playerId] ?? []), h.mod] }, news: withNews(s, [h.text]) };
  }
  // Vanished: taken to the Sub-Levels, replaced in the squad by a new arrival.
  const team = clubOf(s, player.teamId);
  if (!team) return s;
  const replacementId = `${team.id}s${s.season}d${s.currentDay}v`;
  const replacement = freshPlayer(s, 'arrival', replacementId, team.id, player.position);
  const players = { ...s.league.players, [replacementId]: replacement };
  delete players[h.playerId];
  const teams = s.league.teams.map((t) => (t.id === team.id ? { ...t, squad: t.squad.map((id) => (id === h.playerId ? replacementId : id)) } : t));
  const text = `${player.name} (${team.city} ${team.name}) ${h.cause}`;
  return {
    ...s,
    league: { ...s.league, teams, players },
    vanished: [...s.vanished, { player, season: s.season, day: s.currentDay, cause: h.cause }],
    injuries: Object.fromEntries(Object.entries(s.injuries).filter(([id]) => id !== h.playerId)),
    news: withNews(s, [{ text: `Director: ${text}`, director: true }, `${replacement.name} arrives at the ${team.name} Wing to take the empty bunk.`]),
    timeline: withTimeline(s, 'vanish', text),
  };
}

export function reduceSoccer(state: SoccerUniverse, event: SoccerWorldEvent): SoccerUniverse {
  switch (event.type) {
    case 'matchStarted':
      return state.started.includes(event.gameId) ? state : { ...state, started: [...state.started, event.gameId] };

    case 'matchPlayed': {
      const { summary, box } = event;
      if (state.results[summary.gameId]) return state;
      const seasonStats = { ...state.seasonStats };
      const careerStats = { ...state.careerStats };
      for (const [id, line] of Object.entries(box)) {
        seasonStats[id] = addLines(seasonStats[id], line);
        careerStats[id] = addLines(careerStats[id], line);
      }
      // Injuries: the two clubs' injured players have now missed one more match.
      const playing = new Set([...(clubOf(state, summary.homeId)?.squad ?? []), ...(clubOf(state, summary.awayId)?.squad ?? [])]);
      const injuries: Record<string, number> = {};
      for (const [id, n] of Object.entries(state.injuries)) {
        const left = playing.has(id) ? n - 1 : n;
        if (left > 0) injuries[id] = left;
      }
      for (const [id, n] of Object.entries(event.injuries)) injuries[id] = n;
      let next: SoccerUniverse = {
        ...state,
        results: { ...state.results, [summary.gameId]: summary },
        seasonStats,
        careerStats,
        injuries,
        league: applyRelationPairs(state.league, event.relations),
      };
      for (const id of event.awakenings) {
        const p = next.league.players[id];
        if (!p) continue;
        const woke = awaken(p, state.season);
        const text = `${p.name} has Awakened. ${woke.drive !== p.drive ? `Their game has changed: ${p.drive} → ${woke.drive}.` : 'Something in them has changed for good.'}`;
        next = {
          ...next,
          league: { ...next.league, players: { ...next.league.players, [id]: woke } },
          awakenings: [...next.awakenings, { playerId: id, season: state.season, day: summary.day }],
          news: withNews(next, [text], summary.day),
          timeline: withTimeline(next, 'awakening', text),
        };
      }
      const winner = summary.shootout?.winnerId ?? matchWinner(summary);
      if (winner && winner === state.favoriteClubId) {
        next = { ...next, coins: next.coins + FAVORITE_WIN_BONUS, ledger: withLedger(next, FAVORITE_WIN_BONUS, `Your ${clubOf(next, winner)?.name} won`) };
      }
      return settleBets(next, summary);
    }

    case 'happening':
      return applyHappening(state, event.happening);

    case 'betPlaced': {
      const { gameId, teamId, amount } = event;
      if (betError(state, gameId, teamId, amount)) return state;
      const odds = matchOdds(state, gameId);
      const game = state.schedule.find((g) => g.id === gameId)!;
      const [pm, mult] = teamId === DRAW_PICK ? [odds.drawPm, odds.drawMult] : teamId === game.homeId ? [odds.homePm, odds.homeMult] : [odds.awayPm, odds.awayMult];
      const existing = state.bets.find((b) => b.season === state.season && b.gameId === gameId && b.teamId === teamId);
      const bets = existing
        ? state.bets.map((b) => (b === existing ? { ...b, amount: b.amount + amount, multMilli: Math.floor((b.amount * b.multMilli + amount * mult) / (b.amount + amount)) } : b))
        : [...state.bets, { id: `${state.season}-${gameId}-${teamId}`, gameId, day: state.currentDay, teamId, amount, multMilli: mult, pm, status: 'open' as const, payout: 0, season: state.season }];
      return { ...state, coins: state.coins - amount, bets, ledger: withLedger(state, -amount, `Prediction: ${clubName(state, teamId)}`) };
    }

    case 'clubSwitched': {
      if (clubSwitchError(state, event.clubId)) return state;
      const from = clubOf(state, state.favoriteClubId);
      const to = clubOf(state, event.clubId)!;
      const text = `You left the ${from ? `${from.city} ${from.name}` : 'old club'} for the ${to.city} ${to.name}. All ${state.coins} coins stay behind.`;
      return {
        ...state,
        favoriteClubId: event.clubId,
        lastClubSwitchSeason: state.season,
        clubHistory: [...state.clubHistory, { clubId: event.clubId, fromSeason: state.season }],
        coins: 0,
        ledger: withLedger(state, -state.coins, 'Switched clubs'),
        news: withNews(state, [text]),
        timeline: withTimeline(state, 'clubSwitch', text),
      };
    }

    case 'dayEnded': {
      if (event.day !== state.currentDay) return state;
      if (state.phase === 'offseason') return newSeason(state);
      let next: SoccerUniverse = {
        ...state,
        currentDay: state.currentDay + 1,
        dayCount: state.dayCount + 1,
        coins: state.coins + DAILY_STIPEND,
        ledger: withLedger(state, DAILY_STIPEND, 'Daily fan stipend'),
        mods: expireMods(state.mods, state.season, state.currentDay + 1),
      };
      if (state.phase === 'regular' && next.currentDay > regularDays(next)) next = beginPlayoffs(next);
      else if (state.phase === 'playoffs') next = continuePlayoffs(next);
      return next;
    }
  }
}

function expireMods(mods: Record<string, ActiveMod[]>, season: number, day: number): Record<string, ActiveMod[]> {
  const out: Record<string, ActiveMod[]> = {};
  for (const [id, list] of Object.entries(mods)) {
    const keep = list.filter((m) => m.untilDay === null || (m.season === season && m.untilDay >= day));
    if (keep.length) out[id] = keep;
  }
  return out;
}

export const reduceAllSoccer = (state: SoccerUniverse, events: SoccerWorldEvent[]) => events.reduce(reduceSoccer, state);

// ---------------------------------------------------------------------------
// Playoffs (knockout: shootouts, never draws) and the offseason

function beginPlayoffs(s: SoccerUniverse): SoccerUniverse {
  const table = soccerStandings(s);
  const [a, b, c, d] = table.map((r) => r.teamId);
  const day = s.currentDay;
  const semis: SoccerFixture[] = [
    { id: `s${s.season}sf1`, day, homeId: a, awayId: d },
    { id: `s${s.season}sf2`, day, homeId: b, awayId: c },
  ];
  return {
    ...s,
    phase: 'playoffs',
    schedule: [...s.schedule, ...semis],
    playoffs: { semis: semis.map((g) => g.id), final: null, championId: null },
    news: withNews(s, [{ text: `Director: The league phase is complete. The top four enter the Knockout. Draws are no longer permitted.`, director: true }]),
  };
}

const knockoutWinner = (r: SoccerMatchSummary) => r.shootout?.winnerId ?? matchWinner(r)!;

function continuePlayoffs(s: SoccerUniverse): SoccerUniverse {
  const p = s.playoffs!;
  if (!p.final) {
    const [sf1, sf2] = p.semis.map((id) => s.results[id]);
    if (!sf1 || !sf2) return s;
    const final: SoccerFixture = { id: `s${s.season}final`, day: s.currentDay, homeId: knockoutWinner(sf1), awayId: knockoutWinner(sf2) };
    return { ...s, schedule: [...s.schedule, final], playoffs: { ...p, final: final.id } };
  }
  const f = s.results[p.final];
  if (!f) return s;
  const championId = knockoutWinner(f);
  const text = `The ${clubName(s, championId)} are champions of The Assembly, season ${s.season}.`;
  return endSeason({ ...s, playoffs: { ...p, championId }, news: withNews(s, [text]), timeline: withTimeline(s, 'champion', text) });
}

/** Survival pressure (§B1): the bottom clubs are Ejected and replaced by new clubs from outside. */
function endSeason(s: SoccerUniverse): SoccerUniverse {
  const table = soccerStandings(s);
  const out = table.slice(table.length - s.ejections).map((r) => clubOf(s, r.teamId)!);
  let league = s.league;
  let nextClub = s.nextClub;
  const usedCities = new Set(league.teams.map((t) => t.city));
  const usedClubs = new Set(league.teams.map((t) => t.name));
  const rng = createRng(s.settings.seed, 'ejection', s.season);
  const lines: string[] = [];
  for (const old of out) {
    const id = `t${nextClub++}`;
    const freshOr = (all: string[], used: Set<string>) => (all.some((x) => !used.has(x)) ? all.filter((x) => !used.has(x)) : all);
    const city = rng.pick(freshOr(names.cities, usedCities));
    const club = rng.pick(freshOr(names.clubs, usedClubs));
    usedCities.add(city);
    usedClubs.add(club);
    const players: Record<string, SoccerPlayer> = { ...league.players };
    for (const pid of old.squad) delete players[pid];
    const squad = SQUAD_POSITIONS.map((pos, i) => {
      const p = freshPlayer({ ...s, league: { ...league, players } }, 'new-club', `${id}p${i + 1}`, id, pos);
      players[p.id] = p;
      return p.id;
    });
    const team: SoccerTeam = {
      id, city, name: club, abbr: abbrOf(city), colors: old.colors, style: rng.pick(STYLES), squad,
      fanSize: rng.range(30, 70), arenaId: ARENAS[rng.int(ARENAS.length)].id,
    };
    league = { ...league, players, teams: league.teams.map((t) => (t.id === old.id ? team : t)) };
    lines.push(`Director: The ${old.city} ${old.name} have been Ejected from The Assembly. The ${city} ${club} arrive tomorrow.`);
  }
  // A fan whose club was Ejected follows the newcomers into its slot.
  const favOut = out.some((t) => t.id === s.favoriteClubId);
  const favoriteClubId = favOut ? league.teams[s.league.teams.findIndex((t) => t.id === s.favoriteClubId)].id : s.favoriteClubId;
  return {
    ...s,
    phase: 'offseason',
    league,
    nextClub,
    favoriteClubId,
    clubHistory: favOut ? [...s.clubHistory, { clubId: favoriteClubId, fromSeason: s.season + 1 }] : s.clubHistory,
    archive: [...s.archive, { season: s.season, standings: table, championId: s.playoffs?.championId ?? null, ejected: out.map((t) => ({ id: t.id, name: `${t.city} ${t.name}` })) }],
    statsBySeason: { ...s.statsBySeason, [s.season]: s.seasonStats },
    news: withNews(s, lines.map((text) => ({ text, director: true }))),
    timeline: [...s.timeline, ...lines.map((text) => ({ season: s.season, day: s.currentDay, kind: 'ejection' as const, text }))],
  };
}

function newSeason(s: SoccerUniverse): SoccerUniverse {
  const season = s.season + 1;
  return {
    ...s,
    season,
    phase: 'regular',
    engineVersion: SOCCER_ENGINE_VERSION,
    schedule: generateSchedule(s.league.teams, roundsFor(s.league.teams.length)),
    results: {},
    started: [],
    currentDay: 1,
    dayCount: s.dayCount + 1,
    seasonStats: {},
    playoffs: null,
    injuries: {},
    mods: expireMods(s.mods, season, 1),
    news: withNews({ ...s, season }, [{ text: `Director: Season ${season} begins. Some of you are new. Do not get attached.`, director: true }], 1),
  };
}

// ---------------------------------------------------------------------------
// Commands

export function runSoccerCommand(start: SoccerUniverse, cmd: SoccerCommand): SoccerCommandResult {
  let state = start;
  const events: SoccerWorldEvent[] = [];
  const pbp: SoccerPlayByPlay[] = [];
  const apply = (e: SoccerWorldEvent) => {
    state = reduceSoccer(state, e);
    events.push(e);
  };

  const play = (game: SoccerFixture) => {
    if (state.results[game.id]) return;
    const { opts, facility } = matchInputs(state, game);
    const r = simulateSoccer(state.league, game, state.season, opts);
    apply({
      type: 'matchPlayed',
      summary: {
        gameId: game.id, day: game.day, homeId: r.homeId, awayId: r.awayId, homeScore: r.homeScore, awayScore: r.awayScore,
        shootout: r.shootout, knockout: opts.knockout || undefined, facility: facility.length ? facility : undefined, arenaId: r.arenaId,
      },
      box: soccerBoxScore(r),
      injuries: r.injuries,
      awakenings: r.awakenings,
      relations: relationPairs(r),
    });
    pbp.push({ gameId: game.id, day: game.day, season: state.season, events: r.events });
  };

  const endDay = () => {
    if (state.phase !== 'offseason') {
      unplayedToday(state).forEach(play);
      const vanished = new Set(state.vanished.map((v) => v.player.id));
      const days = regularDays(state);
      for (const happening of rollSoccerDay({ seed: state.settings.seed, season: state.season, day: state.currentDay, chaos: state.settings.chaos, seasonDays: days, league: state.league, vanished })) {
        apply({ type: 'happening', happening });
      }
    }
    apply({ type: 'dayEnded', day: state.currentDay });
  };

  switch (cmd.type) {
    case 'playGame': {
      const game = state.schedule.find((g) => g.id === cmd.gameId);
      if (!game || game.day !== state.currentDay) throw new Error(`Match ${cmd.gameId} is not playable today`);
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
      for (let guard = 0; state.phase !== 'offseason' && guard < 1000; guard++) endDay();
      break;
  }
  const minDay = state.currentDay - PBP_DAYS_KEPT;
  return { state, events, pbp: pbp.filter((p) => p.day >= minDay) };
}
