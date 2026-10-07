import { wrap } from 'comlink';
import type { GameEvent } from '../engine/baseball/types';
import { replayGame, runCommand, type Command, type CommandResult, type UniverseState } from '../world/universe';
import type { SimApi } from './sim.worker';

export interface AsyncSim {
  runCommand(state: UniverseState, cmd: Command): Promise<CommandResult>;
  replayGame(state: UniverseState, gameId: string): Promise<GameEvent[]>;
}

let instance: AsyncSim | null = null;

/** Async simulation API. Uses a Web Worker when available, otherwise runs in-thread. */
export function sim(): AsyncSim {
  if (instance) return instance;
  if (typeof Worker === 'undefined') {
    instance = {
      runCommand: async (s, c) => runCommand(s, c),
      replayGame: async (s, g) => replayGame(s, g),
    };
  } else {
    const remote = wrap<SimApi>(new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }));
    instance = {
      runCommand: (s, c) => remote.runCommand(s, c),
      replayGame: (s, g) => remote.replayGame(s, g),
    };
  }
  return instance;
}
