import { useState } from 'react';
import { formatMult } from '../../engine/odds';
import type { ScheduledGame } from '../../engine/baseball/types';
import { perk } from '../../world/persona';
import { betError, currentOdds, freeBetError, massBetTargets, offeredMultiplier } from '../../world/universe';
import { useGame } from '../store';
import { TeamBadge } from './bits';

/** Inline bet slip for one of today's games. */
export function BetPanel({ game, onDone }: { game: ScheduledGame; onDone(): void }) {
  const u = useGame((s) => s.u)!;
  const dispatch = useGame((s) => s.dispatch);
  const existing = u.bets.find((b) => b.gameId === game.id && b.season === u.season);
  const [teamId, setTeamId] = useState<string>(existing?.teamId ?? game.homeId);
  const [amount, setAmount] = useState(Math.min(10, u.coins));
  const odds = currentOdds(u, game.id);
  const teams = [game.awayId, game.homeId].map((id) => u.league.teams.find((t) => t.id === id)!);
  const mult = offeredMultiplier(u, game.id, teamId);
  // The Gambler's weekly free bet (Level 2): offered only while it's available.
  const freeOffered = !!perk(u.persona, 'freeBet') && !freeBetError(u, game.id, teamId, 1);
  const [free, setFree] = useState(false);
  const useFree = free && freeOffered;
  const error = useFree ? freeBetError(u, game.id, teamId, amount) : betError(u, game.id, teamId, amount);
  const toWin = Math.floor((amount * mult) / 1000) - (useFree ? amount : 0);

  return (
    <form
      className="bet-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (error) return;
        dispatch({ type: 'betPlaced', gameId: game.id, teamId, amount, ...(useFree && { free: true }) }).then(onDone);
      }}
    >
      <div className="bet-sides" role="radiogroup" aria-label="Pick a team">
        {teams.map((t) => {
          const pm = t.id === game.homeId ? odds.homePm : odds.awayPm;
          const locked = !!existing && existing.teamId !== t.id;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={teamId === t.id}
              key={t.id}
              disabled={locked}
              className="bet-side"
              onClick={() => setTeamId(t.id)}
            >
              <TeamBadge team={t} size={26} />
              <span className="bet-team">{t.name}</span>
              <span className="bet-mult">{formatMult(offeredMultiplier(u, game.id, t.id))}</span>
              <span className="muted small">{Math.round(pm / 10)}% to win</span>
            </button>
          );
        })}
      </div>
      <div className="row">
        <label className="bet-amount">
          <span className="sr-only">Coins to bet</span>
          <input
            className="field"
            type="number"
            inputMode="numeric"
            min={1}
            max={u.coins}
            value={Number.isFinite(amount) ? amount : ''}
            onChange={(e) => setAmount(Math.trunc(Number(e.target.value)))}
          />
        </label>
        {[10, 25].map((n) => (
          <button type="button" key={n} className="chip" onClick={() => setAmount(Math.min(n, u.coins))} disabled={u.coins < 1}>
            {n}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => setAmount(u.coins)} disabled={u.coins < 1}>
          All in
        </button>
      </div>
      {freeOffered && (
        <label className="small">
          <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} /> Use this week's free bet (up to {String(perk(u.persona, 'freeBet')?.max ?? 25)} coins, no stake taken)
        </label>
      )}
      <p className="small">{error ? <span className="neg">{error}</span> : useFree ? <>Win {toWin} coins if they win; lose nothing if they don't.</> : <>Win {toWin} coins (stake included) if they win.</>}</p>
      <div className="row">
        <button className="btn primary inline" type="submit" disabled={!!error}>
          Place bet
        </button>
        <button className="btn" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const MASS_AMOUNTS = [5, 10, 20, 50];

/** One tap: the same bet on every favorite (or every underdog) in today's open games. */
export function MassBet() {
  const u = useGame((s) => s.u)!;
  const dispatch = useGame((s) => s.dispatch);
  const [amount, setAmount] = useState(20);
  const [done, setDone] = useState<string | null>(null);
  const favorites = massBetTargets(u, 'favorite');
  const underdogs = massBetTargets(u, 'underdog');
  if (!favorites.length && !underdogs.length) return null;

  const place = async (side: 'favorite' | 'underdog', count: number) => {
    const before = u.bets.length;
    await dispatch({ type: 'massBet', side, amount });
    const placed = (useGame.getState().u?.bets.length ?? before) - before;
    setDone(placed ? `Placed ${placed} bet${placed === 1 ? '' : 's'} of ${amount} on the ${side === 'favorite' ? 'favorites' : 'underdogs'}.` : `No bets placed — ${amount * count > u.coins ? 'not enough coins' : 'nothing left to bet on'}.`);
  };
  const button = (side: 'favorite' | 'underdog', list: typeof favorites) => (
    <button className="btn inline" disabled={!list.length || amount > u.coins} onClick={() => place(side, list.length)}>
      {list.length ? `${amount} on all ${list.length} ${side === 'favorite' ? 'favorites' : 'underdogs'} · ${amount * list.length} coins` : `No ${side === 'favorite' ? 'favorites' : 'underdogs'} left to back`}
    </button>
  );

  return (
    <section className="card pad mass-bet" aria-labelledby="mass-bet-title">
      <h2 id="mass-bet-title" className="mass-bet-title">Quick bets</h2>
      <div className="chip-row" role="group" aria-label="Amount per game">
        {MASS_AMOUNTS.map((a) => (
          <button key={a} type="button" aria-pressed={amount === a} className="chip" onClick={() => setAmount(a)}>
            {a}
          </button>
        ))}
      </div>
      <div className="mass-bet-actions">
        {button('favorite', favorites)}
        {button('underdog', underdogs)}
      </div>
      {done && (
        <p className="muted small" role="status">
          {done}
        </p>
      )}
    </section>
  );
}
