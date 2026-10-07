import { describe, expect, it } from 'vitest';
import { CHECKLIST_REWARD, checklistDone, gettingStarted } from '../src/world/soccer/checklist';
import { createSoccerWorld, currentElection, reduceSoccer, type SoccerUniverse } from '../src/world/soccer/universe';

const world = () => createSoccerWorld('u', { name: 'C', seed: 'check', leagueSize: 12, chaos: 'calm', timeMode: 'manual', dayLengthMinutes: 40 }, null, 0);

describe('getting-started checklist', () => {
  it('ticks itself off from what the fan does, then pays once', () => {
    let u: SoccerUniverse = world();
    expect(gettingStarted(u).every((s) => !s.done)).toBe(true);
    const g = u.schedule.find((x) => x.day === 1 && (x.homeId === u.favoriteClubId || x.awayId === u.favoriteClubId))!;
    const other = u.league.teams.find((t) => t.id !== u.favoriteClubId)!;
    const mine = u.league.teams.find((t) => t.id === u.favoriteClubId)!;
    u = reduceSoccer(u, { type: 'ballotVote', gameId: g.id, question: 'tactic', option: 0, count: 1 });
    u = reduceSoccer(u, { type: 'ballotVote', gameId: g.id, question: 'captain', option: 0, count: 1 });
    u = reduceSoccer(u, { type: 'betPlaced', gameId: g.id, teamId: g.homeId });
    u = reduceSoccer(u, { type: 'pickSet', playerId: mine.squad[4], kind: 'back' });
    u = reduceSoccer(u, { type: 'pickSet', playerId: other.squad[4], kind: 'fade' });
    const e = currentElection(u)!;
    u = reduceSoccer(u, { type: 'votesBought', electionId: e.id, proposal: 1, count: 1 });
    expect(checklistDone(u)).toBe(false);
    // Claiming early does nothing.
    expect(reduceSoccer(u, { type: 'checklistClaimed' })).toBe(u);
    u = reduceSoccer(u, { type: 'matchStarted', gameId: g.id });
    expect(checklistDone(u)).toBe(true);
    const coins = u.coins;
    u = reduceSoccer(u, { type: 'checklistClaimed' });
    expect(u.coins).toBe(coins + CHECKLIST_REWARD);
    expect(reduceSoccer(u, { type: 'checklistClaimed' }).coins).toBe(u.coins);
  });

  it('can be hidden without the reward', () => {
    const u = reduceSoccer(world(), { type: 'checklistDismissed' });
    expect(u.checklistClaimed).toBe(true);
    expect(u.coins).toBe(world().coins);
  });
});
