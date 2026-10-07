import { describe, expect, it } from 'vitest';
import { buildSoccerDigest } from '../src/world/soccer/digest';
import { leanAsSeen, personaReward, PERSONAS } from '../src/world/soccer/persona';
import { createSoccerWorld, currentElection, electionVoteCost, reduceSoccer, runSoccerCommand, type SoccerSettings } from '../src/world/soccer/universe';

const settings = (p: Partial<SoccerSettings> = {}): SoccerSettings => ({
  name: 'P', seed: 'persona', leagueSize: 12, chaos: 'normal', timeMode: 'manual', dayLengthMinutes: 60, ...p,
});

describe('fan personas', () => {
  it('five personas, each with a perk', () => {
    expect(PERSONAS).toHaveLength(5);
    for (const p of PERSONAS) expect(p.perk.length).toBeGreaterThan(10);
  });

  it('Diehard earns more backing their own club; Gambler earns more on long shots', () => {
    expect(personaReward('diehard', 2000, 400, true)).toBe(2400);
    expect(personaReward('diehard', 2000, 400, false)).toBe(2000);
    expect(personaReward('gambler', 4000, 300, false)).toBe(4600);
    expect(personaReward('gambler', 1500, 600, false)).toBe(1500);
    expect(personaReward(null, 2000, 300, true)).toBe(2000);
  });

  it('the Organizer pays 20% less for election votes; the Analyst sees exact leans', () => {
    let u = createSoccerWorld('u', settings(), null, 0);
    const full = electionVoteCost(u, 0, 5);
    u = reduceSoccer(u, { type: 'personaChosen', persona: 'organizer' });
    expect(electionVoteCost(u, 0, 5)).toBe(Math.ceil(full * 0.8));
    const e = currentElection(u)!;
    u = reduceSoccer(u, { type: 'votesBought', electionId: e.id, proposal: 1, count: 5 });
    expect(u.coins).toBe(100 - Math.ceil(full * 0.8));
    expect(leanAsSeen('analyst', 47)).toBe(47);
    expect(leanAsSeen(null, 47)).toBe(50);
  });

  it('a Diehard prediction on their own club pays the bonus when it comes in', () => {
    for (let i = 0; i < 20; i++) {
      let u = reduceSoccer(createSoccerWorld('u', settings({ seed: `die-${i}` }), null, 0), { type: 'personaChosen', persona: 'diehard' });
      const g = u.schedule.find((x) => x.day === 1 && (x.homeId === u.favoriteClubId || x.awayId === u.favoriteClubId))!;
      u = reduceSoccer(u, { type: 'betPlaced', gameId: g.id, teamId: u.favoriteClubId, amount: 10 });
      const bet = u.bets[0];
      u = runSoccerCommand(u, { type: 'playGame', gameId: g.id }).state;
      if (u.bets[0].status !== 'won') continue;
      expect(u.bets[0].payout).toBe(Math.floor((10 * Math.floor((bet.multMilli * 120) / 100)) / 1000));
      return;
    }
    throw new Error('the fan club never won in 20 seeds');
  });
});

describe('Living time and While You Were Gone', () => {
  it('a Living universe starts its clock at creation; switching modes re-anchors it', () => {
    let u = createSoccerWorld('u', settings({ timeMode: 'living', dayLengthMinutes: 15 }), null, 1000);
    expect(u.clock).toEqual({ anchorMs: 1000, anchorDay: 1 });
    u = reduceSoccer(u, { type: 'timeSettingsChanged', timeMode: 'manual', dayLengthMinutes: 15, nowMs: 5000 });
    expect(u.clock).toBeNull();
    u = reduceSoccer(u, { type: 'timeSettingsChanged', timeMode: 'living', dayLengthMinutes: 60, nowMs: 9000 });
    expect(u.clock).toEqual({ anchorMs: 9000, anchorDay: u.dayCount });
    expect(reduceSoccer(u, { type: 'clockSet', clock: { anchorMs: 1, anchorDay: 2 } }).clock).toEqual({ anchorMs: 1, anchorDay: 2 });
  });

  it('the digest leads with the Director and your club, and counts the days', () => {
    const before = createSoccerWorld('u', settings({ chaos: 'unhinged', seed: 'digest' }), null, 0);
    const { state, events } = runSoccerCommand(before, { type: 'simDays', count: 7 });
    const d = buildSoccerDigest(before, state, events);
    expect(d.days).toBe(7);
    expect(d.items.some((i) => i.kind === 'club' && /W–D–L/.test(i.text))).toBe(true);
    expect(d.items.some((i) => i.kind === 'election')).toBe(true);
    for (let k = 1; k < d.items.length; k++) expect(d.items[k - 1].importance).toBeGreaterThanOrEqual(d.items[k].importance);
  });
});
