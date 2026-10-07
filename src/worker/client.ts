import { wrap } from 'comlink';
import type { SoccerEvent } from '../engine/soccer/types';
import { replaySoccerMatch, runSoccerCommand, type SoccerCommand, type SoccerCommandResult, type SoccerUniverse } from '../world/soccer/universe';
import type { SimApi } from './sim.worker';

export interface AsyncSim {
  runSoccerCommand(state: SoccerUniverse, cmd: SoccerCommand): Promise<SoccerCommandResult>;
  replaySoccerMatch(state: SoccerUniverse, gameId: string): Promise<SoccerEvent[]>;
}

let instance: AsyncSim | null = null;

/** Async simulation API. Uses a Web Worker when available, otherwise runs in-thread. */
export function sim(): AsyncSim {
  if (instance) return instance;
  if (typeof Worker === 'undefined') {
    instance = { runSoccerCommand: async (s, c) => runSoccerCommand(s, c), replaySoccerMatch: async (s, g) => replaySoccerMatch(s, g) };
  } else {
    const remote = wrap<SimApi>(new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }));
    instance = { runSoccerCommand: (s, c) => remote.runSoccerCommand(s, c), replaySoccerMatch: (s, g) => remote.replaySoccerMatch(s, g) };
  }
  return instance;
}
