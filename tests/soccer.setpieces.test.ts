import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HALF_SECONDS, simulateSoccer } from '../src/engine/soccer/game';
import type { SoccerResult } from '../src/engine/soccer/types';
import { generateSoccerLeague } from '../src/world/soccer/generate';

const league = generateSoccerLeague({ seed: 'set-pieces', teamCount: 12 });
const match = (i: number, knockout = false): SoccerResult =>
  simulateSoccer(league, { id: `m${i}`, day: 1, homeId: league.teams[i % 12].id, awayId: league.teams[(i + 1 + (i % 11)) % 12 === i % 12 ? (i + 1) % 12 : (i + 1 + (i % 11)) % 12].id }, 1, { knockout });

/** Each second of a match as [goals for, seconds] for whichever team is short vs not. */
function powerPlayRates(results: SoccerResult[]) {
  let shortGoals = 0, shortSecs = 0, fullGoals = 0, fullSecs = 0;
  for (const r of results) {
    const windows: { teamId: string; from: number; to: number; half: number }[] = [];
    for (const e of r.events) {
      if (e.kind === 'powerPlay') windows.push({ teamId: e.teamId, from: e.second, to: e.untilSecond, half: e.half });
      if (e.kind === 'powerPlayEnd') {
        const w = windows.findLast((x) => x.teamId === e.teamId);
        if (w) w.to = Math.min(w.to, e.second);
      }
    }
    for (const w of windows) {
      w.to = Math.min(w.to, w.half === 1 ? HALF_SECONDS + 180 : 2 * HALF_SECONDS + 180);
      shortSecs += w.to - w.from;
      fullSecs += 2 * HALF_SECONDS - (w.to - w.from);
    }
    for (const e of r.events) {
      if (e.kind !== 'goal') continue;
      const w = windows.find((x) => x.teamId === e.teamId && e.second >= x.from && e.second <= x.to && e.half === x.half);
      if (w) shortGoals++;
      else if (windows.some((x) => x.teamId === e.teamId)) fullGoals++;
    }
  }
  return { shortRate: shortGoals / Math.max(1, shortSecs), fullRate: fullGoals / Math.max(1, fullSecs), windows: shortSecs };
}

describe('soccer set pieces, cards, injuries, momentum, shootouts (S4)', () => {
  const results = Array.from({ length: 3000 }, (_, i) => match(i));

  it('a red card measurably reduces that team’s scoring while it is short', () => {
    const { shortRate, fullRate, windows } = powerPlayRates(results);
    expect(windows).toBeGreaterThan(10_000);
    expect(shortRate).toBeLessThan(fullRate * 0.8);
  });

  it('never more than one red-card power play running per team, and every card names a player on the floor', () => {
    for (const r of results.slice(0, 500)) {
      const open = new Set<string>();
      for (const e of r.events) {
        if (e.kind === 'powerPlay') {
          expect(open.has(e.teamId)).toBe(false);
          open.add(e.teamId);
        }
        if (e.kind === 'powerPlayEnd') open.delete(e.teamId);
      }
    }
  });

  it('momentum stays within −10..+10 and moves after goals', () => {
    let moved = 0;
    for (const r of results.slice(0, 300)) {
      for (const [i, e] of r.events.entries()) {
        expect(e.momentum).toBeGreaterThanOrEqual(-10);
        expect(e.momentum).toBeLessThanOrEqual(10);
        if (e.kind === 'goal' && i > 0 && r.events[i + 1] && r.events[i + 1].momentum !== r.events[i - 1].momentum) moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('injuries are reported in the result and the hurt player leaves the floor', () => {
    const hurt = results.filter((r) => Object.keys(r.injuries).length);
    expect(hurt.length).toBeGreaterThan(0);
    for (const r of hurt.slice(0, 50)) {
      for (const [id, n] of Object.entries(r.injuries)) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(4);
        const at = r.events.findIndex((e) => e.kind === 'injury' && e.playerId === id);
        const later = r.events.slice(at + 1).some((e) => (e.kind === 'shot' && e.playerId === id) || (e.kind === 'pass' && e.from === id));
        expect(later).toBe(false);
      }
    }
  });

  it('a knockout shootout always produces a winner (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (i) => {
        const r = match(i, true);
        const winner = r.shootout?.winnerId ?? (r.homeScore > r.awayScore ? r.homeId : r.awayScore > r.homeScore ? r.awayId : null);
        expect(winner).not.toBeNull();
        if (r.homeScore === r.awayScore) {
          expect(r.shootout).toBeDefined();
          expect(r.shootout!.home).not.toBe(r.shootout!.away);
          expect(r.shootout!.winnerId).toBe(winner);
        } else expect(r.shootout).toBeUndefined();
      }),
      { numRuns: 300 },
    );
  });

  it('league matches can still end level (no shootout)', () => {
    expect(results.some((r) => r.homeScore === r.awayScore && !r.shootout)).toBe(true);
  });
});
