import type { SportEngine } from '../core/sport';
import { simulateSoccer, SOCCER_ENGINE_VERSION } from './game';
import type { SoccerFixture, SoccerLeague, SoccerPlayer, SoccerRatingKey, SoccerResult, SoccerStarGroup } from './types';

/** Star groups (§B4). Keeping only shows on keepers' cards. */
export const SOCCER_STAR_GROUPS: Record<SoccerStarGroup, SoccerRatingKey[]> = {
  attack: ['finishing', 'dribbling', 'firstTouch'],
  playmaking: ['passing', 'vision'],
  defense: ['tackling', 'positioning', 'aerial'],
  engine: ['pace', 'stamina', 'composure'],
  keeping: ['reflexes', 'handling'],
};

/** 0–5 in half-star steps. Integer math. */
export function soccerStars(p: SoccerPlayer, group: SoccerStarGroup): number {
  const keys = SOCCER_STAR_GROUPS[group];
  const sum = keys.reduce((s, k) => s + p.ratings[k], 0);
  return Math.round((sum * 10) / (keys.length * 100)) / 2;
}

export const soccerEngine: SportEngine<SoccerLeague, SoccerFixture, SoccerResult, SoccerPlayer> = {
  id: 'soccer',
  engineVersion: SOCCER_ENGINE_VERSION,
  allowsDraws: true,
  simulate: (league, game, ctx) => simulateSoccer(league, game, ctx.seasonId, { knockout: ctx.knockout }),
  summarize: (r) => ({
    homeScore: r.homeScore,
    awayScore: r.awayScore,
    winnerId: r.shootout?.winnerId ?? (r.homeScore > r.awayScore ? r.homeId : r.awayScore > r.homeScore ? r.awayId : null),
  }),
  starGroups: (p) => {
    const groups = (Object.keys(SOCCER_STAR_GROUPS) as SoccerStarGroup[]).filter((g) => g !== 'keeping' || p.position === 'K');
    return Object.fromEntries(groups.map((g) => [g, soccerStars(p, g)]));
  },
};
