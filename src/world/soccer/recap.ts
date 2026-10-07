import { getArena } from '../../engine/soccer/arenas';
import { matchWinner } from '../../engine/season';
import { beats, getTactic } from '../../engine/soccer/tactics';
import { FACILITY_EVENTS } from './weird';
import type { SoccerMatchSummary, SoccerUniverse } from './universe';

const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);

/**
 * Recap cause lines (PRD §A7, §B7a): every result ties back to something the fans decided or the
 * facility did, so the player can always tell why they won or lost. Pure, from the summary only.
 */
export function recapLines(s: SoccerUniverse, r: SoccerMatchSummary, clubId = s.favoriteClubId): string[] {
  if (r.homeId !== clubId && r.awayId !== clubId) return [];
  const oppId = r.homeId === clubId ? r.awayId : r.homeId;
  const opp = s.league.teams.find((t) => t.id === oppId);
  const oppName = opp ? possessive(opp.name) : "the opponents'";
  const mine = r.ballot?.[clubId];
  const theirs = r.ballot?.[oppId];
  const lines: string[] = [];
  const winner = r.shootout?.winnerId ?? matchWinner(r);
  const result = winner === clubId ? 'won' : winner === null ? 'drew' : 'lost';
  if (mine) {
    const t = getTactic(mine.tactic)?.name ?? mine.tactic;
    const pos = r.homePossession === undefined ? null : r.homeId === clubId ? r.homePossession : 100 - r.homePossession;
    let line = `${mine.youBackedTactic ? `Your ${t} vote` : `The fans' ${t} call`}${pos === null ? '' : ` produced ${pos}% possession`}`;
    if (theirs && beats(theirs.tactic, mine.tactic)) line += `, but ${oppName} ${getTactic(theirs.tactic)?.name} was the counter to it`;
    else if (theirs && beats(mine.tactic, theirs.tactic)) line += ` and countered ${oppName} ${getTactic(theirs.tactic)?.name}`;
    lines.push(`${line}. You ${result}.`);
  }
  for (const id of r.facility ?? []) {
    const f = FACILITY_EVENTS.find((x) => x.id === id);
    if (f) lines.push(`The Director's ${f.name} shaped this one.`);
  }
  const arena = getArena(r.arenaId);
  if (arena.id !== 'glass-box') lines.push(`Played in ${arena.name}: ${arena.traits[0]}`);
  if (r.bonusPoints) lines.push(`${r.bonusPoints} goal${r.bonusPoints === 1 ? '' : 's'} counted double under a rule the fans voted in.`);
  if (r.burden?.includes(clubId)) lines.push('Your captain let you down: morale is low for the next ballot.');
  return lines;
}
