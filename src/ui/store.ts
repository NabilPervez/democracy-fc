import { create } from 'zustand';
import type { GameEvent } from '../engine/baseball/types';
import * as store from '../storage/db';
import { sim } from '../worker/client';
import { requestPersistenceOnce } from './pwa';
import { DEFAULT_FIRST_PITCH_PCT, firstPitchMs, planCatchUp, playsSince } from '../world/clock';
import { buildDigest, type Digest } from '../world/digest';
import type { Persona } from '../world/persona';
import { createUniverse, reduce, unplayedToday, type Command, type UniverseSettings, type UniverseState, type WorldEvent } from '../world/universe';

export type Tab = 'today' | 'games' | 'league' | 'vote' | 'history' | 'settings' | 'guide';
export type View = 'loading' | 'picker' | 'create' | 'app' | 'intro';

const LAST_UNIVERSE = 'lastUniverseId';

interface State {
  view: View;
  universes: store.UniverseMeta[];
  u: UniverseState | null;
  tab: Tab;
  watchingGameId: string | null;
  /** Team / player detail pages inside the League tab. */
  detail: { kind: 'team' | 'player'; id: string } | null;
  busy: boolean;
  error: string | null;
  /** Seed prefilled on the create screen (e.g. from a shared ?seed= link). */
  pendingSeed: string | null;
  /** What happened over the last stretch of simulated days, shown until dismissed. */
  digest: Digest | null;
  /** Living-mode catch-up progress. */
  catchingUp: { done: number; total: number } | null;

  catchUp(): Promise<void>;
  /** The game currently playing live in the "Now playing" ticker. */
  live: { gameId: string; events: GameEvent[]; shown: number } | null;
  liveEnabled: boolean;
  /** Games running in the background (from "Play all games" or left mid-watch), keyed by game id. */
  running: Record<string, { events: GameEvent[]; shown: number }>;
  /** Start every unplayed game today at once. */
  startAll(): Promise<void>;
  /** Remember how far the player watched a game so it keeps playing after they leave. */
  setProgress(gameId: string, events: GameEvent[], shown: number): void;
  setLiveEnabled(on: boolean): void;
  /** Advance the live ticker by one play (called on a timer). */
  liveTick(): Promise<void>;
  dismissDigest(): void;

  init(): Promise<void>;
  showPicker(): Promise<void>;
  showCreate(seed?: string): void;
  /** Replay the onboarding intro; afterwards return to the app (or create a league). */
  showIntro(): void;
  finishIntro(): void;
  createUniverse(settings: UniverseSettings, persona: Persona): Promise<void>;
  openUniverse(id: string): Promise<void>;
  deleteUniverse(id: string): Promise<void>;
  setTab(tab: Tab): void;
  showDetail(detail: State['detail']): void;
  run(cmd: Command): Promise<void>;
  /** Apply a single player-driven event (bets, watching…) and save it. */
  dispatch(event: WorldEvent): Promise<void>;
  watch(gameId: string | null): Promise<void>;
  /** Play-by-play for a game, or null if it was played long ago and its feed has been archived. */
  playByPlay(gameId: string): Promise<GameEvent[] | null>;
  clearError(): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Democracy FC owns the picker and universe creation; the legacy app hands back to it (set by the Root). */
let legacyExit: (() => void) | null = null;
export const setLegacyExit = (fn: () => void) => (legacyExit = fn);

export const useGame = create<State>((set, get) => ({
  view: 'loading',
  universes: [],
  u: null,
  tab: 'today',
  watchingGameId: null,
  detail: null,
  busy: false,
  error: null,
  pendingSeed: null,
  digest: null,
  catchingUp: null,
  live: null,
  liveEnabled: true,
  running: {},

  init: async () => {
    try {
      const params = new URLSearchParams(location.search);
      // Deep links from home-screen shortcuts, e.g. /?tab=vote
      const tab = params.get('tab');
      if (tab && ['today', 'games', 'league', 'vote', 'history', 'settings', 'guide'].includes(tab)) set({ tab: tab as Tab });
      if (params.has('tab') || params.has('source')) history.replaceState(null, '', location.pathname + (params.has('seed') ? `?seed=${params.get('seed')}` : ''));
      const seed = params.get('seed');
      if (seed) {
        history.replaceState(null, '', location.pathname);
        set({ universes: await store.listUniverses() });
        get().showCreate(seed);
        return;
      }
      // First visit ever: show the intro before anything else.
      if (!(await store.getSetting<boolean>('onboarded')) && (await store.listUniverses()).length === 0) {
        set({ view: 'intro' });
        return;
      }
      set({ liveEnabled: (await store.getSetting<boolean>('liveTicker')) ?? true });
      const last = await store.getSetting<string>(LAST_UNIVERSE);
      const u = last ? await store.loadUniverse(last) : null;
      if (u) {
        set({ u, view: 'app' });
        await get().catchUp();
      }
      else await get().showPicker();
    } catch (e) {
      set({ error: message(e) });
      await get().showPicker();
    }
  },

  showPicker: async () => {
    if (legacyExit) {
      set({ u: null, view: 'loading', watchingGameId: null, detail: null });
      legacyExit();
      return;
    }
    set({ universes: await store.listUniverses(), view: 'picker', watchingGameId: null, detail: null });
  },

  showCreate: (seed) => {
    if (legacyExit) return void get().showPicker();
    set({ view: 'create', pendingSeed: seed ?? null });
  },
  showIntro: () => set({ view: 'intro' }),
  finishIntro: () => set({ view: get().u ? 'app' : 'create' }),

  createUniverse: async (settings, persona) => {
    const u = createUniverse(crypto.randomUUID(), settings, Date.now(), persona);
    await store.saveUniverse(u);
    await store.setSetting(LAST_UNIVERSE, u.id);
    set({ u, view: 'app', tab: 'today', watchingGameId: null, detail: null, live: null, running: {} });
  },

  openUniverse: async (id) => {
    try {
      const u = await store.loadUniverse(id);
      if (!u) throw new Error('That universe no longer exists.');
      await store.setSetting(LAST_UNIVERSE, id);
      set({ u, view: 'app', watchingGameId: null, detail: null, digest: null, live: null, running: {} });
      await get().catchUp();
    } catch (e) {
      set({ error: message(e) });
    }
  },

  deleteUniverse: async (id) => {
    await store.deleteUniverse(id);
    if (get().u?.id === id) set({ u: null });
    await get().showPicker();
  },

  setTab: (tab) => set({ tab, watchingGameId: null, detail: null }),
  showDetail: (detail) => set({ detail, tab: 'league', watchingGameId: null }),

  run: async (cmd) => {
    const { u, busy } = get();
    if (!u || busy) return;
    set({ busy: true });
    try {
      const result = await sim().runCommand(u, cmd);
      await store.persistCommand(u, result);
      let next = result.state;
      // In Living mode, advancing by hand restarts the clock from the new day.
      if (next.clock && next.dayCount !== u.dayCount) {
        const ev = { type: 'clockSet' as const, clock: { anchorMs: Date.now(), anchorDay: next.dayCount } };
        next = reduce(next, ev);
        await store.appendEvent(next, ev);
      }
      const multiDay = (cmd.type === 'simDays' && cmd.count > 1) || cmd.type === 'simToSeasonEnd';
      set({ u: next, digest: multiDay ? buildDigest(u, next, result.events) : get().digest });
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
    const next = reduce(u, event);
    if (next === u) return;
    set({ u: next });
    try {
      await store.appendEvent(next, event);
    } catch (e) {
      set({ error: message(e) });
    }
  },

  watch: async (gameId) => {
    const u = get().u;
    // Watching from the first pitch is logged before the game starts (and before the feed is
    // simulated), so perks that depend on it replay exactly. Then the game starts.
    if (gameId && u && !u.results[gameId] && !u.started.includes(gameId)) await get().dispatch({ type: 'watchedLive', gameId });
    set({ watchingGameId: gameId, tab: gameId ? 'games' : get().tab, detail: null });
    const now = get().u;
    if (gameId && now && !now.results[gameId]) await get().dispatch({ type: 'gameStarted', gameId });
  },

  playByPlay: async (gameId) => {
    const u = get().u!;
    const saved = await store.loadPlayByPlay(u.id, u.season, gameId);
    if (saved) return saved;
    // Unplayed games can be previewed exactly (deterministic). Played games can't be replayed
    // once elections have changed the league, so their feed is gone after compaction.
    return u.results[gameId] ? null : sim().replayGame(u, gameId);
  },

  catchUp: async () => {
    const start = get().u;
    if (!start?.clock || get().busy || get().catchingUp) return;
    const plan = planCatchUp(start.clock, start.settings.dayLengthMinutes, start.dayCount, Number.POSITIVE_INFINITY, Date.now());
    if (!plan.simulate && !plan.skipped) return;
    set({ busy: true, catchingUp: plan.simulate ? { done: 0, total: plan.simulate } : null });
    try {
      let u = start;
      const events: WorldEvent[] = [];
      for (let i = 0; i < plan.simulate; i++) {
        const result = await sim().runCommand(u, { type: 'simDays', count: 1 });
        await store.persistCommand(u, result);
        events.push(...result.events);
        u = result.state;
        set({ u, catchingUp: { done: i + 1, total: plan.simulate } });
      }
      const clockEvent = { type: 'clockSet' as const, clock: plan.nextClock(u.dayCount) };
      u = reduce(u, clockEvent);
      await store.appendEvent(u, clockEvent);
      set({ u, digest: plan.simulate ? buildDigest(start, u, events, plan.skipped) : get().digest });
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false, catchingUp: null });
    }
  },

  dismissDigest: () => set({ digest: null }),

  setLiveEnabled: (on) => {
    set({ liveEnabled: on });
    void store.setSetting('liveTicker', on);
  },

  setProgress: (gameId, events, shown) => set({ running: { ...get().running, [gameId]: { events, shown } } }),

  startAll: async () => {
    const u = get().u;
    if (!u || get().busy) return;
    const live = get().live;
    for (const g of unplayedToday(u)) {
      if (get().running[g.id] || live?.gameId === g.id) continue;
      if (!get().u!.started.includes(g.id)) await get().dispatch({ type: 'gameStarted', gameId: g.id });
      const events = await sim().replayGame(get().u!, g.id);
      if (get().u?.results[g.id] || get().running[g.id]) continue;
      set({ running: { ...get().running, [g.id]: { events, shown: 1 } } });
    }
  },

  liveTick: async () => {
    const { u, live, liveEnabled, busy, view, running, watchingGameId } = get();
    // Games only start when the player kicks them off (Play all, or opening one to watch).
    if (!u || view !== 'app' || busy || !liveEnabled || u.phase === 'offseason') return;

    // Living mode: at first pitch every game starts together — and if the player arrives late,
    // each game picks up where it would be by the clock.
    if (u.clock && u.settings.timeMode === 'living') {
      const start = firstPitchMs(u.clock, u.settings.dayLengthMinutes, u.dayCount, u.settings.firstPitchPct ?? DEFAULT_FIRST_PITCH_PCT);
      const now = Date.now();
      const due = now >= start ? unplayedToday(u).filter((g) => !running[g.id] && g.id !== watchingGameId) : [];
      if (due.length) {
        const added: State['running'] = {};
        for (const g of due) {
          if (!get().u!.started.includes(g.id)) await get().dispatch({ type: 'gameStarted', gameId: g.id });
          const events = await sim().replayGame(get().u!, g.id);
          added[g.id] = { events, shown: Math.min(events.length, playsSince(start, now)) };
        }
        set({ running: { ...get().running, ...added } });
        return;
      }
    }

    // Background games advance one play per tick (the one being watched full-screen drives itself).
    const ids = Object.keys(running);
    if (ids.length) {
      const next: State['running'] = {};
      const finished: string[] = [];
      for (const id of ids) {
        const r = running[id];
        if (u.results[id]) continue;
        if (id === watchingGameId) next[id] = r;
        else if (r.shown < r.events.length) next[id] = { ...r, shown: r.shown + 1 };
        else finished.push(id);
      }
      set({ running: next });
      for (const id of finished) if (!get().u?.results[id]) await get().run({ type: 'playGame', gameId: id });
    }

    // Older saves' ticker game: finish it off like any other running game.
    if (live && !u.results[live.gameId] && !running[live.gameId]) set({ running: { ...get().running, [live.gameId]: { events: live.events, shown: live.shown } }, live: null });
  },

  clearError: () => set({ error: null }),
}));
