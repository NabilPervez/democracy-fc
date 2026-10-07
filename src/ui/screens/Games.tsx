import { useState } from 'react';
import type { ScheduledGame } from '../../engine/baseball/types';
import { betsThisSeason, gamesOn, isSeasonOver, lastScheduledDay, seasonDays, stadiumEnvironment, unplayedToday } from '../../world/universe';
import { formatMult } from '../../engine/odds';
import { matchWinner } from '../../engine/season';
import { BetPanel, MassBet } from '../components/BetPanel';
import { BaseDiamond, Outs, TeamBadge } from '../components/bits';
import { useGame } from '../store';
import { DayCountdown, FirstPitch, useNow } from '../components/TimeBits';
import { describeEvent } from '../../narrative/playByPlay';
import { narrativeExtras } from '../../narrative/fromUniverse';
import { perk } from '../../world/persona';
import { GameView } from './GameView';

export function GameCard({ game }: { game: ScheduledGame }) {
  const u = useGame((s) => s.u)!;
  const [betting, setBetting] = useState(false);
  const watch = useGame((s) => s.watch);
  const away = u.league.teams.find((t) => t.id === game.awayId)!;
  const home = u.league.teams.find((t) => t.id === game.homeId)!;
  const r = u.results[game.id];
  const today = game.day === u.currentDay;
  const started = u.started.includes(game.id);
  const winner = r ? matchWinner(r) : null;
  const row = (team: typeof away, score: number | undefined, side: 'Away' | 'Home') => (
    <div className={`gc-row ${winner === team.id ? 'won' : ''}`}>
      <TeamBadge team={team} size={28} />
      <span className="gc-name">
        <span className="city">{team.city}</span> <strong>{team.name}</strong>
      </span>
      <span className="gc-side" title={side === 'Home' ? `Home team, at ${u.weird.stadiums[home.id]?.name ?? 'their stadium'}` : 'Visiting team'}>
        {side.toUpperCase()}
      </span>
      <span className="gc-score">{score ?? ''}</span>
    </div>
  );
  // A game playing right now (Play all, the live ticker, or left mid-watch): show where it stands.
  const running = useGame((s) => s.running[game.id]);
  const ticker = useGame((s) => (s.live?.gameId === game.id ? s.live : null));
  const progress = !r ? (running ?? ticker) : null;
  const now = progress ? progress.events[Math.max(0, progress.shown - 1)] : null;
  // The latest meaningful play (skip individual pitches), like the live ticker.
  let playIdx = progress ? Math.max(0, progress.shown - 1) : -1;
  while (progress && playIdx > 0 && ['ball', 'calledStrike', 'swingingStrike', 'foul', 'atBat'].includes(progress.events[playIdx].kind)) playIdx--;
  const status = r ? (r.innings > 9 ? `Final/${r.innings}` : 'Final') : today ? (started ? 'In progress ▶' : 'Watch ▶') : `Day ${game.day}`;
  const series = u.playoffs?.series.find((s) => s.games.includes(game.id));
  return (
    <div className="game-card card">
      <button className="gc-main" onClick={() => watch(game.id)} aria-label={`${away.name} at ${home.name}, ${status}`}>
        {row(away, r?.awayScore ?? now?.score.away, 'Away')}
        {row(home, r?.homeScore ?? now?.score.home, 'Home')}
        {now && now.kind !== 'gameEnd' && (
          <span className="gc-live" aria-label={`${now.half === 'top' ? 'Top' : 'Bottom'} of inning ${now.inning}, ${now.outs} out`}>
            <span className="live-dot" aria-hidden="true" />
            <span className="gc-inning">
              {now.half === 'top' ? '▲' : '▼'}
              {now.inning}
            </span>
            <BaseDiamond bases={now.bases} />
            <span className="gc-count">
              {now.balls}-{now.strikes}
            </span>
            <Outs outs={now.outs} />
          </span>
        )}
        {progress && playIdx >= 0 && <span className="gc-play">{describeEvent(u.league, game, progress.events, playIdx, narrativeExtras(u, game))}</span>}
        {!r && today && perk(u.persona, 'stadiumForecast') && u.engineVersion >= 4 && (
          <span className="gc-forecast small muted">
            🌦 Forecast:{' '}
            {stadiumEnvironment(u, game)
              .events.map((e) => `${e.icon} ${e.name}`)
              .join(', ') || 'calm skies'}
          </span>
        )}
        <span className={`gc-status ${!r && today ? 'live' : ''}`}>
          {series && <span className="pill">{series.round === u.playoffs!.finalRound ? 'Final' : 'Semifinal'} · game {series.games.indexOf(game.id) + 1}</span>} {now?.kind === 'gameEnd' ? 'Final — recording…' : status}
        </span>
      </button>
      <BetLine game={game} betting={betting} setBetting={setBetting} />
    </div>
  );
}

function BetLine({ game, betting, setBetting }: { game: ScheduledGame; betting: boolean; setBetting(b: boolean): void }) {
  const u = useGame((s) => s.u)!;
  const bet = betsThisSeason(u).find((b) => b.gameId === game.id);
  const open = game.day === u.currentDay && !u.results[game.id] && !u.started.includes(game.id);
  const team = bet && u.league.teams.find((t) => t.id === bet.teamId)!;
  if (betting && open) return <BetPanel game={game} onDone={() => setBetting(false)} />;
  return (
    <div className="gc-bet">
      {bet && team && (
        <span className={`bet-tag ${bet.status}`}>
          <i className="coin" aria-hidden="true" /> {bet.amount} on {team.name} @ {formatMult(bet.multMilli)}
          {bet.status === 'won' && <> · won {bet.payout}</>}
          {bet.status === 'lost' && <> · lost</>}
        </span>
      )}
      {open && (
        <button className="chip bet-btn" onClick={() => setBetting(true)} disabled={u.coins < 1}>
          {bet ? 'Add to bet' : 'Bet'}
        </button>
      )}
    </div>
  );
}

/** Next Game / Next Day / Next week / Until end of season. */
export function TimeControls() {
  const u = useGame((s) => s.u)!;
  const { run, busy } = useGame();
  if (isSeasonOver(u)) {
    return (
      <div className="time-controls" role="group" aria-label="Time controls">
        <button className="btn primary" disabled={busy} onClick={() => run({ type: 'endDay' })}>
          Start Season {u.season + 1} →
        </button>
        {u.clock && <span className="muted small">Living time will start it automatically after one day.</span>}
        {busy && <span className="muted small" role="status">Simulating…</span>}
      </div>
    );
  }
  const remaining = unplayedToday(u).length;
  const playoffs = u.phase === 'playoffs';
  // Weeks are days 1–7, 8–14…: sim to the first day of the next one (never past the regular season).
  const toNextWeek = Math.min(7 - ((u.currentDay - 1) % 7), Math.max(1, seasonDays(u) + 1 - u.currentDay));
  return (
    <div className="time-controls" role="group" aria-label="Time controls">
      <button className="btn primary" disabled={busy} onClick={() => run({ type: 'nextGame' })}>
        {remaining ? 'Next game' : `Start day ${u.currentDay + 1}`}
      </button>
      <button className="btn" disabled={busy} onClick={() => run({ type: 'endDay' })}>
        {remaining ? `Finish day ${u.currentDay}` : 'Next day'}
      </button>
      {!playoffs && (
        <button className="btn" disabled={busy} onClick={() => run({ type: 'simDays', count: toNextWeek })}>
          Next week (day {u.currentDay + toNextWeek})
        </button>
      )}
      <button
        className="btn"
        disabled={busy}
        onClick={() => {
          if (confirm(playoffs ? 'Simulate the rest of the playoffs?' : 'Simulate the rest of the season, including the playoffs?')) run({ type: 'simToSeasonEnd' });
        }}
      >
        {playoffs ? 'To the champion' : 'To season end'}
      </button>
      {busy && <span className="muted small" role="status">Simulating…</span>}
    </div>
  );
}

/** Kick off every game today at once, so they can all be watched together. */
function PlayAll() {
  const u = useGame((s) => s.u)!;
  const { startAll, busy } = useGame();
  const running = useGame((s) => s.running);
  const live = useGame((s) => s.live);
  const [starting, setStarting] = useState(false);
  const now = useNow(15_000);
  const waiting = unplayedToday(u).filter((g) => !running[g.id] && live?.gameId !== g.id);
  if (isSeasonOver(u) || !unplayedToday(u).length) return null;
  const playing = unplayedToday(u).length - waiting.length;
  return (
    <div className="play-all">
      <button
        className="btn primary"
        disabled={busy || starting || !waiting.length}
        onClick={async () => {
          setStarting(true);
          await startAll();
          setStarting(false);
        }}
      >
        {waiting.length ? `▶ Play all ${waiting.length} game${waiting.length === 1 ? '' : 's'} live` : 'All games are playing'}
      </button>
      <span className="muted small">
        {playing > 0 ? `${playing} playing now · tap a game to watch it` : 'Place your bets first — betting closes once a game starts.'}
        {waiting.length > 0 && <FirstPitch now={now} />}
      </span>
    </div>
  );
}

export function Games() {
  const u = useGame((s) => s.u)!;
  const watchingGameId = useGame((s) => s.watchingGameId);
  const maxDay = Math.max(lastScheduledDay(u), 1);
  const [day, setDay] = useState(Math.min(u.currentDay, maxDay));
  // When a new day begins, move the screen forward with it.
  const [seenDay, setSeenDay] = useState(u.currentDay);
  if (seenDay !== u.currentDay) {
    setSeenDay(u.currentDay);
    setDay(Math.min(u.currentDay, maxDay));
  }

  if (watchingGameId) return <GameView key={watchingGameId} gameId={watchingGameId} />;

  const games = gamesOn(u, day);
  return (
    <section>
      <header className="screen-head">
        <h1>Games</h1>
        <div className="day-picker">
          <button className="chip" onClick={() => setDay((d) => Math.max(1, d - 1))} disabled={day <= 1} aria-label="Previous day">
            ‹
          </button>
          <span>
            {day > seasonDays(u) ? `Playoffs · day ${day - seasonDays(u)}` : `Day ${day}`} <span className="muted">/ {seasonDays(u)}</span>
          </span>
          <button className="chip" onClick={() => setDay((d) => Math.min(maxDay, d + 1))} disabled={day >= maxDay} aria-label="Next day">
            ›
          </button>
          {day !== u.currentDay && !isSeasonOver(u) && (
            <button className="chip" onClick={() => setDay(u.currentDay)}>
              Today
            </button>
          )}
        </div>
      </header>
      {day === u.currentDay && <DayCountdown />}
      {day > u.currentDay && <p className="muted">Upcoming — these games haven't happened yet.</p>}
      <div className="game-grid">
        {games.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
      </div>
      {day === u.currentDay && <PlayAll />}
      {day === u.currentDay && <MassBet />}
      {day === u.currentDay && <TimeControls />}
    </section>
  );
}
