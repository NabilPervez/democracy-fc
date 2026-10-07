import { matchWinner } from '../engine/season';
import { MAX_CATCHUP_DAYS } from './clock';
import { levelOf, PERSONA_DEFS, xpOf } from './persona';
import { newUnlocks } from './picks';
import { DAILY_STIPEND, standingsOf, type UniverseState, type WorldEvent } from './universe';

/**
 * "While You Were Gone" (PRD §6): what happened across a stretch of simulated days, ranked by
 * narrative importance — deaths, returns and elections first, then the player's own team and bets.
 */

export interface DigestItem {
  importance: number;
  day: number;
  kind: 'level' | 'unlock' | 'death' | 'return' | 'election' | 'paused' | 'team' | 'bets' | 'moment' | 'weird' | 'standings' | 'coins';
  text: string;
}

export interface Digest {
  fromDay: number;
  toDay: number;
  games: number;
  items: DigestItem[];
}

const MAX_WEIRD = 5;
const MAX_MOMENTS = 4;

export function buildDigest(before: UniverseState, after: UniverseState, events: WorldEvent[], skippedDays = 0): Digest {
  const items: DigestItem[] = [];
  const teamName = (id: string) => {
    const t = after.league.teams.find((x) => x.id === id)!;
    return `${t.city} ${t.name}`;
  };

  // Weirdness, deaths.
  let weirdCount = 0;
  let day = before.currentDay;
  for (const e of events) {
    if (e.type === 'dayEnded') day = e.day + 1;
    if (e.type !== 'weird') continue;
    if (e.happening.eventId === 'death') items.push({ importance: 100, day, kind: 'death', text: e.happening.text });
    else if (weirdCount++ < MAX_WEIRD) items.push({ importance: 60, day, kind: 'weird', text: e.happening.text });
  }

  // Elections resolved during the stretch.
  for (const el of after.elections) {
    const was = before.elections.find((x) => x.id === el.id);
    if (!el.result || was?.result) continue;
    const p = el.proposals[el.result.winner];
    items.push({ importance: 90, day: el.closesDay, kind: 'election', text: `Election #${el.id}: “${p.title}” won with ${el.result.totals[el.result.winner]} votes.` });
    if (p.effect.kind === 'resurrect') {
      items.push({ importance: 95, day: el.closesDay, kind: 'return', text: `${after.league.players[p.effect.playerId].name} returned from the Departed.` });
    }
    const mine = el.playerVotes.reduce((a, b) => a + b, 0);
    if (mine > 0) {
      const helped = el.playerVotes[el.result.winner] > 0;
      items.push({
        importance: 92,
        day: el.closesDay,
        kind: 'election',
        text: helped ? `Your votes backed the winner of election #${el.id}.` : `Your side lost election #${el.id}.`,
      });
    }
  }

  // Persona level-ups and pick-slot unlocks get a celebratory card at the top.
  const was = before.persona;
  const now = after.persona;
  if (was && now && was.kind === now.kind) {
    const def = PERSONA_DEFS[now.kind];
    for (let lvl = levelOf(xpOf(was)) + 1; lvl <= levelOf(xpOf(now)); lvl++) {
      items.push({ importance: 98, day: after.currentDay - 1, kind: 'level', text: `You reached Level ${lvl} as ${def.label}! New: ${def.levels[lvl - 1].perk}` });
    }
  }
  for (const u of newUnlocks(before.picksLifetime ?? 0, after.picksLifetime ?? 0)) {
    items.push({ importance: 97, day: after.currentDay - 1, kind: 'unlock', text: `Unlocked ${u.text} (${u.at.toLocaleString()} lifetime pick coins).` });
  }

  if (skippedDays > 0) {
    items.push({
      importance: 85,
      day: after.currentDay,
      kind: 'paused',
      text: `You were away a long time. The league played ${MAX_CATCHUP_DAYS} days, then paused and waited for you (${skippedDays} more day${skippedDays === 1 ? '' : 's'} passed in real life).`,
    });
  }

  // The player's team.
  const played = events.filter((e): e is Extract<WorldEvent, { type: 'gamePlayed' }> => e.type === 'gamePlayed').map((e) => e.summary);
  const fav = after.persona?.favoriteTeamId;
  if (fav) {
    const mine = played.filter((g) => g.awayId === fav || g.homeId === fav);
    if (mine.length) {
      const wins = mine.filter((g) => matchWinner(g) === fav).length;
      const draws = mine.filter((g) => matchWinner(g) === null).length;
      const record = draws ? `${wins}–${draws}–${mine.length - wins - draws} (W–D–L)` : `${wins}–${mine.length - wins}`;
      items.push({ importance: 80, day: after.currentDay - 1, kind: 'team', text: `Your ${teamName(fav)} went ${record}.` });
    }
  }

  // Bets settled.
  const settled = after.bets.filter((b) => b.status !== 'open' && before.bets.find((x) => x.id === b.id)?.status === 'open');
  if (settled.length) {
    const won = settled.filter((b) => b.status === 'won');
    const net = settled.reduce((s, b) => s + b.payout - b.amount, 0);
    items.push({
      importance: 75,
      day: after.currentDay - 1,
      kind: 'bets',
      text: `You won ${won.length} of ${settled.length} bet${settled.length === 1 ? '' : 's'} (${net >= 0 ? '+' : ''}${net} coins).`,
    });
  }

  // Player moments — the player's team first.
  const moments: DigestItem[] = [];
  for (const [pid, log] of Object.entries(after.playerLog)) {
    const newEntries = log.slice(before.playerLog[pid]?.length ?? 0);
    const p = after.league.players[pid];
    for (const entry of newEntries) {
      if (entry.text.startsWith('Departed') || entry.text.startsWith('Called up')) continue;
      moments.push({ importance: p.teamId === fav ? 70 : 30, day: entry.day, kind: 'moment', text: `${p.name} (${teamName(p.teamId)}): ${entry.text}` });
    }
  }
  items.push(...moments.sort((a, b) => b.importance - a.importance || a.day - b.day).slice(0, MAX_MOMENTS));

  // Standings.
  const leaderBefore = standingsOf(before)[0];
  const leaderAfter = standingsOf(after)[0];
  if (played.length && leaderAfter.teamId !== leaderBefore.teamId) {
    items.push({ importance: 40, day: after.currentDay - 1, kind: 'standings', text: `The ${teamName(leaderAfter.teamId)} now lead the league at ${leaderAfter.wins}–${leaderAfter.losses}.` });
  }

  const stipend = (after.currentDay - before.currentDay) * DAILY_STIPEND;
  if (stipend > 0) items.push({ importance: 10, day: after.currentDay - 1, kind: 'coins', text: `You collected ${stipend} coins in daily stipends.` });

  items.sort((a, b) => b.importance - a.importance || a.day - b.day);
  return { fromDay: before.currentDay, toDay: after.currentDay - 1, games: played.length, items };
}
