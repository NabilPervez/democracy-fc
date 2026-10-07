import type { SoccerEvent } from '../engine/soccer/types';
import { db, type BlastballDB, type SnapshotRow, type UniverseRow } from './db';
import { snapshotsToPrune, gamesToPrune, type SnapshotRef } from './retention';
import { PBP_DAYS_KEPT, SOCCER_SAVE_VERSION, type SoccerCommandResult, type SoccerUniverse, type SoccerWorldEvent } from '../world/soccer/universe';

/**
 * Democracy FC saves live in the same IndexedDB tables as Blastball saves (one picker, one
 * export format); rows are tagged `sport: 'soccer'`. Same write pattern: state + events +
 * play-by-play in one transaction, snapshots at day boundaries.
 */

const rowFor = (state: SoccerUniverse, now: number): UniverseRow => ({
  id: state.id,
  sport: 'soccer',
  name: state.settings.name,
  seed: state.settings.seed,
  season: state.season,
  currentDay: state.currentDay,
  updatedAt: now,
  state,
});

export async function loadSoccer(id: string, d: BlastballDB = db): Promise<SoccerUniverse | null> {
  const row = await d.universes.get(id);
  if (!row) return null;
  const state = row.state as SoccerUniverse;
  if (state.sport !== 'soccer') return null;
  if (state.saveVersion > SOCCER_SAVE_VERSION) throw new Error('This save is from a newer version of Democracy FC. Update the app first.');
  return state;
}

export const saveSoccer = async (state: SoccerUniverse, d: BlastballDB = db, now = Date.now()) => {
  await d.universes.put(rowFor(state, now));
};

export async function persistSoccerCommand(prev: SoccerUniverse, result: SoccerCommandResult, d: BlastballDB = db, now = Date.now()): Promise<void> {
  const { state, events, pbp } = result;
  await d.transaction('rw', [d.universes, d.snapshots, d.games, d.worldEvents], async () => {
    await d.universes.put(rowFor(state, now));
    if (events.length) {
      let day = prev.currentDay;
      await d.worldEvents.bulkAdd(
        events.map((event) => {
          const row = { universeId: state.id, season: state.season, day, event: event as never };
          if (event.type === 'dayEnded') day += 1;
          return row;
        }),
      );
    }
    if (pbp.length) {
      await d.games.bulkPut(pbp.map((p) => ({ universeId: state.id, season: p.season, gameId: p.gameId, day: p.day, pinned: false, events: p.events as never })));
    }
    if (state.currentDay !== prev.currentDay) {
      await d.snapshots.add({ universeId: state.id, season: state.season, day: state.currentDay - 1, kind: state.phase === 'offseason' ? 'seasonEnd' : 'daily', createdAt: now, state } as SnapshotRow);
      const all = await d.snapshots.where('universeId').equals(state.id).toArray();
      await d.snapshots.bulkDelete(snapshotsToPrune(all as SnapshotRef[]));
      const games = await d.games.where('universeId').equals(state.id).toArray();
      const drop = new Set(gamesToPrune(games, state.season, state.currentDay, PBP_DAYS_KEPT, 0));
      await d.games.bulkDelete(games.filter((g) => drop.has(g.gameId) && !g.pinned).map((g) => [g.universeId, g.season, g.gameId] as [string, number, string]));
    }
  });
}

export async function appendSoccerEvent(state: SoccerUniverse, event: SoccerWorldEvent, d: BlastballDB = db, now = Date.now()): Promise<void> {
  await d.transaction('rw', [d.universes, d.worldEvents], async () => {
    await d.universes.put(rowFor(state, now));
    await d.worldEvents.add({ universeId: state.id, season: state.season, day: state.currentDay, event: event as never });
  });
}

export async function loadSoccerPlayByPlay(universeId: string, season: number, gameId: string, d: BlastballDB = db): Promise<SoccerEvent[] | null> {
  const row = await d.games.get([universeId, season, gameId]);
  return (row?.events as unknown as SoccerEvent[] | undefined) ?? null;
}
