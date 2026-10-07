import { describe, expect, it } from 'vitest';
import { emptyLine, type BoxScore } from '../src/engine/baseball/boxScore';
import { simulateGame } from '../src/engine/baseball/game';
import { gamesToPrune } from '../src/storage/retention';
import { generateProposals, marginalCost, RESURRECTION_OFFER_PM, votesCost } from '../src/world/elections';
import { ENVIRONMENT } from '../src/world/environment';
import { analystReveal, perk, perkValue, PERK_STUBS, PERSONA_DEFS, personaMultiplier, winningPayout, type Persona, type PersonaKind } from '../src/world/persona';
import { settlePicks } from '../src/world/picks';
import { nextTier } from '../src/world/rarity';
import {
  abilityError,
  createUniverse,
  currentElection,
  fadeSlots,
  freeBetError,
  gameLeague,
  offseasonProjection,
  prophecy,
  reduce,
  runCommand,
  stadiumClimates,
  stadiumEnvironment,
  unplayedToday,
  withOpinionGain,
  type UniverseSettings,
  type UniverseState,
} from '../src/world/universe';

const settings: UniverseSettings = { name: 'Perks', seed: 'perks', leagueSize: 8, seasonLength: 20, chaos: 'normal', timeMode: 'manual', dayLengthMinutes: 60 };
const XP_AT = [0, 400, 1200];
const P = (kind: PersonaKind, level: 1 | 2 | 3, favoriteTeamId: string | null = 't1'): Persona => ({ kind, fanName: 'Pat', favoriteTeamId, xp: XP_AT[level - 1] });
const uni = (p: Persona | null): UniverseState => createUniverse('perk', settings, 0, p);
const as = (s: UniverseState, p: Persona): UniverseState => ({ ...s, persona: p });
const box = (lines: Record<string, Partial<ReturnType<typeof emptyLine>>>): BoxScore =>
  Object.fromEntries(Object.entries(lines).map(([id, l]) => [id, { ...emptyLine(), ...l }]));

/** The favorite team's next unplayed game (home only if asked). */
const favGame = (s: UniverseState, home = false) => {
  const fav = s.persona!.favoriteTeamId!;
  return s.schedule.filter((g) => !s.results[g.id] && (g.homeId === fav || (!home && g.awayId === fav))).sort((a, b) => a.day - b.day)[0];
};
/** Sum of a team's ratings in the league a game would be played with. */
const teamRatingSum = (s: UniverseState, gameId: string, teamId: string) => {
  const g = s.schedule.find((x) => x.id === gameId)!;
  const league = gameLeague(s, g);
  const t = league.teams.find((x) => x.id === teamId)!;
  return [...t.lineup, ...t.rotation].reduce((sum, id) => sum + Object.values(league.players[id].ratings).reduce((a, b) => a + b, 0), 0);
};

describe('every perk is covered', () => {
  it('10 personas × 3 levels; the only stubs are Sprint 16 binder/story perks', () => {
    const types = Object.values(PERSONA_DEFS).flatMap((d) => d.levels.map((l) => l.effect.type));
    expect(types).toHaveLength(30);
    expect([...PERK_STUBS].sort()).toEqual(['earlyChapter', 'scoutCards']);
  });

  it('perks unlock by level and not before', () => {
    expect(perk(P('diehard', 1), 'betRefundPct')).toBeNull();
    expect(perk(P('diehard', 2), 'betRefundPct')).not.toBeNull();
    expect(perk(P('diehard', 2), 'teamBoostOnce')).toBeNull();
    expect(perk(P('diehard', 3), 'teamBoostOnce')).not.toBeNull();
    // Lower levels stay unlocked.
    expect(perk(P('diehard', 3), 'betBonusPct')).not.toBeNull();
  });
});

describe('Diehard', () => {
  it('L1 betBonusPct: +25% of the stake on winning bets for the favorite only', () => {
    expect(winningPayout(P('diehard', 1), 100, 2000, 't1')).toBe(225);
    expect(winningPayout(P('diehard', 1), 100, 2000, 't2')).toBe(200);
  });

  it('L2 betRefundPct: losing bets on the favorite refund 15%', () => {
    let refunds = 0;
    for (const level of [1, 2] as const) {
      let s = uni(P('diehard', level));
      for (let d = 0; d < 6; d++) {
        for (const g of unplayedToday(s).filter((x) => x.homeId === 't1' || x.awayId === 't1')) s = reduce(s, { type: 'betPlaced', gameId: g.id, teamId: 't1', amount: 20 });
        s = runCommand(s, { type: 'simDays', count: 1 }).state;
      }
      const n = s.ledger.filter((l) => l.reason.startsWith('Refund on')).length;
      if (level === 1) expect(n).toBe(0);
      else refunds = n;
      if (level === 2) expect(s.ledger.find((l) => l.reason.startsWith('Refund on'))!.amount).toBe(3);
    }
    expect(refunds).toBeGreaterThan(0);
  });

  it('L3 Rally Cry: +3 to every rating of the favorite in its next game, once a season', () => {
    const s = uni(P('diehard', 3));
    const g = favGame(s);
    const after = reduce(s, { type: 'perkUsed', ability: 'rallyCry' });
    const players = s.league.teams.find((t) => t.id === 't1')!;
    const n = (players.lineup.length + players.rotation.length) * 8;
    expect(teamRatingSum(after, g.id, 't1')).toBeGreaterThan(teamRatingSum(s, g.id, 't1'));
    expect(teamRatingSum(after, g.id, 't1') - teamRatingSum(s, g.id, 't1')).toBeLessThanOrEqual(3 * n);
    expect(abilityError(after, 'rallyCry')).toMatch(/Already used/);
    expect(abilityError(uni(P('diehard', 2)), 'rallyCry')).toMatch(/not unlocked/);
  });
});

describe('Analyst', () => {
  const s = uni(P('analyst', 1));
  const player = s.league.players[s.league.teams[0].lineup[0]];

  it('L1/L2 revealStats: one hidden stat, then two', () => {
    expect(perkValue(P('analyst', 1), 'revealStats')).toBe(1);
    expect(perkValue(P('analyst', 2), 'revealStats')).toBe(2);
    expect(analystReveal(player, 1)).toHaveLength(1);
    expect(analystReveal(player, 2)).toHaveLength(2);
  });

  it('L3 showOffseasonProjection: unlocks a real projection', () => {
    expect(perk(P('analyst', 2), 'showOffseasonProjection')).toBeNull();
    expect(perk(P('analyst', 3), 'showOffseasonProjection')).not.toBeNull();
    const proj = offseasonProjection(s, player.id);
    expect(proj).not.toBeNull();
    expect(proj!.retires || Object.keys(proj!.change).length > 0).toBe(true);
  });
});

describe('Gambler', () => {
  it('L1 underdogPayoutPct: +20% on underdog odds only', () => {
    expect(personaMultiplier(P('gambler', 1), 2000, 400)).toBe(2400);
    expect(personaMultiplier(P('gambler', 1), 2000, 600)).toBe(2000);
    expect(personaMultiplier(P('analyst', 1), 2000, 400)).toBe(2000);
  });

  it('L2 freeBet: one free bet (≤ 25) a week, stake not taken', () => {
    const g = unplayedToday(uni(null))[0];
    expect(freeBetError(uni(P('gambler', 1)), g.id, g.homeId, 10)).not.toBeNull();
    const s = uni(P('gambler', 2));
    expect(freeBetError(s, g.id, g.homeId, 26)).not.toBeNull();
    const after = reduce(s, { type: 'betPlaced', gameId: g.id, teamId: g.homeId, amount: 25, free: true });
    expect(after.coins).toBe(s.coins);
    expect(after.bets.at(-1)!.free).toBe(true);
    expect(freeBetError(after, unplayedToday(after)[1].id, unplayedToday(after)[1].homeId, 5)).toMatch(/already/);
  });

  it("L3 Double Down: doubles the winnings of one of today's winning bets", () => {
    let s = uni(P('gambler', 3, null));
    for (const g of unplayedToday(s)) s = reduce(s, { type: 'betPlaced', gameId: g.id, teamId: g.homeId, amount: 10 });
    for (const g of unplayedToday(s)) s = runCommand(s, { type: 'playGame', gameId: g.id }).state;
    const won = s.bets.find((b) => b.status === 'won')!;
    expect(won).toBeDefined();
    const after = reduce(s, { type: 'perkUsed', ability: 'doubleDown', target: won.id });
    expect(after.coins - s.coins).toBe(won.payout - won.amount);
    expect(abilityError(after, 'doubleDown', won.id)).not.toBeNull();
  });
});

describe('Prophet', () => {
  it('L1 weirdHints gives a hint; L2 names the target', () => {
    let s = uni(P('prophet', 1));
    let found = false;
    for (let d = 0; d < 20 && !found; d++) {
      const l1 = prophecy(as(s, P('prophet', 1)))!;
      const l2 = prophecy(as(s, P('prophet', 2)))!;
      expect(l1).toBeTruthy();
      if (l1 !== l2) found = true;
      s = runCommand(s, { type: 'simDays', count: 1 }).state;
    }
    expect(found).toBe(true);
    expect(prophecy(uni(P('analyst', 1)))).toBeNull();
  });

  it("L3 Forecast: reveals today's first environment event, once a week", () => {
    const s = uni(P('prophet', 3));
    const after = reduce(s, { type: 'perkUsed', ability: 'forecast' });
    expect(after.forecastReveal?.text).toBeTruthy();
    expect(abilityError(after, 'forecast')).toMatch(/Already used/);
  });
});

describe('Organizer', () => {
  it('L1 voteDiscountPct: votes cost 20% less', () => {
    expect(votesCost(10, true)).toBe(80);
    expect(votesCost(10, false)).toBe(100);
    expect(marginalCost(4, 3, true)).toBeLessThan(marginalCost(4, 3, false));
  });

  it('L2 opinionGainPct: some factions whose opinion rose gain one more', () => {
    const s = uni(P('organizer', 2));
    const ids = s.factions.map((f) => f.id);
    const before = Object.fromEntries(ids.map((id) => [id, 0]));
    const after = Object.fromEntries(ids.map((id) => [id, 1]));
    const boosted = withOpinionGain(s, before, after, 'test');
    expect(Object.values(boosted).some((v) => v === 2)).toBe(true);
    expect(withOpinionGain(as(s, P('organizer', 1)), before, after, 'test')).toEqual(after);
  });

  it('L3 Backroom Deal: a friendly faction moves 5 votes to your proposal', () => {
    let s = uni(P('organizer', 3));
    const e = currentElection(s)!;
    const f = s.factions[0].id;
    expect(abilityError(s, 'backroomDeal', f, 0)).toMatch(/like you more/);
    s = { ...s, factionOpinion: { [f]: 3 } };
    const votes = e.factionVotes[f];
    const target = votes.indexOf(Math.min(...votes));
    const after = reduce(s, { type: 'perkUsed', ability: 'backroomDeal', target: f, proposal: target });
    const moved = currentElection(after)!.factionVotes[f][target] - votes[target];
    expect(moved).toBe(Math.min(5, votes.reduce((a, b) => a + b, 0) - votes[target]));
    expect(moved).toBeGreaterThan(0);
  });
});

describe('Contrarian', () => {
  const s = uni(P('contrarian', 1));
  const hitter = s.league.teams[0].lineup[0];
  const fade = { back: [], fade: [hitter] };
  const twoK = box({ [hitter]: { ab: 2, h: 1, k: 2 } });

  it('L1 fadePayoutPct: +25% on fade payouts', () => {
    expect(perkValue(P('contrarian', 1), 'fadePayoutPct')).toBe(25);
    expect(settlePicks(fade, twoK, s.league, { streaks: {}, fadeBonusPct: 25 }).lines[0].amount).toBe(5);
    expect(settlePicks(fade, twoK, s.league, { streaks: {} }).lines[0].amount).toBe(4);
  });

  it('L2 extraFadeSlot: a 4th Fade slot', () => {
    expect(fadeSlots(s)).toBe(3);
    expect(fadeSlots(as(s, P('contrarian', 2)))).toBe(4);
  });

  it('L3 Jinx: doubles one player’s fade payouts for 7 days', () => {
    const after = reduce(as(s, P('contrarian', 3)), { type: 'perkUsed', ability: 'jinx', target: hitter });
    expect(after.jinx).toMatchObject({ playerId: hitter, untilDay: s.currentDay + 6 });
    expect(settlePicks(fade, twoK, s.league, { streaks: {}, jinxedId: hitter }).lines[0].amount).toBe(8);
  });
});

describe('Collector', () => {
  it('L1 coinsPerNewCard: +3 coins for each new card, once per player', () => {
    const s = uni(P('collector', 1));
    const id = s.league.teams[0].lineup[0];
    const once = reduce(s, { type: 'collectionToggled', playerId: id });
    expect(once.coins - s.coins).toBe(3);
    const again = reduce(reduce(once, { type: 'collectionToggled', playerId: id }), { type: 'collectionToggled', playerId: id });
    expect(again.coins).toBe(once.coins);
    expect(reduce(uni(P('analyst', 1)), { type: 'collectionToggled', playerId: id }).coins).toBe(s.coins);
  });

  it('L2 previewRarity: unlocks the next-tier preview', () => {
    expect(perk(P('collector', 1), 'previewRarity')).toBeNull();
    expect(perk(P('collector', 2), 'previewRarity')).not.toBeNull();
    const s = uni(P('collector', 2));
    expect(nextTier(s, s.league.teams[0].lineup[0])).toMatchObject({ tier: expect.any(String), at: expect.any(Number) });
  });

  it('L3 scoutCards is a Sprint 16 stub', () => expect(PERK_STUBS.has('scoutCards')).toBe(true));
});

describe('Storm Chaser', () => {
  it('L1 stadiumForecast: unlocked from Level 1', () => {
    expect(perk(P('storm-chaser', 1), 'stadiumForecast')).not.toBeNull();
    expect(perk(P('prophet', 3), 'stadiumForecast')).toBeNull();
  });

  it('L2 envBetBonusPct: +15% of the stake when the environment changed the game', () => {
    expect(winningPayout(P('storm-chaser', 2), 100, 2000, 't1', { gameHadEnv: true })).toBe(215);
    expect(winningPayout(P('storm-chaser', 2), 100, 2000, 't1', { gameHadEnv: false })).toBe(200);
    expect(winningPayout(P('storm-chaser', 1), 100, 2000, 't1', { gameHadEnv: true })).toBe(200);
  });

  it('L3 Seed the Clouds: adds a climate to a stadium for 7 days', () => {
    const s = uni(P('storm-chaser', 3));
    const climate = ENVIRONMENT.climates.map((c) => c.id).find((c) => !stadiumClimates(s, 't2').includes(c))!;
    const after = reduce(s, { type: 'perkUsed', ability: 'seedClouds', target: 't2', climate });
    expect(stadiumClimates(after, 't2')).toContain(climate);
    expect(stadiumClimates(after, 't2', s.currentDay + 7)).not.toContain(climate);
  });
});

describe('Historian', () => {
  it('L1 earlyChapter is a Sprint 16 stub', () => expect(PERK_STUBS.has('earlyChapter')).toBe(true));

  it('L2 resurrectionOdds: "Bring Back" proposals offered far more often', () => {
    expect(perkValue(P('historian', 2), 'resurrectionOdds')).toBe(700);
    const s = uni(null);
    const d = [{ playerId: s.league.teams[0].lineup[0], name: 'Ghost', teamId: 't1' }];
    const count = (pm: number) => Array.from({ length: 300 }, (_, i) => generateProposals(s.league, s.league.teams.map((t) => ({ teamId: t.id, wins: 0, losses: 0 })), ['res', i], d, pm)).filter((ps) => ps.some((p) => p.title.startsWith('Bring Back'))).length;
    expect(count(700)).toBeGreaterThan(count(RESURRECTION_OFFER_PM) + 30);
  });

  it('L3 extraPinnedGames: keeps 10 more old play-by-plays', () => {
    expect(perkValue(P('historian', 3), 'extraPinnedGames')).toBe(10);
    const games = Array.from({ length: 30 }, (_, i) => ({ gameId: `g${i}`, season: 1, day: i + 1, pinned: false }));
    expect(gamesToPrune(games, 1, 40, 7).length - gamesToPrune(games, 1, 40, 7, 10).length).toBe(10);
  });
});

describe('Hype Squad (stat mods logged before the game; never a direct result change)', () => {
  it('L1 homeBoostWhenWatching: +2 ratings for the favorite at a home game you watch', () => {
    const s = uni(P('hype-squad', 1));
    const g = unplayedToday(s).find((x) => x.homeId === 't1') ?? null;
    const target = g ?? favGame(s, true);
    const watched = { ...s, watched: [target.id] };
    expect(teamRatingSum(watched, target.id, 't1')).toBeGreaterThan(teamRatingSum(s, target.id, 't1'));
    expect(teamRatingSum(as(watched, P('analyst', 1)), target.id, 't1')).toBe(teamRatingSum(s, target.id, 't1'));
  });

  it('L2 rallyBoost: a watched home game carries a late-rally boost into the engine', () => {
    const s = uni(P('hype-squad', 2));
    const g = favGame(s, true);
    expect(stadiumEnvironment(s, g).rally).toBeUndefined();
    expect(stadiumEnvironment({ ...s, watched: [g.id] }, g).rally).toEqual({ teamId: 't1', max: 3 });
  });

  it('L3 The Wave: forces a Crowd Surge at the next home game, once a week', () => {
    const s = uni(P('hype-squad', 3));
    const after = reduce(s, { type: 'perkUsed', ability: 'wave' });
    const g = favGame(s, true);
    expect(after.waveGameId).toBe(g.id);
    expect(stadiumEnvironment(after, g).forcedEnv?.id).toBe('crowd-surge');
    expect(abilityError(after, 'wave')).toMatch(/Already used/);
  });

  it('replay: the same watchedLive inputs reproduce the same results', () => {
    const play = () => {
      let s = uni(P('hype-squad', 3));
      for (let d = 0; d < 5; d++) {
        for (const g of unplayedToday(s).filter((x) => x.homeId === 't1')) s = reduce(s, { type: 'watchedLive', gameId: g.id });
        s = runCommand(s, { type: 'simDays', count: 1 }).state;
      }
      return s;
    };
    const a = play();
    const b = play();
    expect(a.watched.length).toBeGreaterThan(0);
    expect(a.results).toEqual(b.results);
    // And the boost is real: the watched game played with boosted ratings differs from unwatched.
    const s = uni(P('hype-squad', 3));
    const g = favGame(s, true);
    const w = { ...s, watched: [g.id] };
    const plain = simulateGame(gameLeague(s, g), g, s.season, s.engineVersion, stadiumEnvironment(s, g));
    const hyped = simulateGame(gameLeague(w, g), g, s.season, s.engineVersion, stadiumEnvironment(w, g));
    expect(hyped.events).not.toEqual(plain.events);
  });
});
