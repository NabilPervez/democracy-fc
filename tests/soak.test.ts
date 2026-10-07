import { describe, expect, it } from 'vitest';
import { createUniverse, runCommand as runBaseball, type UniverseState } from '../src/world/universe';
import { createSoccerWorld, runSoccerCommand, type SoccerUniverse } from '../src/world/soccer/universe';

/**
 * S8 soak: three full seasons of each sport, back to back, on this machine (not a phone).
 * Load time is dominated by parsing the saved state, so save size stands in for it.
 */
function threeSeasons<S>(start: S, step: (s: S) => S, seasonOf: (s: S) => number, phaseOf: (s: S) => string): { state: S; ms: number } {
  const t0 = performance.now();
  let s = start;
  for (let guard = 0; guard < 2000 && !(seasonOf(s) === 3 && phaseOf(s) === 'offseason'); guard++) s = step(s);
  return { state: s, ms: performance.now() - t0 };
}

describe('3-season soak (S8)', () => {
  it('soccer runs three seasons cleanly; its save is no more than 20% bigger than baseball’s', () => {
    const soccer = threeSeasons<SoccerUniverse>(
      createSoccerWorld('soak', { name: 'Soak', seed: 'soak', leagueSize: 12, chaos: 'weird', timeMode: 'manual', dayLengthMinutes: 60 }, null, 0),
      (s) => (s.phase === 'offseason' ? runSoccerCommand(s, { type: 'endDay' }).state : runSoccerCommand(s, { type: 'simToSeasonEnd' }).state),
      (s) => s.season,
      (s) => s.phase,
    );
    const baseball = threeSeasons<UniverseState>(
      createUniverse('soak', { name: 'Soak', seed: 'soak', leagueSize: 12, seasonLength: 20, chaos: 'weird', timeMode: 'manual', dayLengthMinutes: 60 }, 0),
      (s) => (s.phase === 'offseason' ? runBaseball(s, { type: 'endDay' }).state : runBaseball(s, { type: 'simToSeasonEnd' }).state),
      (s) => s.season,
      (s) => s.phase,
    );
    const u = soccer.state;
    expect(u.season).toBe(3);
    expect(u.archive).toHaveLength(3);
    // Invariants after three seasons of Vanishings, Ejections and Returns.
    for (const t of u.league.teams) {
      expect(t.squad).toHaveLength(8);
      for (const id of t.squad) expect(u.league.players[id]?.teamId).toBe(t.id);
    }
    expect(new Set(u.league.teams.map((t) => t.id)).size).toBe(12);
    expect(u.news.length).toBeLessThanOrEqual(150);
    const soccerBytes = JSON.stringify(u).length;
    const baseballBytes = JSON.stringify(baseball.state).length;
    console.log(`soak: soccer ${Math.round(soccer.ms)} ms, ${Math.round(soccerBytes / 1024)} KB · baseball ${Math.round(baseball.ms)} ms, ${Math.round(baseballBytes / 1024)} KB`);
    expect(soccerBytes).toBeLessThanOrEqual(baseballBytes * 1.2);
  });
});
