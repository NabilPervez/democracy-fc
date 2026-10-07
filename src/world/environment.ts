import raw from '../../content/weird/environment.json';
import core from '../../content/weird/core.json';
import { createRng } from '../engine/core/rng';
import type { EnvEffectType, EnvEventDef, EnvPhase, GameEnvironment, GameEvent } from '../engine/baseball/types';
import type { Chaos } from './weird';

/**
 * Stadium environment events (PRD 2 §E11): weather and stranger things that change a specific play
 * during a game, with the log saying so. Content lives in content/weird/environment.json and is
 * validated on load. Pure: no storage, no UI.
 */

const CHAOS_ORDER: Chaos[] = ['calm', 'normal', 'weird', 'unhinged'];

export interface ClimateDef {
  id: string;
  name: string;
  icon: string;
}

export interface EnvironmentPack {
  chaosMultiplier: Record<Chaos, number>;
  climates: ClimateDef[];
  events: (EnvEventDef & { climates: string[]; requiresStadiumMod?: string; minChaos: Chaos })[];
}

/** Which effect types may run in which phase. */
export const PHASE_EFFECTS: Record<EnvPhase, EnvEffectType[]> = {
  prePitch: ['forceBall', 'forceStrike', 'wildPitch', 'runnersAdvance', 'pickoff'],
  onContact: ['upgradeHit', 'downgradeHit', 'outToHit', 'hitToOut', 'induceError', 'homeRunToOut', 'outToHomeRun'],
  afterPlay: ['extraRun', 'runnerHome', 'runnerRemoved', 'runnersAdvance'],
};
const HITS = ['single', 'double', 'triple', 'homeRun'];
const OUTS = ['groundout', 'flyout', 'lineout', 'popout'];
/** Filled from the changed play: batter, pitcher, runner, fielder, batting team. */
const TEXT_VARS = new Set(['stadium', 'b', 'p', 'r', 'f', 't']);

export function validateEnvironment(input: unknown, stadiumModIds: string[]): EnvironmentPack {
  const doc = input as EnvironmentPack;
  if (!doc || !Array.isArray(doc.events) || !Array.isArray(doc.climates)) throw new Error('environment: missing events or climates');
  for (const c of CHAOS_ORDER) if (typeof doc.chaosMultiplier?.[c] !== 'number') throw new Error(`environment: chaosMultiplier.${c} missing`);
  const climates = new Set(doc.climates.map((c) => c.id));
  const ids = new Set<string>();
  for (const e of doc.events) {
    const where = `environment: event ${e.id}`;
    if (!e.id || ids.has(e.id)) throw new Error(`${where}: missing or duplicate id`);
    ids.add(e.id);
    if (!e.name || !e.icon || !e.announce || !e.effectText) throw new Error(`${where}: needs name, icon, announce and effectText`);
    for (const c of e.climates) if (c !== 'any' && !climates.has(c)) throw new Error(`${where}: unknown climate "${c}"`);
    if (e.requiresStadiumMod && !stadiumModIds.includes(e.requiresStadiumMod)) throw new Error(`${where}: unknown stadium mod "${e.requiresStadiumMod}"`);
    if (!CHAOS_ORDER.includes(e.minChaos)) throw new Error(`${where}: unknown minChaos "${e.minChaos}"`);
    if (!PHASE_EFFECTS[e.phase]) throw new Error(`${where}: unknown phase "${e.phase}"`);
    if (!PHASE_EFFECTS[e.phase].includes(e.effect.type)) throw new Error(`${where}: effect "${e.effect.type}" can't run in phase ${e.phase}`);
    if (!Number.isInteger(e.chancePerMille) || !Number.isInteger(e.effect.chancePerMille)) throw new Error(`${where}: chances must be integers per mille`);
    for (const k of e.effect.from ?? []) if (![...HITS, ...OUTS].includes(k)) throw new Error(`${where}: unknown from "${k}"`);
    if (e.effect.to && ![...HITS, ...OUTS].includes(e.effect.to)) throw new Error(`${where}: unknown to "${e.effect.to}"`);
    for (const text of [e.announce, e.effectText, e.fizzle ?? '']) {
      for (const m of text.matchAll(/\{(\w+)\}/g)) if (!TEXT_VARS.has(m[1])) throw new Error(`${where}: unknown variable {${m[1]}}`);
    }
  }
  return doc;
}

export const ENVIRONMENT: EnvironmentPack = validateEnvironment(raw, core.stadiumMods.map((m) => m.id));

export const climateDef = (id: string) => ENVIRONMENT.climates.find((c) => c.id === id);
export const envEventDef = (id: string) => ENVIRONMENT.events.find((e) => e.id === id);

/** 1–2 distinct climates for a stadium, from (seed, 'climate', teamId). A new franchise gets a new seed, so new climates. */
export function assignClimates(seed: string, teamId: string): string[] {
  const rng = createRng(seed, 'climate', teamId);
  const pool = ENVIRONMENT.climates.map((c) => c.id);
  const first = rng.pick(pool);
  if (!rng.chance(500)) return [first];
  const rest = pool.filter((c) => c !== first);
  return [first, rng.pick(rest)];
}

/** Events that can happen at a stadium: matching climate (or "any"), required stadium mod, enough chaos. */
export function eligibleEvents(climates: string[], activeStadiumMods: string[], chaos: Chaos): EnvironmentPack['events'] {
  const level = CHAOS_ORDER.indexOf(chaos);
  return ENVIRONMENT.events.filter(
    (e) =>
      CHAOS_ORDER.indexOf(e.minChaos) <= level &&
      (!e.requiresStadiumMod || activeStadiumMods.includes(e.requiresStadiumMod)) &&
      (e.climates.includes('any') || e.climates.some((c) => climates.includes(c))),
  );
}

/**
 * Scales every event's start chance (per mille) so effective-event frequency lands on PRD 2 §E11's
 * targets: Calm < 15% of games, Normal 30–40%, Unhinged > 70%. Measured by the frequency test.
 */
export const ENV_CHANCE_SCALE = 640;

/** The environment a game is played in, for the engine. */
export function gameEnvironment(climates: string[], activeStadiumMods: string[], chaos: Chaos): GameEnvironment {
  return {
    events: eligibleEvents(climates, activeStadiumMods, chaos),
    chaosPerMille: Math.round((ENVIRONMENT.chaosMultiplier[chaos] * ENV_CHANCE_SCALE * 1000) / 1000),
  };
}

/** For a box score footer: each environment event in a game and how many plays it changed. */
export function envSummary(events: GameEvent[]): { id: string; name: string; icon: string; changed: number }[] {
  const out = new Map<string, { id: string; name: string; icon: string; changed: number }>();
  for (const e of events) {
    if (e.kind === 'envStart' && !out.has(e.envId)) {
      const d = envEventDef(e.envId);
      out.set(e.envId, { id: e.envId, name: d?.name ?? e.envId, icon: d?.icon ?? '', changed: 0 });
    }
    if (e.cause?.type === 'env') out.get(e.cause.id)!.changed += 1;
  }
  return [...out.values()];
}

/** "Environment: Crosswind (changed 1 play)". Empty when nothing happened. */
export function envFooter(events: GameEvent[]): string {
  const all = envSummary(events);
  if (!all.length) return '';
  // Name the events that changed something; if none did, say what blew through anyway.
  const list = all.some((x) => x.changed) ? all.filter((x) => x.changed) : all;
  return `Environment: ${list.map((x) => `${x.name} (changed ${x.changed} play${x.changed === 1 ? '' : 's'})`).join(', ')}`;
}

/** What could happen at a stadium today: a forecast of possibilities, never the rolled result. */
export function forecast(climates: string[], activeStadiumMods: string[], chaos: Chaos): { id: string; name: string; icon: string }[] {
  return eligibleEvents(climates, activeStadiumMods, chaos).map((e) => ({ id: e.id, name: e.name, icon: e.icon }));
}
