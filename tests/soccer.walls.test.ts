import { describe, expect, it } from 'vitest';
import { ARENAS } from '../src/engine/soccer/arenas';
import { HALF_SECONDS, simulateSoccer } from '../src/engine/soccer/game';
import type { SoccerEvent, SoccerResult } from '../src/engine/soccer/types';
import { generateSoccerLeague } from '../src/world/soccer/generate';
import { applyRelations, AWAKENINGS_PER_SEASON, simulateSoccerSeason } from '../src/world/soccer/personality';

const league = generateSoccerLeague({ seed: 'walls', teamCount: 12 });
const fixture = (i: number) => {
  const h = i % 12;
  const a = (h + 1 + (Math.floor(i / 12) % 11)) % 12;
  return { id: `w${i}`, day: 1, homeId: league.teams[h].id, awayId: league.teams[a].id };
};
const run = (n: number, arenaId?: string) => Array.from({ length: n }, (_, i) => simulateSoccer(league, fixture(i), 1, { arenaId }));
const all = (rs: SoccerResult[]) => rs.flatMap((r) => r.events);
const count = (rs: SoccerResult[], f: (e: SoccerEvent) => boolean) => all(rs).filter(f).length;

const ALLOWED_KINDS = new Set([
  'lineups', 'kickoff', 'possession', 'pass', 'dribble', 'longBall', 'shot', 'goal', 'keeperRestart', 'tackle', 'teamFouls', 'freeKick', 'spotKick',
  'penalty', 'card', 'powerPlay', 'powerPlayEnd', 'injury', 'shootout', 'sub', 'halfTime', 'fullTime', 'transition', 'blockChange',
  'setPieceSetup', 'wallPass', 'scramble', 'signature', 'awakening', 'arenaShift',
]);

describe('walls, arenas and personality (S4c)', () => {
  const base = run(500, 'glass-box');

  it('never emits throw-ins, corners or goal kicks: the ball stays in the box', () => {
    for (const e of all(base)) expect(ALLOWED_KINDS.has(e.kind), e.kind).toBe(true);
    expect(all(base).some((e) => /throw|corner|goalKick/i.test(e.kind))).toBe(false);
  });

  it('wall passes, banked shots and scrambles all happen and resolve both ways', () => {
    const wp = all(base).filter((e) => e.kind === 'wallPass');
    expect(wp.some((e) => e.kind === 'wallPass' && e.success)).toBe(true);
    expect(wp.some((e) => e.kind === 'wallPass' && !e.success)).toBe(true);
    const banked = all(base).filter((e) => e.kind === 'shot' && e.wall);
    expect(banked.length).toBeGreaterThan(500);
    expect(banked.some((e) => e.kind === 'shot' && e.outcome === 'goal')).toBe(true);
    expect(banked.some((e) => e.kind === 'shot' && e.outcome === 'woodwork')).toBe(false);
    const scr = all(base).filter((e) => e.kind === 'scramble');
    expect(new Set(scr.map((e) => e.kind === 'scramble' && e.winnerTeamId === e.possessionTeamId)).size).toBe(2);
  });

  it('a power play raises the opponent scoring rate', () => {
    let ppGoals = 0, ppSecs = 0, goals = 0, secs = 0;
    for (let i = 0; i < 2500; i++) {
      const r = simulateSoccer(league, fixture(i), 2);
      const windows: { team: string; opp: string; from: number; to: number; half: number }[] = [];
      for (const e of r.events) {
        if (e.kind === 'powerPlay') windows.push({ team: e.teamId, opp: e.teamId === r.homeId ? r.awayId : r.homeId, from: e.second, to: e.untilSecond, half: e.half });
        if (e.kind === 'powerPlayEnd') {
          const w = windows.findLast((x) => x.team === e.teamId);
          if (w) w.to = Math.min(w.to, e.second);
        }
      }
      for (const w of windows) {
        w.to = Math.min(w.to, w.half * HALF_SECONDS + 180);
        ppSecs += w.to - w.from;
        secs += 2 * HALF_SECONDS - (w.to - w.from);
        for (const e of r.events) {
          if (e.kind !== 'goal' || e.teamId !== w.opp) continue;
          if (e.half === w.half && e.second >= w.from && e.second <= w.to) ppGoals++;
          else goals++;
        }
      }
    }
    expect(ppSecs).toBeGreaterThan(10_000);
    expect(ppGoals / ppSecs).toBeGreaterThan((goals / secs) * 1.2);
  });

  it('each arena moves its target stat in the expected direction over 500 matches', () => {
    const scr = (rs: SoccerResult[]) => count(rs, (e) => e.kind === 'scramble');
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const wallShotQ = (rs: SoccerResult[]) => avg(all(rs).flatMap((e) => (e.kind === 'shot' && e.wall ? [e.quality] : [])));
    const downhillEdge = (rs: SoccerResult[]) => {
      const down: number[] = [];
      const up: number[] = [];
      for (const r of rs) for (const e of r.events) if (e.kind === 'shot' && !e.wall) ((e.half === 1) === (e.possessionTeamId === r.homeId) ? down : up).push(e.quality);
      return avg(down) - avg(up);
    };
    const throughShare = (rs: SoccerResult[]) => {
      const adv = all(rs).filter((e) => e.kind === 'pass' && e.advanced);
      return adv.filter((e) => e.route === 'through').length / adv.length;
    };
    const subs = (rs: SoccerResult[]) => count(rs, (e) => e.kind === 'sub');
    const wallGoalRate = (rs: SoccerResult[]) => {
      const w = all(rs).filter((e) => e.kind === 'shot' && e.wall);
      return w.filter((e) => e.kind === 'shot' && e.outcome === 'goal').length / w.length;
    };
    const checks: Record<string, (a: SoccerResult[]) => boolean> = {
      'echo-chamber': (a) => wallShotQ(a) > wallShotQ(base) && scr(a) > scr(base),
      slope: (a) => downhillEdge(a) > downhillEdge(base) + 3,
      narrows: (a) => throughShare(a) < throughShare(base),
      octagon: (a) => scr(a) > scr(base) * 1.1,
      'cold-room': (a) => subs(a) > subs(base) * 1.3,
      'mirror-hall': (a) => wallGoalRate(a) > wallGoalRate(base),
      'the-pit': (a) => all(a).every((e) => e.momentum === 0) && all(base).some((e) => e.momentum !== 0),
      'rotating-floor': (a) => count(a, (e) => e.kind === 'arenaShift') > 1000 && scr(a) > scr(base),
    };
    for (const arena of ARENAS) {
      if (arena.id === 'glass-box') continue;
      expect(checks[arena.id], `no check for ${arena.id}`).toBeDefined();
      expect(checks[arena.id](run(500, arena.id)), arena.id).toBe(true);
    }
  });

  it('signature moves fire, at most twice per player per match', () => {
    const sigs = all(base).filter((e) => e.kind === 'signature');
    expect(sigs.length).toBeGreaterThan(50);
    for (const r of base) {
      const per: Record<string, number> = {};
      for (const e of r.events) if (e.kind === 'signature') per[e.playerId] = (per[e.playerId] ?? 0) + 1;
      for (const n of Object.values(per)) expect(n).toBeLessThanOrEqual(2);
    }
  });

  it('bonds form from assists between teammates, rivalries from fouls between opponents', () => {
    let l = league;
    for (const r of base.slice(0, 200)) l = applyRelations(l, r);
    const bonds = Object.values(l.players).flatMap((p) => Object.values(p.bonds ?? {}));
    const rivals = Object.values(l.players).flatMap((p) => Object.values(p.rivals ?? {}));
    expect(Math.max(...bonds)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...rivals)).toBeGreaterThanOrEqual(3);
    for (const p of Object.values(l.players)) {
      for (const id of Object.keys(p.bonds ?? {})) expect(l.players[id].teamId).toBe(p.teamId);
      for (const id of Object.keys(p.rivals ?? {})) expect(l.players[id].teamId).not.toBe(p.teamId);
    }
  });

  it('bonded and rival pairs change play once relations exist', () => {
    let l = league;
    for (const r of base) l = applyRelations(l, r);
    const later = Array.from({ length: 200 }, (_, i) => simulateSoccer(l, fixture(i), 3));
    expect(count(later, (e) => e.kind === 'pass' && !!e.bond)).toBeGreaterThan(0);
    expect(count(later, (e) => e.kind === 'dribble' && !!e.rivals)).toBeGreaterThan(0);
  });

  it(`at most ${AWAKENINGS_PER_SEASON} Awakenings per season over 20 seeds, and they do happen`, () => {
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const season = simulateSoccerSeason(generateSoccerLeague({ seed: `awaken-${i}`, teamCount: 12 }), 1);
      expect(season.awakenings.length).toBeLessThanOrEqual(AWAKENINGS_PER_SEASON);
      for (const id of season.awakenings) expect(season.league.players[id].awakened?.seasonId).toBe(1);
      total += season.awakenings.length;
    }
    expect(total).toBeGreaterThan(0);
  });
});
