import { fullLine, type StatLine } from '../engine/baseball/boxScore';
import { assignClimates } from '../world/environment';
import { createFactions } from '../world/factions';
import { initialAge, initialExperience } from '../world/seasons';
import { createStadiums } from '../world/weird';
import { bornWith, SAVE_VERSION, type UniverseState } from '../world/universe';

/** Raised when a save was written by a newer version of the game than this one. */
export class NewerSaveError extends Error {
  constructor(version: number) {
    super(`This save is from a newer version of Blastball (save v${version}, this app reads up to v${SAVE_VERSION}). Update the app first.`);
  }
}

export class InvalidSaveError extends Error {}

type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

/**
 * migrations[n] upgrades a save from version n to n+1. Never edit a shipped migration —
 * add a new one and bump SAVE_VERSION. Each needs a fixture test with a real old save.
 */
export const migrations: Record<number, Migration> = {
  // v1 → v2 (Sprint 4): coins, betting, fan persona. Old saves get the starting balance and pick a persona later.
  1: (save) => ({ ...save, coins: 100, bets: [], persona: null, ledger: [] }),
  // v2 → v3 (Sprint 5): factions and elections. The first election opens at the next day's start.
  2: (save) => {
    const settings = save.settings as { seed: string };
    const league = save.league as { teams: { id: string }[] };
    return { ...save, factions: createFactions(settings.seed, league.teams.map((t) => t.id)), elections: [], news: [] };
  },
  // v3 → v4 (Sprint 6): weirdness — modifiers, stadiums, the Departed.
  3: (save) => {
    const settings = save.settings as { seed: string };
    const league = save.league as Parameters<typeof createStadiums>[1];
    return { ...save, weird: { playerStatus: {}, playerMods: {}, stadiums: createStadiums(settings.seed, league), departed: [] } };
  },
  // v4 → v5 (Sprint 7): Living time, permanent timeline, backup reminders.
  // The timeline is backfilled from past elections and the Departed.
  4: (save) => {
    type E = { season: number; closesDay: number; id: number; proposals: { title: string }[]; result: { winner: number; totals: number[] } | null };
    type D = { playerId: string; season: number; day: number; cause: string };
    const players = (save.league as { players: Record<string, { name: string }> }).players;
    const timeline = [
      ...(save.elections as E[])
        .filter((e) => e.result)
        .map((e) => ({ season: e.season, day: e.closesDay, kind: 'election', text: `Election #${e.id}: “${e.proposals[e.result!.winner].title}” wins with ${e.result!.totals[e.result!.winner]} votes.` })),
      ...(save.weird as { departed: D[] }).departed.map((d) => ({ season: d.season, day: d.day, kind: 'death', text: `${players[d.playerId]?.name ?? 'A player'} ${d.cause}` })),
    ].sort((a, b) => a.season - b.season || a.day - b.day);
    return {
      ...save,
      settings: { ...(save.settings as object), dayLengthMinutes: 60 },
      clock: null,
      timeline,
      lastBackupDay: save.currentDay,
    };
  },
  // v5 → v6 (Sprint 8): playoffs, multiple seasons, aging, Patron. A finished season goes
  // straight to the offseason (its playoffs were never played) and rolls into Season 2.
  5: (save) => {
    const players = (save.league as { players: Record<string, unknown> }).players;
    const settings = save.settings as { seasonLength: number };
    const currentDay = save.currentDay as number;
    return {
      ...save,
      phase: currentDay > settings.seasonLength ? 'offseason' : 'regular',
      dayCount: currentDay,
      ages: Object.fromEntries(Object.keys(players).map((id) => [id, initialAge(id)])),
      playoffs: null,
      patron: null,
      archive: [],
      statsBySeason: {},
      bets: (save.bets as object[]).map((b) => ({ ...b, season: 1 })),
    };
  },
  // v6 → v7: factions hold an opinion of the player.
  6: (save) => ({ ...save, factionOpinion: {} }),
  // v7 → v8: player picks, favorite-team bonus, bailouts.
  7: (save) => ({ ...save, picks: { back: [], fade: [] }, pickEarnings: 0, lastBailoutDay: 0 }),
  // v8 → v9: seasons played, and the fan's keepsake collection. Experience is backfilled from age;
  // later seasons count as played; rookies who debuted in this universe count from their debut.
  8: (save) => {
    const ages = save.ages as Record<string, number>;
    const season = save.season as number;
    const log = (save.playerLog ?? {}) as Record<string, { season: number; text: string }[]>;
    const experience = Object.fromEntries(
      Object.entries(ages).map(([id, age]) => {
        const debut = (log[id] ?? []).find((e) => /^(Debuted|Called up)/.test(e.text));
        return [id, debut ? season - debut.season : initialExperience(id, age - (season - 1)) + (season - 1)];
      }),
    );
    return { ...save, experience, collection: [] };
  },
  // v9 -> v10: born-with traits (so every season opens with a spread of card rarities), and
  // all-time head-to-head records, backfilled from this season's results.
  9: (save) => {
    const seed = (save.settings as { seed: string }).seed;
    const weird = save.weird as { playerMods: Record<string, { id: string; until: unknown }[]> };
    const players = Object.keys((save.league as { players: Record<string, unknown> }).players);
    const untouched = players.filter((id) => !(weird.playerMods[id] ?? []).some((m) => m.until === null));
    const born = bornWith(seed, untouched);
    const playerMods = { ...weird.playerMods };
    for (const [id, mods] of Object.entries(born)) playerMods[id] = [...(playerMods[id] ?? []), ...mods];
    const h2h: Record<string, Record<string, number>> = {};
    type R = { awayId: string; homeId: string; awayScore: number; homeScore: number };
    for (const r of Object.values(save.results as Record<string, R>)) {
      const [w, l] = r.homeScore > r.awayScore ? [r.homeId, r.awayId] : [r.awayId, r.homeId];
      h2h[w] = { ...(h2h[w] ?? {}), [l]: (h2h[w]?.[l] ?? 0) + 1 };
    }
    return { ...save, weird: { ...weird, playerMods }, h2h };
  },
  // v10 → v11 (Sprint 12): engine v3 (steals, errors, double plays…) and new stat columns.
  // The save keeps the engine it was created on until its next season starts, so the rest of this
  // season sims exactly as before. Saved stat lines gain the new columns at 0.
  10: (save) => {
    const fill = (lines: Record<string, Partial<StatLine>>) => Object.fromEntries(Object.entries(lines ?? {}).map(([id, l]) => [id, fullLine(l)]));
    const bySeason = (save.statsBySeason ?? {}) as Record<string, Record<string, Partial<StatLine>>>;
    return {
      ...save,
      engineVersion: Math.min((save.engineVersion as number | undefined) ?? 2, 2),
      seasonStats: fill(save.seasonStats as Record<string, Partial<StatLine>>),
      careerStats: fill(save.careerStats as Record<string, Partial<StatLine>>),
      statsBySeason: Object.fromEntries(Object.entries(bySeason).map(([season, lines]) => [season, fill(lines)])),
    };
  },
  // v11 → v12 (Sprint 13): stadium climates, assigned exactly as a new stadium would get them
  // (a rebuilt stadium uses its rebuild seed). Environment events start with engine v4, next season.
  11: (save) => {
    const seed = (save.settings as { seed: string }).seed;
    const weird = save.weird as { stadiums: Record<string, { rebuilt?: number; climates?: string[] }> };
    const stadiums = Object.fromEntries(
      Object.entries(weird.stadiums).map(([teamId, st]) => [teamId, { ...st, climates: st.climates ?? assignClimates(st.rebuilt ? `${seed}:${st.rebuilt}` : seed, teamId) }]),
    );
    return { ...save, weird: { ...weird, stadiums } };
  },
  // v12 → v13 (Sprint 14): pick streaks and slot unlocks, persona XP, signature abilities.
  // Lifetime pick coins are backfilled from what the save still remembers: the larger of this
  // season's pick earnings and the pick payouts in the coin ledger (which keeps the last 200 entries).
  12: (save) => {
    const ledger = (save.ledger ?? []) as { amount: number; reason: string }[];
    const fromLedger = ledger.filter((l) => l.reason.startsWith('Picks:')).reduce((sum, l) => sum + l.amount, 0);
    const persona = save.persona as Record<string, unknown> | null;
    return {
      ...save,
      persona: persona ? { ...persona, xp: 0 } : null,
      picksLifetime: Math.max((save.pickEarnings as number) ?? 0, fromLedger),
      pickStreaks: {},
      pickLock: null,
      perkUses: {},
      xpToday: { dayCount: save.dayCount ?? 1, counts: {} },
      watched: [],
      rallyCry: null,
      jinx: null,
      waveGameId: null,
      tempClimates: {},
      collectorPaid: [],
      forecastReveal: null,
    };
  },
  // v13 → v14 (Democracy FC S1): the sport abstraction. Every existing save is baseball.
  13: (save) => ({ ...save, sport: 'baseball' }),
};

export function migrateSave(raw: unknown): UniverseState {
  if (!raw || typeof raw !== 'object') throw new InvalidSaveError('Save is empty or not an object.');
  let save = raw as Record<string, unknown>;
  let version = save.saveVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new InvalidSaveError('Save has no valid saveVersion.');
  }
  if (version > SAVE_VERSION) throw new NewerSaveError(version);
  while (version < SAVE_VERSION) {
    const step = migrations[version];
    if (!step) throw new InvalidSaveError(`No migration from save v${version}.`);
    save = { ...step(save), saveVersion: version + 1 };
    version += 1;
  }
  for (const key of ['id', 'settings', 'league', 'schedule', 'results', 'currentDay'] as const) {
    if (!(key in save)) throw new InvalidSaveError(`Save is missing "${key}".`);
  }
  return save as unknown as UniverseState;
}
