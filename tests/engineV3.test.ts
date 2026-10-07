import { describe, expect, it } from 'vitest';
import fingerprints from './fixtures/engine-v2-fingerprints.json';
import v10 from './fixtures/save-v10.json';
import v10Rest from './fixtures/save-v10-rest.json';
import { boxScore, fullLine, type StatLine } from '../src/engine/baseball/boxScore';
import { ENGINE_VERSION, simulateGame } from '../src/engine/baseball/game';
import { hashSeed } from '../src/engine/core/rng';
import { generateSchedule } from '../src/engine/season';
import type { GameEvent } from '../src/engine/baseball/types';
import { migrateSave } from '../src/storage/migrate';
import { generateLeague } from '../src/world/generate';
import { leaderboards } from '../src/world/leaders';
import { pickPayout, PICK_RATES } from '../src/world/picks';
import { createUniverse, runCommand, SAVE_VERSION } from '../src/world/universe';

describe('engine v3: frozen v2 and old saves', () => {
  it('the frozen v2 engine replays pre-Sprint-12 games exactly (50 fingerprinted games)', () => {
    const league = generateLeague({ seed: 'frozen-engine' });
    const games = generateSchedule(league.teams, 20).slice(0, 50);
    const now = games.map((g) => hashSeed(JSON.stringify(simulateGame(league, g, 3, 2).events)).join('.'));
    expect(now).toEqual(fingerprints.fingerprints);
  });

  it('a v10 save migrates to v11 and keeps its engine', () => {
    const u = migrateSave(structuredClone(v10));
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(11);
    expect(u.saveVersion).toBe(SAVE_VERSION);
    expect(u.engineVersion).toBe(2);
    for (const line of Object.values(u.seasonStats)) expect(line).toEqual(fullLine(line));
    expect(Object.values(u.seasonStats).every((l) => l.sb === 0 && l.e === 0 && l.wp === 0)).toBe(true);
  });

  it('a v10 mid-season save sims the rest of its season exactly as the old build did', () => {
    const u = migrateSave(structuredClone(v10));
    const end = runCommand(u, { type: 'simToSeasonEnd' }).state;
    const rest = Object.fromEntries(Object.entries(end.results).filter(([id]) => !u.results[id]).map(([id, r]) => [id, [r.awayScore, r.homeScore, r.innings]]));
    expect(rest).toEqual(v10Rest.results);
    const expected = Object.fromEntries(Object.entries(v10Rest.seasonStats as Record<string, Partial<StatLine>>).map(([id, l]) => [id, fullLine(l)]));
    expect(end.seasonStats).toEqual(expected);
  });

  it('switches to the new engine when the next season starts, never mid-season', () => {
    let u = migrateSave(structuredClone(v10));
    u = runCommand(u, { type: 'simToSeasonEnd' }).state;
    expect(u.engineVersion).toBe(2);
    u = runCommand(u, { type: 'endDay' }).state; // the offseason day rolls into Season 2
    expect(u.season).toBe(2);
    expect(u.engineVersion).toBe(ENGINE_VERSION);
  });

  it('new universes start on the new engine', () => {
    const u = createUniverse('n', { name: 'N', seed: 'n', leagueSize: 4, seasonLength: 20, chaos: 'normal', timeMode: 'manual', dayLengthMinutes: 60 }, 0);
    expect(u.engineVersion).toBe(ENGINE_VERSION);
  });
});

describe('engine v3: new events', () => {
  const sample = (() => {
    const out: { events: GameEvent[]; homeId: string; awayId: string; gameId: string }[] = [];
    for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      const league = generateLeague({ seed });
      for (const g of generateSchedule(league.teams, 100).slice(0, 100)) out.push(simulateGame(league, g));
    }
    return out;
  })();
  const perTeamGame = (kind: string) => sample.reduce((n, r) => n + r.events.filter((e) => e.kind === kind).length, 0) / (2 * sample.length);

  it('is deterministic for the same seed', () => {
    const league = generateLeague({ seed: 'det' });
    const g = generateSchedule(league.teams, 4)[0];
    expect(simulateGame(league, g)).toEqual(simulateGame(league, g));
  });

  it('every new event rate falls inside its PRD band over 500 seeded games', () => {
    expect(sample).toHaveLength(500);
    const bands: Record<string, [number, number]> = {
      stealAttempt: [0.5, 0.8],
      pickoff: [0.05, 0.1],
      error: [0.4, 0.7],
      doublePlay: [0.6, 1.0],
      wildPitch: [0.2, 0.4],
      hitByPitch: [0.3, 0.5],
    };
    for (const [kind, [lo, hi]] of Object.entries(bands)) {
      const rate = perTeamGame(kind);
      expect(rate, kind).toBeGreaterThanOrEqual(lo);
      expect(rate, kind).toBeLessThanOrEqual(hi);
    }
    const steals = sample.flatMap((r) => r.events.filter((e) => e.kind === 'stealAttempt'));
    const success = steals.filter((e) => e.kind === 'stealAttempt' && e.success).length / steals.length;
    expect(success).toBeGreaterThan(0.62);
    expect(success).toBeLessThan(0.78);
  });

  it('the box score agrees with the event stream', () => {
    for (const r of sample.slice(0, 100)) {
      const box = Object.values(boxScore({ ...r, awayScore: 0, homeScore: 0, innings: 9 }));
      const count = (k: string, f?: (e: GameEvent) => boolean) => r.events.filter((e) => e.kind === k && (!f || f(e))).length;
      const sum = (f: (s: StatLine) => number) => box.reduce((n, s) => n + f(s), 0);
      expect(sum((s) => s.sb)).toBe(count('stealAttempt', (e) => e.kind === 'stealAttempt' && e.success));
      expect(sum((s) => s.cs)).toBe(count('stealAttempt', (e) => e.kind === 'stealAttempt' && !e.success) + count('pickoff'));
      expect(sum((s) => s.e)).toBe(count('error'));
      expect(sum((s) => s.gidp)).toBe(count('doublePlay'));
      expect(sum((s) => s.wp)).toBe(count('wildPitch'));
      expect(sum((s) => s.hbp)).toBe(count('hitByPitch'));
      // Plate appearances: only ones that resolved (an inning can end on the bases mid-at-bat).
      const resolved = ['walk', 'strikeout', 'hit', 'out', 'error', 'doublePlay', 'hitByPitch'].reduce((n, k) => n + count(k), 0);
      expect(sum((s) => s.pa)).toBe(resolved);
      // Outs: every out the pitchers recorded.
      const outs = r.events.filter((e) => e.kind === 'halfEnd').length * 3;
      expect(sum((s) => s.outs)).toBeGreaterThanOrEqual(outs);
    }
  });

  it('errors and double plays name a real fielder from the fielding team', () => {
    const league = generateLeague({ seed: 'r1' });
    for (const g of generateSchedule(league.teams, 100).slice(0, 100)) {
      const r = simulateGame(league, g);
      for (const e of r.events) {
        if (e.kind !== 'error' && e.kind !== 'doublePlay' && e.kind !== 'out') continue;
        const fielding = e.half === 'top' ? r.homeId : r.awayId;
        expect(league.players[e.fielderId!].teamId).toBe(fielding);
        expect(league.players[e.fielderId!].position).not.toBe('DH');
      }
    }
  });
});

describe('engine v3: picks and leaders', () => {
  const league = generateLeague({ seed: 'picks' });
  const [hitter, pitcher] = [league.teams[0].lineup[0], league.teams[0].rotation[0]];
  const line = (p: Partial<StatLine>) => fullLine({ g: 1, ...p });

  it('backed hitter earns per stolen base', () => {
    const [l] = pickPayout({ back: [hitter], fade: [] }, { [hitter]: line({ ab: 4, h: 1, sb: 2 }) }, league);
    expect(l.amount).toBe(PICK_RATES.backHit + 2 * PICK_RATES.backSteal);
    expect(l.why).toContain('2 SB');
  });

  it('faded hitter earns when caught stealing or grounding into a double play', () => {
    const [l] = pickPayout({ back: [], fade: [hitter] }, { [hitter]: line({ ab: 2, h: 1, cs: 1, gidp: 1 }) }, league);
    expect(l.amount).toBe(2 * PICK_RATES.fadeCaught);
  });

  it('faded pitcher earns per wild pitch', () => {
    const [l] = pickPayout({ back: [], fade: [pitcher] }, { [pitcher]: line({ wp: 3 }) }, league);
    expect(l.amount).toBe(3 * PICK_RATES.fadeWildPitch);
  });

  it('old stat lines without the new fields still pay as before', () => {
    const old = { ...line({ ab: 4, h: 2 }) } as Partial<StatLine>;
    delete old.sb;
    const [l] = pickPayout({ back: [hitter], fade: [] }, { [hitter]: old as StatLine }, league);
    expect(l.amount).toBe(2 * PICK_RATES.backHit);
  });

  it('leaderboards include stolen bases and fielding (fewest errors per game, minimum games)', () => {
    const [a, b, c] = league.teams[0].lineup;
    const stats = { [a]: line({ g: 10, sb: 5, e: 0 }), [b]: line({ g: 10, sb: 1, e: 3 }), [c]: line({ g: 1, e: 0 }) };
    const { hitters } = leaderboards(stats, league, 10);
    expect(hitters.find((x) => x.id === 'sb')!.rows.map((r) => r.playerId)).toEqual([a, b]);
    const fielding = hitters.find((x) => x.id === 'fielding')!.rows.map((r) => r.playerId);
    expect(fielding).toEqual([a, b]); // c hasn't played enough games
  });
});
