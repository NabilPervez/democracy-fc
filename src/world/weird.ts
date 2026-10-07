import corePack from '../../content/weird/core.json';
import { createRng } from '../engine/core/rng';
import type { League, Player, RatingKey, ScheduledGame } from '../engine/baseball/types';
import { assignClimates } from './environment';
import { makeRookie } from './generate';

/**
 * The weirdness system (PRD §9). Rules are DATA: rule packs in content/weird/*.json declare
 * modifiers, stadium effects, events (trigger → target → effect → duration) and death rates.
 * Adding a new event or modifier never needs engine code — only a pack entry.
 *
 * Everything is seeded per (universe, season, day), so weirdness is deterministic.
 */

export type Chaos = 'calm' | 'normal' | 'weird' | 'unhinged';
const CHAOS_ORDER: Chaos[] = ['calm', 'normal', 'weird', 'unhinged'];

export type Delta = Partial<Record<RatingKey, number>>;

export interface ModDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  delta: Delta;
  /** Only granted to players who return from the Departed. */
  returnedOnly?: boolean;
  /** Bends the career arc: `shift` is added to each offseason's development, `delay` postpones decline and retirement (years). */
  aging?: { shift?: number; delay?: number };
  /** Per-mille chance each day of spreading to a teammate (scaled by chaos). */
  contagion?: number;
  /** Can be rolled as a born-with trait when a player enters the league. */
  innate?: boolean;
  /** Only ever made by fusing two other traits (see ComboDef). */
  comboOnly?: boolean;
}

/** Two traits on one player fuse into a stronger one. */
export interface ComboDef {
  needs: [string, string];
  result: string;
}

export interface StadiumModDef extends ModDef {
  appliesTo: 'all' | 'home' | 'away';
}

export type EventEffect =
  | { type: 'addPlayerMod'; mods: string[]; durationDays: [number, number] | null }
  | { type: 'addStadiumMod'; mods: string[]; durationDays: [number, number] | null }
  | { type: 'ratingDelta'; keys: RatingKey[]; amount: [number, number] }
  | { type: 'teamRatingDelta'; keys: RatingKey[]; amount: [number, number] };

export interface EventDef {
  id: string;
  weight: number;
  minChaos: Chaos;
  target: 'player' | 'team';
  effect: EventEffect;
  /** Template: {player} {team} {stadium} {mod} */
  text: string;
}

export interface RulePack {
  id: string;
  name: string;
  eventChancePerMille: Record<Chaos, number>;
  deathsPerSeason: Record<Chaos, number>;
  deathCauses: string[];
  playerMods: ModDef[];
  stadiumMods: StadiumModDef[];
  events: EventDef[];
  combos?: ComboDef[];
}

// ---------------------------------------------------------------------------
// Pack validation: packs are content, so check them like untrusted input.

const RATING_KEYS: RatingKey[] = ['contact', 'power', 'discipline', 'velocity', 'control', 'stuff', 'speed', 'defense'];

export function validatePack(raw: unknown): RulePack {
  const fail = (msg: string): never => {
    throw new Error(`Invalid rule pack: ${msg}`);
  };
  const p = raw as RulePack;
  if (!p || typeof p !== 'object') fail('not an object');
  if (typeof p.id !== 'string' || !p.id) fail('missing id');
  for (const c of CHAOS_ORDER) {
    if (typeof p.eventChancePerMille?.[c] !== 'number') fail(`eventChancePerMille.${c} missing`);
    if (typeof p.deathsPerSeason?.[c] !== 'number') fail(`deathsPerSeason.${c} missing`);
  }
  if (!Array.isArray(p.deathCauses) || !p.deathCauses.length) fail('deathCauses must be a non-empty list');
  const checkDelta = (d: Delta, where: string) => {
    for (const [k, v] of Object.entries(d ?? {})) {
      if (!RATING_KEYS.includes(k as RatingKey)) fail(`${where}: unknown rating "${k}"`);
      if (typeof v !== 'number') fail(`${where}: ${k} must be a number`);
    }
  };
  const modIds = new Set<string>();
  for (const m of p.playerMods ?? []) {
    if (!m.id || !m.name || !m.icon) fail('player mod needs id, name, icon');
    checkDelta(m.delta, `mod ${m.id}`);
    if (m.aging && !['shift', 'delay'].every((k) => (m.aging as Record<string, unknown>)[k] === undefined || typeof (m.aging as Record<string, unknown>)[k] === 'number')) fail(`mod ${m.id}: aging values must be numbers`);
    modIds.add(m.id);
  }
  const stadiumIds = new Set<string>();
  for (const m of p.stadiumMods ?? []) {
    if (!m.id || !m.name || !['all', 'home', 'away'].includes(m.appliesTo)) fail(`stadium mod ${m.id} is malformed`);
    checkDelta(m.delta, `stadium mod ${m.id}`);
    stadiumIds.add(m.id);
  }
  for (const e of p.events ?? []) {
    if (!e.id || !(e.weight > 0) || !CHAOS_ORDER.includes(e.minChaos) || !['player', 'team'].includes(e.target)) fail(`event ${e.id} is malformed`);
    const ef = e.effect;
    if (ef.type === 'addPlayerMod') ef.mods.forEach((m) => modIds.has(m) || fail(`event ${e.id}: unknown mod ${m}`));
    else if (ef.type === 'addStadiumMod') ef.mods.forEach((m) => stadiumIds.has(m) || fail(`event ${e.id}: unknown stadium mod ${m}`));
    else if (ef.type === 'ratingDelta' || ef.type === 'teamRatingDelta') ef.keys.forEach((k) => RATING_KEYS.includes(k) || fail(`event ${e.id}: unknown rating ${k}`));
    else fail(`event ${e.id}: unknown effect type`);
  }
  for (const c of p.combos ?? []) {
    if (!Array.isArray(c.needs) || c.needs.length !== 2 || !c.needs.every((m) => modIds.has(m)) || !modIds.has(c.result)) fail(`combo ${c.result} is malformed`);
  }
  return p;
}

/** Packs in play. Add new packs here (or merge community packs) — no engine changes needed. */
export const DEFAULT_PACKS: RulePack[] = [validatePack(corePack)];

/** Merge packs: rates come from the first pack; mods/events are combined. */
export function mergePacks(packs: RulePack[]): RulePack {
  const [first, ...rest] = packs;
  return rest.reduce(
    (acc, p) => ({
      ...acc,
      deathCauses: [...acc.deathCauses, ...p.deathCauses],
      playerMods: [...acc.playerMods, ...p.playerMods],
      stadiumMods: [...acc.stadiumMods, ...p.stadiumMods],
      events: [...acc.events, ...p.events],
      combos: [...(acc.combos ?? []), ...(p.combos ?? [])],
    }),
    first,
  );
}

// ---------------------------------------------------------------------------
// State the weirdness system owns.

export type PlayerStatus = 'departed' | 'returned' | 'reserve' | 'retired';

export interface ActiveMod {
  id: string;
  /** Last season/day the mod applies; null = permanent. */
  until: { season: number; day: number } | null;
}

export interface Stadium {
  name: string;
  /** Season the stadium was rebuilt for a new franchise (after relegation). */
  rebuilt?: number;
  mods: ActiveMod[];
  /** 1–2 climate tags (Sprint 13); decide which environment events can happen here. Public. */
  climates: string[];
}

export interface Departure {
  playerId: string;
  teamId: string;
  season: number;
  day: number;
  cause: string;
  replacementId: string;
}

export interface WeirdState {
  playerStatus: Record<string, PlayerStatus>;
  playerMods: Record<string, ActiveMod[]>;
  stadiums: Record<string, Stadium>;
  departed: Departure[];
}

const STADIUM_SUFFIXES = ['Field', 'Park', 'Grounds', 'Bowl', 'Yard', 'Dome', 'Pavilion', 'Commons'];
const STADIUM_PREFIXES = ['Old', 'New', 'Upper', 'Lower', 'Grand', 'Little', 'Echo', 'Lantern'];

export function createStadiums(seed: string, league: League): Record<string, Stadium> {
  return Object.fromEntries(
    league.teams.map((t) => {
      const rng = createRng(seed, 'stadium', t.id);
      return [t.id, { name: `${rng.pick(STADIUM_PREFIXES)} ${t.city} ${rng.pick(STADIUM_SUFFIXES)}`, mods: [], climates: assignClimates(seed, t.id) }];
    }),
  );
}

export const isActiveMod = (m: ActiveMod, season: number, day: number) =>
  m.until === null || m.until.season > season || (m.until.season === season && m.until.day >= day);

export function findPlayerMod(pack: RulePack, id: string) {
  return pack.playerMods.find((m) => m.id === id);
}
export function findStadiumMod(pack: RulePack, id: string) {
  return pack.stadiumMods.find((m) => m.id === id);
}

/** Each player's combined aging trait from their active modifiers (only players with one are listed). */
export function agingTraits(w: WeirdState, pack: RulePack, season: number, day: number): Record<string, { shift: number; delay: number }> {
  const out: Record<string, { shift: number; delay: number }> = {};
  for (const [id, mods] of Object.entries(w.playerMods)) {
    for (const m of mods) {
      const aging = isActiveMod(m, season, day) ? findPlayerMod(pack, m.id)?.aging : undefined;
      if (!aging) continue;
      const t = (out[id] ??= { shift: 0, delay: 0 });
      t.shift += aging.shift ?? 0;
      t.delay += aging.delay ?? 0;
    }
  }
  return out;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 100 ? 100 : v);

function withDelta(p: Player, ...deltas: Delta[]): Player {
  if (!deltas.length) return p;
  const ratings = { ...p.ratings };
  for (const d of deltas) for (const [k, v] of Object.entries(d)) ratings[k as RatingKey] = clamp(ratings[k as RatingKey] + (v ?? 0));
  return { ...p, ratings };
}

/**
 * The league as it plays for one game: player modifiers and the home stadium's effects applied
 * to both rosters. The engine itself never knows about weirdness.
 */
export function effectiveLeague(league: League, w: WeirdState, game: ScheduledGame, season: number, pack: RulePack): League {
  const stadium = w.stadiums[game.homeId];
  const stadiumMods = (stadium?.mods ?? []).filter((m) => isActiveMod(m, season, game.day)).map((m) => findStadiumMod(pack, m.id)).filter((m): m is StadiumModDef => !!m);
  const players = { ...league.players };
  for (const teamId of [game.awayId, game.homeId]) {
    const team = league.teams.find((t) => t.id === teamId)!;
    const side = teamId === game.homeId ? 'home' : 'away';
    for (const id of [...team.lineup, ...team.rotation]) {
      const own = (w.playerMods[id] ?? []).filter((m) => isActiveMod(m, season, game.day)).map((m) => findPlayerMod(pack, m.id)?.delta ?? {});
      const park = stadiumMods.filter((m) => m.appliesTo === 'all' || m.appliesTo === side).map((m) => m.delta);
      players[id] = withDelta(players[id], ...own, ...park);
    }
  }
  return { ...league, players };
}

// ---------------------------------------------------------------------------
// Daily roll: concrete, serializable changes produced from the pack.

export type WeirdChange =
  | { kind: 'addPlayerMod'; playerId: string; mod: ActiveMod }
  | { kind: 'removePlayerMods'; playerId: string; ids: string[] }
  | { kind: 'addStadiumMod'; teamId: string; mod: ActiveMod }
  | { kind: 'ratings'; playerIds: string[]; delta: Delta }
  | { kind: 'death'; playerId: string; teamId: string; cause: string; replacement: Player };

export interface WeirdHappening {
  eventId: string;
  teamId: string;
  text: string;
  changes: WeirdChange[];
}

export interface RollInput {
  league: League;
  weird: WeirdState;
  seed: string;
  season: number;
  day: number;
  seasonDays: number;
  chaos: Chaos;
}

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
const teamName = (league: League, id: string) => {
  const t = league.teams.find((x) => x.id === id)!;
  return `${t.city} ${t.name}`;
};

const later = (a: ActiveMod['until'], b: ActiveMod['until']) =>
  a === null || b === null ? null : a.season > b.season || (a.season === b.season && a.day >= b.day) ? a : b;

/**
 * Give `mod` to a player who already holds `held`. If it completes a combo, the two ingredients
 * fuse: they're removed and the combo trait is added (permanent if either ingredient was).
 */
export function grantMod(pack: RulePack, playerId: string, held: ActiveMod[], mod: ActiveMod): { changes: WeirdChange[]; combo: ModDef | null } {
  const ids = new Set(held.map((m) => m.id));
  for (const c of pack.combos ?? []) {
    if (!c.needs.includes(mod.id) || ids.has(c.result)) continue;
    const other = c.needs[0] === mod.id ? c.needs[1] : c.needs[0];
    const partner = held.find((m) => m.id === other);
    if (!partner) continue;
    return {
      changes: [
        { kind: 'removePlayerMods', playerId, ids: [other, mod.id] },
        { kind: 'addPlayerMod', playerId, mod: { id: c.result, until: later(partner.until, mod.until) } },
      ],
      combo: findPlayerMod(pack, c.result) ?? null,
    };
  }
  return { changes: [{ kind: 'addPlayerMod', playerId, mod }], combo: null };
}

const BIRTH_WEIGHTS = [44, 30, 15, 8, 2, 1];

/** Traits a player is born with: most have none or one, a lucky few arrive already strange. Combos fuse. */
export function birthTraits(seed: string, playerId: string, pack: RulePack = mergePacks(DEFAULT_PACKS)): ActiveMod[] {
  const rng = createRng(seed, 'born', playerId);
  let roll = rng.int(BIRTH_WEIGHTS.reduce((a, b) => a + b, 0));
  let count = BIRTH_WEIGHTS.findIndex((w) => (roll -= w) < 0);
  const pool = pack.playerMods.filter((m) => m.innate);
  let held: ActiveMod[] = [];
  while (count-- > 0 && pool.length) {
    const def = pool.splice(rng.int(pool.length), 1)[0];
    for (const c of grantMod(pack, playerId, held, { id: def.id, until: null }).changes) {
      if (c.kind === 'removePlayerMods') held = held.filter((m) => !c.ids.includes(m.id));
      if (c.kind === 'addPlayerMod') held = [...held, c.mod];
    }
  }
  return held;
}

const CONTAGION_SCALE: Record<Chaos, number> = { calm: 0.5, normal: 1, weird: 1.5, unhinged: 2 };
const MAX_SPREADS_PER_DAY = 2;

/** What strange things happen at the end of `day`. Pure: same input ⇒ same happenings. */
export function rollDay(input: RollInput, pack: RulePack = mergePacks(DEFAULT_PACKS)): WeirdHappening[] {
  const { league, weird, seed, season, day, seasonDays, chaos } = input;
  const out: WeirdHappening[] = [];
  const chaosLevel = CHAOS_ORDER.indexOf(chaos);

  // 1. A random event, scaled by chaos.
  const rng = createRng(seed, season, day, 'weird');
  if (rng.chance(pack.eventChancePerMille[chaos])) {
    const eligible = pack.events.filter((e) => CHAOS_ORDER.indexOf(e.minChaos) <= chaosLevel);
    const total = eligible.reduce((s, e) => s + e.weight, 0);
    let pick = rng.int(total);
    const event = eligible.find((e) => (pick -= e.weight) < 0);
    if (event) {
      const team = rng.pick(league.teams);
      const roster = [...team.lineup, ...team.rotation];
      const playerId = rng.pick(roster);
      const player = league.players[playerId];
      const ef = event.effect;
      const until = (range: [number, number] | null) => (range ? { season, day: day + rng.range(range[0], range[1]) } : null);
      const vars: Record<string, string> = { player: player.name, team: teamName(league, team.id), stadium: weird.stadiums[team.id]?.name ?? 'the stadium' };
      let changes: WeirdChange[];
      if (ef.type === 'addPlayerMod') {
        const mod = findPlayerMod(pack, rng.pick(ef.mods))!;
        vars.mod = mod.name;
        const granted = grantMod(pack, playerId, (weird.playerMods[playerId] ?? []).filter((m) => isActiveMod(m, season, day)), { id: mod.id, until: until(ef.durationDays) });
        changes = granted.changes;
        if (granted.combo) vars.combo = granted.combo.name;
      } else if (ef.type === 'addStadiumMod') {
        const mod = findStadiumMod(pack, rng.pick(ef.mods))!;
        vars.mod = mod.name;
        changes = [{ kind: 'addStadiumMod', teamId: team.id, mod: { id: mod.id, until: until(ef.durationDays) } }];
      } else {
        const amount = rng.range(ef.amount[0], ef.amount[1]);
        const delta = Object.fromEntries(ef.keys.map((k) => [k, amount]));
        changes = [{ kind: 'ratings', playerIds: ef.type === 'ratingDelta' ? [playerId] : roster, delta }];
      }
      const combo = vars.combo ? ` The traits fused: ${player.name} is now ${vars.combo}!` : '';
      out.push({ eventId: event.id, teamId: team.id, text: fill(event.text, vars) + combo, changes });
    }
  }

  // 2. Contagion: some traits spread to teammates.
  const crng = createRng(seed, season, day, 'contagion');
  let spreads = 0;
  for (const team of league.teams) {
    const roster = [...team.lineup, ...team.rotation];
    for (const carrier of roster) {
      for (const m of weird.playerMods[carrier] ?? []) {
        const def = findPlayerMod(pack, m.id);
        if (!def?.contagion || !isActiveMod(m, season, day) || spreads >= MAX_SPREADS_PER_DAY) continue;
        if (!crng.chance(Math.round(def.contagion * CONTAGION_SCALE[chaos]))) continue;
        const healthy = roster.filter((id) => id !== carrier && !(weird.playerMods[id] ?? []).some((x) => x.id === m.id && isActiveMod(x, season, day)));
        if (!healthy.length) continue;
        const victim = crng.pick(healthy);
        const held = (weird.playerMods[victim] ?? []).filter((x) => isActiveMod(x, season, day));
        const granted = grantMod(pack, victim, held, { id: m.id, until: { season, day: day + crng.range(3, 8) } });
        const vName = league.players[victim].name;
        const combo = granted.combo ? ` It fused with what they already had: ${vName} is now ${granted.combo.name}!` : '';
        out.push({
          eventId: 'contagion',
          teamId: team.id,
          text: `${def.name} is spreading through the ${teamName(league, team.id)}: ${league.players[carrier].name} gave it to ${vName}.${combo}`,
          changes: granted.changes,
        });
        spreads++;
      }
    }
  }

  // 3. Death: rare, permanent, rate set per season so long and short seasons feel the same.
  const drng = createRng(seed, season, day, 'death');
  const perMille = Math.round((pack.deathsPerSeason[chaos] * 1000) / seasonDays);
  if (drng.chance(perMille)) {
    const team = drng.pick(league.teams);
    const roster = [...team.lineup, ...team.rotation];
    const slot = drng.int(roster.length);
    const playerId = roster[slot];
    const p = league.players[playerId];
    const used = new Set(Object.values(league.players).map((x) => x.name));
    const replacementId = `${team.id}s${season}d${day}`;
    const replacement = makeRookie(createRng(seed, season, day, 'rookie'), replacementId, team.id, p.role, p.position, used);
    const cause = drng.pick(pack.deathCauses);
    out.push({
      eventId: 'death',
      teamId: team.id,
      text: `${p.name} of the ${teamName(league, team.id)} ${cause} Rookie ${replacement.name} takes their place.`,
      changes: [{ kind: 'death', playerId, teamId: team.id, cause, replacement }],
    });
  }
  return out;
}

/** Apply happenings to the league + weird state. */
export function applyHappening(league: League, weird: WeirdState, h: WeirdHappening, season: number, day: number): { league: League; weird: WeirdState } {
  let lg = league;
  let w = weird;
  for (const c of h.changes) {
    switch (c.kind) {
      case 'addPlayerMod':
        w = { ...w, playerMods: { ...w.playerMods, [c.playerId]: [...(w.playerMods[c.playerId] ?? []).filter((m) => m.id !== c.mod.id), c.mod] } };
        break;
      case 'removePlayerMods':
        w = { ...w, playerMods: { ...w.playerMods, [c.playerId]: (w.playerMods[c.playerId] ?? []).filter((m) => !c.ids.includes(m.id)) } };
        break;
      case 'addStadiumMod': {
        const st = w.stadiums[c.teamId];
        w = { ...w, stadiums: { ...w.stadiums, [c.teamId]: { ...st, mods: [...st.mods.filter((m) => m.id !== c.mod.id), c.mod] } } };
        break;
      }
      case 'ratings': {
        const players = { ...lg.players };
        for (const id of c.playerIds) players[id] = withDelta(players[id], c.delta);
        lg = { ...lg, players };
        break;
      }
      case 'death': {
        const players = { ...lg.players, [c.replacement.id]: c.replacement };
        const teams = lg.teams.map((t) =>
          t.id !== c.teamId
            ? t
            : {
                ...t,
                lineup: t.lineup.map((id) => (id === c.playerId ? c.replacement.id : id)),
                rotation: t.rotation.map((id) => (id === c.playerId ? c.replacement.id : id)),
              },
        );
        lg = { ...lg, players, teams };
        w = {
          ...w,
          playerStatus: { ...w.playerStatus, [c.playerId]: 'departed' },
          departed: [...w.departed, { playerId: c.playerId, teamId: c.teamId, season, day, cause: c.cause, replacementId: c.replacement.id }],
        };
        break;
      }
    }
  }
  return { league: lg, weird: w };
}

/**
 * Bring a departed player back (only ever via an election). They retake their old roster slot
 * — the player there moves to the reserves — and return changed, with a returned-only modifier.
 */
export function resurrect(league: League, weird: WeirdState, playerId: string, seed: string, pack: RulePack): { league: League; weird: WeirdState; modName: string } {
  const d = [...weird.departed].reverse().find((x) => x.playerId === playerId)!;
  const team = league.teams.find((t) => t.id === d.teamId)!;
  const p = league.players[playerId];
  const roster = p.role === 'pitcher' ? team.rotation : team.lineup;
  // Their slot: wherever their replacement (or whoever plays their position) now stands.
  let slot = roster.indexOf(d.replacementId);
  if (slot < 0) slot = roster.findIndex((id) => league.players[id].position === p.position);
  if (slot < 0) slot = 0;
  const displaced = roster[slot];
  const newRoster = roster.map((id, i) => (i === slot ? playerId : id));
  const teams = league.teams.map((t) => (t.id !== team.id ? t : p.role === 'pitcher' ? { ...t, rotation: newRoster } : { ...t, lineup: newRoster }));
  const returnedMods = pack.playerMods.filter((m) => m.returnedOnly);
  const mod = createRng(seed, 'return', playerId, weird.departed.length).pick(returnedMods);
  return {
    league: { ...league, teams, players: { ...league.players, [playerId]: { ...p, teamId: team.id } } },
    weird: {
      ...weird,
      playerStatus: { ...weird.playerStatus, [playerId]: 'returned', [displaced]: 'reserve' },
      playerMods: { ...weird.playerMods, [playerId]: [...(weird.playerMods[playerId] ?? []), { id: mod.id, until: null }] },
    },
    modName: mod.name,
  };
}

/** Drop expired mods (called when a day ends). */
export function expireMods(w: WeirdState, season: number, day: number): WeirdState {
  const playerMods: Record<string, ActiveMod[]> = {};
  for (const [id, mods] of Object.entries(w.playerMods)) {
    const keep = mods.filter((m) => isActiveMod(m, season, day));
    if (keep.length) playerMods[id] = keep;
  }
  const stadiums = Object.fromEntries(Object.entries(w.stadiums).map(([id, s]) => [id, { ...s, mods: s.mods.filter((m) => isActiveMod(m, season, day)) }]));
  return { ...w, playerMods, stadiums };
}
