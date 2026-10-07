import Dexie, { type Table } from 'dexie';
import type { SoccerEvent } from '../engine/soccer/types';
import { PBP_DAYS_KEPT, SOCCER_SAVE_VERSION, type SoccerCommandResult, type SoccerUniverse, type SoccerWorldEvent } from '../world/soccer/universe';
import { gamesToPrune, snapshotsToPrune, type SnapshotRef } from './retention';

/**
 * Local-first saves (IndexedDB). The current state is the atomic save; world events are the
 * history; snapshots are taken at day boundaries; play-by-play is kept for recent days.
 */

export interface UniverseRow {
  id: string;
  name: string;
  seed: string;
  season: number;
  currentDay: number;
  updatedAt: number;
  state: SoccerUniverse;
}

export interface SnapshotRow extends Omit<SnapshotRef, 'id'> {
  id?: number;
  universeId: string;
  createdAt: number;
  state: SoccerUniverse;
}

export interface GameRow {
  universeId: string;
  season: number;
  gameId: string;
  day: number;
  pinned: boolean;
  events: SoccerEvent[];
}

export interface WorldEventRow {
  id?: number;
  universeId: string;
  season: number;
  day: number;
  event: SoccerWorldEvent;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class AssemblyDB extends Dexie {
  universes!: Table<UniverseRow, string>;
  snapshots!: Table<SnapshotRow, number>;
  games!: Table<GameRow, [string, number, string]>;
  worldEvents!: Table<WorldEventRow, number>;
  settings!: Table<SettingRow, string>;

  constructor(name = 'democracy-fc') {
    super(name);
    this.version(1).stores({
      universes: 'id, updatedAt',
      snapshots: '++id, universeId',
      games: '[universeId+season+gameId], universeId',
      worldEvents: '++id, universeId',
      settings: 'key',
    });
  }
}

export const db = new AssemblyDB();

const rowFor = (state: SoccerUniverse, now: number): UniverseRow => ({
  id: state.id,
  name: state.settings.name,
  seed: state.settings.seed,
  season: state.season,
  currentDay: state.currentDay,
  updatedAt: now,
  state,
});

export type UniverseMeta = Omit<UniverseRow, 'state'>;

export async function listUniverses(d = db): Promise<UniverseMeta[]> {
  const rows = await d.universes.orderBy('updatedAt').reverse().toArray();
  return rows.map((row) => {
    const meta: Partial<UniverseRow> = { ...row };
    delete meta.state;
    return meta as UniverseMeta;
  });
}

export async function loadUniverse(id: string, d = db): Promise<SoccerUniverse | null> {
  const row = await d.universes.get(id);
  if (!row) return null;
  if (row.state.saveVersion > SOCCER_SAVE_VERSION) throw new Error('This save is from a newer version of Democracy FC. Update the app first.');
  return row.state;
}

export const saveUniverse = async (state: SoccerUniverse, d = db, now = Date.now()) => {
  await d.universes.put(rowFor(state, now));
};

/** Persist a command's outcome: state, world events, play-by-play, and end-of-day snapshots. */
export async function persistCommand(prev: SoccerUniverse, result: SoccerCommandResult, d = db, now = Date.now()): Promise<void> {
  const { state, events, pbp } = result;
  await d.transaction('rw', [d.universes, d.snapshots, d.games, d.worldEvents], async () => {
    await d.universes.put(rowFor(state, now));
    if (events.length) {
      let day = prev.currentDay;
      await d.worldEvents.bulkAdd(
        events.map((event) => {
          const row = { universeId: state.id, season: state.season, day, event };
          if (event.type === 'dayEnded') day += 1;
          return row;
        }),
      );
    }
    if (pbp.length) await d.games.bulkPut(pbp.map((p) => ({ universeId: state.id, season: p.season, gameId: p.gameId, day: p.day, pinned: false, events: p.events })));
    if (state.currentDay !== prev.currentDay) {
      await d.snapshots.add({ universeId: state.id, season: state.season, day: state.currentDay - 1, kind: state.phase === 'offseason' ? 'seasonEnd' : 'daily', createdAt: now, state });
      const all = await d.snapshots.where('universeId').equals(state.id).toArray();
      await d.snapshots.bulkDelete(snapshotsToPrune(all as SnapshotRef[]));
      const games = await d.games.where('universeId').equals(state.id).toArray();
      const drop = new Set(gamesToPrune(games, state.season, state.currentDay, PBP_DAYS_KEPT));
      await d.games.bulkDelete(games.filter((g) => drop.has(g.gameId) && !g.pinned).map((g) => [g.universeId, g.season, g.gameId] as [string, number, string]));
    }
  });
}

export async function appendEvent(state: SoccerUniverse, event: SoccerWorldEvent, d = db, now = Date.now()): Promise<void> {
  await d.transaction('rw', [d.universes, d.worldEvents], async () => {
    await d.universes.put(rowFor(state, now));
    await d.worldEvents.add({ universeId: state.id, season: state.season, day: state.currentDay, event });
  });
}

export async function loadPlayByPlay(universeId: string, season: number, gameId: string, d = db): Promise<SoccerEvent[] | null> {
  return (await d.games.get([universeId, season, gameId]))?.events ?? null;
}

export async function deleteUniverse(id: string, d = db): Promise<void> {
  await d.transaction('rw', [d.universes, d.snapshots, d.games, d.worldEvents], async () => {
    await d.universes.delete(id);
    await d.snapshots.where('universeId').equals(id).delete();
    await d.games.where('universeId').equals(id).delete();
    await d.worldEvents.where('universeId').equals(id).delete();
  });
}

export async function getSetting<T>(key: string, d = db): Promise<T | undefined> {
  return (await d.settings.get(key))?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown, d = db): Promise<void> {
  await d.settings.put({ key, value });
}
