import type { SoccerResult } from './types';

/** Soccer counting stats for one player (a match or a season). */
export interface SoccerStatLine {
  apps: number;
  goals: number;
  assists: number;
  shots: number;
  onTarget: number;
  /** Keepers: shots saved. */
  saves: number;
  /** Keepers: goals conceded while on the floor. */
  conceded: number;
  /** Keepers who started and conceded nothing. */
  cleanSheets: number;
  tackles: number;
}

export const emptySoccerLine = (): SoccerStatLine => ({ apps: 0, goals: 0, assists: 0, shots: 0, onTarget: 0, saves: 0, conceded: 0, cleanSheets: 0, tackles: 0 });

export function soccerBoxScore(r: SoccerResult): Record<string, SoccerStatLine> {
  const box: Record<string, SoccerStatLine> = {};
  const line = (id: string) => (box[id] ??= emptySoccerLine());
  for (const id of [...r.lineups.home, ...r.lineups.away]) line(id).apps = 1;
  for (const e of r.events) {
    if (e.kind === 'sub') line(e.inId).apps = 1;
    if (e.kind === 'shot') {
      line(e.playerId).shots++;
      if (e.outcome === 'goal' || e.outcome === 'saved') line(e.playerId).onTarget++;
      if (e.outcome === 'saved') line(e.keeperId).saves++;
      if (e.outcome === 'goal') line(e.keeperId).conceded++;
    }
    if (e.kind === 'goal') {
      line(e.scorerId).goals++;
      if (e.assistId) line(e.assistId).assists++;
    }
    if ((e.kind === 'dribble' && !e.success)) line(e.defenderId).tackles++;
    if (e.kind === 'pass' && !e.success && e.interceptorId) line(e.interceptorId).tackles++;
  }
  if (r.awayScore === 0) line(r.lineups.home[0]).cleanSheets = 1;
  if (r.homeScore === 0) line(r.lineups.away[0]).cleanSheets = 1;
  return box;
}
