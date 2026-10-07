import { describe, expect, it } from 'vitest';
import { matchWinner } from '../src/engine/season';
import type { Chaos } from '../src/world/soccer/weird';
import { VANISH_PER_SEASON } from '../src/world/soccer/weird';
import {
  betError, clubSwitchError, createSoccerWorld, DRAW_PICK, reduceAllSoccer, reduceSoccer, regularDays, runSoccerCommand,
  type SoccerSettings, type SoccerUniverse,
} from '../src/world/soccer/universe';

const settings = (p: Partial<SoccerSettings> = {}): SoccerSettings => ({
  name: 'Test Assembly', seed: 'world', leagueSize: 12, chaos: 'normal', timeMode: 'manual', dayLengthMinutes: 60, ...p,
});
const fresh = (p: Partial<SoccerSettings> = {}) => createSoccerWorld('u', settings(p), null, 0);

describe('Democracy FC world (S5)', () => {
  it.each(['calm', 'normal', 'weird', 'unhinged'] as Chaos[])('a full season at %s chaos runs end to end', (chaos) => {
    const { state } = runSoccerCommand(fresh({ chaos, seed: `full-${chaos}` }), { type: 'simToSeasonEnd' });
    expect(state.phase).toBe('offseason');
    const table = state.archive[0].standings;
    for (const row of table) expect(row.wins + row.draws + row.losses).toBe(regularDays(fresh()));
    expect(table.length).toBe(12);
    expect(state.archive[0].championId).toBeTruthy();
    expect(state.archive[0].ejected).toHaveLength(1);
    // Every squad is still 8 and every squad id exists.
    for (const t of state.league.teams) {
      expect(t.squad).toHaveLength(8);
      for (const id of t.squad) expect(state.league.players[id]?.teamId).toBe(t.id);
    }
    // Goals in season stats match the results.
    const goals = Object.values(state.results).reduce((s, r) => s + r.homeScore + r.awayScore - (r.bonusPoints ?? 0), 0);
    const scored = Object.values(state.seasonStats).reduce((s, l) => s + l.goals, 0);
    expect(scored).toBe(goals);
  });

  it('the next season starts after the offseason with the new club in the schedule', () => {
    let u = runSoccerCommand(fresh(), { type: 'simToSeasonEnd' }).state;
    const newcomer = u.archive[0].ejected[0];
    u = runSoccerCommand(u, { type: 'endDay' }).state;
    expect(u.season).toBe(2);
    expect(u.phase).toBe('regular');
    expect(u.league.teams.some((t) => t.id === newcomer.id)).toBe(false);
    const ids = new Set(u.league.teams.map((t) => t.id));
    for (const g of u.schedule) expect(ids.has(g.homeId) && ids.has(g.awayId)).toBe(true);
  });

  it('replaying the emitted events reproduces the same state', () => {
    const u = fresh({ chaos: 'unhinged' });
    const { state, events } = runSoccerCommand(u, { type: 'simDays', count: 8 });
    expect(reduceAllSoccer(u, events)).toEqual(state);
  });

  it('the same seed builds the same world', () => {
    const a = runSoccerCommand(fresh({ seed: 'same' }), { type: 'simDays', count: 5 }).state;
    const b = runSoccerCommand(fresh({ seed: 'same' }), { type: 'simDays', count: 5 }).state;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('vanish counts per season land within ±50% of the configured rate over 20 seeds', () => {
    for (const chaos of ['normal', 'unhinged'] as Chaos[]) {
      let total = 0;
      for (let i = 0; i < 20; i++) total += runSoccerCommand(fresh({ chaos, seed: `vanish-${chaos}-${i}` }), { type: 'simToSeasonEnd' }).state.vanished.length;
      const perSeason = total / 20;
      expect(perSeason, chaos).toBeGreaterThanOrEqual(VANISH_PER_SEASON[chaos] * 0.5);
      expect(perSeason, chaos).toBeLessThanOrEqual(VANISH_PER_SEASON[chaos] * 1.5);
    }
  }, 60_000);

  it('vanished players leave their squad for the Sub-Level Archive and a newcomer takes the bunk', () => {
    const { state } = runSoccerCommand(fresh({ chaos: 'unhinged', seed: 'gone' }), { type: 'simToSeasonEnd' });
    expect(state.vanished.length).toBeGreaterThan(0);
    for (const v of state.vanished) {
      expect(state.league.players[v.player.id]).toBeUndefined();
      expect(state.league.teams.some((t) => t.squad.includes(v.player.id))).toBe(false);
    }
    expect(state.news.some((n) => n.director && n.text.includes('Sub-Levels') || n.text.includes('door'))).toBe(true);
  });

  it('predictions settle on 3-way results, including draws', () => {
    let u = fresh({ seed: 'predict' });
    const today = u.schedule.filter((g) => g.day === 1);
    for (const g of today) u = reduceSoccer(u, { type: 'betPlaced', gameId: g.id, teamId: DRAW_PICK, amount: 5 });
    expect(u.coins).toBe(100 - 5 * today.length);
    u = runSoccerCommand(u, { type: 'endDay' }).state;
    for (const g of today) {
      const r = u.results[g.id];
      const bet = u.bets.find((b) => b.gameId === g.id)!;
      expect(bet.status).toBe(matchWinner(r) === null ? 'won' : 'lost');
    }
  });

  it('prediction rules: no draws in knockouts, one side per match, only today', () => {
    let u = fresh();
    const g = u.schedule.find((x) => x.day === 1)!;
    expect(betError(u, g.id, g.homeId, 10)).toBeNull();
    u = reduceSoccer(u, { type: 'betPlaced', gameId: g.id, teamId: g.homeId, amount: 10 });
    expect(betError(u, g.id, g.awayId, 10)).toMatch(/different prediction/);
    const later = u.schedule.find((x) => x.day === 2)!;
    expect(betError(u, later.id, later.homeId, 1)).toMatch(/today/);
    const end = runSoccerCommand(fresh(), { type: 'simDays', count: regularDays(u) }).state;
    expect(end.phase).toBe('playoffs');
    const semi = end.playoffs!.semis[0];
    expect(betError(end, semi, DRAW_PICK, 1)).toMatch(/Knockout/);
  });

  it('knockout matches never end level', () => {
    const { state } = runSoccerCommand(fresh({ seed: 'ko' }), { type: 'simToSeasonEnd' });
    for (const id of [...state.playoffs!.semis, state.playoffs!.final!]) {
      const r = state.results[id];
      expect(r.knockout).toBe(true);
      expect(r.shootout?.winnerId ?? matchWinner(r)).toBeTruthy();
    }
  });

  it('switching clubs: once per season and it costs every coin', () => {
    let u: SoccerUniverse = fresh();
    const other = u.league.teams.find((t) => t.id !== u.favoriteClubId)!.id;
    expect(clubSwitchError(u, other)).toBeNull();
    u = reduceSoccer(u, { type: 'clubSwitched', clubId: other });
    expect(u.favoriteClubId).toBe(other);
    expect(u.coins).toBe(0);
    expect(u.clubHistory).toHaveLength(2);
    const third = u.league.teams.find((t) => t.id !== other && t.id !== u.clubHistory[0].clubId)!.id;
    expect(clubSwitchError(u, third)).toMatch(/already switched/);
  });

  it('injured players sit out matches, then come back', () => {
    const { state, events } = runSoccerCommand(fresh({ seed: 'hurt' }), { type: 'simToSeasonEnd' });
    const injured = events.flatMap((e) => (e.type === 'matchPlayed' ? Object.keys(e.injuries) : []));
    expect(injured.length).toBeGreaterThan(0);
    expect(Object.keys(state.injuries).length).toBeLessThan(injured.length);
  });
});

describe('soccer narrative (S5)', () => {
  it('has ~150+ original templates and narrates every match without blanks or unfilled slots', async () => {
    const { narrateSoccerMatch, SOCCER_TEMPLATE_COUNT } = await import('../src/narrative/soccer');
    const { simulateSoccer } = await import('../src/engine/soccer/game');
    expect(SOCCER_TEMPLATE_COUNT).toBeGreaterThanOrEqual(150);
    const u = fresh({ seed: 'narrate' });
    const kinds = new Set<string>();
    for (const g of u.schedule.slice(0, 40)) {
      const r = simulateSoccer(u.league, g, 1, { facilityEvents: [{ eventId: 'lights-out', text: 'Director: Lights Out in effect.' }] });
      const lines = narrateSoccerMatch(r.events, { league: u.league, gameId: g.id, homeId: g.homeId, awayId: g.awayId });
      expect(lines.filter((l) => l.tone === 'goal')).toHaveLength(r.homeScore + r.awayScore);
      for (const l of lines) {
        expect(l.text.trim().length).toBeGreaterThan(3);
        expect(l.text).not.toMatch(/\{\w+\}|undefined|null/);
      }
      for (const e of r.events) kinds.add(e.kind);
    }
    expect(kinds.has('goal')).toBe(true);
  });

  it('the same match always reads the same', async () => {
    const { narrateSoccerMatch } = await import('../src/narrative/soccer');
    const { simulateSoccer } = await import('../src/engine/soccer/game');
    const u = fresh({ seed: 'narrate2' });
    const g = u.schedule[0];
    const ctx = { league: u.league, gameId: g.id, homeId: g.homeId, awayId: g.awayId };
    const a = narrateSoccerMatch(simulateSoccer(u.league, g, 1).events, ctx);
    const b = narrateSoccerMatch(simulateSoccer(u.league, g, 1).events, ctx);
    expect(b).toEqual(a);
  });
});

describe('side prediction markets (S8)', () => {
  it('both-teams-score, over/under and first scorer settle from the result', async () => {
    const { sideOdds, TOTAL_LINE } = await import('../src/world/soccer/universe');
    let u = fresh({ seed: 'markets' });
    const today = u.schedule.filter((g) => g.day === 1);
    for (const g of today) {
      const o = sideOdds(u, g.id);
      expect(o.btts.yes + o.btts.no).toBe(1000);
      expect(o.total.over + o.total.under).toBe(1000);
      const scorer = Object.entries(o.firstScorer).sort((a, b) => b[1] - a[1])[0][0];
      u = reduceSoccer(u, { type: 'sidePrediction', gameId: g.id, market: 'btts', pick: 'yes', amount: 1 });
      u = reduceSoccer(u, { type: 'sidePrediction', gameId: g.id, market: 'total', pick: 'over', amount: 1 });
      u = reduceSoccer(u, { type: 'sidePrediction', gameId: g.id, market: 'firstScorer', pick: scorer, amount: 1 });
      // A result prediction is still allowed alongside side markets.
      u = reduceSoccer(u, { type: 'betPlaced', gameId: g.id, teamId: g.homeId, amount: 1 });
    }
    expect(u.bets).toHaveLength(today.length * 4);
    u = runSoccerCommand(u, { type: 'endDay' }).state;
    for (const g of today) {
      const r = u.results[g.id];
      const bet = (m: string) => u.bets.find((b) => b.gameId === g.id && b.market === m)!;
      expect(bet('btts').status).toBe(r.homeScore > 0 && r.awayScore > 0 ? 'won' : 'lost');
      expect(bet('total').status).toBe(r.homeScore + r.awayScore - (r.bonusPoints ?? 0) > TOTAL_LINE ? 'won' : 'lost');
      expect(bet('firstScorer').status).toBe(bet('firstScorer').teamId === r.firstScorerId ? 'won' : 'lost');
    }
  });
});

describe('Echo Goal (S8)', () => {
  it('the first goal of an Echo Goal match counts twice', async () => {
    const { simulateSoccer } = await import('../src/engine/soccer/game');
    const u = fresh({ seed: 'echo' });
    for (const g of u.schedule.slice(0, 10)) {
      const r = simulateSoccer(u.league, g, 1, { rules: { echoFirstGoal: true } });
      const goals = r.events.filter((e) => e.kind === 'goal');
      if (!goals.length) continue;
      expect(goals[0].kind === 'goal' && goals[0].value).toBe(2);
      const points = goals.reduce((n, e) => n + (e.kind === 'goal' ? e.value ?? 1 : 0), 0);
      expect(r.homeScore + r.awayScore).toBe(points);
    }
  });
});
