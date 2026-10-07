import { useEffect, useRef, useState } from 'react';
import { ALL_PHASES, phaseStats } from '../../engine/soccer/phase';
import type { Phase, SoccerEvent, SoccerResult } from '../../engine/soccer/types';
import { narrateSoccerMatch } from '../../narrative/soccer';
import { recapLines } from '../../world/soccer/recap';
import { clubOf } from '../../world/soccer/universe';
import { chainStart, mmss, pitchStateAt } from '../pitch/pitchState';
import { PHASE_LABEL } from './bits';
import { OPP_COLOR, PitchView, VIEW_COLOR } from './PitchView';
import { useAssembly, type Speed } from './store';

const SPEEDS: { id: Speed; label: string; ms: number }[] = [
  { id: 'live', label: 'Live', ms: 1800 },
  { id: 'x2', label: '2×', ms: 900 },
  { id: 'x5', label: '5×', ms: 360 },
  { id: 'key', label: 'Key Moments', ms: 1000 },
  { id: 'instant', label: 'Instant', ms: 0 },
];

type Filter = 'all' | 'key' | 'shots' | 'transitions' | 'setPieces' | 'facility';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'key', label: 'Key Moments' },
  { id: 'shots', label: 'Goals & Shots' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'setPieces', label: 'Set Pieces' },
  { id: 'facility', label: 'Facility' },
];

const PHASE_COLOR: Record<Phase, string> = {
  buildUp: '#6EE7B7', progression: '#10B981', creation: '#047857', highBlock: '#CBD5E1', midBlock: '#94A3B8', lowBlock: '#64748B',
  attTransition: '#1B1F2A', defTransition: '#475569', attSetPiece: '#F59E0B', defSetPiece: '#B45309',
};

/** Log tags (mockup): what kind of moment each line is. */
type Tag = 'pos' | 'tr' | 'set' | 'shot' | 'goal' | 'card' | 'dir' | 'sig';
const TAG: Record<Tag, { label: string; color: string }> = {
  pos: { label: 'Open play', color: 'var(--primary)' },
  tr: { label: 'Transition', color: '#334155' },
  set: { label: 'Set piece', color: '#B45309' },
  shot: { label: 'Shot', color: 'var(--secondary)' },
  goal: { label: 'Goal', color: 'var(--primary)' },
  card: { label: 'Foul', color: 'var(--bad)' },
  dir: { label: 'Facility', color: 'var(--accent)' },
  sig: { label: 'Signature', color: 'var(--accent)' },
};

function tagOf(e: SoccerEvent): Tag {
  switch (e.kind) {
    case 'goal': return 'goal';
    case 'shot': case 'penalty': return 'shot';
    case 'transition': return 'tr';
    case 'tackle': case 'card': case 'teamFouls': case 'powerPlay': case 'powerPlayEnd': return 'card';
    case 'facilityEvent': case 'arenaShift': return 'dir';
    case 'signature': case 'awakening': return 'sig';
    default: return e.phase === 'attSetPiece' ? 'set' : 'pos';
  }
}

/** A chip per team (mockup): the phase, plus what they're doing right now. */
function TeamChip({ name, color, phase, sub }: { name: string; color: string; phase: Phase | null; sub: string }) {
  const c = !phase ? color : /Transition/.test(phase) ? '#334155' : /SetPiece/.test(phase) ? 'var(--amber)' : /Block/.test(phase) ? 'var(--steel)' : color;
  return (
    <div className="arena-chip" style={{ ['--c' as string]: c }}>
      <small>{name}</small>
      <b>{phase ? PHASE_LABEL[phase] : '—'}</b>
      <span>{sub}</span>
    </div>
  );
}

export function MatchView({ gameId }: { gameId: string }) {
  const u = useAssembly((s) => s.u)!;
  const { speed, setSpeed, playByPlay, run, watch } = useAssembly();
  const game = u.schedule.find((g) => g.id === gameId)!;
  const [events, setEvents] = useState<SoccerEvent[] | null>(null);
  const [missing, setMissing] = useState(false);
  /** Current line, and the furthest line revealed so far (an unfinished match never shows the future). */
  const [cursor, setCursor] = useState(0);
  const [reach, setReach] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const finished = !!u.results[gameId];
  const settled = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void playByPlay(gameId).then((ev) => {
      if (!alive) return;
      if (!ev) setMissing(true);
      else setEvents(ev);
    });
    return () => {
      alive = false;
    };
  }, [gameId, playByPlay]);

  const home = clubOf(u, game.homeId)!;
  const away = clubOf(u, game.awayId)!;
  const viewClubId = game.awayId === u.favoriteClubId ? game.awayId : game.homeId;
  const left = viewClubId === home.id ? home : away;
  const right = left === home ? away : home;
  const league = u.league;
  const { homeId, awayId } = game;
  // The React Compiler memoises these; plain derivations keep it able to.
  const lines = events ? narrateSoccerMatch(events, { league, gameId, homeId, awayId }) : [];
  const first = events?.find((e) => e.kind === 'lineups');
  const lineups = first && first.kind === 'lineups' ? { home: first.home, away: first.away } : { home: [] as string[], away: [] as string[] };
  const names = Object.fromEntries(Object.values(league.players).map((p) => [p.id, p.name]));
  /** Possession number at each event (for the log separators). */
  const possessionOf: number[] = [];
  for (const e of events ?? []) possessionOf.push((possessionOf.at(-1) ?? 0) + (chainStart(e) ? 1 : 0));
  const total = lines.length;
  // Which lines are Key Moments, read by the playback timer without restarting it every frame.
  const keysRef = useRef<boolean[]>([]);
  useEffect(() => {
    keysRef.current = lines.map((l) => l.key);
  });
  const end = Math.max(0, total - 1);

  // Played matches open at the final whistle; Instant jumps there too.
  const shownReach = finished || speed === 'instant' ? end : reach;
  const shownCursor = speed === 'instant' && !finished ? end : Math.min(cursor, shownReach);

  useEffect(() => {
    if (!events || !playing || !total || speed === 'instant') return;
    const ms = SPEEDS.find((s) => s.id === speed)!.ms;
    const t = setInterval(() => {
      setCursor((c) => {
        if (c >= end) return c;
        let i = c + 1;
        // Key Moments: skip ahead to the next line that matters.
        if (speed === 'key') while (i < end && !keysRef.current[i]) i++;
        setReach((r) => Math.max(r, i));
        return i;
      });
    }, ms);
    return () => clearInterval(t);
  }, [events, playing, speed, total, end]);

  // When the feed reaches the end, the match is played for real (same seed, same result).
  useEffect(() => {
    if (!events || finished || settled.current || !total) return;
    if (shownReach >= end) {
      settled.current = true;
      void run({ type: 'playGame', gameId });
    }
  }, [shownReach, end, total, events, finished, run, gameId]);

  useEffect(() => {
    // Scroll only the log box (scrollIntoView would drag the whole page away from the arena).
    const box = logRef.current;
    const row = box?.querySelector<HTMLElement>('[data-cur="true"]');
    if (box && row) {
      const top = row.offsetTop;
      if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top - box.clientHeight / 2;
    }
  }, [shownCursor]);

  if (missing) {
    const r = u.results[gameId];
    return (
      <section>
        <button className="link-btn" onClick={() => void watch(null)}>
          ← All matches
        </button>
        <h1>
          {home.name} {r?.homeScore ?? ''}–{r?.awayScore ?? ''} {away.name}
        </h1>
        <p className="muted">This match's play-by-play has been archived.</p>
      </section>
    );
  }
  if (!events || !total) return <p className="muted">Loading the broadcast feed…</p>;

  const line = lines[shownCursor];
  const frame = pitchStateAt(events, line.index, { homeId: game.homeId, awayId: game.awayId, lineups, viewClubId }, names);
  const r = u.results[gameId];
  const score = (id: string) => (id === game.homeId ? frame.score.home : frame.score.away);
  const fouls = (id: string) => (id === game.homeId ? frame.fouls.home : frame.fouls.away);
  const go = (i: number) => {
    setPlaying(false);
    setCursor(Math.max(0, Math.min(shownReach, i)));
  };
  const atEnd = finished && shownCursor >= end;
  const visible = lines
    .slice(0, shownReach + 1)
    .map((l, i) => ({ ...l, i }))
    .filter((l) => matchesFilter(l, events[l.index], filter));
  const arenaId = r?.arenaId ?? home.arenaId ?? 'glass-box';

  return (
    <section aria-labelledby="match-h" className="arena-console">
      <button className="link-btn" onClick={() => void watch(null)}>
        ← All matches
      </button>
      <h1 id="match-h" className="arena-title">
        The Assembly · {arenaId.replace(/-/g, ' ')}
      </h1>

      <div className="arena-board" aria-live="polite">
        <div className="team">
          <span className="sw" style={{ background: VIEW_COLOR }} />
          {left.abbr}
        </div>
        <div className="score">
          {score(left.id)} – {score(right.id)}
        </div>
        <div className="team">
          {right.abbr}
          <span className="sw" style={{ background: OPP_COLOR }} />
        </div>
        <div className="clock">
          {atEnd ? (r?.shootout ? `FT · pens ${r.shootout.home}–${r.shootout.away}` : 'FT') : frame.clock}
          <br />
          <span>
            Fouls {fouls(left.id)} · {fouls(right.id)}
          </span>
        </div>
      </div>

      <PitchView frame={frame} league={u.league} arenaId={arenaId} viewClubId={viewClubId} abbr={{ [home.id]: home.abbr, [away.id]: away.abbr }} />

      <div className="arena-chips">
        <TeamChip name={`${left.city} ${left.name}`} color={VIEW_COLOR} phase={frame.chips[0].phase} sub={frame.chips[0].sub} />
        <TeamChip name={`${right.city} ${right.name}`} color={OPP_COLOR} phase={frame.chips[1].phase} sub={frame.chips[1].sub} />
      </div>

      <div className="arena-controls">
        <button onClick={() => go(shownCursor - 1)} aria-label="Previous moment">
          ◀
        </button>
        <button
          className={playing && speed !== 'instant' ? 'on' : ''}
          onClick={() => {
            if (playing) return setPlaying(false);
            if (shownCursor >= end) setCursor(0);
            if (speed === 'instant') setSpeed('key');
            setPlaying(true);
          }}
        >
          {playing && speed !== 'instant' ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => go(shownCursor + 1)} aria-label="Next moment" disabled={shownCursor >= shownReach}>
          ▶
        </button>
        <button
          onClick={() => {
            if (speed === 'instant') setSpeed('key');
            setCursor(0);
            setPlaying(true);
          }}
        >
          Restart
        </button>
        <span className="poss">
          Possession {possessionOf[line.index]} of {finished ? possessionOf[events.length - 1] : '…'}
        </span>
      </div>
      <div className="speed-row" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s.id} className="chip" aria-pressed={speed === s.id} onClick={() => setSpeed(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="legend">
        <span><i style={{ background: VIEW_COLOR }} />In possession</span>
        <span><i style={{ background: 'var(--steel)' }} />Defensive block</span>
        <span><i style={{ background: '#334155' }} />Transition</span>
        <span><i style={{ background: 'var(--amber)' }} />Set piece</span>
        <span><i style={{ background: 'var(--accent)' }} />Facility</span>
      </div>

      {atEnd && r && <Recap result={r} events={events} />}

      <div className="speed-row" role="group" aria-label="Filter the log">
        {FILTERS.map((f) => (
          <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="arena-log" role="log" aria-label="Play log" ref={logRef}>
        {visible.map((l, k) => {
          const e = events[l.index];
          const tag = TAG[tagOf(e)];
          const prev = visible[k - 1];
          const newPossession = !prev || possessionOf[prev.index] !== possessionOf[l.index];
          const team = e.possessionTeamId === home.id ? home : away;
          return (
            <div key={l.index}>
              {newPossession && filter === 'all' && (
                <div className="sep">
                  Possession {possessionOf[l.index]} · {team.name}
                </div>
              )}
              <button
                className={`row ${l.i <= shownCursor ? 'seen' : ''} ${l.i === shownCursor ? 'cur' : ''} ${tagOf(e) === 'dir' ? 'dir' : ''}`}
                data-cur={l.i === shownCursor}
                aria-current={l.i === shownCursor}
                onClick={() => go(l.i)}
              >
                <span className="m">{mmss(e.second)}</span>
                <span className="t">
                  <span className="tag" style={{ ['--c' as string]: tag.color }}>
                    {tag.label}
                  </span>
                  {l.text}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <p className="note">
        Tap any log line to jump the arena to that moment. The {left.name} always attack left to right. Players stand in engine-assigned spots; nothing here is physics.
      </p>
    </section>
  );
}

function matchesFilter(l: { key: boolean; tone: string }, e: SoccerEvent, f: Filter) {
  switch (f) {
    case 'all': return true;
    case 'key': return l.key;
    case 'shots': return e.kind === 'shot' || e.kind === 'goal' || e.kind === 'penalty';
    case 'transitions': return e.kind === 'transition';
    case 'setPieces': return e.phase === 'attSetPiece';
    case 'facility': return l.tone === 'facility';
  }
}

function Recap({ result, events }: { result: NonNullable<ReturnType<typeof useAssembly.getState>['u']>['results'][string]; events: SoccerEvent[] }) {
  const u = useAssembly((s) => s.u)!;
  const home = clubOf(u, result.homeId)!;
  const away = clubOf(u, result.awayId)!;
  const st = phaseStats({ ...result, lineups: { home: [], away: [] }, injuries: {}, awakenings: [], events } as SoccerResult);
  const lines = recapLines(u, result);
  return (
    <div className="card recap">
      <p className="eyebrow">Recap</p>
      {lines.map((l, i) => (
        <p key={i} style={{ margin: 0 }}>
          {l}
        </p>
      ))}
      {[home, away].map((club) => {
        const secs = st[club.id]?.seconds;
        const total = secs ? Object.values(secs).reduce((a, b) => a + b, 0) : 0;
        return (
          <div key={club.id}>
            <p className="small muted" style={{ margin: '4px 0' }}>
              {club.name}: counters {st[club.id]?.countersScored ?? 0}/{st[club.id]?.countersLaunched ?? 0} scored · set-piece goals {st[club.id]?.setPieceGoals ?? 0}
            </p>
            <div className="phase-bar" role="img" aria-label={`${club.name} phase time`}>
              {secs && ALL_PHASES.map((p) => <span key={p} title={PHASE_LABEL[p]} style={{ width: `${(secs[p] * 100) / Math.max(1, total)}%`, background: PHASE_COLOR[p] }} />)}
            </div>
          </div>
        );
      })}
      <div className="legend">
        {ALL_PHASES.map((p) => (
          <span key={p}>
            <i style={{ background: PHASE_COLOR[p] }} />
            {PHASE_LABEL[p]}
          </span>
        ))}
      </div>
    </div>
  );
}
