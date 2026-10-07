import { create } from 'zustand';
import type { SoccerEvent } from '../../engine/soccer/types';
import * as store from '../../storage/db';
import * as soccerDb from '../../storage/soccerDb';
import { sim } from '../../worker/client';
import {
  createSoccerWorld, reduceSoccer, type SoccerCommand, type SoccerSettings, type SoccerUniverse, type SoccerWorldEvent,
} from '../../world/soccer/universe';
import { requestPersistenceOnce } from '../pwa';

/** Democracy FC app state. Mirrors the Blastball store's shape: one universe open, commands go through the worker. */

export type SoccerTab = 'bulletin' | 'matches' | 'facility' | 'vote' | 'archive';
export type SoccerView = 'loading' | 'picker' | 'create' | 'intro' | 'app';
export type Speed = 'live' | 'x2' | 'x5' | 'key' | 'instant';

export const LAST_UNIVERSE = 'lastUniverseId';
const ONBOARDED = 'dfcOnboarded';

interface AssemblyState {
  view: SoccerView;
  universes: store.UniverseMeta[];
  u: SoccerUniverse | null;
  tab: SoccerTab;
  /** The match open in the Matches tab. */
  watching: string | null;
  speed: Speed;
  /** Club or player detail inside the Facility tab. */
  detail: { kind: 'club' | 'player'; id: string } | null;
  busy: boolean;
  error: string | null;

  init(): Promise<void>;
  showPicker(): Promise<void>;
  showCreate(): void;
  showIntro(): void;
  finishIntro(): Promise<void>;
  create(settings: SoccerSettings, clubIndex: number): Promise<void>;
  open(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  setTab(tab: SoccerTab): void;
  setSpeed(speed: Speed): void;
  showDetail(detail: AssemblyState['detail']): void;
  watch(gameId: string | null): Promise<void>;
  run(cmd: SoccerCommand): Promise<void>;
  dispatch(event: SoccerWorldEvent): Promise<void>;
  playByPlay(gameId: string): Promise<SoccerEvent[] | null>;
  clearError(): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Set by the root so opening a legacy Blastball save hands over to the old app. */
let openLegacy: ((id: string) => void) | null = null;
export const setLegacyOpener = (fn: (id: string) => void) => (openLegacy = fn);

export const useAssembly = create<AssemblyState>((set, get) => ({
  view: 'loading',
  universes: [],
  u: null,
  tab: 'bulletin',
  watching: null,
  speed: 'key',
  detail: null,
  busy: false,
  error: null,

  init: async () => {
    try {
      const params = new URLSearchParams(location.search);
      const tab = params.get('tab');
      if (tab && ['bulletin', 'matches', 'facility', 'vote', 'archive'].includes(tab)) set({ tab: tab as SoccerTab });
      if (!(await store.getSetting<boolean>(ONBOARDED)) && (await store.listUniverses()).length === 0) {
        set({ view: 'intro' });
        return;
      }
      const last = await store.getSetting<string>(LAST_UNIVERSE);
      const u = last ? await soccerDb.loadSoccer(last) : null;
      if (u) set({ u, view: 'app' });
      else await get().showPicker();
    } catch (e) {
      set({ error: message(e) });
      await get().showPicker();
    }
  },

  showPicker: async () => set({ universes: await store.listUniverses(), view: 'picker', watching: null, detail: null }),
  showCreate: () => set({ view: 'create' }),
  showIntro: () => set({ view: 'intro' }),
  finishIntro: async () => {
    await store.setSetting(ONBOARDED, true);
    set({ view: get().u ? 'app' : 'create' });
  },

  create: async (settings, clubIndex) => {
    const draft = createSoccerWorld(crypto.randomUUID(), settings, null, Date.now());
    const clubId = draft.league.teams[Math.max(0, Math.min(clubIndex, draft.league.teams.length - 1))].id;
    const u = { ...draft, favoriteClubId: clubId, clubHistory: [{ clubId, fromSeason: 1 }] };
    await soccerDb.saveSoccer(u);
    await store.setSetting(LAST_UNIVERSE, u.id);
    set({ u, view: 'app', tab: 'bulletin', watching: null, detail: null });
  },

  open: async (id) => {
    try {
      const meta = get().universes.find((m) => m.id === id);
      if (meta?.sport !== 'soccer') {
        await store.setSetting(LAST_UNIVERSE, id);
        openLegacy?.(id);
        return;
      }
      const u = await soccerDb.loadSoccer(id);
      if (!u) throw new Error('That universe no longer exists.');
      await store.setSetting(LAST_UNIVERSE, id);
      set({ u, view: 'app', watching: null, detail: null, tab: 'bulletin' });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  remove: async (id) => {
    await store.deleteUniverse(id);
    if (get().u?.id === id) set({ u: null });
    await get().showPicker();
  },

  setTab: (tab) => set({ tab, watching: null, detail: null }),
  setSpeed: (speed) => set({ speed }),
  showDetail: (detail) => set({ detail, tab: 'facility', watching: null }),

  watch: async (gameId) => {
    const u = get().u;
    set({ watching: gameId, tab: gameId ? 'matches' : get().tab, detail: null });
    if (gameId && u && !u.results[gameId] && !u.started.includes(gameId)) await get().dispatch({ type: 'matchStarted', gameId });
  },

  run: async (cmd) => {
    const { u, busy } = get();
    if (!u || busy) return;
    set({ busy: true });
    try {
      const result = await sim().runSoccerCommand(u, cmd);
      await soccerDb.persistSoccerCommand(u, result);
      set({ u: result.state });
      void requestPersistenceOnce();
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },

  dispatch: async (event) => {
    const { u } = get();
    if (!u) return;
    const next = reduceSoccer(u, event);
    if (next === u) return;
    set({ u: next });
    try {
      await soccerDb.appendSoccerEvent(next, event);
    } catch (e) {
      set({ error: message(e) });
    }
  },

  playByPlay: async (gameId) => {
    const u = get().u!;
    const saved = await soccerDb.loadSoccerPlayByPlay(u.id, u.season, gameId);
    if (saved) return saved;
    // Today's matches replay exactly from the state; older ones are gone once compacted.
    const game = u.schedule.find((g) => g.id === gameId);
    return game && game.day === u.currentDay ? sim().replaySoccerMatch(u, gameId) : null;
  },

  clearError: () => set({ error: null }),
}));
