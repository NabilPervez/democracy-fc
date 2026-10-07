import { stars } from './season';
import type { League, ScheduledGame } from './baseball/types';
import { startingPitcher } from './baseball/game';

/**
 * Pre-game odds from PUBLIC information only: visible star ratings and the standings.
 * Hidden ratings and the RNG are never consulted (they are not part of PublicTeamView).
 * Integer math throughout, so odds are identical on every device.
 */

export interface PublicTeamView {
  teamId: string;
  /** Lineup batting stars, summed in half-star units. */
  battingHalfStars: number;
  /** Today's starter's pitching stars, in half-star units. */
  pitcherHalfStars: number;
  wins: number;
  losses: number;
}

export function publicTeamView(league: League, teamId: string, day: number, record: { wins: number; losses: number }): PublicTeamView {
  const team = league.teams.find((t) => t.id === teamId)!;
  const half = (v: number) => Math.round(v * 2);
  return {
    teamId,
    battingHalfStars: team.lineup.reduce((s, id) => s + half(stars(league.players[id], 'batting')), 0),
    pitcherHalfStars: half(stars(league.players[startingPitcher(team, day)], 'pitching')),
    wins: record.wins,
    losses: record.losses,
  };
}

export interface Odds {
  /** Win probability in per-mille. */
  awayPm: number;
  homePm: number;
  /** Payout multipliers in thousandths (1900 = 1.90×), including a 5% house edge. */
  awayMult: number;
  homeMult: number;
  /** 3-way markets (sports with draws). 0 when draws can't happen. */
  drawPm: number;
  drawMult: number;
}

const HOME_EDGE_PM = 20;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function strength(t: PublicTeamView): number {
  const games = t.wins + t.losses;
  // Record matters more as the season goes on (per-mille win rate, shrunk toward .500).
  const formPm = games ? Math.trunc(((t.wins * 1000) / games - 500) * Math.min(games, 20) / 20) : 0;
  return t.battingHalfStars * 6 + t.pitcherHalfStars * 18 + Math.trunc(formPm / 4);
}

export const multiplierFor = (pm: number) => Math.floor(950_000 / pm);

export function gameOdds(away: PublicTeamView, home: PublicTeamView): Odds {
  const homePm = clamp(500 + HOME_EDGE_PM + Math.trunc((strength(home) - strength(away)) / 2), 150, 850);
  const awayPm = 1000 - homePm;
  return { awayPm, homePm, awayMult: multiplierFor(awayPm), homeMult: multiplierFor(homePm), drawPm: 0, drawMult: 0 };
}

export function oddsForGame(league: League, game: ScheduledGame, records: Record<string, { wins: number; losses: number }>): Odds {
  const rec = (id: string) => records[id] ?? { wins: 0, losses: 0 };
  return gameOdds(publicTeamView(league, game.awayId, game.day, rec(game.awayId)), publicTeamView(league, game.homeId, game.day, rec(game.homeId)));
}

/**
 * Turn 2-way odds into a 3-way market (home / draw / away) for sports with draws: the draw takes
 * `drawPm`, and home/away share the rest in their original ratio. Integer math; sums to 1000.
 */
export function withDraw(odds: Odds, drawPm: number): Odds {
  const rest = 1000 - drawPm;
  const homePm = Math.trunc((odds.homePm * rest) / 1000);
  const awayPm = rest - homePm;
  return { homePm, awayPm, drawPm, homeMult: multiplierFor(homePm), awayMult: multiplierFor(awayPm), drawMult: multiplierFor(drawPm) };
}

export const formatMult = (milli: number) => `${(milli / 1000).toFixed(2)}×`;
