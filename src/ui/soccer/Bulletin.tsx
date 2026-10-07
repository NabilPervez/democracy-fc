import { useState } from 'react';
import { formatMult, multiplierFor } from '../../engine/odds';
import { getTactic } from '../../engine/soccer/tactics';
import { ballotVoteCost } from '../../world/soccer/matchday';
import {
  ballotError, betError, clubOf, currentElection, DRAW_PICK, fixturesOn, matchBallot, matchOdds, predictionLabel, regularDays, sideOdds,
  sidePredictionError, soccerStandings, TOTAL_LINE, unplayedToday, type SideMarket, type SoccerUniverse,
} from '../../world/soccer/universe';
import { Crest, DRIVE_INFO, POSITION_LABEL, useNow } from './bits';
import { formatDuration, msUntilNextDay } from '../../world/clock';
import { leanAsSeen, personaDef } from '../../world/soccer/persona';
import { facilityEventsFor } from '../../world/soccer/weird';
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
  const now = useNow();
  const toKickoff = u.clock ? msUntilNextDay(u.clock, u.settings.dayLengthMinutes, u.dayCount, now) : null;
  const persona = personaDef(u.persona);

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
          {persona && <> {persona.icon} {persona.name}.</>}
        </p>
      </div>

      <Digest />

      {director && (
        <div className="card director-card">
          <p className="eyebrow">The Director</p>
          <p className="director">{director.text}</p>
        </div>
      )}

      {game && open && toKickoff !== null && (
        <p className="countdown-chip" role="status" style={{ margin: '12px 0 0' }}>
          ⏱ Ballot closes at kickoff, in {formatDuration(toKickoff)}.
        </p>
      )}
      {game && open && <MatchdayBallot gameId={game.id} />}
      {u.persona === 'prophet' && <Rumours />}
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

      <Picks />

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

function Digest() {
  const digest = useAssembly((s) => s.digest);
  const { dismissDigest } = useAssembly();
  if (!digest || !digest.items.length) return null;
  return (
    <div className="card director-card" style={{ marginBottom: 12 }} role="region" aria-labelledby="wywg-h">
      <p className="eyebrow" id="wywg-h">
        While you were gone · {digest.days} day{digest.days === 1 ? '' : 's'}
      </p>
      <ul className="feed" style={{ margin: '4px 0 8px' }}>
        {digest.items.slice(0, 8).map((i, k) => (
          <li key={k} className={`feed-item ${i.kind === 'director' ? 'director' : ''}`}>
            {i.text}
          </li>
        ))}
      </ul>
      <button className="chip" onClick={dismissDigest}>
        Got it
      </button>
    </div>
  );
}

/** The Prophet hears tomorrow's facility events a day early. */
function Rumours() {
  const u = useAssembly((s) => s.u)!;
  const tomorrow = fixturesOn(u, u.currentDay + 1);
  const rumours = tomorrow.flatMap((g) => facilityEventsFor(u.settings.seed, u.season, g, u.settings.chaos, u.league).events.map((e) => ({ g, e })));
  return (
    <div className="card" style={{ padding: 14, marginTop: 12 }}>
      <p className="eyebrow">◎ Dorm rumours (Prophet)</p>
      {rumours.length ? (
        rumours.map(({ g, e }) => (
          <p key={g.id + e.eventId} className="director" style={{ marginBottom: 6 }}>
            {clubOf(u, g.homeId)?.name} v {clubOf(u, g.awayId)?.name}: {e.text}
          </p>
        ))
      ) : (
        <p className="muted small" style={{ margin: 0 }}>The corridors are quiet about tomorrow.</p>
      )}
    </div>
  );
}

/** Your backed and faded players, and what they've earned. */
function Picks() {
  const u = useAssembly((s) => s.u)!;
  const { showDetail } = useAssembly();
  const last = [...u.ledger].reverse().find((l) => l.reason.startsWith('Picks:'));
  const ids = [...u.picks.back.map((id) => ['back', id] as const), ...u.picks.fade.map((id) => ['fade', id] as const)].filter(([, id]) => u.league.players[id]);
  return (
    <div className="card" style={{ padding: 14, marginTop: 12 }}>
      <p className="eyebrow">Your picks · {u.picksLifetime} coins earned</p>
      {ids.length ? (
        <ul className="feed" style={{ margin: 0 }}>
          {ids.map(([kind, id]) => {
            const p = u.league.players[id];
            const line = u.seasonStats[id];
            return (
              <li key={id} className="feed-item">
                <button className="link-btn" onClick={() => showDetail({ kind: 'player', id })}>
                  {p.name}
                </button>
                <span className={`pick-tag ${kind}`}>{kind === 'back' ? 'BACKED' : 'FADED'}</span>{' '}
                <span className="muted small">
                  {clubOf(u, p.teamId)?.name} · {line ? `${line.goals}G ${line.assists}A in ${line.apps}` : 'no matches yet'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>Back players to earn when they score or keep clean sheets; fade players to earn when they flop. Open any player card in Facility.</p>
      )}
      {last && <p className="small muted" style={{ margin: '8px 0 0' }}>Last payout: {last.reason.replace('Picks: ', '')}</p>}
    </div>
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
  // §B4: rivals facing each other get a pre-match Director callout.
  const rivalry = clubOf(u, mine)!.squad.flatMap((id) => {
    const p = u.league.players[id];
    return Object.entries(p?.rivals ?? {}).filter(([other, n]) => n >= 3 && opp.squad.includes(other)).map(([other]) => [p.name, u.league.players[other]?.name] as const);
  })[0];

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
        {rivalry && (
          <p className="director" style={{ marginTop: 8 }}>
            Director: {rivalry[0]} and {rivalry[1]} meet again. The facility is watching.
          </p>
        )}
      </div>

      <div>
        <h3>1 · Tactic</h3>
        <p className="muted small" style={{ margin: '0 0 6px' }}>
          Scouting: {opp.name} fans lean {u.persona === 'analyst' ? '' : '~'}{leanAsSeen(u.persona, oppBallot.lean[oppTop])}% {getTactic(oppBallot.options.tactics[oppTop])?.name}.
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
  const side = sideOdds(u, gameId);
  const [scorer, setScorer] = useState('');
  const sideButton = (market: SideMarket, pick: string, label: string, pm: number) => {
    const err = sidePredictionError(u, gameId, market, pick, stake);
    return (
      <button key={market + pick} className="btn" disabled={!!err} title={err ?? undefined} onClick={() => void dispatch({ type: 'sidePrediction', gameId, market, pick, amount: stake })}>
        <strong>{label}</strong>
        <span className="mult">
          {Math.round(pm / 10)}% · {formatMult(multiplierFor(pm))}
        </span>
      </button>
    );
  };
  const scorers = Object.entries(side.firstScorer).sort((a, b) => b[1] - a[1]);
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
        {existing.length ? `You predicted: ${existing.map((b) => `${b.teamId === DRAW_PICK ? 'a draw' : predictionLabel(u, b)} (${b.amount}◈)`).join(', ')}.` : ''}
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
      <details style={{ marginTop: 10 }}>
        <summary className="small">More predictions</summary>
        <p className="small muted" style={{ margin: '8px 0 4px' }}>Both teams score?</p>
        <div className="predict-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {sideButton('btts', 'yes', 'Yes', side.btts.yes)}
          {sideButton('btts', 'no', 'No', side.btts.no)}
        </div>
        <p className="small muted" style={{ margin: '8px 0 4px' }}>Total goals ({TOTAL_LINE})</p>
        <div className="predict-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {sideButton('total', 'over', 'Over', side.total.over)}
          {sideButton('total', 'under', 'Under', side.total.under)}
        </div>
        <p className="small muted" style={{ margin: '8px 0 4px' }}>First scorer</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={scorer} onChange={(e) => setScorer(e.target.value)} aria-label="First scorer" style={{ flex: 1, minHeight: 44, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)' }}>
            <option value="">Pick a player…</option>
            {scorers.map(([id, pm]) => (
              <option key={id} value={id}>
                {u.league.players[id]?.name} · {formatMult(multiplierFor(pm))}
              </option>
            ))}
          </select>
          {scorer && sideButton('firstScorer', scorer, 'Predict', side.firstScorer[scorer])}
        </div>
      </details>
    </div>
  );
}
