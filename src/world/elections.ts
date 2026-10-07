import { createRng } from '../engine/core/rng';
import type { League, RatingKey } from '../engine/baseball/types';
import { FACTION_BUDGET, type Faction, type Tag } from './factions';

/** Weekly elections (PRD §6–7). Proposals are data; their effects are applied to the league. */

export const ELECTION_LENGTH_DAYS = 7;
export const ORGANIZER_DISCOUNT_PCT = 20;

export type ProposalEffect =
  | { kind: 'statusQuo' }
  | { kind: 'teamBoost'; teamId: string; keys: RatingKey[]; amount: number }
  | { kind: 'leagueBoost'; keys: RatingKey[]; amount: number }
  | { kind: 'trade'; teamA: string; teamB: string; slot: number }
  /** Bring a departed player back. The only way anyone ever returns. */
  | { kind: 'resurrect'; playerId: string };

export interface Proposal {
  title: string;
  description: string;
  tags: Partial<Record<Tag, number>>;
  /** Teams this proposal helps (+) or hurts (-), for factions' favorite-team reactions. */
  teamImpact: Record<string, number>;
  effect: ProposalEffect;
}

export interface Election {
  id: number;
  season: number;
  openedDay: number;
  closesDay: number;
  proposals: Proposal[];
  /** factionId → votes per proposal, decided when the election opens (public leanings). */
  factionVotes: Record<string, number[]>;
  playerVotes: number[];
  coinsSpent: number;
  result: { winner: number; totals: number[] } | null;
}

/** What a faction is allowed to know. No ratings, no RNG, no future. */
export interface FactionView {
  standings: { teamId: string; wins: number; losses: number }[];
  proposal: Proposal;
}

/** Total coins for owning `n` votes in one election: n². */
export const votesCost = (n: number, organizer: boolean) => {
  const base = n * n;
  return organizer ? Math.ceil((base * (100 - ORGANIZER_DISCOUNT_PCT)) / 100) : base;
};

/** Coins to go from `have` to `have + more` votes. */
export const marginalCost = (have: number, more: number, organizer: boolean) => votesCost(have + more, organizer) - votesCost(have, organizer);

export function factionScore(f: Faction, view: FactionView): number {
  // Fans like something new to talk about, so any change starts slightly ahead of the status quo.
  let score = view.proposal.effect.kind === 'statusQuo' ? 10 : 13;
  for (const [tag, v] of Object.entries(view.proposal.tags) as [Tag, number][]) score += (f.prefs[tag] ?? 0) * v * 3;
  for (const teamId of f.favoriteTeams) score += (view.proposal.teamImpact[teamId] ?? 0) * 8;
  return Math.max(1, score);
}

/** Split a faction's fixed budget across proposals by preference (+ a little seeded spread). */
export function factionSplit(f: Faction, views: FactionView[], seedParts: (string | number)[]): number[] {
  const rng = createRng(...seedParts, f.id);
  const weights = views.map((v) => factionScore(f, v) + rng.int(2 + f.riskTolerance * 3));
  const total = weights.reduce((a, b) => a + b, 0);
  const votes = weights.map((w) => Math.floor((FACTION_BUDGET * w) / total));
  let left = FACTION_BUDGET - votes.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) votes[order[k % order.length][1]]++;
  return votes;
}

const teamLabel = (league: League, id: string) => {
  const t = league.teams.find((x) => x.id === id)!;
  return `${t.city} ${t.name}`;
};

/** Generate 3 proposals: always "Keep things as they are" plus two from the pool, using public standings. */
export interface DepartedRef {
  playerId: string;
  name: string;
  teamId: string;
}

/** Chance (per mille) an election offers to bring back one of the Departed, when any exist. */
export const RESURRECTION_OFFER_PM = 450;

export function generateProposals(league: League, standings: FactionView['standings'], seedParts: (string | number)[], departed: DepartedRef[] = [], resurrectionPm = RESURRECTION_OFFER_PM): Proposal[] {
  const rng = createRng(...seedParts, 'proposals');
  const leader = standings[0].teamId;
  const last = standings[standings.length - 1].teamId;
  const randomTeam = () => rng.pick(league.teams).id;

  const pool: (() => Proposal)[] = [
    () => {
      const t = randomTeam();
      return {
        title: `Batting Practice for the ${teamLabel(league, t)}`,
        description: 'Their whole lineup gets +6 contact and power.',
        tags: { power: 1 },
        teamImpact: { [t]: 1 },
        effect: { kind: 'teamBoost', teamId: t, keys: ['contact', 'power'], amount: 6 },
      };
    },
    () => ({
      title: `Hand Up to the ${teamLabel(league, last)}`,
      description: 'The last-place team gets +5 to every rating.',
      tags: { underdog: 2, order: 1 },
      teamImpact: { [last]: 1 },
      effect: { kind: 'teamBoost', teamId: last, keys: ['contact', 'power', 'discipline', 'velocity', 'control', 'stuff', 'speed', 'defense'], amount: 5 },
    }),
    () => ({
      title: `Humble the ${teamLabel(league, leader)}`,
      description: 'The first-place team loses 5 velocity, control and stuff.',
      tags: { underdog: 1, chaos: 1 },
      teamImpact: { [leader]: -1 },
      effect: { kind: 'teamBoost', teamId: leader, keys: ['velocity', 'control', 'stuff'], amount: -5 },
    }),
    () => ({
      title: 'Juiced Balls',
      description: 'Every batter in the league gets +5 power.',
      tags: { power: 2, chaos: 1 },
      teamImpact: {},
      effect: { kind: 'leagueBoost', keys: ['power'], amount: 5 },
    }),
    () => ({
      title: 'Dead Balls',
      description: 'Every batter in the league loses 4 power. Pitchers rejoice.',
      tags: { pitching: 2, order: 1, power: -1 },
      teamImpact: {},
      effect: { kind: 'leagueBoost', keys: ['power'], amount: -4 },
    }),
    () => ({
      title: 'Greased Basepaths',
      description: 'Every player gets +6 speed.',
      tags: { chaos: 1, power: 1 },
      teamImpact: {},
      effect: { kind: 'leagueBoost', keys: ['speed'], amount: 6 },
    }),
    () => {
      const a = randomTeam();
      let b = randomTeam();
      while (b === a) b = randomTeam();
      const slot = rng.int(9);
      const pa = league.players[league.teams.find((t) => t.id === a)!.lineup[slot]];
      const pb = league.players[league.teams.find((t) => t.id === b)!.lineup[slot]];
      return {
        title: `The ${pa.position} Swap`,
        description: `${pa.name} (${teamLabel(league, a)}) and ${pb.name} (${teamLabel(league, b)}) trade places.`,
        tags: { chaos: 2, history: 1 },
        teamImpact: { [a]: -1, [b]: -1 },
        effect: { kind: 'trade', teamA: a, teamB: b, slot },
      };
    },
  ];

  const first = rng.int(pool.length);
  let second = rng.int(pool.length - 1);
  if (second >= first) second++;
  const firstProposal = pool[first]();
  let third = pool[second]();
  if (departed.length && rng.chance(resurrectionPm)) {
    const d = rng.pick(departed);
    third = {
      title: `Bring Back ${d.name}`,
      description: `${d.name} returns from the Departed to the ${teamLabel(league, d.teamId)}. They will come back changed.`,
      tags: { history: 2, chaos: 1 },
      teamImpact: { [d.teamId]: 1 },
      effect: { kind: 'resurrect', playerId: d.playerId },
    };
  }
  return [
    {
      title: 'Keep Things As They Are',
      description: 'No change. The game stays as it is.',
      tags: { order: 1 },
      teamImpact: {},
      effect: { kind: 'statusQuo' },
    },
    firstProposal,
    third,
  ];
}

export function openElection(
  league: League,
  factions: Faction[],
  standings: FactionView['standings'],
  id: number,
  season: number,
  openedDay: number,
  lastDay: number,
  departed: DepartedRef[] = [],
  /** The Historian's Level 2 raises this. */
  resurrectionPm = RESURRECTION_OFFER_PM,
): Election {
  const seedParts = [league.seed, season, 'election', id];
  const proposals = generateProposals(league, standings, seedParts, departed, resurrectionPm);
  const views = proposals.map((proposal) => ({ standings, proposal }));
  return {
    id,
    season,
    openedDay,
    closesDay: Math.min(openedDay + ELECTION_LENGTH_DAYS - 1, lastDay),
    proposals,
    factionVotes: Object.fromEntries(factions.map((f) => [f.id, factionSplit(f, views, seedParts)])),
    playerVotes: proposals.map(() => 0),
    coinsSpent: 0,
    result: null,
  };
}

export const playerVoteTotal = (e: Election) => e.playerVotes.reduce((a, b) => a + b, 0);

export function tally(e: Election): number[] {
  const totals = [...e.playerVotes];
  for (const votes of Object.values(e.factionVotes)) votes.forEach((v, i) => (totals[i] += v));
  return totals;
}

/** Highest total wins; ties go to the status quo (index 0), then the earlier proposal. */
export function winnerOf(totals: number[]): number {
  let best = 0;
  totals.forEach((t, i) => {
    if (t > totals[best]) best = i;
  });
  return best;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 100 ? 100 : v);

/** Apply a winning proposal to the league. Returns the new league and life-timeline notes. */
export function applyEffect(league: League, effect: ProposalEffect): { league: League; notes: { playerId: string; text: string }[] } {
  const players = { ...league.players };
  const notes: { playerId: string; text: string }[] = [];
  const bump = (id: string, keys: RatingKey[], amount: number) => {
    const p = players[id];
    const ratings = { ...p.ratings };
    for (const k of keys) ratings[k] = clamp(ratings[k] + amount);
    players[id] = { ...p, ratings };
  };

  switch (effect.kind) {
    case 'statusQuo':
    case 'resurrect': // handled by the universe, which owns the Departed
      return { league, notes };
    case 'teamBoost': {
      const t = league.teams.find((x) => x.id === effect.teamId)!;
      for (const id of [...t.lineup, ...t.rotation]) bump(id, effect.keys, effect.amount);
      return { league: { ...league, players }, notes };
    }
    case 'leagueBoost':
      for (const id of Object.keys(players)) bump(id, effect.keys, effect.amount);
      return { league: { ...league, players }, notes };
    case 'trade': {
      const a = league.teams.find((x) => x.id === effect.teamA)!;
      const b = league.teams.find((x) => x.id === effect.teamB)!;
      const pa = a.lineup[effect.slot];
      const pb = b.lineup[effect.slot];
      players[pa] = { ...players[pa], teamId: b.id };
      players[pb] = { ...players[pb], teamId: a.id };
      notes.push({ playerId: pa, text: `Traded to the ${b.city} ${b.name} by election.` });
      notes.push({ playerId: pb, text: `Traded to the ${a.city} ${a.name} by election.` });
      const teams = league.teams.map((t) => {
        if (t.id === a.id) return { ...t, lineup: t.lineup.map((id, i) => (i === effect.slot ? pb : id)) };
        if (t.id === b.id) return { ...t, lineup: t.lineup.map((id, i) => (i === effect.slot ? pa : id)) };
        return t;
      });
      return { league: { ...league, teams, players }, notes };
    }
  }
}
