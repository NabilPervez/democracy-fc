import { SOCCER_ENGINE_VERSION } from '../engine/soccer/game';
import { SOCCER_SAVE_VERSION, type SoccerUniverse } from '../world/soccer/universe';
import { db, type AssemblyDB, type GameRow, type SnapshotRow, type WorldEventRow } from './db';

/** `.league` backup file: gzip-compressed JSON of a universe and its history. */
export const LEAGUE_FORMAT = 'democracy-fc.league';
export const LEAGUE_FORMAT_VERSION = 1;

export class InvalidSaveError extends Error {}

export interface LeagueFile {
  format: typeof LEAGUE_FORMAT;
  formatVersion: number;
  saveVersion: number;
  engineVersion: number;
  exportedAt: number;
  state: SoccerUniverse;
  snapshots: Omit<SnapshotRow, 'id' | 'universeId'>[];
  worldEvents: Omit<WorldEventRow, 'id' | 'universeId'>[];
  games: Omit<GameRow, 'universeId'>[];
}

async function gzip(text: string): Promise<Blob> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

async function gunzip(blob: Blob): Promise<string> {
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

const strip = <T extends { universeId: string; id?: number }>(r: T): Omit<T, 'universeId' | 'id'> => {
  const copy: Partial<T> = { ...r };
  delete copy.universeId;
  delete copy.id;
  return copy as Omit<T, 'universeId' | 'id'>;
};

export async function exportUniverse(id: string, opts: { includePlayByPlay: boolean }, d: AssemblyDB = db, now = Date.now()): Promise<Blob> {
  const row = await d.universes.get(id);
  if (!row) throw new Error('Universe not found.');
  const file: LeagueFile = {
    format: LEAGUE_FORMAT,
    formatVersion: LEAGUE_FORMAT_VERSION,
    saveVersion: SOCCER_SAVE_VERSION,
    engineVersion: SOCCER_ENGINE_VERSION,
    exportedAt: now,
    state: row.state,
    snapshots: (await d.snapshots.where('universeId').equals(id).toArray()).map(strip),
    worldEvents: (await d.worldEvents.where('universeId').equals(id).toArray()).map(strip),
    games: opts.includePlayByPlay ? (await d.games.where('universeId').equals(id).toArray()).map(strip) : [],
  };
  return gzip(JSON.stringify(file));
}

/** Validate a `.league` file without touching the DB. */
export async function readLeagueFile(blob: Blob): Promise<LeagueFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await gunzip(blob));
  } catch {
    throw new InvalidSaveError("This file isn't a readable .league backup (it may be corrupt).");
  }
  const f = parsed as Partial<LeagueFile>;
  if (!f || f.format !== LEAGUE_FORMAT) throw new InvalidSaveError("This file isn't a Democracy FC backup.");
  if (typeof f.formatVersion !== 'number' || f.formatVersion > LEAGUE_FORMAT_VERSION || (f.state?.saveVersion ?? Infinity) > SOCCER_SAVE_VERSION) {
    throw new InvalidSaveError('This backup is from a newer version of Democracy FC. Update the app first.');
  }
  if (!f.state?.id || !f.state.league || !Array.isArray(f.snapshots) || !Array.isArray(f.worldEvents) || !Array.isArray(f.games)) {
    throw new InvalidSaveError('This backup is incomplete.');
  }
  return f as LeagueFile;
}

/** Import a backup. If the universe already exists, the import becomes a copy with a new id. */
export async function importLeague(blob: Blob, d: AssemblyDB = db, newId: () => string = () => crypto.randomUUID(), now = Date.now()): Promise<string> {
  const file = await readLeagueFile(blob);
  const exists = !!(await d.universes.get(file.state.id));
  const id = exists ? newId() : file.state.id;
  const rename = (s: SoccerUniverse): SoccerUniverse => (exists ? { ...s, id, settings: { ...s.settings, name: `${s.settings.name} (copy)` } } : s);
  const state = rename(file.state);
  await d.transaction('rw', [d.universes, d.snapshots, d.games, d.worldEvents], async () => {
    await d.universes.put({ id, name: state.settings.name, seed: state.settings.seed, season: state.season, currentDay: state.currentDay, updatedAt: now, state });
    await d.snapshots.bulkAdd(file.snapshots.map((s) => ({ ...s, universeId: id, state: rename(s.state) })));
    await d.worldEvents.bulkAdd(file.worldEvents.map((e) => ({ ...e, universeId: id })));
    await d.games.bulkPut(file.games.map((g) => ({ ...g, universeId: id })));
  });
  return id;
}

export const leagueFileName = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'universe'}.league`;
