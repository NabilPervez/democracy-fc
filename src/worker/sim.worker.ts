import { expose } from 'comlink';
import { replayGame, runCommand } from '../world/universe';
import { replaySoccerMatch, runSoccerCommand } from '../world/soccer/universe';

/** The simulation runs here, off the main thread, so long sims never freeze the UI. */
const api = { runCommand, replayGame, runSoccerCommand, replaySoccerMatch };

export type SimApi = typeof api;

expose(api);
