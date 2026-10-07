import { useState } from 'react';
import type { Player } from '../../engine/baseball/types';
import { leaderboards, type Board } from '../../world/leaders';
import { lockUnlocked, PICK_RATES, pickOf, SLOT_UNLOCKS, streakMultiplierPct, type PickKind } from '../../world/picks';
import { backSlots, fadeSlots, FAVORITE_LOCKS_AFTER_SEASON, FAVORITE_WIN_BONUS, pickError, type UniverseState } from '../../world/universe';
import { useGame } from '../store';
import { TeamBadge } from './bits';

/** Favorite team: choose or change it during Season 1; it locks after that. */
export function FavoriteTeamControl() {
  const u = useGame((s) => s.u)!;
  const dispatch = useGame((s) => s.dispatch);
  if (!u.persona) return null;
  const fav = u.persona.favoriteTeamId ? u.league.teams.find((t) => t.id === u.persona!.favoriteTeamId) : null;
  const locked = u.season > FAVORITE_LOCKS_AFTER_SEASON;
  if (locked) return null;
  return (
    <label className="fav-team">
      <span className="small">
        {fav ? 'Favorite team' : 'Pick a favorite team'} — <strong>+{FAVORITE_WIN_BONUS} coins every time they win</strong>. Locks after Season {FAVORITE_LOCKS_AFTER_SEASON}.
      </span>
      <select className="field" value={fav?.id ?? ''} onChange={(e) => e.target.value && dispatch({ type: 'favoriteTeamSet', teamId: e.target.value })}>
        {!fav && <option value="">— choose a team —</option>}
        {u.league.teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.city} {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const describePick = (p: Player, kind: PickKind) =>
  kind === 'back'
    ? p.role === 'pitcher'
      ? `+${PICK_RATES.backStrikeout} per strikeout thrown`
      : `+${PICK_RATES.backHit} per hit, +${PICK_RATES.backHomeRun} more per home run, +${PICK_RATES.backSteal} per stolen base`
    : p.role === 'pitcher'
      ? `+${PICK_RATES.fadeHitAllowed} per hit, +${PICK_RATES.fadeRunAllowed} per run allowed, +${PICK_RATES.fadeWildPitch} per wild pitch`
      : `+${PICK_RATES.fadeStrikeout} per strikeout, +${PICK_RATES.fadeHitless} for a hitless game, +${PICK_RATES.fadeCaught} if caught stealing or doubled up`;

/** Back / Fade buttons for a player page. */
export function PickButtons({ player }: { player: Player }) {
  const u = useGame((s) => s.u)!;
  const dispatch = useGame((s) => s.dispatch);
  const current = pickOf(u.picks, player.id);
  const streak = current ? (u.pickStreaks?.[player.id] ?? 0) : 0;
  const set = (kind: PickKind | null) => {
    // Dropping or switching a pick resets its streak: warn before throwing a hot one away.
    if (streak >= 3 && kind !== current && !window.confirm(`${player.name} has paid ${streak} games in a row. Changing this pick resets the streak. Continue?`)) return;
    dispatch({ type: 'pickSet', playerId: player.id, kind });
  };
  const locked = u.pickLock?.season === u.season && u.pickLock.playerId === player.id;
  const canLock = !!current && lockUnlocked(u.picksLifetime ?? 0) && u.pickLock?.season !== u.season;
  const backErr = pickError(u, player.id, 'back');
  const fadeErr = pickError(u, player.id, 'fade');
  return (
    <div className="pick-buttons card pad stack">
      <p className="eyebrow">Your pick</p>
      <div className="row">
        <button className="chip pick-back" aria-pressed={current === 'back'} disabled={!!backErr && current !== 'back'} onClick={() => set(current === 'back' ? null : 'back')}>
          ▲ Back
        </button>
        <button className="chip pick-fade" aria-pressed={current === 'fade'} disabled={!!fadeErr && current !== 'fade'} onClick={() => set(current === 'fade' ? null : 'fade')}>
          ▼ Fade
        </button>
      </div>
      <p className="small muted">
        {current ? (
          <>
            You {current === 'back' ? 'back' : 'fade'} {player.name}: {describePick(player, current)}.
          </>
        ) : (
          <>
            Back: {describePick(player, 'back')}. Fade: {describePick(player, 'fade')}.
          </>
        )}
      </p>
      {current && (
        <p className="small">
          <StreakFlame streak={streak} /> {streak ? `Paid ${streak} game${streak === 1 ? '' : 's'} in a row` : 'No streak yet'} — next payout ×{streakMultiplierPct(streak) / 100}.
          {locked && ' 🔐 Locked: survives one empty game this season.'}
        </p>
      )}
      {canLock && (
        <button className="chip inline" onClick={() => dispatch({ type: 'pickLocked', playerId: player.id })}>
          🔐 Lock this pick (once a season)
        </button>
      )}
      {!current && (backErr || fadeErr) && <p className="small muted">{backErr ?? fadeErr}</p>}
    </div>
  );
}

/** 🔥 and the streak, from 1 game in a row. */
export function StreakFlame({ streak }: { streak: number }) {
  if (!streak) return null;
  return (
    <span className="streak-flame" title={`Paid ${streak} games in a row`} aria-label={`streak ${streak}`}>
      🔥{streak}
    </span>
  );
}

/** Today: the player's backed and faded players and what they've earned. */
export function PicksPanel() {
  const u = useGame((s) => s.u)!;
  const showDetail = useGame((s) => s.showDetail);
  const row = (id: string, kind: PickKind) => {
    const p = u.league.players[id];
    const team = u.league.teams.find((t) => t.id === p.teamId)!;
    const s = u.seasonStats[id];
    const line = s ? (p.role === 'pitcher' ? `${s.pk} K · ${s.ra} R allowed` : `${s.h}-for-${s.ab} · ${s.hr} HR · ${s.k} K`) : 'No games yet';
    return (
      <li key={id}>
        <button className="link-row pick-row" onClick={() => showDetail({ kind: 'player', id })}>
          <span className={`pick-tag ${kind}`}>{kind === 'back' ? '▲ Back' : '▼ Fade'}</span>
          <TeamBadge team={team} size={22} />
          <span className="pick-name">
            {p.name} <StreakFlame streak={u.pickStreaks?.[id] ?? 0} />
          </span>
          <span className="muted small">{line}</span>
        </button>
      </li>
    );
  };
  const empty = !u.picks.back.length && !u.picks.fade.length;
  const lifetime = u.picksLifetime ?? 0;
  const next = SLOT_UNLOCKS.find((x) => lifetime < x.at);
  return (
    <>
      <h2>Your picks</h2>
      <div className="card pad stack picks-panel">
        <p className="small">
          Picks earned <strong className="pos">+{u.pickEarnings}</strong> coins this season ({lifetime.toLocaleString()} lifetime). Back up to {backSlots(u)} players and fade up to {fadeSlots(u)} from any player's page. A pick that pays 3+ games in a row earns ×1.25, 5+ ×1.5, 10+ ×2.
        </p>
        {next && (
          <p className="small muted">
            Next unlock at {next.at.toLocaleString()} lifetime pick coins: {next.text}.
          </p>
        )}
        {empty ? (
          <p className="muted small">No picks yet. Open a player in League → choose ▲ Back (they do well, you earn) or ▼ Fade (they struggle, you earn).</p>
        ) : (
          <ul className="pick-list">
            {u.picks.back.map((id) => row(id, 'back'))}
            {u.picks.fade.map((id) => row(id, 'fade'))}
          </ul>
        )}
      </div>
    </>
  );
}

function BoardTable({ u, board }: { u: UniverseState; board: Board }) {
  const showDetail = useGame((s) => s.showDetail);
  return (
    <div className="card leader-board">
      <h3 className="leader-title display">{board.label}</h3>
      {board.rows.length === 0 ? (
        <p className="muted small pad-x">Not enough games yet.</p>
      ) : (
        <ol className="leader-rows">
          {board.rows.map((r, i) => {
            const p = u.league.players[r.playerId];
            const team = u.league.teams.find((t) => t.id === p.teamId);
            const pick = pickOf(u.picks, r.playerId);
            return (
              <li key={r.playerId}>
                <span className="leader-rank">{i + 1}</span>
                {team && <TeamBadge team={team} size={20} />}
                <button className="link-row leader-name" onClick={() => showDetail({ kind: 'player', id: r.playerId })}>
                  {p.name}
                  {pick && <span className={`pick-dot ${pick}`} aria-label={pick === 'back' ? '(you back them)' : '(you fade them)'} />}
                </button>
                <strong className="leader-value">{r.display}</strong>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** League leaderboards, hitters and pitchers separately; season or career. */
export function Leaders() {
  const u = useGame((s) => s.u)!;
  const [span, setSpan] = useState<'season' | 'career'>('season');
  const stats = span === 'season' ? u.seasonStats : u.careerStats;
  // Games a regular has played: the most games by any hitter. Sets the minimums for AVG and ERA.
  const teamGames = Math.max(1, ...Object.entries(stats).map(([id, s]) => (u.league.players[id]?.role === 'batter' ? s.g : 0)));
  const { hitters, pitchers } = leaderboards(stats, u.league, teamGames);
  return (
    <>
      <div className="leaders-head">
        <h2>Leaders</h2>
        <div className="choice-row" role="group" aria-label="Leaderboard span">
          <button className="chip" aria-pressed={span === 'season'} onClick={() => setSpan('season')}>
            Season {u.season}
          </button>
          <button className="chip" aria-pressed={span === 'career'} onClick={() => setSpan('career')}>
            Career
          </button>
        </div>
      </div>
      <h3 className="leaders-sub">Hitters</h3>
      <div className="leader-grid">
        {hitters.map((b) => (
          <BoardTable key={b.id} u={u} board={b} />
        ))}
      </div>
      <h3 className="leaders-sub">Pitchers</h3>
      <div className="leader-grid">
        {pitchers.map((b) => (
          <BoardTable key={b.id} u={u} board={b} />
        ))}
      </div>
    </>
  );
}
