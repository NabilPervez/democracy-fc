import { describe, expect, it } from 'vitest';
import { simulateSoccer } from '../src/engine/soccer/game';
import { TACTICS } from '../src/engine/soccer/tactics';
import type { SoccerEvent, SoccerResult, TacticId } from '../src/engine/soccer/types';
import { generateSoccerLeague } from '../src/world/soccer/generate';
import { ballotVoteCost, CAPTAIN_BONUS, matchdayVotesCost } from '../src/world/soccer/matchday';
import {
  ballotError, createSoccerWorld, matchBallot, reduceAllSoccer, reduceSoccer, runSoccerCommand, type SoccerSettings, type SoccerUniverse,
} from '../src/world/soccer/universe';

const league = generateSoccerLeague({ seed: 'tactics', teamCount: 12 });
const fixture = (i: number) => {
  const h = i % 12;
  const a = (h + 1 + (Math.floor(i / 12) % 11)) % 12;
  return { id: `t${i}`, day: 1, homeId: league.teams[h].id, awayId: league.teams[a].id };
};
/** 500 matches where the home side plays `tactic` (or nothing) and the away side plays `away` (or nothing). */
const run = (tactic?: TacticId, away?: TacticId, disableCounters = false) =>
  Array.from({ length: 500 }, (_, i) => {
    const g = fixture(i);
    return simulateSoccer(league, g, 1, { matchday: { [g.homeId]: { tactic }, [g.awayId]: { tactic: away } }, disableCounters });
  });
const homeEvents = (rs: SoccerResult[], f: (e: SoccerEvent) => boolean) => rs.reduce((n, r) => n + r.events.filter((e) => e.possessionTeamId === r.homeId && f(e)).length, 0);
const awayEvents = (rs: SoccerResult[], f: (e: SoccerEvent) => boolean) => rs.reduce((n, r) => n + r.events.filter((e) => e.possessionTeamId === r.awayId && f(e)).length, 0);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

const settings = (p: Partial<SoccerSettings> = {}): SoccerSettings => ({
  name: 'Ballot', seed: 'ballot', leagueSize: 12, chaos: 'calm', timeMode: 'manual', dayLengthMinutes: 60, ...p,
});

describe('Matchday Ballot (S6b)', () => {
  const none = run();

  it('each tactic moves its target stat in the right direction over 500 matches', () => {
    const shots = (rs: SoccerResult[]) => homeEvents(rs, (e) => e.kind === 'shot');
    const passes = (rs: SoccerResult[]) => homeEvents(rs, (e) => e.kind === 'pass');
    const oppShotQ = (rs: SoccerResult[]) => avg(rs.flatMap((r) => r.events.filter((e) => e.kind === 'shot' && e.possessionTeamId === r.awayId).map((e) => (e.kind === 'shot' ? e.quality : 0))));
    const breakaways = (rs: SoccerResult[]) => rs.reduce((n, r) => n + r.events.filter((e) => e.kind === 'transition' && e.wonBy === r.homeId && e.attChoice === 'counter').length, 0);
    const oppLostInBuildUp = (rs: SoccerResult[]) => awayEvents(rs, (e) => e.zone === 'def' && (e.kind === 'pass' || e.kind === 'dribble') && !e.success);
    const longBalls = (rs: SoccerResult[]) => homeEvents(rs, (e) => e.kind === 'longBall');
    const dribbles = (rs: SoccerResult[]) => homeEvents(rs, (e) => e.kind === 'dribble');
    const checks: Record<TacticId, (t: SoccerResult[]) => boolean> = {
      shootOnSight: (t) => shots(t) > shots(none) * 1.15,
      tikiTaka: (t) => passes(t) > passes(none) * 1.1,
      lockTheDoor: (t) => oppShotQ(t) < oppShotQ(none) - 3,
      counterBlitz: (t) => breakaways(t) > breakaways(none) * 1.2,
      highPress: (t) => oppLostInBuildUp(t) > oppLostInBuildUp(none) * 1.1,
      airRaid: (t) => longBalls(t) > longBalls(none) * 1.4,
      showtime: (t) => dribbles(t) > dribbles(none) * 1.3,
    };
    for (const t of TACTICS) expect(checks[t.id](run(t.id)), t.id).toBe(true);
  });

  it('a counter matchup gives a measurable edge', () => {
    // Away plays High Press, which beats the home side's Tiki-Taka.
    const points = (rs: SoccerResult[]) => rs.reduce((n, r) => n + (r.awayScore > r.homeScore ? 3 : r.awayScore === r.homeScore ? 1 : 0), 0);
    const goalDiff = (rs: SoccerResult[]) => rs.reduce((n, r) => n + r.awayScore - r.homeScore, 0);
    const withCounter = run('tikiTaka', 'highPress');
    const without = run('tikiTaka', 'highPress', true);
    expect(goalDiff(withCounter)).toBeGreaterThan(goalDiff(without));
    expect(points(withCounter)).toBeGreaterThan(points(without));
  });

  it('ballots resolve identically on replay', () => {
    let u: SoccerUniverse = createSoccerWorld('u', settings(), null, 0);
    const g = u.schedule.find((x) => x.day === 1 && (x.homeId === u.favoriteClubId || x.awayId === u.favoriteClubId))!;
    u = reduceSoccer(u, { type: 'ballotVote', gameId: g.id, question: 'tactic', option: 2, count: 3 });
    u = reduceSoccer(u, { type: 'ballotVote', gameId: g.id, question: 'captain', option: 1, count: 1 });
    const start = u;
    const { state, events } = runSoccerCommand(u, { type: 'simDays', count: 4 });
    expect(reduceAllSoccer(start, events)).toEqual(state);
    const again = runSoccerCommand(start, { type: 'simDays', count: 4 }).state;
    expect(again.results[g.id].ballot).toEqual(state.results[g.id].ballot);
  });

  it('skipping the ballot never blocks a match, and every result records both clubs’ ballots', () => {
    const { state } = runSoccerCommand(createSoccerWorld('u', settings({ seed: 'skip' }), null, 0), { type: 'simToSeasonEnd' });
    for (const r of Object.values(state.results)) {
      expect(Object.keys(r.ballot ?? {})).toEqual(expect.arrayContaining([r.homeId, r.awayId]));
      for (const [clubId, b] of Object.entries(r.ballot!)) {
        expect(TACTICS.some((t) => t.id === b.tactic)).toBe(true);
        // Ejected clubs' players are gone; everyone else's captain is still around (or in the Sub-Level Archive).
        if (!state.league.teams.some((t) => t.id === clubId)) continue;
        expect(!!state.league.players[b.captainId] || state.vanished.some((v) => v.player.id === b.captainId), b.captainId).toBe(true);
      }
    }
  });

  it('the player’s votes swing their own club’s ballot; the first vote is free, extras cost n²', () => {
    let u: SoccerUniverse = createSoccerWorld('u', settings({ seed: 'swing' }), null, 0);
    const g = u.schedule.find((x) => x.day === 1 && (x.homeId === u.favoriteClubId || x.awayId === u.favoriteClubId))!;
    const b = matchBallot(u, g.id, u.favoriteClubId);
    const fansPick = b.fans.tactic.indexOf(Math.max(...b.fans.tactic));
    const target = (fansPick + 1) % 3;
    const need = b.fans.tactic[fansPick] - b.fans.tactic[target] + 1;
    expect(ballotVoteCost([0, 0, 0], 1)).toBe(0);
    expect(ballotVoteCost([0, 0, 0], need)).toBe(matchdayVotesCost(need - 1));
    u = { ...u, coins: 10_000 };
    u = reduceSoccer(u, { type: 'ballotVote', gameId: g.id, question: 'tactic', option: target, count: need });
    expect(u.coins).toBe(10_000 - matchdayVotesCost(need - 1));
    const after = runSoccerCommand(u, { type: 'playGame', gameId: g.id }).state;
    expect(after.results[g.id].ballot![u.favoriteClubId].tactic).toBe(b.options.tactics[target]);
    expect(after.news.some((n) => n.text.startsWith('The fans have spoken'))).toBe(true);
  });

  it('only the player’s club ballot is open to them, and it closes at kickoff', () => {
    const u = createSoccerWorld('u', settings({ seed: 'rules' }), null, 0);
    const other = u.schedule.find((x) => x.day === 1 && x.homeId !== u.favoriteClubId && x.awayId !== u.favoriteClubId)!;
    expect(ballotError(u, other.id, 'tactic', 0, 1)).toMatch(/own club/);
    const mine = u.schedule.find((x) => x.day === 1 && (x.homeId === u.favoriteClubId || x.awayId === u.favoriteClubId))!;
    const played = runSoccerCommand(u, { type: 'playGame', gameId: mine.id }).state;
    expect(ballotError(played, mine.id, 'tactic', 0, 1)).toMatch(/closed/);
  });

  it('Captain’s Bonus pays the fans who backed a captain who delivers', () => {
    let paid = 0;
    for (let i = 0; i < 30 && !paid; i++) {
      let u: SoccerUniverse = createSoccerWorld('u', settings({ seed: `cap-${i}` }), null, 0);
      const g = u.schedule.find((x) => x.day === 1 && (x.homeId === u.favoriteClubId || x.awayId === u.favoriteClubId))!;
      const b = matchBallot(u, g.id, u.favoriteClubId);
      const fansPick = b.fans.captain.indexOf(Math.max(...b.fans.captain));
      u = reduceSoccer(u, { type: 'ballotVote', gameId: g.id, question: 'captain', option: fansPick, count: 1 });
      const after = runSoccerCommand(u, { type: 'playGame', gameId: g.id }).state;
      paid = after.ledger.filter((l) => l.reason.startsWith("Captain's Bonus")).reduce((n, l) => n + l.amount, 0);
    }
    expect(paid).toBe(CAPTAIN_BONUS);
  });

  it('no Captain’s Bonus for a fan who backed a different captain', () => {
    let ran = 0;
    for (let i = 0; i < 30; i++) {
      let u: SoccerUniverse = createSoccerWorld('u', settings({ seed: `cap-${i}` }), null, 0);
      const g = u.schedule.find((x) => x.day === 1 && (x.homeId === u.favoriteClubId || x.awayId === u.favoriteClubId))!;
      const b = matchBallot(u, g.id, u.favoriteClubId);
      const fansPick = b.fans.captain.indexOf(Math.max(...b.fans.captain));
      const other = (fansPick + 1) % 3;
      // One vote on a captain the fans won't elect.
      if (b.fans.captain[fansPick] - b.fans.captain[other] < 2) continue;
      u = reduceSoccer(u, { type: 'ballotVote', gameId: g.id, question: 'captain', option: other, count: 1 });
      const after = runSoccerCommand(u, { type: 'playGame', gameId: g.id }).state;
      expect(after.results[g.id].ballot![u.favoriteClubId].youBackedCaptain).toBe(false);
      expect(after.ledger.some((l) => l.reason.startsWith("Captain's Bonus"))).toBe(false);
      ran++;
    }
    expect(ran).toBeGreaterThan(5);
  });
});

describe('recap cause lines', () => {
  it('every one of the fan’s matches gets a cause line that names their tactic vote', async () => {
    const { recapLines } = await import('../src/world/soccer/recap');
    const { state } = runSoccerCommand(createSoccerWorld('u', settings({ seed: 'recap', chaos: 'weird' }), null, 0), { type: 'simDays', count: 10 });
    const mine = Object.values(state.results).filter((r) => r.homeId === state.favoriteClubId || r.awayId === state.favoriteClubId);
    expect(mine.length).toBeGreaterThan(5);
    for (const r of mine) {
      const lines = recapLines(state, r);
      expect(lines[0]).toMatch(/^(Your .+ vote|The fans' .+ call) produced \d+% possession.*You (won|drew|lost)\.$/);
    }
  });
});
