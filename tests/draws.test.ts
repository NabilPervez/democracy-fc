import { describe, expect, it } from 'vitest';
import { baseballEngine } from '../src/engine/baseball/sport';
import { registerSport } from '../src/engine/core/registry';
import type { AnySportEngine } from '../src/engine/core/sport';
import { computeStandings, matchWinner } from '../src/engine/season';
import { gameOdds, withDraw } from '../src/engine/odds';
import { buildDigest } from '../src/world/digest';
import { createUniverse, DRAW_PICK, reduce, runCommand, standingsOf, type UniverseSettings } from '../src/world/universe';

/** S2 stub: a "soccer" engine where every match ends 1–1 with no events. */
const stubSoccer: AnySportEngine = {
  ...baseballEngine,
  id: 'soccer',
  allowsDraws: true,
  simulate: (league, game, ctx) => ({ ...baseballEngine.simulate(league, game, ctx), awayScore: 1, homeScore: 1, events: [] }),
};

const settings = (p: Partial<UniverseSettings> = {}): UniverseSettings => ({
  name: 'Draws', seed: 'draws', leagueSize: 8, seasonLength: 20, chaos: 'calm', timeMode: 'manual', dayLengthMinutes: 60, sport: 'soccer', ...p,
});

describe('draw support', () => {
  // Vitest isolates modules per file, so the stub never leaks into other suites.
  registerSport(stubSoccer);

  it('matchWinner returns null on level scores', () => {
    expect(matchWinner({ homeId: 'h', awayId: 'a', homeScore: 2, awayScore: 2 })).toBeNull();
    expect(matchWinner({ homeId: 'h', awayId: 'a', homeScore: 3, awayScore: 2 })).toBe('h');
  });

  it('standings count draws as 1 point each and rank by points, then goal difference', () => {
    const teams = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[];
    const table = computeStandings(teams, [
      { homeId: 'a', awayId: 'b', homeScore: 1, awayScore: 1 },
      { homeId: 'c', awayId: 'a', homeScore: 0, awayScore: 3 },
      { homeId: 'b', awayId: 'c', homeScore: 2, awayScore: 0 },
    ]);
    expect(table.map((r) => [r.teamId, r.wins, r.draws, r.losses, r.points])).toEqual([
      ['a', 1, 1, 0, 4], ['b', 1, 1, 0, 4], ['c', 0, 0, 2, 0],
    ]);
  });

  it('3-way odds sum to 1000 and keep the home/away ratio', () => {
    const two = gameOdds({ teamId: 'a', battingHalfStars: 50, pitcherHalfStars: 5, wins: 0, losses: 0 }, { teamId: 'h', battingHalfStars: 50, pitcherHalfStars: 5, wins: 0, losses: 0 });
    const three = withDraw(two, 200);
    expect(three.homePm + three.awayPm + three.drawPm).toBe(1000);
    expect(three.homePm).toBeGreaterThan(three.awayPm);
    expect(three.drawMult).toBeGreaterThan(1000);
  });

  it('a season of fixed draws flows through standings, predictions and the digest', () => {
    let u = createUniverse('d', settings(), 0);
    expect(u.sport).toBe('soccer');
    u = { ...u, persona: { ...(u.persona ?? {}), favoriteTeamId: u.league.teams[0].id } as never };
    const today = u.schedule.filter((g) => g.day === u.currentDay);
    const coins = u.coins;
    u = reduce(u, { type: 'betPlaced', gameId: today[0].id, teamId: DRAW_PICK, amount: 10 });
    u = reduce(u, { type: 'betPlaced', gameId: today[1].id, teamId: today[1].homeId, amount: 10 });
    const before = u;
    const res = runCommand(u, { type: 'simDays', count: 3 });
    const bets = res.state.bets;
    expect(bets.find((b) => b.teamId === DRAW_PICK)?.status).toBe('won');
    expect(bets.find((b) => b.gameId === today[1].id)?.status).toBe('lost');
    expect(res.state.coins).toBeGreaterThan(coins - 20);
    for (const row of standingsOf(res.state)) expect([row.wins, row.losses, row.draws, row.points]).toEqual([0, 0, 3, 3]);
    const digest = buildDigest(before, res.state, res.events);
    expect(digest.items.some((i) => i.text.includes('W–D–L'))).toBe(true);
  });
});
