import type { StatLine } from '../engine/baseball/boxScore';
import { createRng } from '../engine/core/rng';
import type { League, Player, RatingKey, ScheduledGame } from '../engine/baseball/types';
import { makeRookie } from './generate';

/**
 * Seasons beyond the first (PRD §15 MVP 3): playoffs, awards, aging, retirements and rookies.
 * Pure functions over plain data so they're easy to test.
 */

export type Phase = 'regular' | 'playoffs' | 'offseason';

export interface Series {
  id: string;
  round: number;
  highSeed: string;
  lowSeed: string;
  bestOf: number;
  games: string[];
  wins: Record<string, number>;
  winner: string | null;
}

export interface Playoffs {
  series: Series[];
  finalRound: number;
  championId: string | null;
}

export interface SeasonRecord {
  season: number;
  standings: { teamId: string; wins: number; losses: number }[];
  championId: string | null;
  mvpId: string | null;
  aceId: string | null;
  /** Team names as they were that season (a relegated team's slot is later reused). */
  teamNames?: Record<string, string>;
}

export const isPlayoffGame = (gameId: string) => gameId.startsWith('p');
export const SEMIS_BEST_OF = 3;
export const FINAL_BEST_OF = 5;

const winsNeeded = (s: Series) => Math.floor(s.bestOf / 2) + 1;

/** Next game of a series, if it isn't decided. Odd-numbered games are at the higher seed. */
function nextGame(s: Series, day: number): ScheduledGame | null {
  if (s.winner) return null;
  const n = s.games.length + 1;
  const highHome = n % 2 === 1;
  return { id: `${s.id}g${n}`, day, awayId: highHome ? s.lowSeed : s.highSeed, homeId: highHome ? s.highSeed : s.lowSeed };
}

/** Seed the playoffs from the final regular-season standings (best first). */
export function startPlayoffs(standingIds: string[], day: number): { playoffs: Playoffs; games: ScheduledGame[] } {
  const four = standingIds.length > 4;
  const series: Series[] = four
    ? [
        { id: 'p1s1', round: 1, highSeed: standingIds[0], lowSeed: standingIds[3], bestOf: SEMIS_BEST_OF, games: [], wins: {}, winner: null },
        { id: 'p1s2', round: 1, highSeed: standingIds[1], lowSeed: standingIds[2], bestOf: SEMIS_BEST_OF, games: [], wins: {}, winner: null },
      ]
    : [{ id: 'p1s1', round: 1, highSeed: standingIds[0], lowSeed: standingIds[1], bestOf: FINAL_BEST_OF, games: [], wins: {}, winner: null }];
  const playoffs: Playoffs = { series, finalRound: four ? 2 : 1, championId: null };
  return scheduleDay(playoffs, day);
}

function scheduleDay(p: Playoffs, day: number): { playoffs: Playoffs; games: ScheduledGame[] } {
  const games: ScheduledGame[] = [];
  const series = p.series.map((s) => {
    const g = nextGame(s, day);
    if (!g) return s;
    games.push(g);
    return { ...s, games: [...s.games, g.id] };
  });
  return { playoffs: { ...p, series }, games };
}

/**
 * After a playoff day: count wins, decide series, start the next round or crown a champion.
 * `winnerOf(gameId)` returns the winning team id of a played game.
 */
export function advancePlayoffs(p: Playoffs, winnerOf: (gameId: string) => string | null, nextDay: number): { playoffs: Playoffs; games: ScheduledGame[] } {
  let series = p.series.map((s) => {
    if (s.winner) return s;
    const wins: Record<string, number> = { [s.highSeed]: 0, [s.lowSeed]: 0 };
    for (const g of s.games) {
      const w = winnerOf(g);
      if (w) wins[w] = (wins[w] ?? 0) + 1;
    }
    const winner = wins[s.highSeed] >= winsNeeded(s) ? s.highSeed : wins[s.lowSeed] >= winsNeeded(s) ? s.lowSeed : null;
    return { ...s, wins, winner };
  });

  const round = Math.max(...series.map((s) => s.round));
  const current = series.filter((s) => s.round === round);
  if (current.every((s) => s.winner)) {
    if (round === p.finalRound) return { playoffs: { ...p, series, championId: current[0].winner }, games: [] };
    // Semifinal winners meet in the final; the better seed (series 1's winner) hosts.
    series = [...series, { id: `p${round + 1}s1`, round: round + 1, highSeed: current[0].winner!, lowSeed: current[1].winner!, bestOf: FINAL_BEST_OF, games: [], wins: {}, winner: null }];
  }
  return scheduleDay({ ...p, series }, nextDay);
}

// ---------------------------------------------------------------------------
// Awards

export function seasonAwards(seasonStats: Record<string, StatLine>, league: League): { mvpId: string | null; aceId: string | null } {
  let mvpId: string | null = null;
  let aceId: string | null = null;
  let best = -Infinity;
  let bestAce = -Infinity;
  for (const [pid, s] of Object.entries(seasonStats)) {
    const p = league.players[pid];
    if (!p) continue;
    if (p.role === 'batter') {
      const score = s.h * 3 + s.hr * 6 + s.r * 3 + s.bb * 2 - s.k;
      if (score > best) [best, mvpId] = [score, pid];
    } else {
      const score = s.pk * 2 + s.w * 15 + s.outs - s.ra * 4;
      if (score > bestAce) [bestAce, aceId] = [score, pid];
    }
  }
  return { mvpId, aceId };
}

// ---------------------------------------------------------------------------
// Aging, development and retirement

export const initialAge = (playerId: string) => 21 + createRng(playerId, 'age').int(14);
export const rookieAge = (playerId: string) => 21 + createRng(playerId, 'age').int(3);

/** Seasons already played when the league begins: most players debuted at 21–23. */
export const initialExperience = (playerId: string, age: number) => Math.max(0, age - 21 - createRng(playerId, 'debut').int(3));

/** Where a player is in their career arc. Traits can shift the arc (see AgingTrait). */
export type CareerPhase = 'rising' | 'prime' | 'fading' | 'twilight';
export const PHASE_LABEL: Record<CareerPhase, string> = { rising: 'Rising', prime: 'Prime', fading: 'Fading', twilight: 'Twilight' };

export function careerPhase(age: number): CareerPhase {
  if (age <= 26) return 'rising';
  if (age <= 30) return 'prime';
  if (age <= 33) return 'fading';
  return 'twilight';
}

/** How far a player is from their peak at a given age, used to shape a brand-new league. */
export function ageRatingOffset(age: number): number {
  if (age <= 23) return -6;
  if (age <= 26) return -2;
  if (age <= 30) return 3;
  if (age <= 33) return 0;
  return -4;
}

/** Permanent traits that bend the aging curve. `shift` is added every offseason; `delay` postpones retirement. */
export interface AgingTrait {
  shift: number;
  delay: number;
}

/** Rating change for a year of aging: the young improve, peak in their prime, then fade. */
function development(age: number, rng: ReturnType<typeof createRng>): number {
  const phase = careerPhase(age);
  if (phase === 'rising') return rng.range(2, 5);
  if (phase === 'prime') return rng.range(-1, 2);
  if (phase === 'fading') return rng.range(-4, 0);
  return rng.range(-7, -2);
}

/** Per-mille chance of retiring at a given (new) age. */
export function retirementChance(age: number): number {
  if (age >= 37) return 1000;
  if (age >= 35) return 550;
  if (age >= 33) return 200;
  return 0;
}

export interface OffseasonResult {
  league: League;
  ages: Record<string, number>;
  experience: Record<string, number>;
  retired: { playerId: string; teamId: string; age: number; rookieId: string }[];
  notes: { playerId: string; text: string }[];
}

const RATING_KEYS: RatingKey[] = ['contact', 'power', 'discipline', 'velocity', 'control', 'stuff', 'speed', 'defense'];
const clamp = (v: number) => (v < 0 ? 0 : v > 100 ? 100 : v);

/** Everyone ages a year. Active players develop; some veterans retire and rookies take their place. */
export function runOffseason(
  league: League,
  ages: Record<string, number>,
  seed: string,
  newSeason: number,
  experience: Record<string, number> = {},
  traits: Record<string, AgingTrait> = {},
): OffseasonResult {
  const rng = createRng(seed, newSeason, 'offseason');
  const nextAges: Record<string, number> = {};
  for (const [id, age] of Object.entries(ages)) nextAges[id] = age + 1;
  const nextExperience: Record<string, number> = { ...experience };
  const players: Record<string, Player> = { ...league.players };
  const used = new Set(Object.values(players).map((p) => p.name));
  const retired: OffseasonResult['retired'] = [];
  const notes: OffseasonResult['notes'] = [];

  const teams = league.teams.map((team) => {
    const swap = (ids: string[], offset: number) =>
      ids.map((id, slot) => {
        const age = nextAges[id] ?? initialAge(id);
        const trait = traits[id] ?? { shift: 0, delay: 0 };
        if (rng.chance(retirementChance(age - trait.delay))) {
          const rookieId = `${team.id}y${newSeason}r${offset + slot}`;
          const p = players[id];
          const rookie = makeRookie(createRng(seed, newSeason, 'rookie', id), rookieId, team.id, p.role, p.position, used);
          players[rookieId] = rookie;
          nextAges[rookieId] = rookieAge(rookieId);
          nextExperience[rookieId] = 0;
          retired.push({ playerId: id, teamId: team.id, age, rookieId });
          notes.push({ playerId: id, text: `Retired at ${age}.` });
          notes.push({ playerId: rookieId, text: `Debuted as a rookie, replacing ${p.name}.` });
          return rookieId;
        }
        const p = players[id];
        const ratings = { ...p.ratings };
        const d = development(age - trait.delay, rng) + trait.shift;
        nextExperience[id] = (experience[id] ?? initialExperience(id, age - 1)) + 1;
        for (const k of RATING_KEYS) ratings[k] = clamp(ratings[k] + d + rng.range(-1, 1));
        players[id] = { ...p, ratings };
        return id;
      });
    return { ...team, lineup: swap(team.lineup, 0), rotation: swap(team.rotation, team.lineup.length) };
  });

  return { league: { ...league, teams, players }, ages: nextAges, experience: nextExperience, retired, notes };
}
