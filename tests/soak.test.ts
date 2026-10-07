import { describe, expect, it } from 'vitest';
import { createSoccerWorld, runSoccerCommand, type SoccerUniverse } from '../src/world/soccer/universe';

describe('3-season soak', () => {
  it('three full seasons run cleanly and the save stays small', () => {
    let u: SoccerUniverse = createSoccerWorld('soak', { name: 'Soak', seed: 'soak', leagueSize: 12, chaos: 'weird', timeMode: 'manual', dayLengthMinutes: 60 }, null, 0);
    const t0 = performance.now();
    for (let guard = 0; guard < 20 && !(u.season === 3 && u.phase === 'offseason'); guard++) {
      u = runSoccerCommand(u, u.phase === 'offseason' ? { type: 'endDay' } : { type: 'simToSeasonEnd' }).state;
    }
    const ms = performance.now() - t0;
    expect(u.season).toBe(3);
    expect(u.archive).toHaveLength(3);
    for (const t of u.league.teams) {
      expect(t.squad).toHaveLength(8);
      for (const id of t.squad) expect(u.league.players[id]?.teamId).toBe(t.id);
    }
    expect(new Set(u.league.teams.map((t) => t.id)).size).toBe(12);
    expect(u.news.length).toBeLessThanOrEqual(150);
    const kb = JSON.stringify(u).length / 1024;
    console.log(`soak: ${Math.round(ms)} ms, ${Math.round(kb)} KB`);
    // Budget: a three-season save parses quickly on a phone.
    expect(kb).toBeLessThan(400);
  });
});
