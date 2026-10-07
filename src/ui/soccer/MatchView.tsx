import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_PHASES, phaseStats } from '../../engine/soccer/phase';
import type { Phase, SoccerEvent, SoccerResult } from '../../engine/soccer/types';
import { narrateSoccerMatch } from '../../narrative/soccer';
import { recapLines } from '../../world/soccer/recap';
import { clubOf } from '../../world/soccer/universe';
import { pitchStateAt } from '../pitch/pitchState';
import { Crest, PHASE_LABEL, PhaseChip } from './bits';
import { PitchView } from './PitchView';
import { useAssembly, type Speed } from './store';

const SPEEDS: { id: Speed; label: string; ms: number }[] = [
  { id: 'live', label: 'Live', ms: 1400 },
  { id: 'x2', label: '2×', ms: 700 },
  { id: 'x5', label: '5×', ms: 280 },
  { id: 'key', label: 'Key Moments', ms: 800 },
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
  buildUp: '#f7dc85', progression: '#f5cf55', creation: '#f2c230', highBlock: '#6b7383', midBlock: '#4c5362', lowBlock: '#343a46',
  attTransition: '#ffffff', defTransition: '#cfcfd6', attSetPiece: '#e8a317', defSetPiece: '#b38019',
};

export function MatchView({ gameId }: { gameId: string }) {
  const u = useAssembly((s) => s.u)!;
  const { speed, setSpeed, playByPlay, run, watch } = useAssembly();
  const game = u.schedule.find((g) => g.id === gameId)!;
  const [events, setEvents] = useState<SoccerEvent[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [shown, setShown] = useState(0); // index into narrated lines
  const [scrub, setScrub] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const finished = !!u.results[gameId];
  const settled = useRef(false);

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
  const ctx = useMemo(() => ({ league: u.league, gameId, homeId: game.homeId, awayId: game.awayId }), [u.league, gameId, game.homeId, game.awayId]);
  const lines = useMemo(() => (events ? narrateSoccerMatch(events, ctx) : []), [events, ctx]);
  const lineups = useMemo(() => {
    const first = events?.find((e) => e.kind === 'lineups');
    return first && first.kind === 'lineups' ? { home: first.home, away: first.away } : { home: [], away: [] };
  }, [events]);

  // Already finished (or Instant): show everything.
  const complete = finished || speed === 'instant';
  const total = lines.length;
  const visible = complete ? total : Math.min(shown, total);

  useEffect(() => {
    if (!events || complete) return;
    const ms = SPEEDS.find((s) => s.id === speed)!.ms;
    const t = setInterval(() => {
      setShown((n) => {
        if (n >= total) return n;
        if (speed !== 'key') return n + 1;
        // Key Moments: jump to the next line that matters.
        let i = n + 1;
        while (i < total && !lines[i - 1]?.key) i++;
        return Math.min(i, total);
      });
    }, ms);
    return () => clearInterval(t);
  }, [events, speed, complete, total, lines]);

  // When the feed reaches the end, the match is played for real (same seed, same result).
  useEffect(() => {
    if (!events || finished || settled.current) return;
    if (visible >= total && total > 0) {
      settled.current = true;
      void run({ type: 'playGame', gameId });
    }
  }, [visible, total, events, finished, run, gameId]);

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
  if (!events) return <p className="muted">Loading the broadcast feed…</p>;

  const lastLine = visible > 0 ? lines[visible - 1] : null;
  const eventIndex = scrub ?? (lastLine ? lastLine.index : 0);
  const frame = pitchStateAt(events, eventIndex, { homeId: game.homeId, awayId: game.awayId, lineups, viewClubId: game.awayId === u.favoriteClubId ? game.awayId : game.homeId });
  const colors = { [home.id]: home.colors[0], [away.id]: away.colors[0] };
  const atk = frame.possessionTeamId ? clubOf(u, frame.possessionTeamId) : null;
  const def = frame.possessionTeamId ? (frame.possessionTeamId === home.id ? away : home) : null;
  const shownLines = lines.slice(0, visible).filter((l) => matchesFilter(l, events[l.index], filter)).reverse();
  const r = u.results[gameId];
  const momentum = frame.momentum;

  return (
    <section aria-labelledby="match-h">
      <button className="link-btn" onClick={() => void watch(null)}>
        ← All matches
      </button>
      <h1 id="match-h" className="sr-only">
        {home.name} vs {away.name}
      </h1>
      <div className="card scorebar" style={{ marginTop: 8 }}>
        <span className="side">
          <Crest team={home} />
          <strong>{home.abbr}</strong>
        </span>
        <span>
          <span className="score" aria-live="polite">
            {frame.score.home}–{frame.score.away}
          </span>
          <span className="clock">
            {complete ? (r?.shootout ? `FT · pens ${r.shootout.home}–${r.shootout.away}` : 'FT') : `${frame.minute}'`}
          </span>
        </span>
        <span className="side away">
          <strong>{away.abbr}</strong>
          <Crest team={away} />
        </span>
      </div>
      <p className="momentum" aria-label={`Momentum ${momentum > 0 ? home.name : momentum < 0 ? away.name : 'even'}`}>
        Momentum {momentum === 0 ? 'even' : `${momentum > 0 ? home.abbr : away.abbr} +${Math.abs(momentum)}`}
      </p>

      <PitchView frame={frame} league={u.league} arenaId={r?.arenaId ?? home.arenaId ?? 'glass-box'} colors={colors} />

      {atk && def && frame.phase && frame.defPhase && (
        <div className="phase-chips">
          <PhaseChip phase={frame.phase} prefix={atk.abbr} />
          <PhaseChip phase={frame.defPhase} prefix={def.abbr} />
        </div>
      )}

      {!finished && (
        <div className="speed-row" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s.id} className="chip" aria-pressed={speed === s.id} onClick={() => setSpeed(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {complete && r && <Recap result={r} events={events} />}

      <h2>Play log</h2>
      <div className="speed-row" role="group" aria-label="Filter the log">
        {FILTERS.map((f) => (
          <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <ol className="play-log" aria-live="polite">
        {shownLines.map((l) => (
          <li key={l.index}>
            <button aria-current={scrub === l.index} onClick={() => setScrub(scrub === l.index ? null : l.index)}>
              <span className="min">{l.minute}'</span>
              <PhaseChip phase={events[l.index].phase} />
              <span className={`tone-${l.tone}`}>{l.text}</span>
            </button>
          </li>
        ))}
      </ol>
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
