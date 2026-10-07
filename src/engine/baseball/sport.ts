import type { SportEngine } from '../core/sport';
import { stars } from '../season';
import { ENGINE_VERSION, simulateGame } from './game';
import type { GameEnvironment, GameResult, League, Player, ScheduledGame, StarGroup } from './types';

const GROUPS: StarGroup[] = ['batting', 'pitching', 'baserunning', 'defense'];

/** The Blastball engine (v2 frozen / v3 / v4) behind the sport interface. Behavior is unchanged. */
export const baseballEngine: SportEngine<League, ScheduledGame, GameResult, Player> = {
  id: 'baseball',
  engineVersion: ENGINE_VERSION,
  allowsDraws: false,
  simulate: (league, game, ctx) => simulateGame(league, game, ctx.seasonId, ctx.engineVersion, ctx.env as GameEnvironment | undefined),
  summarize: (r) => ({
    homeScore: r.homeScore,
    awayScore: r.awayScore,
    winnerId: r.homeScore > r.awayScore ? r.homeId : r.awayScore > r.homeScore ? r.awayId : null,
  }),
  starGroups: (p) => Object.fromEntries(GROUPS.map((g) => [g, stars(p, g)])),
};
