import { describe, expect, it } from 'vitest';
import { emptyLine, type BoxScore } from '../src/engine/baseball/boxScore';
import { leaderboards } from '../src/world/leaders';
import { MAX_BACKED, PICK_RATES, pickPayout } from '../src/world/picks';
import {
  BAILOUT_COINS,
  createUniverse,
  currentElection,
  DAILY_STIPEND,
  FAVORITE_WIN_BONUS,
  favoriteTeamError,
  pickError,
  reduce,
  runCommand,
  unplayedToday,
  type UniverseSettings,
  type UniverseState,
} from '../src/world/universe';

const settings = (seed = 'feat'): UniverseSettings => ({ name: 'F', seed, leagueSize: 8, seasonLength: 20, chaos: 'calm', timeMode: 'manual', dayLengthMinutes: 60 });
const fan = (favoriteTeamId: string | null = null) => ({ kind: 'analyst' as const, fanName: 'Kim', favoriteTeamId });

describe('bailout', () => {
  it('a fan who loses everything on a bet gets 100 coins back', () => {
    for (let i = 0; i < 20; i++) {
      let u = createUniverse('b', settings(`bail-${i}`), 0, fan());
      const g = unplayedToday(u)[0];
      u = reduce(u, { type: 'betPlaced', gameId: g.id, teamId: g.homeId, amount: u.coins });
      expect(u.coins).toBe(0);
      u = runCommand(u, { type: 'playGame', gameId: g.id }).state;
      if (u.bets[0].status !== 'lost') continue;
      expect(u.coins).toBe(BAILOUT_COINS);
      expect(u.ledger.at(-1)!.reason).toMatch(/bailout/);
      return;
    }
    throw new Error('no losing bet found');
  });

  it('no bailout while a bet is still riding', () => {
    let u = createUniverse('b', settings(), 0, fan());
    const [g1, g2] = unplayedToday(u);
    u = reduce(u, { type: 'betPlaced', gameId: g1.id, teamId: g1.homeId, amount: 50 });
    u = reduce(u, { type: 'betPlaced', gameId: g2.id, teamId: g2.homeId, amount: 50 });
    expect(u.coins).toBe(0);
    u = runCommand(u, { type: 'playGame', gameId: g1.id }).state;
    // g2's bet is still open, so no bailout yet, whatever g1 did.
    expect(u.ledger.some((l) => /bailout/.test(l.reason))).toBe(false);
  });

  it('spending everything on votes is bailed out at day end, once a day', () => {
    let u: UniverseState = { ...createUniverse('b', settings(), 0, fan()), coins: 100 };
    const e = currentElection(u)!;
    u = reduce(u, { type: 'votesBought', electionId: e.id, proposal: 1, count: 10 });
    expect(u.coins).toBe(0);
    u = runCommand(u, { type: 'endDay' }).state;
    expect(u.coins).toBe(BAILOUT_COINS + DAILY_STIPEND);
  });
});

describe('favorite team', () => {
  it('can be chosen in Season 1 and pays a bonus on every win', () => {
    let u = createUniverse('f', settings(), 0, fan());
    u = reduce(u, { type: 'favoriteTeamSet', teamId: 't2' });
    expect(u.persona!.favoriteTeamId).toBe('t2');
    const before = u.coins;
    u = runCommand(u, { type: 'simDays', count: 5 }).state;
    const wins = Object.values(u.results).filter((r) => (r.homeScore > r.awayScore ? r.homeId : r.awayId) === 't2').length;
    const bonuses = u.ledger.filter((l) => l.reason.startsWith('Your ') && l.reason.endsWith(' won'));
    expect(bonuses).toHaveLength(wins);
    expect(bonuses.every((b) => b.amount === FAVORITE_WIN_BONUS)).toBe(true);
    expect(u.coins).toBe(before + wins * FAVORITE_WIN_BONUS + 5 * DAILY_STIPEND);
  });

  it('locks after Season 1', () => {
    let u = createUniverse('f', settings(), 0, fan('t1'));
    u = runCommand(runCommand(u, { type: 'simToSeasonEnd' }).state, { type: 'endDay' }).state;
    expect(u.season).toBe(2);
    expect(favoriteTeamError(u, 't3')).toMatch(/locked/);
    expect(reduce(u, { type: 'favoriteTeamSet', teamId: 't3' }).persona!.favoriteTeamId).toBe('t1');
  });
});

describe('player picks', () => {
  const box = (lines: Record<string, Partial<ReturnType<typeof emptyLine>>>): BoxScore =>
    Object.fromEntries(Object.entries(lines).map(([id, l]) => [id, { ...emptyLine(), ...l }]));

  it('backed hitters pay for hits and homers, backed pitchers for strikeouts', () => {
    const u = createUniverse('p', settings(), 0);
    const hitter = u.league.teams[0].lineup[0];
    const pitcher = u.league.teams[0].rotation[0];
    const lines = pickPayout({ back: [hitter, pitcher], fade: [] }, box({ [hitter]: { h: 3, hr: 1, ab: 4 }, [pitcher]: { pk: 7 } }), u.league);
    expect(lines.find((l) => l.playerId === hitter)!.amount).toBe(3 * PICK_RATES.backHit + PICK_RATES.backHomeRun);
    expect(lines.find((l) => l.playerId === pitcher)!.amount).toBe(7 * PICK_RATES.backStrikeout);
  });

  it('faded hitters pay when they strike out or go hitless; faded pitchers when they get hit', () => {
    const u = createUniverse('p', settings(), 0);
    const hitter = u.league.teams[1].lineup[2];
    const pitcher = u.league.teams[1].rotation[1];
    const lines = pickPayout({ back: [], fade: [hitter, pitcher] }, box({ [hitter]: { ab: 4, h: 0, k: 2 }, [pitcher]: { ha: 9, ra: 5 } }), u.league);
    expect(lines.find((l) => l.playerId === hitter)!.amount).toBe(2 * PICK_RATES.fadeStrikeout + PICK_RATES.fadeHitless);
    expect(lines.find((l) => l.playerId === pitcher)!.amount).toBe(9 * PICK_RATES.fadeHitAllowed + 5 * PICK_RATES.fadeRunAllowed);
  });

  it('pays out during real games and tracks season earnings', () => {
    let u = createUniverse('p', settings(), 0, fan());
    const team = u.league.teams[0];
    for (const id of team.lineup.slice(0, 3)) u = reduce(u, { type: 'pickSet', playerId: id, kind: 'back' });
    u = reduce(u, { type: 'pickSet', playerId: team.rotation[0], kind: 'back' });
    u = runCommand(u, { type: 'simDays', count: 6 }).state;
    expect(u.pickEarnings).toBeGreaterThan(0);
    expect(u.ledger.some((l) => l.reason.startsWith('Picks:'))).toBe(true);
  });

  it('limits picks, forbids backing and fading the same player, and can clear a pick', () => {
    let u = createUniverse('p', settings(), 0, fan());
    const ids = u.league.teams[0].lineup;
    for (const id of ids.slice(0, MAX_BACKED)) u = reduce(u, { type: 'pickSet', playerId: id, kind: 'back' });
    expect(pickError(u, ids[MAX_BACKED], 'back')).toMatch(/up to/);
    u = reduce(u, { type: 'pickSet', playerId: ids[0], kind: 'fade' });
    expect(u.picks.back).not.toContain(ids[0]);
    expect(u.picks.fade).toContain(ids[0]);
    u = reduce(u, { type: 'pickSet', playerId: ids[0], kind: null });
    expect(u.picks.fade).not.toContain(ids[0]);
  });
});

describe('leaderboards', () => {
  it('ranks hitters and pitchers separately, with minimums for rate stats', () => {
    const u = runCommand(createUniverse('l', settings(), 0), { type: 'simDays', count: 10 }).state;
    const { hitters, pitchers } = leaderboards(u.seasonStats, u.league, 10);
    for (const b of hitters) for (const r of b.rows) expect(u.league.players[r.playerId].role).toBe('batter');
    for (const b of pitchers) for (const r of b.rows) expect(u.league.players[r.playerId].role).toBe('pitcher');
    const hr = hitters.find((b) => b.id === 'hr')!.rows;
    for (let i = 1; i < hr.length; i++) expect(hr[i - 1].value).toBeGreaterThanOrEqual(hr[i].value);
    const era = pitchers.find((b) => b.id === 'era')!.rows;
    for (let i = 1; i < era.length; i++) expect(era[i - 1].value).toBeLessThanOrEqual(era[i].value);
    for (const r of era) expect(u.seasonStats[r.playerId].outs).toBeGreaterThanOrEqual(10);
  });
});
