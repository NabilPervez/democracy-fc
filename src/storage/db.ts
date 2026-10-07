import Dexie, { type Table } from 'dexie';
import type { GameEvent } from '../engine/baseball/types';
import { isSeasonOver, PBP_DAYS_KEPT, type CommandResult, type UniverseState, type WorldEvent } from '../world/universe';
import { migrateSave } from './migrate';
import { perkValue } from '../world/persona';
import { gamesToPrune, snapshotsToPrune, type SnapshotRef } from './retention';
import type { SoccerUniverse } from '../world/soccer/universe';

export interface UniverseRow {
  id: string;
  name: string;
  seed: string;
  season: number;
  currentDay: number;
  updatedAt: number;
  /** Which game this save plays (missing on Blastball saves = baseball). */
  sport?: 'baseball' | 'soccer';
  /** Current state — the atomic save. Snapshots are the history. */
  state: UniverseState | SoccerUniverse;
}

export interface SnapshotRow extends SnapshotRef {
  universeId: string;
  createdAt: number;
  state: UniverseState | SoccerUniverse;
}

export interface GameRow {
  universeId: string;
  season: number;
  gameId: string;
  day: number;
  pinned: boolean;
  /** Engine that simmed it; missing on rows saved before Sprint 12 (engine v2 or older). */
  engineVersion?: number;
  /** Baseball GameEvents or soccer SoccerEvents, by the universe's sport. */
  events: GameEvent[];
}

export interface WorldEventRow {
  id?: number;
  universeId: string;
  season: number;
  day: number;
  event: WorldEvent;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class BlastballDB extends Dexie {
  universes!: Table<UniverseRow, string>;
  snapshots!: Table<SnapshotRow, number>;
  games!: Table<GameRow, [string, number, string]>;
  worldEvents!: Table<WorldEventRow, number>;
  settings!: Table<SettingRow, string>;

  constructor(name = 'blastball') {
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

export const db = new BlastballDB();

const rowFor = (state: UniverseState, now: number): UniverseRow => ({
  id: state.id,
  sport: 'baseball',
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
    const meta: Partial<UniverseRow> = { ...row, sport: row.sport ?? (row.state.sport === 'soccer' ? 'soccer' : 'baseball') };
    delete meta.state;
    return meta as UniverseMeta;
  });
}

export async function loadUniverse(id: string, d = db): Promise<UniverseState | null> {
  const row = await d.universes.get(id);
  if (row && (row.state as { sport?: string }).sport === 'soccer') throw new Error('That is a Democracy FC save; open it from the Democracy FC picker.');
  return row ? migrateSave(row.state) : null;
}

export async function saveUniverse(state: UniverseState, d = db, now = Date.now()): Promise<void> {
  await d.universes.put(rowFor(state, now));
}

async function saveSnapshot(state: UniverseState, kind: SnapshotRef['kind'], d: BlastballDB, now: number) {
  await d.snapshots.add({ universeId: state.id, season: state.season, day: state.currentDay - 1, kind, createdAt: now, state } as SnapshotRow);
  const all = await d.snapshots.where('universeId').equals(state.id).toArray();
  await d.snapshots.bulkDelete(snapshotsToPrune(all as SnapshotRef[]));
}

/** Persist the outcome of a command: state, world events, play-by-play, and end-of-day snapshots. */
export async function persistCommand(prev: UniverseState, result: CommandResult, d = db, now = Date.now()): Promise<void> {
  const { state, events, pbp } = result;
  await d.transaction('rw', [d.universes, d.snapshots, d.games, d.worldEvents], async () => {
    await d.universes.put(rowFor(state, now));
    if (events.length) {
      // Track the day each event happened on as we walk forward.
      let day = prev.currentDay;
      await d.worldEvents.bulkAdd(
        events.map((event) => {
          const row = { universeId: state.id, season: state.season, day, event };
          if (event.type === 'dayEnded') day += 1;
          return row;
        }),
      );
    }
    if (pbp.length) {
      await d.games.bulkPut(pbp.map((p) => ({ universeId: state.id, season: p.season, gameId: p.gameId, day: p.day, pinned: false, engineVersion: p.engineVersion, events: p.events })));
    }
    if (state.currentDay !== prev.currentDay) {
      await saveSnapshot(state, isSeasonOver(state) ? 'seasonEnd' : 'daily', d, now);
      const games = await d.games.where('universeId').equals(state.id).toArray();
      const drop = new Set(gamesToPrune(games, state.season, state.currentDay, PBP_DAYS_KEPT, perkValue(state.persona, 'extraPinnedGames')));
      await d.games.bulkDelete(games.filter((g) => drop.has(g.gameId) && !g.pinned).map((g) => [g.universeId, g.season, g.gameId] as [string, number, string]));
    }
  });
}

export async function appendEvent(state: UniverseState, event: WorldEvent, d = db, now = Date.now()): Promise<void> {
  await d.transaction('rw', [d.universes, d.worldEvents], async () => {
    await d.universes.put(rowFor(state, now));
    await d.worldEvents.add({ universeId: state.id, season: state.season, day: state.currentDay, event });
  });
}

export async function loadPlayByPlay(universeId: string, season: number, gameId: string, d = db): Promise<GameEvent[] | null> {
  const row = await d.games.get([universeId, season, gameId]);
  return row?.events ?? null;
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

/** Pin a game so its play-by-play survives compaction. */
export async function setPinned(universeId: string, season: number, gameId: string, pinned: boolean, d = db): Promise<boolean> {
  const updated = await d.games.update([universeId, season, gameId], { pinned });
  return updated > 0;
}

export async function listPinned(universeId: string, d = db): Promise<Omit<GameRow, 'events'>[]> {
  const rows = await d.games.where('universeId').equals(universeId).filter((g) => g.pinned).toArray();
  return rows.map((r) => ({ universeId: r.universeId, season: r.season, gameId: r.gameId, day: r.day, pinned: r.pinned }));
}

export async function isPinned(universeId: string, season: number, gameId: string, d = db): Promise<boolean | null> {
  const row = await d.games.get([universeId, season, gameId]);
  return row ? row.pinned : null;
}
