import type { Drive, SoccerLeague, SoccerPlayer, SoccerRatingKey, SoccerResult } from '../../engine/soccer/types';
import { generateSchedule } from '../../engine/season';
import { simulateSoccer } from '../../engine/soccer/game';

/**
 * Personality layer between matches (PRD §B4): Bonds and Rivalries grow from match events, and
 * Awakenings permanently change a player. Pure: returns a new league, never mutates.
 */

/** League-wide Awakenings allowed per season (§B4: ~1–3). */
export const AWAKENINGS_PER_SEASON = 3;

const bump = (m: Record<string, number> | undefined, id: string) => ({ ...(m ?? {}), [id]: (m?.[id] ?? 0) + 1 });

export interface RelationPairs {
  bonds: [string, string][];
  rivals: [string, string][];
}

/** Assists between teammates build Bonds; fouls between opponents build Rivalries. */
export function relationPairs(r: SoccerResult): RelationPairs {
  const out: RelationPairs = { bonds: [], rivals: [] };
  for (const e of r.events) {
    if (e.kind === 'goal' && e.assistId) out.bonds.push([e.scorerId, e.assistId]);
    if (e.kind === 'tackle') out.rivals.push([e.defenderId, e.victimId]);
  }
  return out;
}

export function applyRelationPairs(league: SoccerLeague, pairs: RelationPairs): SoccerLeague {
  const players = { ...league.players };
  const touch = (a: string, b: string, key: 'bonds' | 'rivals') => {
    if (!players[a] || !players[b] || a === b) return;
    players[a] = { ...players[a], [key]: bump(players[a][key], b) };
    players[b] = { ...players[b], [key]: bump(players[b][key], a) };
  };
  for (const [a, b] of pairs.bonds) touch(a, b, 'bonds');
  for (const [a, b] of pairs.rivals) touch(a, b, 'rivals');
  return { ...league, players };
}

export const applyRelations = (league: SoccerLeague, r: SoccerResult) => applyRelationPairs(league, relationPairs(r));

/** How Drives evolve when a player Awakens. */
const EVOLVE: Partial<Record<Drive, Drive>> = { spark: 'ice', selfish: 'predator', showboat: 'conductor' };
const BOOST_KEY: Record<SoccerPlayer['position'], SoccerRatingKey> = { K: 'reflexes', A: 'tackling', W: 'pace', P: 'finishing' };

export function awaken(player: SoccerPlayer, seasonId: number): SoccerPlayer {
  const boost = BOOST_KEY[player.position];
  return {
    ...player,
    drive: EVOLVE[player.drive] ?? player.drive,
    ratings: { ...player.ratings, [boost]: Math.min(100, player.ratings[boost] + 12) },
    awakened: { seasonId, boost },
  };
}

export interface SoccerSeasonSummary {
  league: SoccerLeague;
  results: SoccerResult[];
  awakenings: string[];
}

/**
 * A whole season of round-robin matches (used by tests and, from S5, the universe): relations and
 * Awakenings carry from match to match, and Awakenings stop at the league-wide cap.
 */
export function simulateSoccerSeason(start: SoccerLeague, seasonId: number, rounds = (start.teams.length - 1) * 2): SoccerSeasonSummary {
  let league = start;
  const results: SoccerResult[] = [];
  const awakenings: string[] = [];
  for (const game of generateSchedule(start.teams, rounds)) {
    const r = simulateSoccer(league, game, seasonId, { allowAwakening: awakenings.length < AWAKENINGS_PER_SEASON });
    results.push(r);
    league = applyRelations(league, r);
    for (const id of r.awakenings) {
      awakenings.push(id);
      league = { ...league, players: { ...league.players, [id]: awaken(league.players[id], seasonId) } };
    }
  }
  return { league, results, awakenings };
}
