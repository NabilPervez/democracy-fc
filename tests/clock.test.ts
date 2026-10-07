import { describe, expect, it } from 'vitest';
import { daysDue, MAX_CATCHUP_DAYS, msUntilNextDay, planCatchUp } from '../src/world/clock';

const HOUR = 60 * 60_000;

describe('Living time clock', () => {
  it('counts the days that have ended', () => {
    const clock = { anchorMs: 0, anchorDay: 1 };
    expect(daysDue(clock, 60, 1, HOUR - 1)).toBe(0);
    expect(daysDue(clock, 60, 1, HOUR)).toBe(1);
    expect(daysDue(clock, 60, 1, 5 * HOUR + 10)).toBe(5);
    expect(msUntilNextDay(clock, 60, 1, HOUR / 4)).toBe((3 * HOUR) / 4);
  });

  it('catches up at most a week, then pauses and restarts from now', () => {
    const clock = { anchorMs: 0, anchorDay: 1 };
    const plan = planCatchUp(clock, 60, 1, Infinity, 30 * HOUR);
    expect(plan.simulate).toBe(MAX_CATCHUP_DAYS);
    expect(plan.skipped).toBe(30 - MAX_CATCHUP_DAYS);
    expect(plan.nextClock(8)).toEqual({ anchorMs: 30 * HOUR, anchorDay: 8 });
  });

  it('keeps partial progress toward the next day when nothing was skipped', () => {
    const plan = planCatchUp({ anchorMs: 0, anchorDay: 1 }, 60, 1, Infinity, 2 * HOUR + 600);
    expect(plan.simulate).toBe(2);
    expect(plan.nextClock(3)).toEqual({ anchorMs: 2 * HOUR, anchorDay: 3 });
  });
});
