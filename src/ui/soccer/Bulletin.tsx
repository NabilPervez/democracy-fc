import { useState } from 'react';
import { formatMult } from '../../engine/odds';
import { getTactic } from '../../engine/soccer/tactics';
import { ballotVoteCost } from '../../world/soccer/matchday';
import {
  ballotError, betError, clubOf, currentElection, DRAW_PICK, fixturesOn, matchBallot, matchOdds, regularDays, soccerStandings, unplayedToday,
  type SoccerUniverse,
} from '../../world/soccer/universe';
import { Crest, DRIVE_INFO, POSITION_LABEL } from './bits';
import { useAssembly } from './store';

function myMatchToday(u: SoccerUniverse) {
  return fixturesOn(u, u.currentDay).find((g) => g.homeId === u.favoriteClubId || g.awayId === u.favoriteClubId) ?? null;
}

export function Bulletin() {
  const u = useAssembly((s) => s.u)!;
  const { run, watch, busy } = useAssembly();
  const club = clubOf(u, u.favoriteClubId)!;
  const director = [...u.news].reverse().find((n) => n.director);
  const game = myMatchToday(u);
  const open = game && !u.results[game.id] && !u.started.includes(game.id);
  const election = currentElection(u);
  const table = soccerStandings(u);
  const rank = table.findIndex((r) => r.teamId === club.id) + 1;
  const left = unplayedToday(u).length;

  return (
    <section aria-labelledby="bulletin-h">
      <div className="screen-head hero">
        <p className="eyebrow">
          Season {u.season} · {u.phase === 'regular' ? `Matchday ${u.currentDay} of ${regularDays(u)}` : u.phase === 'playoffs' ? 'Knockout' : 'Offseason'}
        </p>
        <h1 id="bulletin-h">Bulletin</h1>
        <p className="muted">
          You support the <strong>{club.city} {club.name}</strong>
          {u.phase !== 'offseason' && rank && Object.keys(u.results).length ? ` · ${ordinal(rank)} of ${table.length}` : ''}.
        </p>
      </div>

      {director && (
        <div className="card director-card">
          <p className="eyebrow">The Director</p>
          <p className="director">{director.text}</p>
        </div>
      )}

      {game && open && <MatchdayBallot gameId={game.id} />}
      {game && !open && (
        <div className="card" style={{ padding: 14, marginTop: 12 }}>
          <p className="eyebrow">Your match today</p>
          <p style={{ margin: '0 0 8px' }}>{u.results[game.id] ? 'Full-time — see the recap in Matches.' : 'Kicked off. The ballot is closed.'}</p>
          <button className="btn" onClick={() => void watch(game.id)}>
            Open the match
          </button>
        </div>
      )}
      {!game && u.phase !== 'offseason' && (
        <div className="card" style={{ padding: 14, marginTop: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            No match for the {club.name} today.
          </p>
        </div>
      )}

      <h2>Today</h2>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {game && open && (
          <button className="btn primary" disabled={busy} onClick={() => void watch(game.id)}>
            ▶ Watch your match
          </button>
        )}
        <button className="btn" disabled={busy} onClick={() => void run({ type: 'endDay' })}>
          {u.phase === 'offseason' ? 'Start next season' : left ? `Play the day (${left} match${left === 1 ? '' : 'es'})` : 'Next day'}
        </button>
        {u.phase !== 'offseason' && (
          <button className="btn" disabled={busy} onClick={() => void run({ type: 'simDays', count: 7 })}>
            Sim a week
          </button>
        )}
      </div>

      {election && (
        <div className="card" style={{ padding: 14, marginTop: 16 }}>
          <p className="eyebrow">Facility election</p>
          <p style={{ margin: '0 0 8px' }}>
            {election.proposals.length} proposals on the ballot. Voting closes after matchday {election.closesDay}.
          </p>
          <button className="btn" onClick={() => useAssembly.getState().setTab('vote')}>
            Go vote
          </button>
        </div>
      )}

      <h2>Latest</h2>
      <ul className="feed">
        {[...u.news].reverse().slice(0, 8).map((n, i) => (
          <li key={i} className={`feed-item ${n.director ? 'director' : ''}`}>
            <span className="muted small">D{n.day} · </span>
            {n.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** §B7a: Tactic + Armband + Prediction, one screen, all optional. */
function MatchdayBallot({ gameId }: { gameId: string }) {
  const u = useAssembly((s) => s.u)!;
  const { dispatch } = useAssembly();
  const game = u.schedule.find((g) => g.id === gameId)!;
  const mine = u.favoriteClubId;
  const oppId = game.homeId === mine ? game.awayId : game.homeId;
  const opp = clubOf(u, oppId)!;
  const ballot = matchBallot(u, gameId, mine);
  const oppBallot = matchBallot(u, gameId, oppId);
  const my = u.ballots[gameId] ?? { tactic: [0, 0, 0], captain: [0, 0, 0], coinsSpent: 0 };
  const oppTop = oppBallot.lean.indexOf(Math.max(...oppBallot.lean));
  const total = (q: number[]) => q.reduce((a, b) => a + b, 0);

  const vote = (question: 'tactic' | 'captain', option: number) => void dispatch({ type: 'ballotVote', gameId, question, option, count: 1 });
  const nextCost = (question: 'tactic' | 'captain') => ballotVoteCost(my[question], 1);
  const voteLabel = (question: 'tactic' | 'captain') => {
    const c = nextCost(question);
    return c === 0 ? 'Vote (free)' : `+1 vote · ${c}◈`;
  };

  return (
    <div className="card ballot" style={{ marginTop: 12 }} aria-labelledby="ballot-h">
      <div>
        <p className="eyebrow">Matchday Ballot · closes at kickoff</p>
        <h2 id="ballot-h" style={{ margin: 0, color: 'var(--text)' }}>
          vs <Crest team={opp} size={22} /> {opp.city} {opp.name}
        </h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Skip it and the {clubOf(u, mine)!.name} fans decide without you.
        </p>
      </div>

      <div>
        <h3>1 · Tactic</h3>
        <p className="muted small" style={{ margin: '0 0 6px' }}>
          Scouting: {opp.name} fans lean {oppBallot.lean[oppTop]}% {getTactic(oppBallot.options.tactics[oppTop])?.name}.
        </p>
        <div className="ballot-options">
          {ballot.options.tactics.map((id, i) => {
            const t = getTactic(id)!;
            const err = ballotError(u, gameId, 'tactic', i, 1);
            return (
              <div key={id} className={`ballot-option ${my.tactic[i] ? 'mine' : ''}`}>
                <span>
                  <strong>{t.name}</strong>
                  {my.tactic[i] ? <span className="muted small"> · your votes: {my.tactic[i]}</span> : null}
                </span>
                <button className="chip" disabled={!!err} title={err ?? undefined} onClick={() => vote('tactic', i)} aria-label={`Vote ${t.name}`}>
                  {voteLabel('tactic')}
                </button>
                <span className="why">
                  {t.blurb}
                  {t.beats.length ? ` Beats ${t.beats.map((b) => getTactic(b)?.name).join(', ')}.` : ''}
                </span>
                <span className="lean-bar fans" aria-label={`${ballot.lean[i]}% of your club's fans`}>
                  <span style={{ width: `${ballot.lean[i]}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3>2 · Armband</h3>
        <div className="ballot-options">
          {ballot.options.captains.map((id, i) => {
            const p = u.league.players[id];
            const err = ballotError(u, gameId, 'captain', i, 1);
            const share = Math.round((ballot.fans.captain[i] * 100) / Math.max(1, total(ballot.fans.captain)));
            const streak = u.captaincy[id]?.streak ?? 0;
            return (
              <div key={id} className={`ballot-option ${my.captain[i] ? 'mine' : ''}`}>
                <span>
                  <strong>{p.name}</strong> <span className="muted small">{POSITION_LABEL[p.position]} · {DRIVE_INFO[p.drive].icon} {DRIVE_INFO[p.drive].label}</span>
                  {streak >= 5 && <span className="badge helps" style={{ marginLeft: 6 }}>Fan Favorite</span>}
                  {my.captain[i] ? <span className="muted small"> · your votes: {my.captain[i]}</span> : null}
                </span>
                <button className="chip" disabled={!!err} title={err ?? undefined} onClick={() => vote('captain', i)} aria-label={`Vote ${p.name} captain`}>
                  {voteLabel('captain')}
                </button>
                <span className="lean-bar fans" aria-label={`${share}% of your club's fans`}>
                  <span style={{ width: `${share}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Prediction gameId={gameId} />
    </div>
  );
}

function Prediction({ gameId }: { gameId: string }) {
  const u = useAssembly((s) => s.u)!;
  const { dispatch } = useAssembly();
  const [stake, setStake] = useState(10);
  const game = u.schedule.find((g) => g.id === gameId)!;
  const odds = matchOdds(u, gameId);
  const home = clubOf(u, game.homeId)!;
  const away = clubOf(u, game.awayId)!;
  const existing = u.bets.filter((b) => b.gameId === gameId && b.season === u.season);
  const options = [
    { id: game.homeId, label: home.name, mult: odds.homeMult, pm: odds.homePm },
    { id: DRAW_PICK, label: 'Draw', mult: odds.drawMult, pm: odds.drawPm },
    { id: game.awayId, label: away.name, mult: odds.awayMult, pm: odds.awayPm },
  ];
  return (
    <div>
      <h3>3 · Prediction</h3>
      <p className="muted small" style={{ margin: '0 0 6px' }}>
        Coins are earned, never bought.{' '}
        {existing.length ? `You predicted ${existing.map((b) => `${b.teamId === DRAW_PICK ? 'a draw' : clubOf(u, b.teamId)?.name} (${b.amount}◈)`).join(', ')}.` : ''}
      </p>
      <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        Stake
        <input type="number" min={1} max={u.coins} value={stake} onChange={(e) => setStake(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ width: 80, minHeight: 36, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px' }} />
        coins
      </label>
      <div className="predict-row">
        {options.map((o) => {
          const err = betError(u, gameId, o.id, stake);
          return (
            <button key={o.id} className="btn" disabled={!!err} title={err ?? undefined} onClick={() => void dispatch({ type: 'betPlaced', gameId, teamId: o.id, amount: stake })}>
              <strong>{o.label}</strong>
              <span className="mult">
                {Math.round(o.pm / 10)}% · {formatMult(o.mult)} reward
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
