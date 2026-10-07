import { expose } from 'comlink';
import { replaySoccerMatch, runSoccerCommand } from '../world/soccer/universe';

/** The simulation runs here, off the main thread, so long sims never freeze the UI. */
const api = { runSoccerCommand, replaySoccerMatch };

export type SimApi = typeof api;

expose(api);
