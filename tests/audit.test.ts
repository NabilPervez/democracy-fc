import { describe, expect, it } from 'vitest';
import { simulateGame } from '../src/engine/baseball/game';
import type { League, RatingKey, ScheduledGame } from '../src/engine/baseball/types';
import { stadiumPerk, teamPerk } from '../src/world/teams';
import { createUniverse, gameLeague, type UniverseSettings } from '../src/world/universe';

/**
 * Audit: every rating, trait, perk and bonus must actually move results. We buff one team's
 * rating in isolation and check the effect over many seeded games.
 */

const settings: UniverseSettings = { name: 'A', seed: 'audit', leagueSize: 8, seasonLength: 20, chaos: 'normal', timeMode: 'manual', dayLengthMinutes: 60 } as UniverseSettings;
const u = createUniverse('audit', settings, 0);
const [A, B] = u.league.teams;

function flatten(league: League): League {
  const players = Object.fromEntries(Object.entries(league.players).map(([id, p]) => [id, { ...p, ratings: { contact: 50, power: 50, discipline: 50, velocity: 50, control: 50, stuff: 50, speed: 50, defense: 50 } }]));
  return { ...league, players };
}

function buff(league: League, teamId: string, key: RatingKey, by: number): League {
  const team = league.teams.find((t) => t.id === teamId)!;
  const players = { ...league.players };
  for (const id of [...team.lineup, ...team.rotation]) players[id] = { ...players[id], ratings: { ...players[id].ratings, [key]: players[id].ratings[key] + by } };
  return { ...league, players };
}

function measure(league: League, n = 1500) {
  let wins = 0, runs = 0, allowed = 0, hr = 0, walks = 0, ks = 0, triples = 0;
  for (let i = 0; i < n; i++) {
    const home = i % 2 === 0;
    const g: ScheduledGame = { id: `g${i}`, day: 1 + (i % 4), awayId: home ? B.id : A.id, homeId: home ? A.id : B.id };
    const r = simulateGame(league, g, 1);
    const mine = home ? r.homeScore : r.awayScore;
    const theirs = home ? r.awayScore : r.homeScore;
    if (mine > theirs) wins++;
    runs += mine;
    allowed += theirs;
    const aBats = (e: { half: string }) => (e.half === 'bottom') === home;
    for (const e of r.events) {
      if (!aBats(e)) {
        if (e.kind === 'strikeout') ks++;
        continue;
      }
      if (e.kind === 'hit' && e.hit === 'homeRun') hr++;
      if (e.kind === 'hit' && e.hit === 'triple') triples++;
      if (e.kind === 'walk') walks++;
    }
  }
  return { winPct: wins / n, runs: runs / n, allowed: allowed / n, hr: hr / n, walks: walks / n, ks: ks / n, triples: triples / n };
}

describe('audit: every rating moves results', () => {
  const base = measure(flatten(u.league));
  const RATINGS: [RatingKey, (b: ReturnType<typeof measure>, x: ReturnType<typeof measure>) => boolean][] = [
    ['contact', (b, x) => x.runs > b.runs],
    ['power', (b, x) => x.hr > b.hr],
    ['discipline', (b, x) => x.walks > b.walks],
    ['velocity', (b, x) => x.allowed < b.allowed],
    ['control', (b, x) => x.allowed < b.allowed],
    ['stuff', (b, x) => x.ks > b.ks],
    ['speed', (b, x) => x.triples > b.triples],
    ['defense', (b, x) => x.allowed < b.allowed],
  ];
  for (const [key, better] of RATINGS) {
    it(`+20 ${key} helps`, () => {
      const x = measure(buff(flatten(u.league), A.id, key, 20));
      expect(better(base, x)).toBe(true);
      expect(x.winPct).toBeGreaterThan(base.winPct);
    });
  }
});

describe('audit: modifiers reach the game', () => {
  const game = u.schedule.find((g) => g.awayId === A.id || g.homeId === A.id)!;

  it('team perks are applied to the roster for that game', () => {
    const perk = teamPerk(u.settings.seed, u.league, A.id);
    const lg = gameLeague({ ...u, weird: { ...u.weird, playerMods: {} } }, game);
    const id = A.lineup[0];
    const applies = !perk.homeOnly || game.homeId === A.id;
    for (const [k, v] of Object.entries(perk.delta)) {
      const raw = u.league.players[id].ratings[k as RatingKey];
      expect(lg.players[id].ratings[k as RatingKey]).toBe(applies ? Math.max(0, Math.min(100, raw + v!)) : raw);
    }
  });

  it('the home stadium perk helps the home team only', () => {
    const plain = { ...u, weird: { ...u.weird, playerMods: {} } };
    const lg = gameLeague(plain, game);
    const park = stadiumPerk(u.settings.seed, u.league, game.homeId);
    const homeTeam = u.league.teams.find((t) => t.id === game.homeId)!;
    const id = homeTeam.lineup[0];
    const perk = teamPerk(u.settings.seed, u.league, game.homeId);
    for (const [k, v] of Object.entries(park.delta)) {
      const raw = u.league.players[id].ratings[k as RatingKey] + (perk.delta[k as RatingKey] ?? 0);
      expect(lg.players[id].ratings[k as RatingKey]).toBe(Math.max(0, Math.min(100, raw + v!)));
    }
  });

  it('player traits are applied', () => {
    const id = A.lineup[0];
    const s = { ...u, weird: { ...u.weird, playerMods: { [id]: [{ id: 'blessed', until: null }] } } };
    const plain = gameLeague({ ...u, weird: { ...u.weird, playerMods: {} } }, game);
    const lg = gameLeague(s, game);
    expect(lg.players[id].ratings).not.toEqual(plain.players[id].ratings);
  });

  it('rivalry bonus is applied when rivals meet', () => {
    const h2h = { [game.awayId]: { [game.homeId]: 5 }, [game.homeId]: { [game.awayId]: 5 } };
    const base = { ...u, weird: { ...u.weird, playerMods: {} } };
    const a = gameLeague(base, game);
    const b = gameLeague({ ...base, h2h }, game);
    const id = A.lineup[0];
    expect(b.players[id].ratings.power).toBeGreaterThanOrEqual(a.players[id].ratings.power);
    expect(Object.values(b.players[id].ratings).reduce((x, y) => x + y)).toBeGreaterThan(Object.values(a.players[id].ratings).reduce((x, y) => x + y));
  });
});

describe('audit: a batter’s pitching ratings count a little', () => {
  const batters = (league: League, key: RatingKey, by: number): League => {
    const players = { ...league.players };
    for (const id of A.lineup) players[id] = { ...players[id], ratings: { ...players[id].ratings, [key]: players[id].ratings[key] + by } };
    return { ...league, players };
  };
  const base = measure(flatten(u.league), 3000);
  it('Velocity (arm) improves fielding', () => expect(measure(batters(flatten(u.league), 'velocity', 50), 3000).allowed).toBeLessThan(base.allowed));
  it('Control (eye) draws more walks', () => expect(measure(batters(flatten(u.league), 'control', 50), 3000).walks).toBeGreaterThan(base.walks));
  it('Stuff (bat wizardry) adds power', () => expect(measure(batters(flatten(u.league), 'stuff', 50), 3000).hr).toBeGreaterThan(base.hr));
});
