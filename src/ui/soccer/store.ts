import { create } from 'zustand';
import type { SoccerEvent } from '../../engine/soccer/types';
import * as store from '../../storage/db';
import { sim } from '../../worker/client';
import {
  createSoccerWorld, reduceSoccer, type SoccerCommand, type SoccerSettings, type SoccerUniverse, type SoccerWorldEvent,
} from '../../world/soccer/universe';
import { requestPersistenceOnce } from '../pwa';
import { planCatchUp } from '../../world/clock';
import { buildSoccerDigest, type SoccerDigest } from '../../world/soccer/digest';
import type { PersonaId } from '../../world/soccer/persona';

/** Democracy FC app state: one universe open; commands go through the worker. */

export type SoccerTab = 'bulletin' | 'matches' | 'facility' | 'vote' | 'archive';
export type SoccerView = 'loading' | 'picker' | 'create' | 'intro' | 'app' | 'settings';
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
  /** "While You Were Gone": shown after the league moved on without the fan. */
  digest: SoccerDigest | null;
  /** Living-mode catch-up progress. */
  catchingUp: { done: number; total: number } | null;

  init(): Promise<void>;
  showPicker(): Promise<void>;
  showCreate(): void;
  showIntro(): void;
  finishIntro(): Promise<void>;
  create(settings: SoccerSettings, clubIndex: number, persona: PersonaId | null): Promise<void>;
  catchUp(): Promise<void>;
  dismissDigest(): void;
  showSettings(): void;
  closeSettings(): void;
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
  digest: null,
  catchingUp: null,

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
      const u = last ? await store.loadUniverse(last) : null;
      if (u) {
        set({ u, view: 'app' });
        await get().catchUp();
      } else await get().showPicker();
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

  create: async (settings, clubIndex, persona) => {
    const draft = createSoccerWorld(crypto.randomUUID(), settings, null, Date.now());
    const clubId = draft.league.teams[Math.max(0, Math.min(clubIndex, draft.league.teams.length - 1))].id;
    const u = { ...draft, favoriteClubId: clubId, clubHistory: [{ clubId, fromSeason: 1 }], persona };
    await store.saveUniverse(u);
    await store.setSetting(LAST_UNIVERSE, u.id);
    set({ u, view: 'app', tab: 'bulletin', watching: null, detail: null });
  },

  open: async (id) => {
    try {
      const u = await store.loadUniverse(id);
      if (!u) throw new Error('That universe no longer exists.');
      await store.setSetting(LAST_UNIVERSE, id);
      set({ u, view: 'app', watching: null, detail: null, tab: 'bulletin', digest: null });
      await get().catchUp();
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
      await store.persistCommand(u, result);
      let next = result.state;
      // Living mode: advancing by hand restarts the clock from the new day.
      if (next.clock && next.dayCount !== u.dayCount) {
        const ev = { type: 'clockSet' as const, clock: { anchorMs: Date.now(), anchorDay: next.dayCount } };
        next = reduceSoccer(next, ev);
        await store.appendEvent(next, ev);
      }
      const multiDay = (cmd.type === 'simDays' && cmd.count > 1) || cmd.type === 'simToSeasonEnd';
      set({ u: next, digest: multiDay ? buildSoccerDigest(u, next, result.events) : get().digest });
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
      await store.appendEvent(next, event);
    } catch (e) {
      set({ error: message(e) });
    }
  },

  playByPlay: async (gameId) => {
    const u = get().u!;
    const saved = await store.loadPlayByPlay(u.id, u.season, gameId);
    if (saved) return saved;
    // Today's matches replay exactly from the state; older ones are gone once compacted.
    const game = u.schedule.find((g) => g.id === gameId);
    return game && game.day === u.currentDay ? sim().replaySoccerMatch(u, gameId) : null;
  },

  catchUp: async () => {
    const start = get().u;
    if (!start?.clock || get().busy || get().catchingUp) return;
    const plan = planCatchUp(start.clock, start.settings.dayLengthMinutes, start.dayCount, Number.POSITIVE_INFINITY, Date.now());
    if (!plan.simulate && !plan.skipped) return;
    set({ busy: true, catchingUp: plan.simulate ? { done: 0, total: plan.simulate } : null });
    try {
      let u = start;
      const events: SoccerWorldEvent[] = [];
      for (let i = 0; i < plan.simulate; i++) {
        const result = await sim().runSoccerCommand(u, { type: 'endDay' });
        await store.persistCommand(u, result);
        events.push(...result.events);
        u = result.state;
        set({ u, catchingUp: { done: i + 1, total: plan.simulate } });
      }
      const clockEvent = { type: 'clockSet' as const, clock: plan.nextClock(u.dayCount) };
      u = reduceSoccer(u, clockEvent);
      await store.appendEvent(u, clockEvent);
      set({ u, digest: plan.simulate ? buildSoccerDigest(start, u, events) : get().digest });
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false, catchingUp: null });
    }
  },

  dismissDigest: () => set({ digest: null }),
  showSettings: () => set({ view: 'settings' }),
  closeSettings: () => set({ view: get().u ? 'app' : 'picker' }),

  clearError: () => set({ error: null }),
}));
