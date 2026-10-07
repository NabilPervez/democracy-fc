import { useMemo, type ReactNode } from 'react';
import type { League } from '../../engine/baseball/types';
import { useGame } from '../store';

type Target = { kind: 'player' | 'team'; id: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regex for every player and team name in the league, longest first so "Oxbow Voltage" beats "Voltage". */
function buildMatcher(league: League): { re: RegExp; lookup: Map<string, Target> } | null {
  const lookup = new Map<string, Target>();
  for (const t of league.teams) {
    lookup.set(`${t.city} ${t.name}`, { kind: 'team', id: t.id });
    if (!lookup.has(t.name)) lookup.set(t.name, { kind: 'team', id: t.id });
  }
  for (const p of Object.values(league.players)) if (!lookup.has(p.name)) lookup.set(p.name, { kind: 'player', id: p.id });
  if (!lookup.size) return null;
  const names = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escape);
  return { re: new RegExp(`\\b(${names.join('|')})\\b`, 'g'), lookup };
}

/** Plain text with every player and team name turned into a link to their page. */
export function LinkedText({ text }: { text: string }) {
  const league = useGame((s) => s.u?.league);
  const showDetail = useGame((s) => s.showDetail);
  const matcher = useMemo(() => (league ? buildMatcher(league) : null), [league]);
  if (!matcher) return <>{text}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(matcher.re)) {
    const target = matcher.lookup.get(m[0])!;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <button key={m.index} type="button" className="inline-link" onClick={() => showDetail(target)}>
        {m[0]}
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
