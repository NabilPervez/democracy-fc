import type { GameResult, Player, Ratings, ScheduledGame, StarGroup, Team } from './baseball/types';

const STAR_GROUPS: Record<StarGroup, (keyof Ratings)[]> = {
  batting: ['contact', 'power', 'discipline'],
  pitching: ['velocity', 'control', 'stuff'],
  baserunning: ['speed'],
  defense: ['defense'],
};

/** Visible star rating (0–5 in half-star steps) for one group of hidden ratings. */
export function stars(player: Player, group: StarGroup): number {
  const keys = STAR_GROUPS[group];
  const avg = keys.reduce((sum, k) => sum + player.ratings[k], 0) / keys.length;
  return Math.round((avg / 100) * 10) / 2;
}

/**
 * Round-robin schedule (circle method): every team plays exactly one game per day, and every
 * other team once per cycle of n-1 days. Home/away alternate between cycles. Requires an even
 * number of teams. `days` = games per team in the season.
 */
export function generateSchedule(teams: Team[], days: number): ScheduledGame[] {
  const ids = teams.map((t) => t.id);
  const n = ids.length;
  const games: ScheduledGame[] = [];
  let rot = [...ids];
  for (let day = 1; day <= days; day++) {
    const round = (day - 1) % (n - 1);
    const cycle = Math.floor((day - 1) / (n - 1));
    if (round === 0) rot = [...ids];
    for (let i = 0; i < n / 2; i++) {
      let a = rot[i];
      let b = rot[n - 1 - i];
      if ((round + cycle + i) % 2 === 1) [a, b] = [b, a];
      games.push({ id: `d${day}g${i + 1}`, day, awayId: a, homeId: b });
    }
    // Keep the first team fixed, rotate the rest.
    rot.splice(1, 0, rot.pop()!);
  }
  return games;
}

export interface StandingRow {
  teamId: string;
  wins: number;
  losses: number;
  runsFor: number;
  runsAgainst: number;
}

export type ScoreLine = Pick<GameResult, 'awayId' | 'homeId' | 'awayScore' | 'homeScore'>;

export function computeStandings(teams: Team[], results: ScoreLine[]): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    teams.map((t) => [t.id, { teamId: t.id, wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 }]),
  );
  for (const r of results) {
    const away = rows.get(r.awayId)!;
    const home = rows.get(r.homeId)!;
    away.runsFor += r.awayScore;
    away.runsAgainst += r.homeScore;
    home.runsFor += r.homeScore;
    home.runsAgainst += r.awayScore;
    if (r.homeScore > r.awayScore) {
      home.wins++;
      away.losses++;
    } else {
      away.wins++;
      home.losses++;
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.wins - a.wins || a.losses - b.losses || b.runsFor - b.runsAgainst - (a.runsFor - a.runsAgainst),
  );
}
