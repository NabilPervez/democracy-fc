import { describe, expect, it } from 'vitest';
import v3fp from './fixtures/engine-v3-fingerprints.json';
import v10 from './fixtures/save-v10.json';
import { boxScore, type StatLine } from '../src/engine/baseball/boxScore';
import { simulateGame } from '../src/engine/baseball/game';
import { hashSeed } from '../src/engine/core/rng';
import { generateSchedule } from '../src/engine/season';
import type { EnvEventDef, EnvPhase, GameEnvironment, GameEvent, ScheduledGame } from '../src/engine/baseball/types';
import { describeEvent } from '../src/narrative/playByPlay';
import { migrateSave } from '../src/storage/migrate';
import { assignClimates, eligibleEvents, ENVIRONMENT, envEventDef, envFooter, PHASE_EFFECTS, validateEnvironment } from '../src/world/environment';
import { generateLeague } from '../src/world/generate';
import { createUniverse, gameLeague, prophecy, stadiumEnvironment, type UniverseSettings } from '../src/world/universe';

const settings = (p: Partial<UniverseSettings> = {}): UniverseSettings => ({
  name: 'Env', seed: 'env', leagueSize: 16, seasonLength: 99, chaos: 'normal', timeMode: 'manual', dayLengthMinutes: 60, ...p,
});

/** Every game of the first `days` days of a few fresh universes, simmed with their real stadium environments. */
function sample(chaos: UniverseSettings['chaos'], days = 11) {
  const out: { u: ReturnType<typeof createUniverse>; g: ScheduledGame; events: GameEvent[] }[] = [];
  for (const seed of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']) {
    const u = createUniverse('x', settings({ seed, chaos }), 0);
    for (const g of u.schedule.filter((x) => x.day <= days)) out.push({ u, g, events: simulateGame(gameLeague(u, g), g, 1, 4, stadiumEnvironment(u, g)).events });
  }
  return out;
}
const effective = (games: { events: GameEvent[] }[]) => games.filter((x) => x.events.some((e) => e.cause)).length / games.length;

describe('environment content', () => {
  it('validates: 32 events covering all 15 effect types and 8 climates', () => {
    expect(ENVIRONMENT.events).toHaveLength(32);
    expect(ENVIRONMENT.climates).toHaveLength(8);
    const types = new Set(ENVIRONMENT.events.map((e) => e.effect.type));
    expect(types.size).toBe(15);
  });

  it('rejects unknown climates, effects in the wrong phase, unknown stadium mods and variables', () => {
    const base = structuredClone(ENVIRONMENT);
    const bad = (f: (e: (typeof base.events)[number]) => void) => {
      const doc = structuredClone(base);
      f(doc.events[0]);
      return () => validateEnvironment(doc, ['tornado-alley']);
    };
    expect(bad((e) => (e.climates = ['lunar']))).toThrow(/unknown climate/);
    expect(bad((e) => ((e.phase = 'afterPlay'), (e.effect.type = 'forceBall')))).toThrow(/can't run in phase/);
    expect(bad((e) => (e.requiresStadiumMod = 'moon-base'))).toThrow(/unknown stadium mod/);
    expect(bad((e) => (e.effectText = 'The {xyz} wins.'))).toThrow(/unknown variable/);
  });

  it('assigns each stadium 1–2 distinct climates, deterministically', () => {
    for (const t of ['t1', 't2', 't3', 't4', 't5', 't6']) {
      const c = assignClimates('seed', t);
      expect(c).toEqual(assignClimates('seed', t));
      expect(c.length).toBeGreaterThanOrEqual(1);
      expect(c.length).toBeLessThanOrEqual(2);
      expect(new Set(c).size).toBe(c.length);
    }
  });
});

describe('environment in the engine', () => {
  it('isolation: with the environment off, games match engine v3 exactly', () => {
    const league = generateLeague({ seed: 'frozen-engine' });
    const games = generateSchedule(league.teams, 40).slice(0, 100);
    const fp = (v: number, env?: GameEnvironment) => games.map((g) => hashSeed(JSON.stringify(simulateGame(league, g, 3, v, env).events)).join('.'));
    expect(fp(4)).toEqual(v3fp.fingerprints);
    // Engine v3 ignores an environment even when one is passed (seasons already underway keep v3).
    const env: GameEnvironment = { events: ENVIRONMENT.events, chaosPerMille: 3000 };
    expect(fp(3, env)).toEqual(v3fp.fingerprints);
  });

  it('determinism: the same seed gives the same environment events and changed plays', () => {
    const u = createUniverse('d', settings({ chaos: 'unhinged' }), 0);
    for (const g of u.schedule.filter((x) => x.day <= 2)) {
      const a = simulateGame(gameLeague(u, g), g, 1, 4, stadiumEnvironment(u, g));
      const b = simulateGame(gameLeague(u, g), g, 1, 4, stadiumEnvironment(u, g));
      expect(a).toEqual(b);
    }
  });

  it('frequency: Calm < 15%, Normal 30–40%, Unhinged > 70% of games have an effective event', () => {
    expect(effective(sample('calm'))).toBeLessThan(0.15);
    const normal = effective(sample('normal'));
    expect(normal).toBeGreaterThanOrEqual(0.3);
    expect(normal).toBeLessThanOrEqual(0.4);
    expect(effective(sample('unhinged'))).toBeGreaterThan(0.7);
  });

  it('climate gating: an event only fires where its climate (or required stadium mod) allows', () => {
    for (const { u, g, events } of sample('unhinged', 4)) {
      const st = u.weird.stadiums[g.homeId];
      for (const e of events) {
        if (e.kind !== 'envStart') continue;
        const def = ENVIRONMENT.events.find((x) => x.id === e.envId)!;
        if (!def.climates.includes('any')) expect(def.climates.some((c) => st.climates.includes(c)), def.id).toBe(true);
        if (def.requiresStadiumMod) expect(st.mods.some((m) => m.id === def.requiresStadiumMod), def.id).toBe(true);
      }
    }
  });

  it('every changed play is followed by an attributed effect line, and every line has text', () => {
    let changed = 0;
    for (const { u, g, events } of sample('unhinged', 3)) {
      events.forEach((e, i) => {
        if (!e.cause) return;
        changed++;
        if (e.kind !== 'envEffect') expect(events[i + 1].kind, `${e.kind} needs an effect line`).toBe('envEffect');
        const effectAt = e.kind === 'envEffect' ? i : i + 1;
        const line = describeEvent(u.league, g, events, effectAt);
        expect(line).toContain(envEventDef(e.cause.id)!.icon);
        expect(line).not.toMatch(/[{}]/);
      });
      events.forEach((e, i) => e.kind.startsWith('env') && expect(describeEvent(u.league, g, events, i).length).toBeGreaterThan(3));
    }
    expect(changed).toBeGreaterThan(50);
  });

  it('box score footer counts changed plays', () => {
    const { events } = sample('unhinged', 2).find((x) => x.events.some((e) => e.cause))!;
    expect(envFooter(events)).toMatch(/^Environment: .+ \(changed \d+ plays?\)/);
    expect(envFooter([])).toBe('');
  });

  it('box scores stay consistent with environment events in play', () => {
    for (const { events, g } of sample('unhinged', 2)) {
      const box = Object.values(boxScore({ gameId: g.id, awayId: g.awayId, homeId: g.homeId, awayScore: 0, homeScore: 0, innings: 9, events }));
      const sum = (f: (s: StatLine) => number) => box.reduce((n, s) => n + f(s), 0);
      const resolved = events.filter((e) => ['walk', 'strikeout', 'hit', 'out', 'error', 'doublePlay', 'hitByPitch'].includes(e.kind)).length;
      expect(sum((s) => s.pa)).toBe(resolved);
      expect(sum((s) => s.r)).toBe(events.filter((e) => e.kind === 'run').length);
    }
  });

  // Force each effect type: an event that always starts and always fires when it can.
  const league = generateLeague({ seed: 'force' });
  const games = generateSchedule(league.teams, 20).slice(0, 30);
  const allTypes = Object.entries(PHASE_EFFECTS).flatMap(([phase, types]) => types.map((type) => [phase as EnvPhase, type] as const));
  it.each(allTypes)('effect %s / %s changes a play', (phase, type) => {
    const from = ['outToHit', 'induceError', 'outToHomeRun'].includes(type) ? ['groundout', 'flyout', 'lineout', 'popout'] : type === 'hitToOut' ? ['single', 'double'] : undefined;
    const to = type === 'outToHit' ? 'double' : type === 'hitToOut' || type === 'homeRunToOut' ? 'flyout' : undefined;
    const def: EnvEventDef = { id: 'crosswind', name: 'Test', icon: '🧪', chancePerMille: 1000, phase, effect: { type, from, to, chancePerMille: 1000 }, announce: 'x', effectText: 'y' };
    const env: GameEnvironment = { events: [def], chaosPerMille: 1000 };
    const caused = games.flatMap((g) => simulateGame(league, g, 1, 4, env).events.filter((e) => e.cause));
    expect(caused.length, `${type} never fired`).toBeGreaterThan(0);
  });
});

describe('environment in the world', () => {
  it('migration v11 → v12 gives existing stadiums their climates and keeps the engine', () => {
    const u = migrateSave(structuredClone(v10));
    expect(u.engineVersion).toBe(2);
    for (const [teamId, st] of Object.entries(u.weird.stadiums)) expect(st.climates).toEqual(assignClimates(u.settings.seed, teamId));
  });

  it('new universes get climates, and the stadium list only offers matching events', () => {
    const u = createUniverse('c', settings(), 0);
    for (const [, st] of Object.entries(u.weird.stadiums)) {
      expect(st.climates.length).toBeGreaterThan(0);
      for (const e of eligibleEvents(st.climates, [], 'unhinged')) expect(e.climates.includes('any') || e.climates.some((c) => st.climates.includes(c))).toBe(true);
    }
  });

  it('the Prophet’s hint includes the weather forecast', () => {
    const u = { ...createUniverse('p', settings(), 0), persona: { kind: 'prophet' as const, fanName: 'P', favoriteTeamId: null } };
    expect(prophecy(u)).toMatch(/skies whisper/);
  });
});
