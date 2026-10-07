import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/engine/soccer/calibrate';
import { generateSoccerLeague } from '../src/world/soccer/generate';

describe('soccer calibration (PRD §B5, chaos = calm)', () => {
  it('1,000 seeded neutral matches land in the target bands', () => {
    const stats = calibrate(generateSoccerLeague({ seed: 'calibration', teamCount: 12 }), 1000);
    expect(stats.meanGoals).toBeGreaterThanOrEqual(5.5);
    expect(stats.meanGoals).toBeLessThanOrEqual(7.5);
    expect(stats.drawRate).toBeGreaterThanOrEqual(0.12);
    expect(stats.drawRate).toBeLessThanOrEqual(0.18);
    expect(stats.homeWinRate).toBeGreaterThanOrEqual(0.44);
    expect(stats.homeWinRate).toBeLessThanOrEqual(0.52);
    expect(stats.nilNilRate).toBeLessThan(0.02);
    expect(stats.meanShotsPerTeam).toBeGreaterThanOrEqual(18);
    expect(stats.meanShotsPerTeam).toBeLessThanOrEqual(28);
    expect(stats.meanChains).toBeGreaterThanOrEqual(90);
    expect(stats.meanChains).toBeLessThanOrEqual(120);
  });

  it('other league seeds stay near the bands (league make-up shifts scoring a little)', () => {
    for (const seed of ['cal-a', 'cal-b', 'cal-c']) {
      const stats = calibrate(generateSoccerLeague({ seed, teamCount: 12 }), 300);
      expect(stats.meanGoals).toBeGreaterThan(4.5);
      expect(stats.meanGoals).toBeLessThan(8.5);
      expect(stats.drawRate).toBeLessThan(0.25);
      expect(stats.nilNilRate).toBeLessThan(0.03);
    }
  });
});
