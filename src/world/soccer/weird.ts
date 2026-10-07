import pack from '../../../content/soccer/weird/core.json';
import { createRng } from '../../engine/core/rng';
import type { SoccerFixture, SoccerLeague, SoccerRatingKey } from '../../engine/soccer/types';

/**
 * The facility's chaos (PRD §B6): player mods, Director facility events and Vanishings.
 * Rules are DATA (content/soccer/weird/core.json). Everything is seeded per (universe, season,
 * day or match), so the same world always gets the same weirdness.
 */

export type Chaos = 'calm' | 'normal' | 'weird' | 'unhinged';
export const CHAOS_ORDER: Chaos[] = ['calm', 'normal', 'weird', 'unhinged'];
const atLeast = (c: Chaos, min: Chaos) => CHAOS_ORDER.indexOf(c) >= CHAOS_ORDER.indexOf(min);

export type SoccerDelta = Partial<Record<SoccerRatingKey, number>>;

export interface SoccerModDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  delta: SoccerDelta;
  innate?: boolean;
  returnedOnly?: boolean;
}

interface ModEventDef {
  id: string;
  weight: number;
  minChaos: Chaos;
  mod: string;
  durationDays: [number, number];
  text: string;
}

export interface FacilityEventDef {
  id: string;
  name: string;
  minChaos: Chaos;
  weight: number;
  /** Applies to everyone in the match. */
  delta?: SoccerDelta;
  /** One random starter misses the match. */
  sealOne?: boolean;
  /** One team (seeded) gets this buff. */
  drillOne?: SoccerDelta;
  /** The match's first goal is replayed and counts twice (Unhinged only). */
  echoGoal?: boolean;
  text: string;
}

export const SOCCER_MODS = pack.playerMods as SoccerModDef[];
const MOD_EVENTS = pack.events as ModEventDef[];
export const FACILITY_EVENTS = pack.facilityEvents as FacilityEventDef[];
export const VANISH_PER_SEASON = pack.vanishPerSeason as Record<Chaos, number>;
const MOD_BY_ID = new Map(SOCCER_MODS.map((m) => [m.id, m]));
export const soccerMod = (id: string) => MOD_BY_ID.get(id);

/** A mod on a player; `untilDay` null = permanent. */
export interface ActiveMod {
  id: string;
  season: number;
  untilDay: number | null;
}

export type SoccerHappening =
  | { type: 'mod'; playerId: string; mod: ActiveMod; text: string }
  | { type: 'vanish'; playerId: string; cause: string };

function weighted<T extends { weight: number }>(rng: ReturnType<typeof createRng>, items: T[]): T | null {
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (!total) return null;
  let r = rng.int(total);
  for (const i of items) {
    if (r < i.weight) return i;
    r -= i.weight;
  }
  return null;
}

export interface DayRollInput {
  seed: string;
  season: number;
  day: number;
  chaos: Chaos;
  seasonDays: number;
  league: SoccerLeague;
  /** Players already in the Sub-Level Archive. */
  vanished: ReadonlySet<string>;
}

const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? k);

/** End-of-day weirdness: at most one mod event and one Vanishing. */
export function rollSoccerDay(input: DayRollInput): SoccerHappening[] {
  const rng = createRng(input.seed, 'soccer-weird', input.season, input.day);
  const out: SoccerHappening[] = [];
  const players = input.league.teams.flatMap((t) => t.squad).filter((id) => !input.vanished.has(id) && input.league.players[id]);
  if (!players.length) return out;
  const name = (id: string) => input.league.players[id].name;

  if (rng.chance(pack.eventChancePerMille[input.chaos])) {
    const ev = weighted(rng, MOD_EVENTS.filter((e) => atLeast(input.chaos, e.minChaos)));
    if (ev) {
      const playerId = rng.pick(players);
      const days = rng.range(ev.durationDays[0], ev.durationDays[1]);
      out.push({ type: 'mod', playerId, mod: { id: ev.mod, season: input.season, untilDay: input.day + days }, text: fill(ev.text, { player: name(playerId) }) });
    }
  }
  // Vanish rate is per season; spread over the season's days. Per hundred-thousand for precision.
  const perDay = Math.round((VANISH_PER_SEASON[input.chaos] * 100_000) / Math.max(1, input.seasonDays));
  if (rng.int(100_000) < perDay) {
    const playerId = rng.pick(players);
    out.push({ type: 'vanish', playerId, cause: rng.pick(pack.vanishCauses) });
  }
  return out;
}

/** Rating deltas from each player's active mods. */
export function modDeltas(mods: Record<string, ActiveMod[]>, season: number, day: number): Record<string, SoccerDelta> {
  const out: Record<string, SoccerDelta> = {};
  for (const [playerId, list] of Object.entries(mods)) {
    for (const m of list) {
      if (m.season !== season && m.untilDay !== null) continue;
      if (m.untilDay !== null && day > m.untilDay) continue;
      const def = soccerMod(m.id);
      if (!def) continue;
      const d = (out[playerId] ??= {});
      for (const [k, v] of Object.entries(def.delta) as [SoccerRatingKey, number][]) d[k] = (d[k] ?? 0) + v;
    }
  }
  return out;
}

export interface MatchFacility {
  events: { eventId: string; text: string }[];
  teamDeltas: Record<string, SoccerDelta>;
  sealed: string[];
  echoGoal?: boolean;
}

/** The Director's facility events for one match, decided before kickoff (seeded per match). */
export function facilityEventsFor(seed: string, season: number, game: SoccerFixture, chaos: Chaos, league: SoccerLeague, perMilleBonus = 0): MatchFacility {
  const rng = createRng(seed, 'facility', season, game.id);
  const out: MatchFacility = { events: [], teamDeltas: {}, sealed: [] };
  if (!rng.chance(pack.facilityEventPerMille[chaos] + perMilleBonus)) return out;
  const def = weighted(rng, FACILITY_EVENTS.filter((e) => atLeast(chaos, e.minChaos)));
  if (!def) return out;
  const teamId = rng.chance(500) ? game.homeId : game.awayId;
  const team = league.teams.find((t) => t.id === teamId)!;
  let text = def.text;
  if (def.delta) out.teamDeltas['*'] = { ...def.delta };
  if (def.drillOne) {
    out.teamDeltas[teamId] = { ...def.drillOne };
    text = fill(text, { team: `${team.city} ${team.name}` });
  }
  if (def.sealOne) {
    const starters = team.squad.slice(0, 5).filter((id) => league.players[id] && league.players[id].position !== 'K');
    const playerId = rng.pick(starters);
    out.sealed.push(playerId);
    text = fill(text, { player: league.players[playerId].name });
  }
  if (def.echoGoal) out.echoGoal = true;
  out.events.push({ eventId: def.id, text });
  return out;
}
