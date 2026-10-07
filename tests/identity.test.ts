import { describe, expect, it } from 'vitest';
import { createRng } from '../src/engine/core/rng';
import {
  cardRarity, careerPhase, CLUB_PERKS, clubBio, clubPerk, development, perkDeltas, PITCH_PERKS, retirementChance, tierFor,
} from '../src/world/soccer/identity';
import { bornWith, COMBOS, fuseTraits, SOCCER_MODS } from '../src/world/soccer/weird';
import { createSoccerWorld, matchInputs, reduceSoccer, runSoccerCommand, type SoccerSettings, type SoccerUniverse } from '../src/world/soccer/universe';

const settings = (p: Partial<SoccerSettings> = {}): SoccerSettings => ({
  name: 'I', seed: 'identity', leagueSize: 12, chaos: 'normal', timeMode: 'manual', dayLengthMinutes: 40, seasonLength: 'short', ...p,
});

describe('traits, gifts and combos', () => {
  it('has variety: 30+ traits across born-with, combo, ageing and Sub-Level kinds, and every combo resolves', () => {
    expect(SOCCER_MODS.length).toBeGreaterThanOrEqual(30);
    expect(SOCCER_MODS.filter((m) => m.innate).length).toBeGreaterThanOrEqual(15);
    expect(SOCCER_MODS.filter((m) => m.comboOnly)).toHaveLength(COMBOS.length);
    expect(SOCCER_MODS.filter((m) => m.aging).length).toBeGreaterThanOrEqual(4);
    const ids = new Set(SOCCER_MODS.map((m) => m.id));
    for (const c of COMBOS) for (const id of [...c.needs, c.result]) expect(ids.has(id), id).toBe(true);
  });

  it('two combining traits fuse into the combo, permanently', () => {
    const { mods, fused } = fuseTraits([{ id: 'blessed', season: 1, untilDay: 4 }, { id: 'cursed', season: 1, untilDay: null }], 2);
    expect(fused.map((c) => c.result)).toEqual(['balanced']);
    expect(mods).toEqual([{ id: 'balanced', season: 2, untilDay: null }]);
  });

  it('about four in ten players are born with a trait', () => {
    const n = Array.from({ length: 1000 }, (_, i) => bornWith('seed', `p${i}`).length > 0).filter(Boolean).length;
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(480);
  });
});

describe('club and pitch power-ups', () => {
  it('every club gets a distinct power-up and a bio; home-only perks only apply at home', () => {
    const perks = Array.from({ length: 12 }, (_, i) => clubPerk('s', `t${i + 1}`).id);
    expect(new Set(perks).size).toBe(12);
    expect(CLUB_PERKS.length).toBeGreaterThanOrEqual(12);
    expect(PITCH_PERKS.every((p) => p.homeOnly)).toBe(true);
    const home = perkDeltas('s', 't1', true);
    const away = perkDeltas('s', 't1', false);
    expect(Object.values(home).reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThan(Object.values(away).reduce((a, b) => a + (b ?? 0), 0));
    expect(clubBio('s', { id: 't1', city: 'A', name: 'B' } as never).text).toMatch(/were founded in/);
  });

  it('power-ups reach the match engine', () => {
    const u = createSoccerWorld('u', settings(), null, 0);
    const g = u.schedule[0];
    const { opts } = matchInputs(u, g);
    const perk = clubPerk(u.settings.seed, g.homeId);
    for (const [k, v] of Object.entries(perk.delta)) expect(opts.teamDeltas?.[g.homeId]?.[k as never]).toBeGreaterThanOrEqual(Math.min(0, v!));
  });
});

describe('careers', () => {
  it('rise, prime, fade, decline', () => {
    expect([20, 26, 30, 34].map(careerPhase)).toEqual(['rising', 'prime', 'fading', 'declining']);
    const rng = createRng('dev');
    expect(development(19, rng)).toBeGreaterThan(0);
    expect(development(34, rng)).toBeLessThan(0);
    expect(retirementChance(26)).toBe(0);
    expect(retirementChance(36)).toBe(1000);
  });

  it('every player has an age; seasons age them, veterans retire and academy rookies replace them', () => {
    let u: SoccerUniverse = createSoccerWorld('u', settings({ seed: 'careers' }), null, 0);
    for (const id of Object.keys(u.league.players)) expect(u.ages[id]).toBeGreaterThanOrEqual(18);
    const before = { ...u.ages };
    for (let s = 0; s < 3; s++) {
      u = runSoccerCommand(u, { type: 'simToSeasonEnd' }).state;
      u = runSoccerCommand(u, { type: 'endDay' }).state;
    }
    expect(u.season).toBe(4);
    expect(u.retired.length).toBeGreaterThan(0);
    const stayed = Object.keys(before).filter((id) => u.league.players[id]);
    expect(stayed.length).toBeGreaterThan(0);
    for (const id of stayed) expect(u.ages[id]).toBe(before[id] + 3);
    for (const t of u.league.teams) expect(t.squad).toHaveLength(8);
    expect(u.news.some((n) => /retired at/.test(n.text)) || u.timeline.some((t) => t.kind === 'retirement')).toBe(true);
  });
});

describe('rarity and the collection', () => {
  it('more powers and output mean a rarer card', () => {
    const u = createSoccerWorld('u', settings(), null, 0);
    const p = Object.values(u.league.players).find((x) => !u.mods[x.id] && !x.signatureId)!;
    const plain = cardRarity(u, p);
    const loaded = cardRarity({ ...u, mods: { ...u.mods, [p.id]: [{ id: 'balanced', season: 1, untilDay: null }, { id: 'metronome', season: 1, untilDay: null }, { id: 'echoed', season: 1, untilDay: null }] }, careerStats: { [p.id]: { apps: 80, goals: 60, assists: 30, cleanSheets: 0, shots: 0, onTarget: 0, saves: 0, conceded: 0, tackles: 0 } } as SoccerUniverse['careerStats'] }, { ...p, awakened: { seasonId: 1, boost: 'finishing' } });
    expect(plain.tier).toBe('common');
    expect(['epic', 'legendary']).toContain(loaded.tier);
    expect(tierFor(13)).toBe('legendary');
  });

  it('cards can be collected and removed', () => {
    let u = createSoccerWorld('u', settings(), null, 0);
    const id = u.league.teams[0].squad[0];
    u = reduceSoccer(u, { type: 'cardToggled', playerId: id });
    expect(u.collection.map((c) => c.playerId)).toEqual([id]);
    u = reduceSoccer(u, { type: 'cardToggled', playerId: id });
    expect(u.collection).toHaveLength(0);
  });
});
