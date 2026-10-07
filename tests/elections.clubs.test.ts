import { describe, expect, it } from 'vitest';
import type { SoccerTeam, Style } from '../src/engine/soccer/types';
import {
  averageStars, benefit, clubSplit, clubView, coalitions, electionTotals, electionWinner, PROPOSAL_DEFS, soccerVotesCost, type ClubView, type SoccerProposal,
} from '../src/world/soccer/elections';
import { generateSoccerLeague } from '../src/world/soccer/generate';
import {
  createSoccerWorld, currentElection, matchInputs, reduceSoccer, runSoccerCommand, soccerStandings, type SoccerSettings, type SoccerUniverse,
} from '../src/world/soccer/universe';

const settings = (p: Partial<SoccerSettings> = {}): SoccerSettings => ({
  name: 'Votes', seed: 'votes', leagueSize: 12, chaos: 'normal', timeMode: 'manual', dayLengthMinutes: 60, ...p,
});
const def = (id: string): SoccerProposal => ({ ...PROPOSAL_DEFS.find((p) => p.id === id)! });

/** Two identical clubs that differ only in Style. */
function twins(a: Style, b: Style): [ClubView, ClubView] {
  const league = generateSoccerLeague({ seed: 'twins', teamCount: 8 });
  const base = league.teams[0];
  const make = (style: Style): ClubView => clubView(league, { ...base, style } as SoccerTeam, []);
  return [make(a), make(b)];
}

describe('club fan-base voting (S6)', () => {
  it('a Long-Ball Siege club scores the Wind Tunnel rule higher than a Park-the-Bus club', () => {
    const [longBall, bus] = twins('longBallSiege', 'parkTheBus');
    const avg = averageStars([longBall, bus]);
    const wind = def('wind-tunnel');
    expect(benefit(longBall, wind, avg)).toBeGreaterThan(benefit(bus, wind, avg));
    // And the reverse for a rule built for defenders.
    const heavy = def('heavy-ball');
    expect(benefit(bus, heavy, avg)).toBeGreaterThan(benefit(longBall, heavy, avg));
  });

  it('the top club votes against "best record" sabotage; everyone else likes it', () => {
    const u = runSoccerCommand(createSoccerWorld('u', settings(), null, 0), { type: 'simDays', count: 8 }).state;
    const standings = soccerStandings(u);
    const top = standings[0].teamId;
    const proposals: SoccerProposal[] = [def('status-quo'), { ...def('sabotage-leader'), targetClubIds: [top] }, def('wall-goals-double')];
    const views = u.league.teams.map((t) => clubView(u.league, t, standings));
    const avg = averageStars(views);
    const topView = views.find((v) => v.team.id === top)!;
    const topScores = proposals.map((p) => benefit(topView, p, avg));
    expect(topScores[1]).toBeLessThan(0);
    expect(clubSplit(topScores, 40, ['t'])[1]).toBe(0);
    const others = views.filter((v) => v.team.id !== top).map((v) => benefit(v, proposals[1], avg));
    expect(others.every((n) => n > 0)).toBe(true);
  });

  it('the player’s coins measurably swing a close election', () => {
    // Find a ballot where the runner-up trails by an amount the starting coins can cover.
    for (let i = 0; i < 60; i++) {
      let u: SoccerUniverse = createSoccerWorld('u', settings({ seed: `swing-${i}` }), null, 0);
      const e = currentElection(u)!;
      const totals = electionTotals(e);
      const winner = electionWinner(totals);
      const order = totals.map((t, j) => [t, j]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const runnerUp = order[1][1];
      const need = totals[winner] - totals[runnerUp] + (runnerUp < winner ? 0 : 1);
      if (soccerVotesCost(need) > u.coins) continue;
      u = reduceSoccer(u, { type: 'votesBought', electionId: e.id, proposal: runnerUp, count: need });
      expect(u.coins).toBe(100 - soccerVotesCost(need));
      // Sim to the close of the ballot.
      const before = runSoccerCommand(createSoccerWorld('u', settings({ seed: `swing-${i}` }), null, 0), { type: 'simDays', count: 7 }).state;
      const after = runSoccerCommand(u, { type: 'simDays', count: 7 }).state;
      expect(before.elections[0].result!.winner).toBe(winner);
      expect(after.elections[0].result!.winner).toBe(runnerUp);
      return;
    }
    throw new Error('no close election found in 60 seeds');
  });

  it('every club and faction has a public lean, and coalitions list who backs what', () => {
    const u = createSoccerWorld('u', settings(), null, 0);
    const e = currentElection(u)!;
    expect(Object.keys(e.clubVotes)).toHaveLength(12);
    expect(Object.keys(e.factionVotes)).toHaveLength(6);
    const c = coalitions(e);
    expect(c.reduce((n, x) => n + x.clubs.length, 0)).toBe(12);
    expect(c.reduce((n, x) => n + x.factions.length, 0)).toBe(6);
  });

  it('elections open weekly and their rules reach the matches', () => {
    const u = runSoccerCommand(createSoccerWorld('u', settings({ seed: 'rules' }), null, 0), { type: 'simDays', count: 21 }).state;
    expect(u.elections.filter((e) => e.result).length).toBe(3);
    expect(currentElection(u)).not.toBeNull();
    // Force each kind of effect and check the match inputs.
    const g = u.schedule.find((x) => x.day === u.currentDay)!;
    const ruled: SoccerUniverse = {
      ...u,
      activeRules: [
        { proposalId: 'wall-goals-double', title: '', effect: { kind: 'goalValue', wall: 2 }, season: u.season, untilDay: u.currentDay + 3 },
        { proposalId: 'spot-kick-fourth', title: '', effect: { kind: 'spotKickFrom', fouls: 4 }, season: u.season, untilDay: u.currentDay + 3 },
        { proposalId: 'all-narrows', title: '', effect: { kind: 'arena', arenaId: 'narrows' }, season: u.season, untilDay: u.currentDay + 3 },
      ],
      clubEffects: [{ clubId: g.homeId, title: '', delta: { finishing: 6 }, matchesLeft: 2 }],
    };
    const { opts } = matchInputs(ruled, g);
    expect(opts.rules).toEqual({ wallGoalValue: 2, spotKickFrom: 4 });
    expect(opts.arenaId).toBe('narrows');
    expect(opts.teamDeltas?.[g.homeId]?.finishing).toBe(6);
    const sabotaged: SoccerUniverse = { ...ruled, activeRules: [], clubEffects: [{ clubId: g.awayId, title: '', arenaId: 'cold-room', matchesLeft: 3 }] };
    expect(matchInputs(sabotaged, g).opts.arenaId).toBe('cold-room');
  });

  it('a Return election brings a Vanished player back, changed', () => {
    let u = createSoccerWorld('u', settings({ seed: 'return', chaos: 'unhinged' }), null, 0);
    for (let d = 0; d < 60 && !u.vanished.length; d++) u = runSoccerCommand(u, { type: 'endDay' }).state;
    const gone = u.vanished[0];
    expect(gone).toBeDefined();
    const e = currentElection(u)!;
    const ballot = [...e.proposals, { id: `return-${gone.player.id}`, title: 'Bring them back', type: 'return' as const, description: '', effect: { kind: 'return' as const, playerId: gone.player.id }, favors: {}, hurts: {}, factionLean: {} }];
    u = { ...u, elections: u.elections.map((x) => (x.id === e.id ? { ...x, proposals: ballot, playerVotes: [...x.playerVotes, 0], clubVotes: Object.fromEntries(Object.entries(x.clubVotes).map(([k, v]) => [k, [...v, 0]])), factionVotes: Object.fromEntries(Object.entries(x.factionVotes).map(([k, v]) => [k, [...v, 0]])) } : x)), coins: 1_000_000 };
    u = reduceSoccer(u, { type: 'votesBought', electionId: e.id, proposal: ballot.length - 1, count: 300 });
    expect(currentElection(u)!.playerVotes.at(-1)).toBe(300);
    u = runSoccerCommand(u, { type: 'simDays', count: e.closesDay - u.currentDay + 1 }).state;
    const back = u.league.players[gone.player.id];
    expect(back).toBeDefined();
    expect(back.drive).not.toBe(gone.player.drive);
    expect(u.mods[gone.player.id]?.some((m) => m.untilDay === null)).toBe(true);
    expect(u.vanished.some((v) => v.player.id === gone.player.id)).toBe(false);
    expect(u.league.teams.find((t) => t.id === back.teamId)!.squad).toContain(gone.player.id);
  });
});
