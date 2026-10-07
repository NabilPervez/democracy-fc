import { simulateSoccer } from './game';
import type { SoccerFixture, SoccerLeague } from './types';

export interface CalibrationStats {
  matches: number;
  meanGoals: number;
  drawRate: number;
  homeWinRate: number;
  nilNilRate: number;
  meanShotsPerTeam: number;
  meanChains: number;
  spotKicksPerMatch: number;
  penaltiesPerMatch: number;
  redsPerMatch: number;
  foulsPerMatch: number;
}

/** Aggregate stats over n seeded matches (PRD §B5 calibration targets). Not used at runtime. */
export function calibrate(league: SoccerLeague, n: number, seasonId = 1): CalibrationStats {
  let goals = 0, draws = 0, home = 0, nil = 0, shots = 0, chains = 0, spots = 0, pens = 0, reds = 0, fouls = 0;
  const teams = league.teams;
  for (let i = 0; i < n; i++) {
    const h = teams[i % teams.length];
    const a = teams[(i + 1 + (Math.floor(i / teams.length) % (teams.length - 1))) % teams.length];
    const game: SoccerFixture = { id: `cal${i}`, day: 1 + Math.floor(i / teams.length), homeId: h.id, awayId: a.id };
    const r = simulateSoccer(league, game, seasonId);
    goals += r.homeScore + r.awayScore;
    if (r.homeScore === r.awayScore) draws++;
    if (r.homeScore > r.awayScore) home++;
    if (r.homeScore + r.awayScore === 0) nil++;
    for (const e of r.events) {
      if (e.kind === 'shot') shots++;
      if (e.kind === 'penalty' && e.spot === 'spotKick') spots++;
      if (e.kind === 'penalty' && e.spot === 'penalty') pens++;
      if (e.kind === 'card' && e.color === 'red') reds++;
      if (e.kind === 'tackle') fouls++;
      if (e.kind === 'possession' || e.kind === 'kickoff' || e.kind === 'keeperRestart') chains++;
    }
  }
  return { matches: n, meanGoals: goals / n, drawRate: draws / n, homeWinRate: home / n, nilNilRate: nil / n, meanShotsPerTeam: shots / n / 2, meanChains: chains / n, spotKicksPerMatch: spots / n, penaltiesPerMatch: pens / n, redsPerMatch: reds / n, foulsPerMatch: fouls / n };
}
