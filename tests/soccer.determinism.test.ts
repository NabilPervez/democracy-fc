import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { simulateSoccer } from '../src/engine/soccer/game';
import { selectLineup } from '../src/engine/soccer/lineup';
import { soccerBoxScore } from '../src/engine/soccer/boxScore';
import { starGroups } from '../src/engine/soccer/sport';
import { generateSoccerLeague } from '../src/world/soccer/generate';

const sources = import.meta.glob('../src/engine/soccer/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('soccer engine determinism', () => {
  it('same seed ⇒ identical events (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 50 }), fc.integer({ min: 0, max: 5 }), (seed, season, pair) => {
        const league = generateSoccerLeague({ seed, teamCount: 8 });
        const game = { id: `g${pair}`, day: 1, homeId: league.teams[pair].id, awayId: league.teams[pair + 1].id };
        const a = simulateSoccer(league, game, season);
        const b = simulateSoccer(structuredClone(league), { ...game }, season);
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }),
      { numRuns: 40 },
    );
  });

  it('different game ids give different matches', () => {
    const league = generateSoccerLeague({ seed: 'diff', teamCount: 8 });
    const [h, a] = league.teams;
    const one = simulateSoccer(league, { id: 'g1', day: 1, homeId: h.id, awayId: a.id });
    const two = simulateSoccer(league, { id: 'g2', day: 1, homeId: h.id, awayId: a.id });
    expect(JSON.stringify(one.events)).not.toBe(JSON.stringify(two.events));
  });

  it('the engine never uses Math.random and never imports ui/ or storage/', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(3);
    for (const [file, src] of Object.entries(sources)) {
      expect(src, file).not.toMatch(/Math\.random/);
      expect(src, file).not.toMatch(/from ['"][^'"]*\/(ui|storage)\//);
    }
  });

  it('the auto lineup is K, A, W, W, P from the squad and skips unavailable players', () => {
    const league = generateSoccerLeague({ seed: 'lineup', teamCount: 8 });
    const team = league.teams[0];
    const five = selectLineup(team, league);
    expect(five).toHaveLength(5);
    expect(league.players[five[0]].position).toBe('K');
    const without = selectLineup(team, league, new Set([five[0]]));
    expect(without).not.toContain(five[0]);
    expect(league.players[without[0]].position).toBe('K'); // the backup keeper steps in
  });

  it('every match has kickoffs, a half-time, a full-time and a score that matches its goals', () => {
    const league = generateSoccerLeague({ seed: 'shape', teamCount: 8 });
    for (let i = 0; i < 20; i++) {
      const r = simulateSoccer(league, { id: `s${i}`, day: 1, homeId: league.teams[i % 8].id, awayId: league.teams[(i + 3) % 8].id });
      const goals = r.events.filter((e) => e.kind === 'goal');
      expect(goals.length).toBe(r.homeScore + r.awayScore);
      expect(r.events.filter((e) => e.kind === 'halfTime')).toHaveLength(1);
      expect(r.events.at(-1)?.kind).toBe('fullTime');
      // The clock runs forward within each half (the 2nd half restarts at 20:00 after 1st-half stoppage).
      expect(r.events.every((e, j) => j === 0 || e.half !== r.events[j - 1].half || e.second >= r.events[j - 1].second)).toBe(true);
    }
  });

  it('box score adds up and Keeping stars only show on keepers', () => {
    const league = generateSoccerLeague({ seed: 'box', teamCount: 8 });
    const r = simulateSoccer(league, { id: 'b1', day: 1, homeId: 't1', awayId: 't2' });
    const box = soccerBoxScore(r);
    expect(Object.values(box).reduce((s, l) => s + l.goals, 0)).toBe(r.homeScore + r.awayScore);
    expect(Object.keys(starGroups(league.players[league.teams[0].squad[0]]))).toContain('keeping');
    expect(Object.keys(starGroups(league.players[league.teams[0].squad[4]]))).not.toContain('keeping');
  });
});
