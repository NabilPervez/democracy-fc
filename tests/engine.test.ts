import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/engine/core/rng';
import { simulateGame } from '../src/engine/baseball/game';
import { computeStandings, generateSchedule, stars } from '../src/engine/season';
import { generateLeague } from '../src/world/generate';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng('abc');
    const b = createRng('abc');
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(Array.from({ length: 50 }, () => b.next()));
  });

  it('differs for different seeds', () => {
    expect(createRng('abc').next()).not.toEqual(createRng('abd').next());
  });

  it('int stays in range', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 10_000 }), (seed, n) => {
        const v = createRng(seed).int(n);
        return v >= 0 && v < n && Number.isInteger(v);
      }),
    );
  });
});

describe('world generator', () => {
  it('same seed ⇒ same league', () => {
    expect(generateLeague({ seed: 'ember-flux-123' })).toEqual(generateLeague({ seed: 'ember-flux-123' }));
  });

  it('builds 8 teams × 13 players with unique names', () => {
    const league = generateLeague({ seed: 'x' });
    expect(league.teams).toHaveLength(8);
    for (const t of league.teams) {
      expect(t.lineup).toHaveLength(9);
      expect(t.rotation).toHaveLength(4);
    }
    const players = Object.values(league.players);
    expect(players).toHaveLength(104);
    expect(new Set(players.map((p) => p.name)).size).toBe(104);
    for (const p of players) {
      for (const g of ['batting', 'pitching', 'baserunning', 'defense'] as const) {
        const s = stars(p, g);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('game engine', () => {
  const schedule = (seed: string) => {
    const league = generateLeague({ seed });
    return { league, games: generateSchedule(league.teams, 14) };
  };

  it('same seed ⇒ identical game results', () => {
    const { league, games } = schedule('determinism');
    expect(simulateGame(league, games[0])).toEqual(simulateGame(league, games[0]));
  });

  it('every game ends with a valid, untied result (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.nat(55), (seed, gameIndex) => {
        const { league, games } = schedule(seed);
        const r = simulateGame(league, games[gameIndex]);
        const last = r.events[r.events.length - 1];
        expect(last.kind).toBe('gameEnd');
        expect(r.awayScore).toBeGreaterThanOrEqual(0);
        expect(r.homeScore).toBeGreaterThanOrEqual(0);
        expect(r.awayScore).not.toBe(r.homeScore);
        expect(r.innings).toBeGreaterThanOrEqual(9);
        // Every completed half-inning ends with exactly 3 outs.
        r.events.forEach((e, i) => {
          if (e.kind === 'halfEnd') expect(r.events[i - 1].outs).toBe(3);
          expect(e.outs).toBeLessThanOrEqual(3);
          expect(e.balls).toBeLessThanOrEqual(3);
          expect(e.strikes).toBeLessThanOrEqual(2);
        });
        // Runs counted equal the final score.
        const runs = r.events.filter((e) => e.kind === 'run');
        expect(runs.filter((e) => e.kind === 'run' && e.teamId === r.homeId).length).toBe(r.homeScore);
      }),
      { numRuns: 60 },
    );
  });

  it('produces believable scoring on average', () => {
    const { league, games } = schedule('averages');
    const results = games.map((g) => simulateGame(league, g));
    const avg = results.reduce((s, r) => s + r.awayScore + r.homeScore, 0) / (results.length * 2);
    expect(avg).toBeGreaterThan(2);
    expect(avg).toBeLessThan(9);
  });
});

describe('season', () => {
  it('round robin: each team plays every other team once per cycle, one game per day', () => {
    const league = generateLeague({ seed: 's' });
    const games = generateSchedule(league.teams, 7);
    expect(games).toHaveLength(28);
    const pairs = new Set(games.map((g) => [g.awayId, g.homeId].sort().join('-')));
    expect(pairs.size).toBe(28);
    for (let day = 1; day <= 7; day++) {
      const teamsToday = games.filter((g) => g.day === day).flatMap((g) => [g.awayId, g.homeId]);
      expect(new Set(teamsToday).size).toBe(8);
    }
  });

  it('standings are consistent with results', () => {
    const league = generateLeague({ seed: 'st' });
    const results = generateSchedule(league.teams, 7).map((g) => simulateGame(league, g));
    const table = computeStandings(league.teams, results);
    expect(table.reduce((s, r) => s + r.wins, 0)).toBe(results.length);
    expect(table.reduce((s, r) => s + r.losses, 0)).toBe(results.length);
    for (let i = 1; i < table.length; i++) expect(table[i - 1].wins).toBeGreaterThanOrEqual(table[i].wins);
  });
});
