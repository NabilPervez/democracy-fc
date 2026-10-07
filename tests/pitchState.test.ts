import { describe, expect, it } from 'vitest';
import { simulateSoccer } from '../src/engine/soccer/game';
import { generateSoccerLeague } from '../src/world/soccer/generate';
import { FLOOR, pitchStateAt, type PitchContext } from '../src/ui/pitch/pitchState';

const league = generateSoccerLeague({ seed: 'pitch', teamCount: 8 });
const matches = Array.from({ length: 30 }, (_, i) => {
  const g = { id: `p${i}`, day: 1, homeId: league.teams[i % 8].id, awayId: league.teams[(i + 3) % 8].id };
  const r = simulateSoccer(league, g, 1);
  const ctx: PitchContext = { homeId: g.homeId, awayId: g.awayId, lineups: r.lineups, viewClubId: g.awayId };
  return { r, ctx };
});

describe('pitchStateAt (S7)', () => {
  it('same events ⇒ same frames', () => {
    const { r, ctx } = matches[0];
    for (const i of [0, 10, 50, r.events.length - 1]) expect(pitchStateAt(r.events, i, ctx)).toEqual(pitchStateAt(structuredClone(r.events), i, { ...ctx }));
  });

  it('every event maps to a valid frame: ball and tokens on the floor, ten or fewer players, one ball carrier at most', () => {
    for (const { r, ctx } of matches) {
      r.events.forEach((_, i) => {
        const f = pitchStateAt(r.events, i, ctx);
        expect(f.ball.x).toBeGreaterThanOrEqual(0);
        expect(f.ball.x).toBeLessThanOrEqual(FLOOR.w);
        expect(f.ball.y).toBeGreaterThanOrEqual(0);
        expect(f.ball.y).toBeLessThanOrEqual(FLOOR.h);
        expect(f.tokens.length).toBe(10);
        expect(f.tokens.filter((t) => t.carrier).length).toBeLessThanOrEqual(1);
        for (const t of f.tokens) {
          expect(t.x).toBeGreaterThanOrEqual(0);
          expect(t.x).toBeLessThanOrEqual(FLOOR.w);
          expect(t.y).toBeGreaterThanOrEqual(0);
          expect(t.y).toBeLessThanOrEqual(FLOOR.h);
        }
      });
    }
  });

  it('the viewer’s club always attacks left → right: its keeper is on the left', () => {
    const { r, ctx } = matches[1];
    const f = pitchStateAt(r.events, 20, ctx);
    const keeper = f.tokens.find((t) => t.teamId === ctx.viewClubId && t.slot === 'K')!;
    const other = f.tokens.find((t) => t.teamId !== ctx.viewClubId && t.slot === 'K')!;
    expect(keeper.x).toBeLessThan(FLOOR.w / 2);
    expect(other.x).toBeGreaterThan(FLOOR.w / 2);
  });

  it('power plays show an empty dashed slot until the side is back to five', () => {
    const all = Array.from({ length: 400 }, (_, i) => {
      const g = { id: `pp${i}`, day: 1, homeId: league.teams[i % 8].id, awayId: league.teams[(i + 1) % 8].id };
      const r = simulateSoccer(league, g, 2);
      return { r, ctx: { homeId: g.homeId, awayId: g.awayId, lineups: r.lineups, viewClubId: g.homeId } };
    });
    const hit = all.find(({ r }) => r.events.some((e) => e.kind === 'powerPlay'));
    expect(hit).toBeDefined();
    const { r, ctx } = hit!;
    const at = r.events.findIndex((e) => e.kind === 'powerPlay');
    expect(pitchStateAt(r.events, at, ctx).tokens.filter((t) => t.empty)).toHaveLength(1);
    const end = r.events.findIndex((e, i) => i > at && e.kind === 'powerPlayEnd');
    if (end > 0) expect(pitchStateAt(r.events, end, ctx).tokens.filter((t) => t.empty)).toHaveLength(0);
  });

  it('subs replace the token, and banked shots draw a bank line', () => {
    const withSub = matches.find(({ r }) => r.events.some((e) => e.kind === 'sub' && e.inId))!;
    const i = withSub.r.events.findIndex((e) => e.kind === 'sub' && e.inId);
    const e = withSub.r.events[i];
    if (e.kind !== 'sub') throw new Error('unreachable');
    const f = pitchStateAt(withSub.r.events, i, withSub.ctx);
    expect(f.tokens.some((t) => t.id === e.inId)).toBe(true);
    expect(f.tokens.some((t) => t.id === e.outId)).toBe(false);
    const banked = matches.flatMap(({ r, ctx }) => r.events.map((ev, j) => ({ ev, j, r, ctx }))).find(({ ev }) => ev.kind === 'shot' && ev.wall)!;
    expect(pitchStateAt(banked.r.events, banked.j, banked.ctx).bank).toHaveLength(3);
  });

  it('scoreboard data: fouls reset at half-time, possessions count up, chips describe both teams', () => {
    const { r, ctx } = matches[2];
    const end = pitchStateAt(r.events, r.events.length - 1, ctx);
    const ht = r.events.findIndex((e) => e.half === 2);
    expect(pitchStateAt(r.events, ht, ctx).fouls).toEqual({ home: 0, away: 0 });
    expect(end.possession).toBeGreaterThan(50);
    expect(end.clock).toMatch(/^\d\d:\d\d$/);
    const mid = pitchStateAt(r.events, 40, ctx);
    expect(mid.chips[0].teamId).toBe(ctx.viewClubId);
    expect(mid.chips.every((c) => c.sub.length > 0)).toBe(true);
  });
});
