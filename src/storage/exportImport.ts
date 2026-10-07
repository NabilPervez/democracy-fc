import { ENGINE_VERSION } from '../engine/baseball/game';
import { SAVE_VERSION, type UniverseState } from '../world/universe';
import { db, type BlastballDB, type GameRow, type SnapshotRow, type WorldEventRow } from './db';
import { InvalidSaveError, migrateSave } from './migrate';

/** `.league` file: gzip-compressed JSON. */
export const LEAGUE_FORMAT = 'blastball.league';
export const LEAGUE_FORMAT_VERSION = 1;

export interface LeagueFile {
  format: typeof LEAGUE_FORMAT;
  formatVersion: number;
  saveVersion: number;
  engineVersion: number;
  exportedAt: number;
  state: UniverseState;
  snapshots: Omit<SnapshotRow, 'id' | 'universeId'>[];
  worldEvents: Omit<WorldEventRow, 'id' | 'universeId'>[];
  games: Omit<GameRow, 'universeId'>[];
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

async function gunzip(blob: Blob): Promise<string> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function exportUniverse(id: string, opts: { includePlayByPlay: boolean }, d: BlastballDB = db, now = Date.now()): Promise<Blob> {
  const row = await d.universes.get(id);
  if (!row) throw new Error('Universe not found.');
  const strip = <T extends { universeId: string; id?: number }>(r: T) => {
    const copy: Partial<T> = { ...r };
    delete copy.universeId;
    delete copy.id;
    return copy;
  };
  const file: LeagueFile = {
    format: LEAGUE_FORMAT,
    formatVersion: LEAGUE_FORMAT_VERSION,
    saveVersion: SAVE_VERSION,
    engineVersion: ENGINE_VERSION,
    exportedAt: now,
    state: row.state,
    snapshots: (await d.snapshots.where('universeId').equals(id).toArray()).map(strip) as LeagueFile['snapshots'],
    worldEvents: (await d.worldEvents.where('universeId').equals(id).toArray()).map(strip) as LeagueFile['worldEvents'],
    games: opts.includePlayByPlay ? ((await d.games.where('universeId').equals(id).toArray()).map(strip) as LeagueFile['games']) : [],
  };
  return gzip(JSON.stringify(file));
}

/** Validate and migrate a `.league` file. Throws InvalidSaveError / NewerSaveError without touching the DB. */
export async function readLeagueFile(blob: Blob): Promise<LeagueFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await gunzip(blob));
  } catch {
    throw new InvalidSaveError("This file isn't a readable .league save (it may be corrupt).");
  }
  const f = parsed as Partial<LeagueFile>;
  if (!f || f.format !== LEAGUE_FORMAT) throw new InvalidSaveError("This file isn't a Blastball .league save.");
  if (typeof f.formatVersion !== 'number' || f.formatVersion > LEAGUE_FORMAT_VERSION) {
    throw new InvalidSaveError('This .league file is from a newer version of Blastball. Update the app first.');
  }
  if (!Array.isArray(f.snapshots) || !Array.isArray(f.worldEvents) || !Array.isArray(f.games)) {
    throw new InvalidSaveError('This .league file is incomplete.');
  }
  const state = migrateSave(f.state);
  const snapshots = f.snapshots.map((s) => ({ ...s, state: migrateSave(s.state) }));
  return { ...(f as LeagueFile), state, snapshots };
}

/**
 * Import a `.league` file. If a universe with the same id already exists, the import becomes
 * a copy with a new id so nothing is overwritten. Returns the imported universe's id.
 */
export async function importLeague(blob: Blob, d: BlastballDB = db, newId: () => string = () => crypto.randomUUID(), now = Date.now()): Promise<string> {
  const file = await readLeagueFile(blob);
  const exists = !!(await d.universes.get(file.state.id));
  const id = exists ? newId() : file.state.id;
  const rename = (s: UniverseState): UniverseState =>
    exists ? { ...s, id, settings: { ...s.settings, name: `${s.settings.name} (copy)` } } : s;
  const state = rename(file.state);

  await d.transaction('rw', [d.universes, d.snapshots, d.games, d.worldEvents], async () => {
    await d.universes.put({ id, name: state.settings.name, seed: state.settings.seed, season: state.season, currentDay: state.currentDay, updatedAt: now, state });
    await d.snapshots.bulkAdd(file.snapshots.map((s) => ({ ...s, universeId: id, state: rename(s.state) }) as SnapshotRow));
    await d.worldEvents.bulkAdd(file.worldEvents.map((e) => ({ ...e, universeId: id })));
    await d.games.bulkPut(file.games.map((g) => ({ ...g, universeId: id })));
  });
  return id;
}

export const leagueFileName = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'universe'}.league`;
