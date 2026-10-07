import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AssemblyDB, appendEvent as appendSoccerEvent, listUniverses, loadPlayByPlay as loadSoccerPlayByPlay, loadUniverse as loadSoccer, persistCommand as persistSoccerCommand, saveUniverse as saveSoccer } from '../src/storage/db';
import { exportUniverse, importLeague } from '../src/storage/exportImport';
import { createSoccerWorld, reduceSoccer, runSoccerCommand } from '../src/world/soccer/universe';

const world = () => createSoccerWorld('dfc-1', { name: 'Stored', seed: 'stored', leagueSize: 8, chaos: 'normal', timeMode: 'manual', dayLengthMinutes: 60 }, null, 0);

describe('saves', () => {
  it('save, persist a command, append an event, load it back', async () => {
    const d = new AssemblyDB('dfc-store-1');
    const u = world();
    await saveSoccer(u, d);
    const result = runSoccerCommand(u, { type: 'simDays', count: 2 });
    await persistSoccerCommand(u, result, d);
    const g = result.state.schedule.find((x) => x.day === result.state.currentDay)!;
    const next = reduceSoccer(result.state, { type: 'betPlaced', gameId: g.id, teamId: g.homeId, amount: 5 });
    await appendSoccerEvent(next, { type: 'betPlaced', gameId: g.id, teamId: g.homeId, amount: 5 }, d);
    expect(await loadSoccer(u.id, d)).toEqual(next);
    const metas = await listUniverses(d);
    expect(metas[0].name).toBe('Stored');
    const played = result.pbp[0];
    expect(await loadSoccerPlayByPlay(u.id, played.season, played.gameId, d)).toEqual(played.events);
  });

  it('exports and re-imports a soccer save as a copy with sport in the metadata', async () => {
    const d = new AssemblyDB('dfc-store-2');
    const u = runSoccerCommand(world(), { type: 'simDays', count: 3 }).state;
    await saveSoccer(u, d);
    const blob = await exportUniverse(u.id, { includePlayByPlay: false }, d);
    const id = await importLeague(blob, d, () => 'copy-1');
    expect(id).toBe('copy-1');
    const copy = (await loadSoccer('copy-1', d))!;
    expect(copy.settings.name).toBe('Stored (copy)');
    expect(copy.results).toEqual(u.results);
  });
});
