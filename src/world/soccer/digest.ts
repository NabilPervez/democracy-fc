import { matchWinner } from '../../engine/season';
import { clubOf, type SoccerUniverse, type SoccerWorldEvent } from './universe';

/**
 * "While You Were Gone" (PRD §B3): the facility bulletin shown after the league moved on without
 * the fan. Ranked so the Director and your own club come first. Pure.
 */

export interface DigestItem {
  importance: number;
  kind: 'director' | 'club' | 'election' | 'vanish' | 'awakening' | 'coins' | 'season';
  text: string;
}

export interface SoccerDigest {
  days: number;
  items: DigestItem[];
}

export function buildSoccerDigest(before: SoccerUniverse, after: SoccerUniverse, events: SoccerWorldEvent[]): SoccerDigest {
  const items: DigestItem[] = [];
  const days = events.filter((e) => e.type === 'dayEnded').length;
  const fav = after.favoriteClubId;
  const club = clubOf(after, fav);

  const mine = events.flatMap((e) => (e.type === 'matchPlayed' && (e.summary.homeId === fav || e.summary.awayId === fav) ? [e.summary] : []));
  if (mine.length && club) {
    const result = (r: (typeof mine)[number]) => {
      const w = r.shootout?.winnerId ?? matchWinner(r);
      return w === fav ? 'W' : w === null ? 'D' : 'L';
    };
    const rs = mine.map(result);
    const count = (x: string) => rs.filter((r) => r === x).length;
    const goals = mine.reduce((n, r) => n + (r.homeId === fav ? r.homeScore : r.awayScore), 0);
    items.push({ importance: 90, kind: 'club', text: `Your ${club.name} went ${count('W')}–${count('D')}–${count('L')} (W–D–L), scoring ${goals}. Form: ${rs.join(' ')}.` });
  }

  for (const e of after.elections.filter((x) => x.result && !before.elections.find((b) => b.id === x.id && b.result))) {
    const p = e.proposals[e.result!.winner];
    items.push({ importance: 85, kind: 'election', text: `The fans voted in: ${p.title}.` });
  }
  for (const v of after.vanished.filter((x) => !before.vanished.some((b) => b.player.id === x.player.id))) {
    items.push({ importance: 80, kind: 'vanish', text: `${v.player.name} was taken to the Sub-Levels.` });
  }
  for (const a of after.awakenings.filter((x) => !before.awakenings.some((b) => b.playerId === x.playerId && b.season === x.season))) {
    items.push({ importance: 75, kind: 'awakening', text: `${after.league.players[a.playerId]?.name ?? 'A player'} Awakened.` });
  }
  const seen = new Set(before.news.map((n) => `${n.season}|${n.day}|${n.text}`));
  const newNews = after.news.filter((n) => !seen.has(`${n.season}|${n.day}|${n.text}`));
  for (const n of newNews.filter((x) => x.director).slice(-3)) items.push({ importance: 95, kind: 'director', text: n.text });
  if (after.season > before.season) items.push({ importance: 99, kind: 'season', text: `A new season began: season ${after.season}.` });
  const delta = after.coins - before.coins;
  if (delta) items.push({ importance: 40, kind: 'coins', text: `${delta > 0 ? '+' : ''}${delta} coins while you were away.` });

  items.sort((a, b) => b.importance - a.importance);
  return { days, items };
}
