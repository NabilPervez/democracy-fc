import { useState } from 'react';
import { averageStars, benefit, clubView, coalitions, electionTotals } from '../../world/soccer/elections';
import {
  clubOf, currentElection, electionVoteCost, fixturesOn, isKnockout, playoffSize, ROUND_NAMES, soccerStandings, voteError,
} from '../../world/soccer/universe';
import { Crest, Tip } from './bits';
import { HELP } from './help';
import { MatchView } from './MatchView';
import { ClubPage, Collection, PlayerPage } from './Profiles';
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
  const playoffCut = playoffSize(u);
  const scorers = Object.entries(u.seasonStats).filter(([id]) => u.league.players[id]).sort((a, b) => b[1].goals - a[1].goals || b[1].assists - a[1].assists).slice(0, 8);
  return (
    <section aria-labelledby="facility-h">
      <div className="screen-head hero">
        <p className="eyebrow">The Assembly · Season {u.season}</p>
        <h1 id="facility-h">Facility</h1>
        <p className="muted small">
          Top {playoffSize(u)} make the playoffs · bottom {u.ejections} {u.ejections === 1 ? 'is' : 'are'} Ejected ·{' '}
          <Tip label="How it works" text={`${HELP.table} P played, W won (3 pts), D drawn (1 pt), L lost, GD goal difference, Pts points.`} />
        </p>
      </div>
      <div className="table-wrap card">
        <table className="dfc-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="club">Club</th>
              <th title="Played">P</th>
              <th title="Won (3 points)">W</th>
              <th title="Drawn (1 point)">D</th>
              <th title="Lost">L</th>
              <th title="Goal difference">GD</th>
              <th title="Points">Pts</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r, i) => {
              const c = clubOf(u, r.teamId)!;
              return (
                <tr key={r.teamId} className={`${r.teamId === u.favoriteClubId ? 'mine' : ''} ${i === ejectFrom ? 'eject-line' : ''} ${i === playoffCut ? 'playoff-line' : ''}`}>
                  <td>{i + 1}</td>
                  <td className="club">
                    <button className="club-btn" onClick={() => showDetail({ kind: 'club', id: c.id })}>
                      <Crest team={c} size={22} />
                      <span title={`${c.city} ${c.name}`}>{c.name}</span>
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
      {u.playoffs && <Bracket />}
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

/** The championship bracket (§B5 knockouts): rounds side by side, winners in gold. */
export function Bracket() {
  const u = useAssembly((s) => s.u)!;
  const { watch } = useAssembly();
  const p = u.playoffs!;
  const seedOf = (id: string) => p.seeds.indexOf(id) + 1;
  // Rounds not yet drawn are shown as empty slots.
  const sizes: number[] = [];
  for (let n = p.seeds.length / 2; n >= 1; n /= 2) sizes.push(n);
  return (
    <>
      <h2>
        <Tip label="Playoffs" text={HELP.bracket} />
      </h2>
      {p.championId && (
        <div className="card champion" style={{ marginBottom: 10 }}>
          <p className="eyebrow">Champions · Season {u.season}</p>
          <strong style={{ fontSize: '1.2rem' }}>
            🏆 {clubOf(u, p.championId)?.city} {clubOf(u, p.championId)?.name}
          </strong>
        </div>
      )}
      <div className="bracket" role="list" aria-label="Playoff bracket">
        {sizes.map((n, ri) => (
          <div key={n} className="bracket-round" role="listitem">
            <h3>{ROUND_NAMES[n] ?? `Round ${ri + 1}`}</h3>
            {Array.from({ length: n }, (_, mi) => {
              const id = p.rounds[ri]?.[mi];
              const g = id ? u.schedule.find((x) => x.id === id) : null;
              const r = id ? u.results[id] : null;
              const winner = r ? r.shootout?.winnerId ?? (r.homeScore > r.awayScore ? r.homeId : r.awayId) : null;
              if (!g) return <div key={mi} className="card bracket-match muted small">To be decided</div>;
              const row = (team: string, score?: number) => (
                <span className={`bm-row ${winner === team ? 'won' : ''}`}>
                  <span>
                    <span className="seed">{seedOf(team)}</span>
                    {clubOf(u, team)?.name ?? 'Ejected club'}
                  </span>
                  <span>{score ?? ''}</span>
                </span>
              );
              return (
                <button key={mi} className="card bracket-match" onClick={() => void watch(g.id)} aria-label={`${clubOf(u, g.homeId)?.name} vs ${clubOf(u, g.awayId)?.name}`}>
                  {row(g.homeId, r?.homeScore)}
                  {row(g.awayId, r?.awayScore)}
                  {r?.shootout && <span className="muted small">pens {r.shootout.home}–{r.shootout.away}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
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
          Every club's fans vote for what helps their club. Your votes join the {mine.team.name} bloc. <Tip label="Votes cost 2×n² credibility" text={HELP.voteCost} />{u.persona === 'organizer' ? ' (20% off: Organizer)' : ''}.
        </p>
      </div>
      <label className="stake">
        Votes to add
        <input type="number" min={1} value={count} onChange={(ev) => setCount(Math.max(1, Math.floor(Number(ev.target.value) || 1)))} />
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
              <div className="proposal-head">
                <h3>{p.title}</h3>
                <Tip label={tag === 'helps' ? 'Helps your club' : tag === 'hurts' ? 'Hurts your club' : 'Neutral for you'} text={HELP.helpsHurts}>
                  <span className={`badge ${tag}`}>{tag === 'helps' ? 'Helps your club' : tag === 'hurts' ? 'Hurts your club' : 'Neutral for you'}</span>
                </Tip>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {p.description}
                {p.targetClubIds?.length ? ` Target: ${p.targetClubIds.map((id) => clubOf(u, id)?.name).join(', ')}.` : ''}
              </p>
              <div className="lean-bar" aria-label={`${share}% of votes so far`}>
                <span style={{ width: `${share}%`, background: 'var(--accent)' }} />
              </div>
              <p className="coalition" style={{ margin: 0 }}>
                <Tip label={`${share}%`} text={HELP.coalition} /> · Backed by {c.clubs.length ? c.clubs.map((id) => clubOf(u, id)?.name).join(', ') : 'no clubs'}
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
      <h2>
        <Tip label={`Your collection (${u.collection.length})`} text={HELP.collection} />
      </h2>
      <Collection />
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
      <h2>
        <Tip label="Sub-Level Archive" text={HELP.subLevels} />
      </h2>
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
          <h2>
            <Tip label="Awakenings" text={HELP.awakening} />
          </h2>
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
