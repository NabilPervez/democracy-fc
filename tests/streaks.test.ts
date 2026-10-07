import { describe, expect, it } from 'vitest';
import { emptyLine, type BoxScore } from '../src/engine/baseball/boxScore';
import { lockUnlocked, maxBacked, maxFaded, newUnlocks, PICK_RATES, settlePicks, streakMultiplierPct } from '../src/world/picks';
import { backSlots, createUniverse, reduce, type UniverseSettings } from '../src/world/universe';

const settings: UniverseSettings = { name: 'S', seed: 'streaks', leagueSize: 8, seasonLength: 20, chaos: 'calm', timeMode: 'manual', dayLengthMinutes: 60 };
const u = createUniverse('s', settings, 0, { kind: 'analyst', fanName: 'Kim', favoriteTeamId: null });
const hitter = u.league.teams[0].lineup[0];
const hitter2 = u.league.teams[0].lineup[1];
const box = (lines: Record<string, Partial<ReturnType<typeof emptyLine>>>): BoxScore =>
  Object.fromEntries(Object.entries(lines).map(([id, l]) => [id, { ...emptyLine(), ...l }]));
const back = (...ids: string[]) => ({ back: ids, fade: [] });

describe('pick streaks (PRD 2 §E3)', () => {
  it('multiplier tiers: 0–2 ×1, 3–4 ×1.25, 5–9 ×1.5, 10+ ×2', () => {
    expect([0, 2, 3, 4, 5, 9, 10, 40].map(streakMultiplierPct)).toEqual([100, 100, 125, 125, 150, 150, 200, 200]);
  });

  it('acceptance: streak 4 and 1 hit pays 2 (2 × 1.25 = 2.5, rounded down) and the streak becomes 5', () => {
    const r = settlePicks(back(hitter), box({ [hitter]: { ab: 4, h: 1 } }), u.league, { streaks: { [hitter]: 4 } });
    expect(r.lines[0].base).toBe(PICK_RATES.backHit);
    expect(r.lines[0].amount).toBe(2);
    expect(r.streaks[hitter]).toBe(5);
  });

  it('uses the streak from before the game: the game that reaches 3 still pays ×1', () => {
    const r = settlePicks(back(hitter), box({ [hitter]: { ab: 4, h: 2 } }), u.league, { streaks: { [hitter]: 2 } });
    expect(r.lines[0].amount).toBe(4);
    expect(r.streaks[hitter]).toBe(3);
  });

  it('applies ×1.5 and ×2 with a single round-down', () => {
    const one = box({ [hitter]: { ab: 4, h: 1 } });
    expect(settlePicks(back(hitter), one, u.league, { streaks: { [hitter]: 5 } }).lines[0].amount).toBe(3);
    expect(settlePicks(back(hitter), one, u.league, { streaks: { [hitter]: 12 } }).lines[0].amount).toBe(4);
    // Fade bonus and the streak combine before rounding: 2 × 1.25 × 1.10 = 2.75 → 2.
    const fade = { back: [], fade: [hitter] };
    const k = box({ [hitter]: { ab: 2, h: 1, k: 1 } });
    expect(settlePicks(fade, k, u.league, { streaks: { [hitter]: 3 }, fadeBonusPct: 10 }).lines[0].amount).toBe(2);
  });

  it('a game where the pick played and paid 0 resets the streak', () => {
    const r = settlePicks(back(hitter), box({ [hitter]: { ab: 4, h: 0 } }), u.league, { streaks: { [hitter]: 7 } });
    expect(r.lines).toHaveLength(0);
    expect(r.streaks[hitter]).toBe(0);
  });

  it('acceptance: a pick that did not play (off day, injury) keeps its streak', () => {
    const r = settlePicks(back(hitter, hitter2), box({ [hitter2]: { ab: 4, h: 1 } }), u.league, { streaks: { [hitter]: 6, [hitter2]: 1 } });
    expect(r.streaks[hitter]).toBe(6);
    expect(r.streaks[hitter2]).toBe(2);
  });

  it('the Lock saves one empty game per season, then stops', () => {
    const empty = box({ [hitter]: { ab: 4, h: 0 } });
    const first = settlePicks(back(hitter), empty, u.league, { streaks: { [hitter]: 6 }, lockedId: hitter, lockUsed: false });
    expect(first.streaks[hitter]).toBe(6);
    expect(first.lockUsed).toBe(true);
    const second = settlePicks(back(hitter), empty, u.league, { streaks: first.streaks, lockedId: hitter, lockUsed: first.lockUsed });
    expect(second.streaks[hitter]).toBe(0);
  });

  it('dropping a pick and adding it back resets its streak', () => {
    let s = reduce(u, { type: 'pickSet', playerId: hitter, kind: 'back' });
    s = { ...s, pickStreaks: { [hitter]: 8 } };
    s = reduce(s, { type: 'pickSet', playerId: hitter, kind: null });
    s = reduce(s, { type: 'pickSet', playerId: hitter, kind: 'back' });
    expect(s.pickStreaks[hitter] ?? 0).toBe(0);
  });
});

describe('slot unlocks', () => {
  it('unlock at 300 / 700 / 1,500 / 3,000 lifetime pick coins', () => {
    expect([0, 299, 300, 1499, 1500].map((n) => maxBacked(n))).toEqual([4, 4, 5, 5, 6]);
    expect([699, 700].map((n) => maxFaded(n))).toEqual([3, 4]);
    expect(maxFaded(700, 1)).toBe(5);
    expect([2999, 3000].map(lockUnlocked)).toEqual([false, true]);
  });

  it('acceptance: crossing 300 reports the 5th Back slot exactly once', () => {
    expect(newUnlocks(290, 310).map((x) => x.id)).toEqual(['back5']);
    expect(newUnlocks(310, 400)).toEqual([]);
    expect(newUnlocks(0, 5000).map((x) => x.id)).toEqual(['back5', 'fade4', 'back6', 'lock']);
    expect(backSlots({ ...u, picksLifetime: 300 })).toBe(5);
  });
});

describe('save v12 → v13', () => {
  it('adds streaks and XP, and backfills lifetime pick coins from the ledger', async () => {
    const { migrateSave } = await import('../src/storage/migrate');
    const v13 = ['picksLifetime', 'pickStreaks', 'pickLock', 'perkUses', 'xpToday', 'watched', 'rallyCry', 'jinx', 'waveGameId', 'tempClimates', 'collectorPaid', 'forecastReveal'];
    const v12: Record<string, unknown> = { ...structuredClone(u), saveVersion: 12, pickEarnings: 40, persona: { kind: 'analyst', fanName: 'Kim', favoriteTeamId: null } };
    for (const k of v13) delete v12[k];
    v12.ledger = [
      { season: 1, day: 1, amount: 120, reason: 'Picks: A 2 H' },
      { season: 1, day: 2, amount: 50, reason: 'Bet won: X' },
      { season: 1, day: 3, amount: 90, reason: 'Picks: B 1 HR' },
    ];
    const m = migrateSave(v12);
    expect(m.persona!.xp).toBe(0);
    expect(m.picksLifetime).toBe(210);
    expect(m.pickStreaks).toEqual({});
    expect(m.watched).toEqual([]);
    // With nothing in the ledger, this season's earnings are the floor.
    expect(migrateSave({ ...v12, ledger: [] }).picksLifetime).toBe(40);
  });
});

describe('Rebrand', () => {
  it('costs 1,000 coins, switches persona and resets XP; refused without the coins', () => {
    const rich = { ...u, coins: 1500, persona: { ...u.persona!, xp: 900 } };
    const r = reduce(rich, { type: 'rebranded', kind: 'gambler' });
    expect(r.persona).toMatchObject({ kind: 'gambler', xp: 0 });
    expect(r.coins).toBe(500);
    expect(reduce({ ...rich, coins: 999 }, { type: 'rebranded', kind: 'gambler' }).persona!.kind).toBe('analyst');
  });
});

describe('digest level-up card', () => {
  it('acceptance: a Gambler crossing 400 XP gets a Level 2 card at the top of the digest', async () => {
    const { buildDigest } = await import('../src/world/digest');
    const before = { ...u, persona: { kind: 'gambler' as const, fanName: 'Kim', favoriteTeamId: null, xp: 390 }, picksLifetime: 290 };
    const after = { ...before, persona: { ...before.persona, xp: 420 }, picksLifetime: 310, currentDay: before.currentDay + 1 };
    const d = buildDigest(before, after, []);
    expect(d.items[0]).toMatchObject({ kind: 'level', text: expect.stringContaining('Level 2 as The Gambler') });
    expect(d.items[1]).toMatchObject({ kind: 'unlock', text: expect.stringContaining('5th Back slot') });
    expect(buildDigest(after, after, []).items.some((i) => i.kind === 'level')).toBe(false);
  });
});
