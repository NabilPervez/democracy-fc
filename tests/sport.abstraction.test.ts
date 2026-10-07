import { describe, expect, it } from 'vitest';
import fixture from './fixtures/baseball-v4-universe.json';
import { hashSeed } from '../src/engine/core/rng';
import { getSport } from '../src/engine/core/registry';
import { migrateSave } from '../src/storage/migrate';
import v10 from './fixtures/save-v10.json';
import { createUniverse, runCommand, type UniverseSettings } from '../src/world/universe';

const settings = (chaos: UniverseSettings['chaos']): UniverseSettings => ({
  name: 'Fingerprint', seed: `fp-${chaos}`, leagueSize: 8, seasonLength: 20, chaos, timeMode: 'manual', dayLengthMinutes: 60,
});

describe('sport abstraction', () => {
  it('baseball output is byte-identical to the pre-abstraction build', () => {
    const now: Record<string, string> = {};
    for (const chaos of ['calm', 'normal', 'weird', 'unhinged'] as const) {
      const { state, events } = runCommand(createUniverse('fp', settings(chaos), 0), { type: 'simToSeasonEnd' });
      now[`${chaos}:results`] = hashSeed(JSON.stringify(state.results)).join('.');
      now[`${chaos}:events`] = hashSeed(JSON.stringify(events)).join('.');
    }
    expect(now).toEqual(fixture.fingerprints);
  });

  it('new universes default to baseball and resolve through the registry', () => {
    const u = createUniverse('u', settings('normal'), 0);
    expect(u.sport).toBe('baseball');
    const sport = getSport(u.sport);
    expect(sport.id).toBe('baseball');
    expect(sport.allowsDraws).toBe(false);
  });

  it('old saves migrate to sport: baseball', () => {
    expect(migrateSave(structuredClone(v10)).sport).toBe('baseball');
  });

  it('unknown sports throw', () => {
    expect(() => getSport('cricket' as never)).toThrow();
  });
});
