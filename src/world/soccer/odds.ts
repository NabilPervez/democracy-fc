import { multiplierFor, type Odds } from '../../engine/odds';
import { selectLineup } from '../../engine/soccer/lineup';
import { soccerStars } from '../../engine/soccer/sport';
import type { SoccerFixture, SoccerLeague } from '../../engine/soccer/types';

/**
 * Pre-match 3-way odds (home / draw / away) from PUBLIC information only: the visible star groups
 * of each club's likely five and the standings. Integer math, identical on every device.
 */

export interface SoccerRecord {
  wins: number;
  draws: number;
  losses: number;
}

const HOME_EDGE_PM = 25;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Half-star units summed over the likely five (keeping counts double for the keeper). */
export function clubStrength(league: SoccerLeague, teamId: string, unavailable: ReadonlySet<string> = new Set()): number {
  const team = league.teams.find((t) => t.id === teamId)!;
  const five = selectLineup(team, league, unavailable);
  const half = (v: number) => Math.round(v * 2);
  return five.reduce((sum, id, i) => {
    const p = league.players[id];
    if (i === 0) return sum + half(soccerStars(p, 'keeping')) * 2;
    return sum + half(soccerStars(p, 'attack')) + half(soccerStars(p, 'playmaking')) + half(soccerStars(p, 'defense')) + half(soccerStars(p, 'engine'));
  }, 0);
}

const form = (r: SoccerRecord) => {
  const games = r.wins + r.draws + r.losses;
  if (!games) return 0;
  // Points per game vs an average 1.5, shrunk toward 0 early in the season.
  return Math.trunc((((r.wins * 3 + r.draws) * 1000) / games - 1500) * Math.min(games, 10) / 10 / 20);
};

export function soccerOdds(league: SoccerLeague, game: SoccerFixture, records: Record<string, SoccerRecord>, unavailable: ReadonlySet<string> = new Set()): Odds {
  const rec = (id: string) => records[id] ?? { wins: 0, draws: 0, losses: 0 };
  const diff = clubStrength(league, game.homeId, unavailable) + form(rec(game.homeId)) - clubStrength(league, game.awayId, unavailable) - form(rec(game.awayId));
  // Close matches draw more often.
  const drawPm = clamp(180 - Math.abs(diff) * 2, 80, 180);
  const homeShare = clamp(500 + HOME_EDGE_PM + diff * 6, 120, 880);
  const rest = 1000 - drawPm;
  const homePm = Math.trunc((homeShare * rest) / 1000);
  const awayPm = rest - homePm;
  return { homePm, awayPm, drawPm, homeMult: multiplierFor(homePm), awayMult: multiplierFor(awayPm), drawMult: multiplierFor(drawPm) };
}
