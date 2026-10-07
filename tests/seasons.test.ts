import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { BlastballDB, loadUniverse, persistCommand, saveUniverse } from '../src/storage/db';
import { exportUniverse, importLeague } from '../src/storage/exportImport';
import { advancePlayoffs, retirementChance, startPlayoffs } from '../src/world/seasons';
import { rarityOf } from '../src/world/rarity';
import {
  createUniverse,
  currentElection,
  gameLeague,
  PATRON_BLESSING,
  PATRON_COST,
  patronError,
  reduce,
  regularResults,
  runCommand,
  standingsOf,
  type UniverseSettings,
  type UniverseState,
} from '../src/world/universe';

const settings = (p: Partial<UniverseSettings> = {}): UniverseSettings => ({
  name: 'Seasons', seed: 'season-seed', leagueSize: 8, seasonLength: 20, chaos: 'normal', timeMode: 'manual', dayLengthMinutes: 60, ...p,
});

describe('playoffs', () => {
  it('top 4 seeds: 1 v 4 and 2 v 3, best of 3, then a best-of-5 final', () => {
    const { playoffs, games } = startPlayoffs(['a', 'b', 'c', 'd', 'e', 'f'], 21);
    expect(playoffs.series.map((s) => [s.highSeed, s.lowSeed, s.bestOf])).toEqual([
      ['a', 'd', 3],
      ['b', 'c', 3],
    ]);
    expect(games).toHaveLength(2);
    // a and b sweep their semis in two games each.
    let p = playoffs;
    const winners: Record<string, string> = {};
    for (let day = 22; day <= 23; day++) {
      for (const s of p.series) for (const g of s.games) winners[g] ??= s.highSeed;
      p = advancePlayoffs(p, (g) => winners[g] ?? null, day).playoffs;
    }
    const final = p.series.find((s) => s.round === 2)!;
    expect([final.highSeed, final.lowSeed, final.bestOf]).toEqual(['a', 'b', 5]);
  });

  it('a 4-team league goes straight to a best-of-5 final', () => {
    const { playoffs } = startPlayoffs(['a', 'b', 'c', 'd'], 21);
    expect(playoffs.series).toHaveLength(1);
    expect(playoffs.series[0].bestOf).toBe(5);
    expect(playoffs.finalRound).toBe(1);
  });

  it('a full season ends with a playoff champion, awards, and the offseason', () => {
    const u = runCommand(createUniverse('s', settings(), 0), { type: 'simToSeasonEnd' }).state;
    expect(u.phase).toBe('offseason');
    const champ = u.playoffs!.championId!;
    const top4 = standingsOf(u).slice(0, 4).map((r) => r.teamId);
    expect(top4).toContain(champ);
    expect(u.archive).toHaveLength(1);
    expect(u.archive[0].championId).toBe(champ);
    expect(u.archive[0].mvpId).toBeTruthy();
    expect(u.archive[0].aceId).toBeTruthy();
    expect(u.timeline.at(-1)!.text).toMatch(/Blastball Cup/);
    // Playoff games don't count in the standings.
    expect(regularResults(u)).toHaveLength(80);
    expect(Object.keys(u.results).length).toBeGreaterThan(80);
  });
});

describe('multiple seasons', () => {
  it('three consecutive seasons simulate cleanly, and the save loads after each', async () => {
    const d = new BlastballDB(`seasons-${Date.now()}`);
    let u: UniverseState = createUniverse('multi', settings({ chaos: 'weird' }), 0);
    await saveUniverse(u, d);
    for (let season = 1; season <= 3; season++) {
      const toEnd = runCommand(u, { type: 'simToSeasonEnd' });
      await persistCommand(u, toEnd, d);
      u = toEnd.state;
      expect(u.season).toBe(season);
      expect(u.phase).toBe('offseason');
      expect(await loadUniverse('multi', d)).toEqual(u);
      // End the offseason → next season.
      const roll = runCommand(u, { type: 'endDay' });
      await persistCommand(u, roll, d);
      u = roll.state;
      expect(u.season).toBe(season + 1);
      expect(u.phase).toBe('regular');
      expect(u.currentDay).toBe(1);
      expect(Object.keys(u.results)).toHaveLength(0);
      expect(currentElection(u)?.openedDay).toBe(1);
      for (const t of u.league.teams) {
        expect(t.lineup).toHaveLength(9);
        expect(t.rotation).toHaveLength(4);
      }
    }
    expect(u.archive.map((a) => a.season)).toEqual([1, 2, 3]);
    expect(Object.keys(u.statsBySeason).map(Number)).toEqual([1, 2, 3]);
    // Round-trip through export still works on a multi-season save.
    const blob = await exportUniverse('multi', { includePlayByPlay: false }, d);
    const id = await importLeague(blob, d, () => 'copy');
    expect((await loadUniverse(id, d))!.season).toBe(4);
  }, 60_000);

  it('players age, develop, and veterans retire', () => {
    let u = runCommand(createUniverse('s', settings({ leagueSize: 16 }), 0), { type: 'simToSeasonEnd' }).state;
    const agesBefore = { ...u.ages };
    u = runCommand(u, { type: 'endDay' }).state;
    const someone = Object.keys(agesBefore)[0];
    expect(u.ages[someone]).toBe(agesBefore[someone] + 1);
    expect(Object.values(u.weird.playerStatus)).toContain('retired');
    expect(retirementChance(37)).toBe(1000);
    expect(retirementChance(25)).toBe(0);
  });

  it('each season has its own schedule order', () => {
    let u = runCommand(createUniverse('s', settings(), 0), { type: 'simToSeasonEnd' }).state;
    const first = u.schedule.filter((g) => g.day === 1).map((g) => `${g.awayId}-${g.homeId}`);
    u = runCommand(u, { type: 'endDay' }).state;
    const second = u.schedule.filter((g) => g.day === 1).map((g) => `${g.awayId}-${g.homeId}`);
    expect(second).not.toEqual(first);
  });

  it('players become Veterans over multiple seasons', () => {
    let u = createUniverse('s', settings({ seasonLength: 50 }), 0);
    for (let i = 0; i < 2; i++) u = runCommand(runCommand(u, { type: 'simToSeasonEnd' }).state, { type: 'endDay' }).state;
    const anyVeteran = Object.keys(u.league.players).some((id) => rarityOf(u, id) === 'veteran' || rarityOf(u, id) === 'legend');
    expect(anyVeteran).toBe(true);
  });
});

describe('Patron tier', () => {
  it('unlocks only from Season 2', () => {
    const s1 = { ...createUniverse('s', settings(), 0), coins: 1000 };
    expect(patronError(s1, 't1')).toMatch(/Season 2/);
    expect(reduce(s1, { type: 'patronSponsored', teamId: 't1' })).toBe(s1);
  });

  it('costs coins, blesses the team for the season, once per season, and ends at rollover', () => {
    let u = runCommand(runCommand(createUniverse('s', settings(), 0), { type: 'simToSeasonEnd' }).state, { type: 'endDay' }).state;
    expect(u.season).toBe(2);
    u = { ...u, coins: 500 };
    const after = reduce(u, { type: 'patronSponsored', teamId: 't1' });
    expect(after.coins).toBe(500 - PATRON_COST);
    expect(after.patron).toEqual({ season: 2, teamId: 't1' });
    expect(patronError(after, 't2')).toMatch(/already/);
    const game = after.schedule.find((g) => g.awayId === 't1' || g.homeId === 't1')!;
    const pid = after.league.teams.find((t) => t.id === 't1')!.lineup[0];
    const base = gameLeague(u, game).players[pid].ratings.contact;
    expect(gameLeague(after, game).players[pid].ratings.contact).toBe(Math.min(100, base + PATRON_BLESSING));
    const next = runCommand(runCommand(after, { type: 'simToSeasonEnd' }).state, { type: 'endDay' }).state;
    expect(next.patron).toBeNull();
  });
});

describe('save fixtures', () => {
  it('a real v6 save (Sprint 8, Season 2) migrates and keeps playing', async () => {
    const { migrateSave } = await import('../src/storage/migrate');
    const raw = (await import('./fixtures/save-v6.json')).default;
    const u = migrateSave(structuredClone(raw));
    const strip = (x: object) => ({ ...x, saveVersion: undefined, factionOpinion: undefined, picks: undefined, pickEarnings: undefined, lastBailoutDay: undefined, experience: undefined, collection: undefined, h2h: undefined, weird: undefined, seasonStats: undefined, careerStats: undefined, statsBySeason: undefined,
      persona: undefined, picksLifetime: undefined, pickStreaks: undefined, pickLock: undefined, perkUses: undefined, xpToday: undefined, watched: undefined,
      rallyCry: undefined, jinx: undefined, waveGameId: undefined, tempClimates: undefined, collectorPaid: undefined, forecastReveal: undefined, sport: undefined });
    expect(strip(u)).toEqual(strip(raw));
    // v10 → v11 only adds the new stat columns, at 0.
    const [id, line] = Object.entries(raw.careerStats as Record<string, object>)[0];
    expect(u.careerStats[id]).toEqual({ ...line, sb: 0, cs: 0, gidp: 0, hbp: 0, e: 0, wp: 0, phbp: 0 });
    expect(u.factionOpinion).toEqual({});
    // v12 → v13: persona XP starts at 0; lifetime pick coins can't be lower than this season's.
    if (u.persona) expect({ ...u.persona, xp: undefined }).toEqual({ ...(raw as { persona: object }).persona, xp: undefined });
    expect(u.picksLifetime).toBeGreaterThanOrEqual(u.pickEarnings);
    expect(u.collection).toEqual([]);
    // Founding players have finished at least Season 1; this offseason's rookies have played none.
    expect(u.experience.t1p1).toBeGreaterThanOrEqual(1);
    expect(u.experience.t3y2r10).toBe(0);
    expect(u.season).toBe(2);
    expect(u.archive).toHaveLength(1);
    expect(runCommand(u, { type: 'endDay' }).state.currentDay).toBe(u.currentDay + 1);
  });
});
