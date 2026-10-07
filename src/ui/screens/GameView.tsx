import { useEffect, useRef, useState } from 'react';
import type { GameEvent } from '../../engine/baseball/types';
import { describeEvent, isBigMoment } from '../../narrative/playByPlay';
import { narrativeExtras } from '../../narrative/fromUniverse';
import { envFooter } from '../../world/environment';
import { BaseDiamond, Outs, TeamBadge } from '../components/bits';
import { useGame } from '../store';
import { isPinned, setPinned } from '../../storage/db';

const SPEEDS = [
  { label: 'Live', ms: 1500 },
  { label: '2×', ms: 750 },
  { label: '5×', ms: 300 },
] as const;

export function GameView({ gameId }: { gameId: string }) {
  const u = useGame((s) => s.u)!;
  const { run, watch, playByPlay } = useGame();
  const game = u.schedule.find((g) => g.id === gameId)!;
  const alreadyPlayed = !!u.results[gameId];
  const playable = game.day === u.currentDay;

  const [events, setEvents] = useState<GameEvent[] | null>(null);
  const [archived, setArchived] = useState(false);
  // null = this game has no saved play-by-play (yet), so it can't be pinned.
  const [pinned, setPinnedState] = useState<boolean | null>(null);
  const recordedNow = !!u.results[gameId];
  useEffect(() => {
    if (recordedNow) isPinned(u.id, u.season, gameId).then(setPinnedState);
  }, [recordedNow, u.id, u.season, gameId]);
  const togglePin = async () => {
    if (pinned === null) return;
    if (await setPinned(u.id, u.season, gameId, !pinned)) setPinnedState(!pinned);
  };
  const [shown, setShown] = useState(0);
  const [speed, setSpeed] = useState<number>(SPEEDS[0].ms);
  const [paused, setPaused] = useState(false);

  // Load once. The sim is deterministic, so replaying an unplayed game shows exactly what will be recorded.
  const startedPlayed = useRef(alreadyPlayed);
  useEffect(() => {
    let live = true;
    playByPlay(gameId).then((evts) => {
      if (!live) return;
      if (!evts) {
        setArchived(true);
        return;
      }
      setEvents(evts);
      const { live: ticker, running } = useGame.getState();
      setShown(startedPlayed.current || !playable ? evts.length : running[gameId]?.shown ?? (ticker?.gameId === gameId ? ticker.shown : 1));
    });
    return () => {
      live = false;
    };
  }, [gameId, playByPlay, playable]);

  const total = events?.length ?? 0;
  const done = events !== null && shown >= total;

  useEffect(() => {
    if (!events || done || paused) return;
    const t = setTimeout(() => setShown((n) => Math.min(n + 1, total)), speed);
    return () => clearTimeout(t);
  }, [events, shown, done, paused, speed, total]);

  // Keep the game's progress in the store so it carries on in the background (and on the Games
  // list) after the player leaves this screen.
  const setProgress = useGame((s) => s.setProgress);
  useEffect(() => {
    if (events && playable && !alreadyPlayed && !done) setProgress(gameId, events, shown);
  }, [events, playable, alreadyPlayed, done, gameId, shown, setProgress]);

  // Record the result once the player has seen the final out.
  useEffect(() => {
    if (done && playable && !u.results[gameId]) run({ type: 'playGame', gameId });
  }, [done, playable, gameId, u.results, run]);

  const away = u.league.teams.find((t) => t.id === game.awayId)!;
  const home = u.league.teams.find((t) => t.id === game.homeId)!;

  if (archived) {
    const r = u.results[gameId];
    return (
      <section>
        <button className="link-btn" onClick={() => watch(null)}>← All games</button>
        <div className="card pad">
          <p className="display big-ish">
            {away.name} {r.awayScore} – {r.homeScore} {home.name}
          </p>
          <p className="muted">Final{r.innings > 9 ? ` (${r.innings} innings)` : ''}. Play-by-play is kept for the last 7 days; this game's feed has been archived.</p>
        </div>
      </section>
    );
  }
  if (!events) return <p className="muted">Loading game…</p>;
  if (!playable && !alreadyPlayed) {
    return (
      <section>
        <button className="link-btn" onClick={() => watch(null)}>← All games</button>
        <p className="muted">This game is on day {game.day}. It can be watched when that day comes.</p>
      </section>
    );
  }

  const current = events[Math.max(0, shown - 1)];
  const extras = narrativeExtras(u, game);
  const feed = events.slice(0, shown).map((e, i) => ({ e, i })).reverse();

  return (
    <section className="game-view" aria-label={`${away.name} at ${home.name}`}>
      <div className="row">
        <button className="link-btn" onClick={() => watch(null)}>
          ← All games
        </button>
        {done && pinned !== null && (
          <button className="chip pin-btn" aria-pressed={pinned} onClick={togglePin}>
            {pinned ? '★ Pinned' : '☆ Pin this game'}
          </button>
        )}
      </div>

      <div className="scoreboard card">
        <div className="sb-team">
          <TeamBadge team={away} size={40} />
          <span className="sb-name">{away.name}</span>
          <span className="sb-score">{current.score.away}</span>
        </div>
        <div className="sb-mid">
          <span className="sb-inning">{done ? 'FINAL' : `${current.half === 'top' ? '▲' : '▼'} ${current.inning}`}</span>
          {!done && (
            <>
              <BaseDiamond bases={current.bases} />
              <span className="sb-count">
                {current.balls}-{current.strikes} <Outs outs={current.outs} />
              </span>
            </>
          )}
        </div>
        <div className="sb-team">
          <TeamBadge team={home} size={40} />
          <span className="sb-name">{home.name}</span>
          <span className="sb-score">{current.score.home}</span>
        </div>
      </div>

      {!done && (
        <div className="speed-controls" role="group" aria-label="Playback speed">
          <button className="chip" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? '▶ Play' : '❚❚ Pause'}
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s.label}
              className="chip"
              aria-pressed={!paused && speed === s.ms}
              onClick={() => {
                setSpeed(s.ms);
                setPaused(false);
              }}
            >
              {s.label}
            </button>
          ))}
          <button className="chip" onClick={() => setShown(total)}>
            Instant
          </button>
        </div>
      )}

      <ol className="feed" aria-live={done ? 'off' : 'polite'} aria-label="Play-by-play">
        {feed.map(({ e, i }) => (
          <li key={i} className={`feed-item ${isBigMoment(e) ? 'big' : ''} k-${e.kind}`}>
            {describeEvent(u.league, game, events, i, extras)}
          </li>
        ))}
      </ol>
      {done && envFooter(events) && <p className="env-footer small muted">{envFooter(events)}</p>}
    </section>
  );
}
