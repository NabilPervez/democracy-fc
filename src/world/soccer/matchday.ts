import { createRng } from '../../engine/core/rng';
import { selectLineup } from '../../engine/soccer/lineup';
import { SUPPORTER_BLOCS, TACTICS, getTactic, type TacticDef } from '../../engine/soccer/tactics';
import type { SoccerLeague, SoccerTeam, TacticId } from '../../engine/soccer/types';
import type { SoccerStatLine } from '../../engine/soccer/boxScore';

/**
 * The Matchday Ballot (PRD §B7a): before every match each club's fans vote on the Tactic and the
 * Armband (captain). The player gets one free vote per question; extra votes cost n² coins.
 * Simulated supporter blocs vote too, so skipping the ballot never blocks a match.
 * Everything is seeded per (universe, season, match, club), so a replay resolves identically.
 */

export const OPTIONS_PER_QUESTION = 3;
export const CAPTAIN_BONUS = 10;

export type BallotQuestion = 'tactic' | 'captain';

export interface BallotOptions {
  tactics: TacticId[];
  captains: string[];
}

/** The player's votes on one club's ballot for one match. */
export interface PlayerBallot {
  tactic: number[];
  captain: number[];
  coinsSpent: number;
}

export interface BallotResult {
  tactic: TacticId;
  captainId: string;
  /** Winning shares, percent. */
  tacticPct: number;
  captainPct: number;
}

/** Extra matchday votes (beyond the free one) cost n² coins in total — cheaper than elections. */
export const matchdayVotesCost = (paid: number) => paid * paid;

const fitsStyle = (t: TacticDef, team: SoccerTeam) => t.styles.includes(team.style);

/** Three tactics (weighted toward ones that suit the club) and three captain candidates from the likely five. */
export function ballotOptions(league: SoccerLeague, team: SoccerTeam, seedParts: (string | number)[], form: Record<string, SoccerStatLine> = {}, unavailable: ReadonlySet<string> = new Set()): BallotOptions {
  const rng = createRng(...seedParts, 'ballot', team.id);
  const pool = [...TACTICS];
  const tactics: TacticId[] = [];
  while (tactics.length < OPTIONS_PER_QUESTION && pool.length) {
    const weights = pool.map((t) => (fitsStyle(t, team) ? 3 : 1));
    let r = rng.int(weights.reduce((a, b) => a + b, 0));
    let i = 0;
    while (r >= weights[i]) r -= weights[i++];
    tactics.push(pool.splice(i, 1)[0].id);
  }
  // Captains: from the likely five, favouring form and a mix of Drives.
  const five = selectLineup(team, league, unavailable);
  const score = (id: string) => {
    const f = form[id];
    return (f ? f.goals * 3 + f.assists * 2 + f.cleanSheets * 2 : 0) + rng.int(6);
  };
  const ranked = [...five].sort((a, b) => score(b) - score(a) || five.indexOf(a) - five.indexOf(b));
  const captains: string[] = [];
  for (const id of ranked) {
    if (captains.length >= OPTIONS_PER_QUESTION) break;
    const drive = league.players[id].drive;
    if (captains.some((c) => league.players[c].drive === drive) && ranked.length - ranked.indexOf(id) > OPTIONS_PER_QUESTION - captains.length) continue;
    captains.push(id);
  }
  for (const id of ranked) if (captains.length < OPTIONS_PER_QUESTION && !captains.includes(id)) captains.push(id);
  return { tactics, captains };
}

/** Simulated fans' votes: supporter blocs with leanings (Old Guard, Ultras, Tacticians). */
export function simulatedFanVotes(team: SoccerTeam, options: BallotOptions, seedParts: (string | number)[], form: Record<string, SoccerStatLine> = {}, moraleLow = false): { tactic: number[]; captain: number[] } {
  const rng = createRng(...seedParts, 'fans', team.id);
  const budget = Math.trunc((team.fanSize * (moraleLow ? 3 : 4)) / 4);
  const tactic = options.tactics.map(() => 0);
  const captain = options.captains.map(() => 0);
  for (const bloc of SUPPORTER_BLOCS) {
    const votes = Math.trunc((budget * bloc.share) / 100);
    const tw = options.tactics.map((id) => {
      const t = getTactic(id)!;
      return 4 + (t.lean === bloc.lean ? 8 : 0) + (fitsStyle(t, team) ? 4 : 0) + rng.int(6);
    });
    spread(tactic, tw, votes);
    const cw = options.captains.map((id) => {
      const f = form[id];
      return 4 + (f ? f.goals * 2 + f.assists + f.cleanSheets : 0) + rng.int(6);
    });
    spread(captain, cw, votes);
  }
  return { tactic, captain };
}

function spread(into: number[], weights: number[], votes: number) {
  const total = weights.reduce((a, b) => a + b, 0);
  let left = votes;
  weights.forEach((w, i) => {
    const n = Math.floor((votes * w) / total);
    into[i] += n;
    left -= n;
  });
  const best = weights.indexOf(Math.max(...weights));
  into[best] += left;
}

const argmax = (xs: number[]) => xs.reduce((best, v, i) => (v > xs[best] ? i : best), 0);
const pct = (xs: number[], i: number) => Math.round((xs[i] * 100) / Math.max(1, xs.reduce((a, b) => a + b, 0)));

/** Resolve at kickoff: fans' votes plus the player's (on their own club's ballot only). */
export function resolveBallot(options: BallotOptions, fans: { tactic: number[]; captain: number[] }, player?: PlayerBallot): BallotResult {
  const tactic = fans.tactic.map((v, i) => v + (player?.tactic[i] ?? 0));
  const captain = fans.captain.map((v, i) => v + (player?.captain[i] ?? 0));
  const t = argmax(tactic);
  const c = argmax(captain);
  return { tactic: options.tactics[t], captainId: options.captains[c], tacticPct: pct(tactic, t), captainPct: pct(captain, c) };
}

/** Public scouting: the opponent fan base's current tactic lean, in percent per option (§B7a). */
export function tacticLean(fans: { tactic: number[] }): number[] {
  const total = fans.tactic.reduce((a, b) => a + b, 0) || 1;
  return fans.tactic.map((v) => Math.round((v * 100) / total));
}

/** Coins for adding `count` votes to one option, given the votes already cast on this ballot question. */
export function ballotVoteCost(current: number[], count: number): number {
  const cast = current.reduce((a, b) => a + b, 0);
  const paidBefore = Math.max(0, cast - 1);
  const paidAfter = Math.max(0, cast + count - 1);
  return matchdayVotesCost(paidAfter) - matchdayVotesCost(paidBefore);
}
