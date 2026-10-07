import type { StatLine } from '../engine/baseball/boxScore';
import type { League } from '../engine/baseball/types';

/** League leaderboards: hitters and pitchers ranked separately. */

export interface LeaderRow {
  playerId: string;
  value: number;
  display: string;
}

export interface Board {
  id: string;
  label: string;
  rows: LeaderRow[];
}

const top = (rows: LeaderRow[], n: number, asc = false) =>
  rows.sort((a, b) => (asc ? a.value - b.value : b.value - a.value) || a.playerId.localeCompare(b.playerId)).slice(0, n);

/**
 * Rate stats (AVG, ERA) need a minimum sample so one lucky game doesn't top the board:
 * 2 plate appearances per team game for hitters, 1 out per team game for pitchers, and
 * half the team's games for the fielding board.
 */
export function leaderboards(stats: Record<string, StatLine>, league: League, teamGames: number, n = 5): { hitters: Board[]; pitchers: Board[] } {
  const hitters = Object.entries(stats).filter(([id]) => league.players[id]?.role === 'batter');
  const pitchers = Object.entries(stats).filter(([id]) => league.players[id]?.role === 'pitcher');
  const minPa = Math.max(5, teamGames * 2);
  const minOuts = Math.max(9, teamGames);
  const minGames = Math.max(3, Math.ceil(teamGames / 2));

  const count = (rows: [string, StatLine][], f: (s: StatLine) => number) =>
    rows.map(([playerId, s]) => ({ playerId, value: f(s), display: String(f(s)) })).filter((r) => r.value > 0);

  return {
    hitters: [
      {
        id: 'avg',
        label: 'Batting average',
        rows: top(
          hitters.filter(([, s]) => s.pa >= minPa && s.ab > 0).map(([playerId, s]) => ({ playerId, value: s.h / s.ab, display: (s.h / s.ab).toFixed(3).replace(/^0/, '') })),
          n,
        ),
      },
      { id: 'hr', label: 'Home runs', rows: top(count(hitters, (s) => s.hr), n) },
      { id: 'h', label: 'Hits', rows: top(count(hitters, (s) => s.h), n) },
      { id: 'r', label: 'Runs', rows: top(count(hitters, (s) => s.r), n) },
      { id: 'sb', label: 'Stolen bases', rows: top(count(hitters, (s) => s.sb ?? 0), n) },
      {
        // Fewest errors per game; ties go to whoever has played more.
        id: 'fielding',
        label: 'Fielding (fewest errors per game)',
        rows: hitters
          .filter(([, s]) => s.g >= minGames)
          .map(([playerId, s]) => ({ playerId, g: s.g, value: (s.e ?? 0) / s.g, display: `${s.e ?? 0} E in ${s.g} G` }))
          .sort((a, b) => a.value - b.value || b.g - a.g || a.playerId.localeCompare(b.playerId))
          .slice(0, n)
          .map(({ playerId, value, display }) => ({ playerId, value, display })),
      },
    ],
    pitchers: [
      {
        id: 'era',
        label: 'ERA',
        rows: top(
          pitchers.filter(([, s]) => s.outs >= minOuts).map(([playerId, s]) => ({ playerId, value: (s.ra * 27) / s.outs, display: ((s.ra * 27) / s.outs).toFixed(2) })),
          n,
          true,
        ),
      },
      { id: 'k', label: 'Strikeouts', rows: top(count(pitchers, (s) => s.pk), n) },
      { id: 'w', label: 'Wins', rows: top(count(pitchers, (s) => s.w), n) },
    ],
  };
}
