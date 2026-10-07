import content from '../../../content/soccer/proposals.json';
import { createRng } from '../../engine/core/rng';
import type { StandingRow } from '../../engine/season';
import { soccerStars, SOCCER_STAR_GROUPS } from '../../engine/soccer/sport';
import type { Drive, SoccerLeague, SoccerRatingKey, SoccerStarGroup, SoccerTeam, Style } from '../../engine/soccer/types';
import { FACTION_BUDGET, type Faction } from '../factions';
import { votesCost } from '../elections';

/**
 * Facility elections (PRD §B7). Two kinds of voters:
 * - club fan bases, one per club, voting self-interestedly with a budget scaled by fan size;
 * - the six ideological factions, voting by lean (swing voters).
 * The player's votes join their club's bloc. Votes cost n² coins (quadratic, unchanged from base).
 * Everything is integer math and public information only (star groups, Style, standings).
 */

export const ELECTION_DAYS = 7;
export const PROPOSALS_PER_ELECTION = 4;

export type ProposalType = 'statusQuo' | 'matchRule' | 'facilityRule' | 'sabotage' | 'boost' | 'return' | 'ejection';
export type ProposalTarget = 'bestRecord' | 'worstRecord' | 'bottomTwo' | 'bottomOne';

export type SoccerProposalEffect =
  | { kind: 'statusQuo' }
  | { kind: 'goalValue'; wall?: number; longRange?: number }
  | { kind: 'spotKickFrom'; fouls: number }
  | { kind: 'powerPlaySeconds'; seconds: number }
  | { kind: 'facilityEvent'; eventId: string }
  | { kind: 'arena'; arenaId: string }
  | { kind: 'facilityChance'; perMille: number }
  | { kind: 'sabotage'; target: ProposalTarget; arenaId: string; matches: number }
  | { kind: 'boost'; target: ProposalTarget; delta: Partial<Record<SoccerRatingKey, number>>; matches: number }
  | { kind: 'ejections'; count: number }
  | { kind: 'return'; playerId: string };

export interface Leaning {
  stars?: Partial<Record<SoccerStarGroup, number>>;
  drives?: Drive[];
  styles?: Style[];
}

export interface SoccerProposalDef {
  id: string;
  title: string;
  type: ProposalType;
  description: string;
  effect: SoccerProposalEffect;
  duration?: { days: number };
  favors: Leaning;
  hurts: Leaning;
  target?: ProposalTarget;
  factionLean: Record<string, number>;
}

/** A proposal on a ballot, with any target resolved to a club when the election opens. */
export interface SoccerProposal extends SoccerProposalDef {
  targetClubIds?: string[];
}

export const PROPOSAL_DEFS = content.proposals as unknown as SoccerProposalDef[];

export interface SoccerElection {
  id: number;
  season: number;
  openedDay: number;
  closesDay: number;
  proposals: SoccerProposal[];
  /** clubId → votes per proposal (the club's simulated fans; public lean). */
  clubVotes: Record<string, number[]>;
  factionVotes: Record<string, number[]>;
  /** The player's votes (they join their club's bloc). */
  playerVotes: number[];
  coinsSpent: number;
  result: { winner: number; totals: number[] } | null;
}

/** What a fan base may know: public star groups, Style and standings. */
export interface ClubView {
  team: SoccerTeam;
  /** Half-star totals per group across the squad. */
  stars: Record<SoccerStarGroup, number>;
  drives: Drive[];
  rank: number;
  clubs: number;
}

export function clubView(league: SoccerLeague, team: SoccerTeam, standings: StandingRow[]): ClubView {
  const players = team.squad.map((id) => league.players[id]).filter(Boolean);
  const stars = Object.fromEntries(
    (Object.keys(SOCCER_STAR_GROUPS) as SoccerStarGroup[]).map((g) => [g, players.reduce((s, p) => s + Math.round(soccerStars(p, g) * 2), 0)]),
  ) as Record<SoccerStarGroup, number>;
  const rank = Math.max(0, standings.findIndex((r) => r.teamId === team.id));
  return { team, stars, drives: players.map((p) => p.drive), rank, clubs: standings.length || 1 };
}

function leaningScore(v: ClubView, leaning: Leaning, avgStars: Record<SoccerStarGroup, number>): number {
  let score = 0;
  for (const [g, w] of Object.entries(leaning.stars ?? {}) as [SoccerStarGroup, number][]) {
    // Above-average clubs in that group gain; below-average clubs lose. Half-stars over 8 players.
    score += Math.trunc(((v.stars[g] - avgStars[g]) * w * 3) / 2);
  }
  for (const d of leaning.drives ?? []) score += v.drives.filter((x) => x === d).length * 3;
  if (leaning.styles?.includes(v.team.style)) score += 12;
  return score;
}

/**
 * How much a proposal helps one club (§B7). Integer. Positive = helps, negative = hurts.
 * favors − hurts, plus a standings term for targeted proposals.
 */
export function benefit(v: ClubView, p: SoccerProposal, avgStars: Record<SoccerStarGroup, number>): number {
  if (p.effect.kind === 'statusQuo') return 2; // a mild comfort in the known
  let score = leaningScore(v, p.favors, avgStars) - leaningScore(v, p.hurts, avgStars);
  if (p.targetClubIds?.includes(v.team.id)) {
    // Being the target is what matters most.
    if (p.effect.kind === 'sabotage') score -= 40;
    if (p.effect.kind === 'boost') score += 30;
    if (p.effect.kind === 'ejections') score += p.effect.count === 0 ? 35 : -40;
  } else if (p.effect.kind === 'sabotage' || p.effect.kind === 'boost') {
    // Everyone else: hurting a rival above you is good, helping one below is mildly bad.
    score += p.effect.kind === 'sabotage' ? 6 : -3;
  } else if (p.effect.kind === 'ejections') {
    // Clubs near the bottom fear more Ejections; safe clubs shrug.
    const danger = v.rank >= v.clubs - 3;
    score += p.effect.count === 0 ? (danger ? 20 : -2) : danger ? -20 : 2;
  }
  return score;
}

export const averageStars = (views: ClubView[]): Record<SoccerStarGroup, number> =>
  Object.fromEntries(
    (Object.keys(SOCCER_STAR_GROUPS) as SoccerStarGroup[]).map((g) => [g, Math.trunc(views.reduce((s, v) => s + v.stars[g], 0) / Math.max(1, views.length))]),
  ) as Record<SoccerStarGroup, number>;

/** A club's vote budget scales with its fan base. */
export const clubBudget = (fanSize: number) => Math.max(10, Math.trunc(fanSize / 2));

/** Split a club's budget: everything on positive-benefit proposals, weighted, plus a little seeded spread. */
export function clubSplit(scores: number[], budget: number, seedParts: (string | number)[]): number[] {
  const rng = createRng(...seedParts);
  const best = Math.max(...scores);
  // Fans pile into what helps them most; anything not positive gets nothing.
  const weights = scores.map((s) => (s > 0 ? s * s + rng.int(4) : 0) + (s === best && s > 0 ? best * best : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) {
    // Nothing helps: back the least-bad option.
    const i = scores.indexOf(best);
    return scores.map((_, j) => (j === i ? budget : 0));
  }
  const votes = weights.map((w) => Math.floor((budget * w) / total));
  let left = budget - votes.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) votes[order[k % order.length][1]]++;
  return votes;
}

/** Ideological factions vote by lean, not club (§B7). */
export function factionSplitSoccer(f: Faction, proposals: SoccerProposal[], seedParts: (string | number)[]): number[] {
  const rng = createRng(...seedParts, f.id);
  const weights = proposals.map((p) => Math.max(1, 10 + (p.factionLean[f.id] ?? 0) * 6 + rng.int(2 + f.riskTolerance * 3)));
  const total = weights.reduce((a, b) => a + b, 0);
  const votes = weights.map((w) => Math.floor((FACTION_BUDGET * w) / total));
  let left = FACTION_BUDGET - votes.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) votes[order[k % order.length][1]]++;
  return votes;
}

function resolveTargets(def: SoccerProposalDef, standings: StandingRow[]): string[] | undefined {
  const ids = standings.map((r) => r.teamId);
  switch (def.target) {
    case 'bestRecord': return ids.slice(0, 1);
    case 'worstRecord': return ids.slice(-1);
    case 'bottomTwo': return ids.slice(-2);
    case 'bottomOne': return ids.slice(-1);
    default: return undefined;
  }
}

export interface ReturnCandidate {
  playerId: string;
  name: string;
}

/** Ballot: always the status quo, then 2–3 seeded proposals; sometimes a Return; sometimes a Director wildcard. */
export function generateSoccerProposals(standings: StandingRow[], seedParts: (string | number)[], returnable: ReturnCandidate[] = []): SoccerProposal[] {
  const rng = createRng(...seedParts, 'proposals');
  const pool = PROPOSAL_DEFS.filter((p) => p.type !== 'statusQuo');
  const picked: SoccerProposal[] = [{ ...PROPOSAL_DEFS.find((p) => p.type === 'statusQuo')! }];
  if (returnable.length && rng.chance(450)) {
    const r = rng.pick(returnable);
    picked.push({
      id: `return-${r.playerId}`, title: `Bring ${r.name} Back Up`, type: 'return',
      description: `Open the Sub-Levels for ${r.name}. They will come back changed.`,
      effect: { kind: 'return', playerId: r.playerId }, favors: {}, hurts: {},
      factionLean: { lore: 3, loyalists: 2, chaos: 1, purists: -1 },
    });
  }
  const used = new Set<string>();
  while (picked.length < PROPOSALS_PER_ELECTION && used.size < pool.length) {
    const def = rng.pick(pool);
    if (used.has(def.id)) continue;
    used.add(def.id);
    // One ejection-rule proposal per ballot at most.
    if (def.type === 'ejection' && picked.some((p) => p.type === 'ejection')) continue;
    picked.push({ ...def, targetClubIds: resolveTargets(def, standings) });
  }
  return picked;
}

export interface Coalition {
  proposal: number;
  clubs: string[];
  factions: string[];
}

/** Which clubs and factions are leaning toward each proposal (their largest share), for the coalition bars. */
export function coalitions(e: SoccerElection): Coalition[] {
  const top = (votes: number[]) => votes.indexOf(Math.max(...votes));
  return e.proposals.map((_, i) => ({
    proposal: i,
    clubs: Object.entries(e.clubVotes).filter(([, v]) => top(v) === i).map(([id]) => id),
    factions: Object.entries(e.factionVotes).filter(([, v]) => top(v) === i).map(([id]) => id),
  }));
}

export function electionTotals(e: SoccerElection): number[] {
  const totals = e.proposals.map(() => 0);
  for (const v of [...Object.values(e.clubVotes), ...Object.values(e.factionVotes), e.playerVotes]) v.forEach((n, i) => (totals[i] += n));
  return totals;
}

/** Winner: most votes; ties go to the earlier proposal (the status quo is first). */
export function electionWinner(totals: number[]): number {
  let best = 0;
  for (let i = 1; i < totals.length; i++) if (totals[i] > totals[best]) best = i;
  return best;
}

/** Coins to own `n` votes on one proposal in one election (quadratic). */
export const soccerVotesCost = (n: number) => votesCost(n, false);
