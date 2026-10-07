import { useState } from 'react';
import { getArena, getSignature } from '../../engine/soccer/arenas';
import { soccerStars } from '../../engine/soccer/sport';
import type { SoccerPlayer, SoccerStarGroup } from '../../engine/soccer/types';
import { averageStars, benefit, clubView, coalitions, electionTotals } from '../../world/soccer/elections';
import { soccerMod } from '../../world/soccer/weird';
import {
  clubOf, currentElection, electionVoteCost, fixturesOn, isKnockout, soccerStandings, voteError, type SoccerUniverse,
} from '../../world/soccer/universe';
import { Crest, DRIVE_INFO, POSITION_LABEL, Stars } from './bits';
import { MatchView } from './MatchView';
import { useAssembly } from './store';

// ---------------------------------------------------------------------------
// Matches

export function Matches() {
  const u = useAssembly((s) => s.u)!;
  const { watching, watch } = useAssembly();
  const [day, setDay] = useState(u.currentDay);
  if (watching) return <MatchView gameId={watching} />;
  const games = fixturesOn(u, day);
  const lastDay = u.schedule.reduce((m, g) => Math.max(m, g.day), 1);
  return (
    <section aria-labelledby="matches-h">
      <div className="screen-head">
        <h1 id="matches-h">Matches</h1>
        <div className="day-picker" role="group" aria-label="Matchday">
          <button className="chip" disabled={day <= 1} onClick={() => setDay(day - 1)} aria-label="Previous day">
            ‹
          </button>
          <span className="small">Day {day}</span>
          <button className="chip" disabled={day >= lastDay} onClick={() => setDay(day + 1)} aria-label="Next day">
            ›
          </button>
        </div>
      </div>
      {!games.length && <p className="muted">No matches on this day.</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {games.map((g) => {
          const h = clubOf(u, g.homeId)!;
          const a = clubOf(u, g.awayId)!;
          const r = u.results[g.id];
          const mine = g.homeId === u.favoriteClubId || g.awayId === u.favoriteClubId;
          const playable = g.day === u.currentDay || !!r;
          return (
            <button key={g.id} className={`card fixture ${mine ? 'mine' : ''}`} disabled={!playable} onClick={() => void watch(g.id)} aria-label={`${h.name} vs ${a.name}${r ? `, ${r.homeScore} to ${r.awayScore}` : ''}`}>
              <span className="home">
                <Crest team={h} />
                <span className="name">{h.name}</span>
              </span>
              <span className="mid">
                {r ? `${r.homeScore}–${r.awayScore}` : 'vs'}
                <small>{r ? (r.shootout ? `pens ${r.shootout.home}–${r.shootout.away}` : 'FT') : isKnockout(u, g.id) ? 'Knockout' : u.started.includes(g.id) ? 'Live' : 'Watch'}</small>
              </span>
              <span className="away">
                <span className="name">{a.name}</span>
                <Crest team={a} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Facility: standings, clubs, players

export function Facility() {
  const u = useAssembly((s) => s.u)!;
  const { detail, showDetail } = useAssembly();
  if (detail?.kind === 'club') return <ClubPage clubId={detail.id} />;
  if (detail?.kind === 'player') return <PlayerPage playerId={detail.id} />;
  const table = soccerStandings(u);
  const ejectFrom = table.length - u.ejections;
  const scorers = Object.entries(u.seasonStats).filter(([id]) => u.league.players[id]).sort((a, b) => b[1].goals - a[1].goals || b[1].assists - a[1].assists).slice(0, 8);
  return (
    <section aria-labelledby="facility-h">
      <div className="screen-head hero">
        <p className="eyebrow">The Assembly · Season {u.season}</p>
        <h1 id="facility-h">Facility</h1>
        <p className="muted small">The dashed line is the Ejection line: clubs below it leave the facility at season's end.</p>
      </div>
      <div className="table-wrap card">
        <table className="dfc-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="club">Club</th>
              <th title="Played">P</th>
              <th title="Won">W</th>
              <th title="Drawn">D</th>
              <th title="Lost">L</th>
              <th title="Goal difference">GD</th>
              <th title="Points">Pts</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r, i) => {
              const c = clubOf(u, r.teamId)!;
              return (
                <tr key={r.teamId} className={`${r.teamId === u.favoriteClubId ? 'mine' : ''} ${i === ejectFrom ? 'eject-line' : ''}`}>
                  <td>{i + 1}</td>
                  <td className="club">
                    <button className="club-btn" onClick={() => showDetail({ kind: 'club', id: c.id })}>
                      <Crest team={c} size={22} />
                      {c.city} {c.name}
                    </button>
                  </td>
                  <td>{r.wins + r.draws + r.losses}</td>
                  <td>{r.wins}</td>
                  <td>{r.draws}</td>
                  <td>{r.losses}</td>
                  <td>{r.runsFor - r.runsAgainst > 0 ? '+' : ''}{r.runsFor - r.runsAgainst}</td>
                  <td>
                    <strong>{r.points}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h2>Top scorers</h2>
      <ol className="feed">
        {scorers.map(([id, l]) => (
          <li key={id} className="feed-item">
            <button className="link-btn" onClick={() => showDetail({ kind: 'player', id })}>
              {u.league.players[id].name}
            </button>{' '}
            <span className="muted small">
              {clubOf(u, u.league.players[id].teamId)?.name} · {l.goals} goals, {l.assists} assists
            </span>
          </li>
        ))}
        {!scorers.length && <li className="muted">No goals yet this season.</li>}
      </ol>
    </section>
  );
}

const STYLE_LABEL: Record<string, string> = {
  allOutAttack: 'All-Out Attack', counterPunch: 'Counter-Punch', possessionWall: 'Possession Wall', longBallSiege: 'Long-Ball Siege', parkTheBus: 'Park the Bus',
};

function ClubPage({ clubId }: { clubId: string }) {
  const u = useAssembly((s) => s.u)!;
  const { showDetail, dispatch } = useAssembly();
  const club = clubOf(u, clubId);
  const [confirm, setConfirm] = useState(false);
  if (!club) return <p className="muted">That club has left the facility.</p>;
  const switchable = club.id !== u.favoriteClubId && u.lastClubSwitchSeason !== u.season;
  return (
    <section>
      <button className="link-btn" onClick={() => showDetail(null)}>
        ← Facility
      </button>
      <div className="screen-head hero">
        <Crest team={club} size={48} />
        <h1>
          {club.city} {club.name}
        </h1>
        <p className="muted">
          Style: {STYLE_LABEL[club.style]} · Fan base {club.fanSize} · Home arena: {getArena(club.arenaId).name}
        </p>
      </div>
      <div className="squad">
        {club.squad.map((id, i) => {
          const p = u.league.players[id];
          if (!p) return null;
          return (
            <button key={id} className="card squad-row" onClick={() => showDetail({ kind: 'player', id })}>
              <span className="muted small">{p.position}</span>
              <span>
                {p.name} {i >= 5 && <span className="muted small">(reserve)</span>}
                {u.injuries[id] ? <span className="badge hurts" style={{ marginLeft: 6 }}>Injured {u.injuries[id]}</span> : null}
              </span>
              <span className="drive-chip">
                {DRIVE_INFO[p.drive].icon} {DRIVE_INFO[p.drive].label}
              </span>
            </button>
          );
        })}
      </div>
      {club.id !== u.favoriteClubId && (
        <div style={{ marginTop: 16 }}>
          {!confirm ? (
            <button className="btn" disabled={!switchable} onClick={() => setConfirm(true)}>
              {switchable ? `Support the ${club.name} instead` : 'You already switched clubs this season'}
            </button>
          ) : (
            <div className="card callout" role="alertdialog" aria-labelledby="switch-h" style={{ padding: 14 }}>
              <p id="switch-h" style={{ marginTop: 0 }}>
                <strong>Switch to the {club.name}?</strong> You'll lose all {u.coins} coins. You can't switch again until next season.
              </p>
              <button className="btn primary" onClick={() => void dispatch({ type: 'clubSwitched', clubId: club.id })}>
                Switch and lose {u.coins} coins
              </button>{' '}
              <button className="btn" onClick={() => setConfirm(false)}>
                Stay
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const GROUP_LABEL: Record<SoccerStarGroup, string> = { attack: 'Attack', playmaking: 'Playmaking', defense: 'Defense', engine: 'Engine', keeping: 'Keeping' };

export function PlayerCard({ p, u }: { p: SoccerPlayer; u: SoccerUniverse }) {
  const groups: SoccerStarGroup[] = p.position === 'K' ? ['keeping', 'defense', 'playmaking', 'engine'] : ['attack', 'playmaking', 'defense', 'engine'];
  const sig = getSignature(p.signatureId);
  const mods = (u.mods[p.id] ?? []).map((m) => soccerMod(m.id)).filter(Boolean);
  const returned = mods.some((m) => m!.returnedOnly);
  const bonds = Object.entries(p.bonds ?? {}).filter(([, n]) => n >= 3).map(([id]) => u.league.players[id]?.name).filter(Boolean);
  const rivals = Object.entries(p.rivals ?? {}).filter(([, n]) => n >= 3).map(([id]) => u.league.players[id]?.name).filter(Boolean);
  const line = u.seasonStats[p.id];
  const cap = u.captaincy[p.id];
  return (
    <div className={`card pcard ${p.awakened ? 'awakened' : ''} ${returned ? 'returned' : ''}`}>
      <p className="eyebrow">
        {POSITION_LABEL[p.position]} · {clubOf(u, p.teamId)?.name ?? 'Unattached'}
      </p>
      <h2 style={{ margin: 0, color: 'var(--text)' }}>{p.name}</h2>
      {p.catchphrase && <p className="muted" style={{ margin: 0 }}>“{p.catchphrase}”</p>}
      <div className="star-groups">
        {groups.map((g) => (
          <span key={g} style={{ display: 'contents' }}>
            <span className="muted">{GROUP_LABEL[g]}</span>
            <Stars value={soccerStars(p, g)} label={GROUP_LABEL[g]} />
          </span>
        ))}
      </div>
      <p style={{ margin: 0 }}>
        <span className="drive-chip">
          {DRIVE_INFO[p.drive].icon} {DRIVE_INFO[p.drive].label}
        </span>{' '}
        <span className="muted small">{DRIVE_INFO[p.drive].text}</span>
      </p>
      {sig && (
        <p style={{ margin: 0 }}>
          ★ <strong>{sig.name}</strong> <span className="muted small">— {sig.text}.</span>
        </p>
      )}
      {p.awakened && <p style={{ margin: 0, color: 'var(--secondary)' }}>✷ Awakened in season {p.awakened.seasonId}.</p>}
      {mods.map((m) => (
        <p key={m!.id} className="small" style={{ margin: 0 }}>
          {m!.icon} <strong>{m!.name}</strong> <span className="muted">{m!.description}</span>
        </p>
      ))}
      {bonds.length > 0 && <p className="small" style={{ margin: 0 }}>Bonds: {bonds.join(', ')}</p>}
      {rivals.length > 0 && <p className="small" style={{ margin: 0 }}>Rivals: {rivals.join(', ')}</p>}
      {cap && <p className="small muted" style={{ margin: 0 }}>Captained {cap.total}× {cap.streak >= 5 ? '· Fan Favorite' : ''}</p>}
      {line && (
        <p className="small muted" style={{ margin: 0 }}>
          This season: {line.apps} apps · {line.goals} goals · {line.assists} assists{p.position === 'K' ? ` · ${line.saves} saves · ${line.cleanSheets} clean sheets` : ''}
        </p>
      )}
    </div>
  );
}

function PlayerPage({ playerId }: { playerId: string }) {
  const u = useAssembly((s) => s.u)!;
  const { showDetail } = useAssembly();
  const p = u.league.players[playerId] ?? u.vanished.find((v) => v.player.id === playerId)?.player;
  return (
    <section>
      <button className="link-btn" onClick={() => showDetail(p ? { kind: 'club', id: p.teamId } : null)}>
        ← Club
      </button>
      {p ? <PlayerCard p={p} u={u} /> : <p className="muted">No record of this player.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Vote

export function VoteScreen() {
  const u = useAssembly((s) => s.u)!;
  const { dispatch } = useAssembly();
  const [count, setCount] = useState(1);
  const e = currentElection(u);
  if (!e) return <p className="muted">No election is open right now.</p>;
  const standings = soccerStandings(u);
  const views = u.league.teams.map((t) => clubView(u.league, t, standings));
  const avg = averageStars(views);
  const mine = views.find((v) => v.team.id === u.favoriteClubId)!;
  const totals = electionTotals(e);
  const sum = totals.reduce((a, b) => a + b, 0) || 1;
  const coal = coalitions(e);
  return (
    <section aria-labelledby="vote-h">
      <div className="screen-head hero">
        <p className="eyebrow">Facility election · closes after day {e.closesDay}</p>
        <h1 id="vote-h">Vote</h1>
        <p className="muted small">
          Every club's fans vote for what helps their club. Your votes join the {mine.team.name} bloc. Votes cost 2×n² coins{u.persona === 'organizer' ? ' (20% off: Organizer)' : ''}.
        </p>
      </div>
      <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        Votes to add
        <input type="number" min={1} value={count} onChange={(ev) => setCount(Math.max(1, Math.floor(Number(ev.target.value) || 1)))} style={{ width: 70, minHeight: 36, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px' }} />
      </label>
      <div style={{ display: 'grid', gap: 10 }}>
        {e.proposals.map((p, i) => {
          const b = benefit(mine, p, avg);
          const tag = b >= 5 ? 'helps' : b <= -5 ? 'hurts' : 'neutral';
          const have = e.playerVotes[i];
          const cost = electionVoteCost(u, have, count);
          const err = voteError(u, e.id, i, count);
          const c = coal[i];
          const share = Math.round((totals[i] * 100) / sum);
          return (
            <div key={p.id} className="card proposal">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <h3>{p.title}</h3>
                <span className={`badge ${tag}`}>{tag === 'helps' ? 'Helps your club' : tag === 'hurts' ? 'Hurts your club' : 'Neutral for you'}</span>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {p.description}
                {p.targetClubIds?.length ? ` Target: ${p.targetClubIds.map((id) => clubOf(u, id)?.name).join(', ')}.` : ''}
              </p>
              <div className="lean-bar" aria-label={`${share}% of votes so far`}>
                <span style={{ width: `${share}%`, background: 'var(--accent)' }} />
              </div>
              <p className="coalition" style={{ margin: 0 }}>
                {share}% · Backed by {c.clubs.length ? c.clubs.map((id) => clubOf(u, id)?.name).join(', ') : 'no clubs'}
                {c.factions.length ? ` + ${c.factions.map((id) => u.factions.find((f) => f.id === id)?.name).join(', ')}` : ''}
              </p>
              <div className="vote-buy">
                <button className="btn" disabled={!!err} title={err ?? undefined} onClick={() => void dispatch({ type: 'votesBought', electionId: e.id, proposal: i, count })}>
                  +{count} vote{count === 1 ? '' : 's'} · {cost}◈
                </button>
                {have > 0 && <span className="small muted">Your votes: {have}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Archive

export function Archive() {
  const u = useAssembly((s) => s.u)!;
  const { showDetail } = useAssembly();
  return (
    <section aria-labelledby="archive-h">
      <div className="screen-head hero">
        <h1 id="archive-h">Archive</h1>
      </div>
      <h2>Seasons</h2>
      {!u.archive.length && <p className="muted">The first season is still being played.</p>}
      <ul className="feed">
        {u.archive.map((a) => (
          <li key={a.season} className="feed-item">
            Season {a.season}: champions <strong>{a.championId ? clubOf(u, a.championId)?.name ?? 'a club since Ejected' : '—'}</strong>
            {a.ejected.length ? ` · Ejected: ${a.ejected.map((x) => x.name).join(', ')}` : ''}
          </li>
        ))}
      </ul>
      <h2>Sub-Level Archive</h2>
      {!u.vanished.length && <p className="muted">Nobody has been taken to the Sub-Levels. Yet.</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {u.vanished.map((v) => (
          <div key={v.player.id} className="card pcard vanished">
            <strong>{v.player.name}</strong>
            <span className="small muted">
              Season {v.season}, day {v.day}: {v.cause}
            </span>
          </div>
        ))}
      </div>
      <h2>Timeline</h2>
      <ul className="feed">
        {[...u.timeline].reverse().map((t, i) => (
          <li key={i} className="feed-item">
            <span className="muted small">S{t.season} D{t.day} · </span>
            {t.text}
          </li>
        ))}
        {!u.timeline.length && <li className="muted">Nothing notable yet.</li>}
      </ul>
      {u.awakenings.length > 0 && (
        <>
          <h2>Awakenings</h2>
          <ul className="feed">
            {u.awakenings.map((a) => (
              <li key={a.playerId + a.season} className="feed-item">
                <button className="link-btn" onClick={() => showDetail({ kind: 'player', id: a.playerId })}>
                  {u.league.players[a.playerId]?.name ?? 'Someone'}
                </button>{' '}
                <span className="muted small">Season {a.season}, day {a.day}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
