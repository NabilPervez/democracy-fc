import { baseballEngine } from '../baseball/sport';
import type { AnySportEngine, SportId } from './sport';

const ENGINES: Record<SportId, AnySportEngine | undefined> = {
  baseball: baseballEngine,
  soccer: undefined, // registered in Sprint 3
};

export function getSport(id: SportId): AnySportEngine {
  const engine = ENGINES[id];
  if (!engine) throw new Error(`No engine registered for sport "${id}".`);
  return engine;
}

/** Test/extension hook: swap in an engine (e.g. a stub soccer engine for draw tests). */
export function registerSport(engine: AnySportEngine): void {
  ENGINES[engine.id] = engine;
}
