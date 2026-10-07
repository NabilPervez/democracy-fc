/**
 * FROZEN: engine v2, exactly as it shipped before Sprint 12. Never edit this file.
 * Seasons simmed with engineVersion <= 2 (every save created before Sprint 12) keep using it until
 * their next season starts, so results never change mid-season. New engine work goes in ../game.ts.
 */
import { createRng, type Rng } from '../../core/rng';
import type { Bases, GameEvent, GameResult, Half, HitKind, League, OutKind, Player, ScheduledGame, Team } from '../types';

const MAX_INNINGS = 30; // safety valve; extra-inning ghost runners make this practically unreachable

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Seed for a single game: hash(universeSeed, seasonId, gameId). */
export function gameSeed(universeSeed: string, seasonId: number, gameId: string): (string | number)[] {
  return [universeSeed, seasonId, gameId];
}

export function startingPitcher(team: Team, day: number): string {
  return team.rotation[(day - 1) % team.rotation.length];
}

/** A fielder's throwing arm: Velocity nudges their defense (±10 at the extremes). */
const armBonus = (velocity: number) => Math.trunc((velocity - 50) / 5);

function teamDefense(league: League, team: Team): number {
  const total = team.lineup.reduce((sum, id) => {
    const r = league.players[id].ratings;
    return sum + r.defense + armBonus(r.velocity);
  }, 0);
  return Math.floor(total / team.lineup.length);
}

/**
 * Pitching ratings matter a little at the plate too: Control is a batter's eye (adds to
 * Discipline) and Stuff is bat wizardry (adds to Power), each ±10 at the extremes.
 */
export function batterView(r: Player['ratings']): Player['ratings'] {
  return { ...r, discipline: r.discipline + Math.trunc((r.control - 50) / 5), power: r.power + Math.trunc((r.stuff - 50) / 5) };
}

type EmitPayload = { kind: GameEvent['kind'] } & Record<string, unknown>;

export function simulateGameV2(league: League, game: ScheduledGame, seasonId = 1): GameResult {
  const rng: Rng = createRng(...gameSeed(league.seed, seasonId, game.id));
  const away = league.teams.find((t) => t.id === game.awayId)!;
  const home = league.teams.find((t) => t.id === game.homeId)!;
  const p = (id: string): Player => league.players[id];

  const pitchers = { away: startingPitcher(away, game.day), home: startingPitcher(home, game.day) };
  const defense = { away: teamDefense(league, away), home: teamDefense(league, home) };
  const order = { away: 0, home: 0 };

  const events: GameEvent[] = [];
  const s = {
    inning: 1,
    half: 'top' as Half,
    outs: 0,
    balls: 0,
    strikes: 0,
    bases: [null, null, null] as Bases,
    score: { away: 0, home: 0 },
  };
  let over = false;

  const emit = (e: EmitPayload) => {
    events.push({
      ...e,
      inning: s.inning,
      half: s.half,
      outs: s.outs,
      balls: s.balls,
      strikes: s.strikes,
      bases: [...s.bases] as Bases,
      score: { ...s.score },
    } as GameEvent);
  };

  const battingSide = () => (s.half === 'top' ? 'away' : 'home');
  const fieldingSide = () => (s.half === 'top' ? 'home' : 'away');
  const battingTeam = () => (s.half === 'top' ? away : home);

  const isWalkOff = () => s.half === 'bottom' && s.inning >= 9 && s.score.home > s.score.away;

  const scoreRun = (runnerId: string) => {
    s.score[battingSide()] += 1;
    emit({ kind: 'run', runnerId, teamId: battingTeam().id });
    if (isWalkOff()) over = true;
  };

  /** Chance (per mille) a runner takes an extra base, driven by speed. */
  const extraBase = (runnerId: string, base: number) =>
    rng.chance(clamp(base + (p(runnerId).ratings.speed - 50) * 5, 50, 950));

  const advanceOnHit = (batterId: string, hit: HitKind) => {
    const [first, second, third] = s.bases;
    const next: Bases = [null, null, null];
    const scorers: string[] = [];
    const onBase = [third, second, first].filter((r): r is string => r !== null);
    if (hit === 'homeRun') {
      scorers.push(...onBase, batterId);
    } else if (hit === 'triple') {
      scorers.push(...onBase);
      next[2] = batterId;
    } else if (hit === 'double') {
      if (third) scorers.push(third);
      if (second) scorers.push(second);
      if (first) {
        if (extraBase(first, 400)) scorers.push(first);
        else next[2] = first;
      }
      next[1] = batterId;
    } else {
      if (third) scorers.push(third);
      if (second) {
        if (extraBase(second, 550)) scorers.push(second);
        else next[2] = second;
      }
      if (first) {
        if (!next[2] && extraBase(first, 250)) next[2] = first;
        else next[1] = first;
      }
      next[0] = batterId;
    }
    s.bases = next;
    for (const r of scorers) {
      if (over) break;
      scoreRun(r);
    }
  };

  const walk = (batterId: string) => {
    const [first, second, third] = s.bases;
    if (first && second && third) {
      s.bases = [batterId, first, second];
      scoreRun(third);
    } else if (first && second) {
      s.bases = [batterId, first, second];
    } else if (first) {
      s.bases = [batterId, first, third];
    } else {
      s.bases = [batterId, second, third];
    }
  };

  const strike = (ids: { batterId: string; pitcherId: string }, called: boolean): boolean => {
    s.strikes += 1;
    if (s.strikes === 3) {
      s.outs += 1;
      s.balls = 0;
      s.strikes = 0;
      emit({ kind: 'strikeout', ...ids, swinging: !called });
      return true;
    }
    emit({ kind: called ? 'calledStrike' : 'swingingStrike', ...ids });
    return false;
  };

  const plateAppearance = () => {
    const side = battingSide();
    const team = battingTeam();
    const batterId = team.lineup[order[side] % team.lineup.length];
    order[side] += 1;
    const pitcherId = pitchers[fieldingSide()];
    const b = batterView(p(batterId).ratings);
    const pr = p(pitcherId).ratings;
    s.balls = 0;
    s.strikes = 0;
    emit({ kind: 'atBat', batterId, pitcherId });

    const ids = { batterId, pitcherId };
    const ballPm = clamp(330 + (b.discipline - pr.control) * 2, 180, 520);
    const contactPm = clamp(770 + (b.contact - pr.stuff) * 3, 500, 940);
    const hitPm = clamp(330 + (b.contact - pr.velocity) * 2 - (defense[fieldingSide()] - 50), 180, 460);

    for (;;) {
      if (rng.chance(ballPm)) {
        s.balls += 1;
        if (s.balls === 4) {
          s.balls = 0;
          s.strikes = 0;
          emit({ kind: 'walk', ...ids });
          walk(batterId);
          return;
        }
        emit({ kind: 'ball', ...ids });
        continue;
      }
      if (rng.chance(220)) {
        if (strike(ids, true)) return;
        continue;
      }
      if (!rng.chance(contactPm)) {
        if (strike(ids, false)) return;
        continue;
      }
      if (rng.chance(450)) {
        if (s.strikes < 2) s.strikes += 1;
        emit({ kind: 'foul', ...ids });
        continue;
      }
      // Ball in play.
      s.balls = 0;
      s.strikes = 0;
      if (rng.chance(hitPm)) {
        const roll = rng.int(1000);
        const hrPm = clamp(90 + (b.power - 50) * 3, 20, 250);
        const triplePm = clamp(20 + Math.trunc((b.speed - 50) / 2), 5, 60);
        const doublePm = clamp(190 + (b.power - 50) * 2, 80, 320);
        const hit: HitKind =
          roll < hrPm
            ? 'homeRun'
            : roll < hrPm + triplePm
              ? 'triple'
              : roll < hrPm + triplePm + doublePm
                ? 'double'
                : 'single';
        emit({ kind: 'hit', ...ids, hit });
        advanceOnHit(batterId, hit);
        return;
      }
      const out: OutKind = rng.pick(['groundout', 'groundout', 'flyout', 'flyout', 'lineout', 'popout'] as const);
      const runnerOnThird = s.bases[2];
      const canTagUp = runnerOnThird !== null && s.outs < 2 && (out === 'flyout' || out === 'groundout');
      const sacrifice = canTagUp && extraBase(runnerOnThird, out === 'flyout' ? 650 : 300);
      s.outs += 1;
      emit({ kind: 'out', ...ids, out, sacrifice });
      if (sacrifice && runnerOnThird) {
        s.bases = [s.bases[0], s.bases[1], null];
        scoreRun(runnerOnThird);
      }
      return;
    }
  };

  emit({ kind: 'gameStart', awayPitcherId: pitchers.away, homePitcherId: pitchers.home });

  while (!over) {
    s.outs = 0;
    s.bases = [null, null, null];
    if (s.inning > 9) {
      // Extra innings start with a runner on second: the last batter of the previous inning.
      const team = battingTeam();
      const side = battingSide();
      s.bases[1] = team.lineup[(order[side] + team.lineup.length - 1) % team.lineup.length];
    }
    emit({ kind: 'halfStart', battingTeamId: battingTeam().id });
    while (s.outs < 3 && !over) plateAppearance();
    if (over) break;
    emit({ kind: 'halfEnd' });

    if (s.half === 'top') {
      if (s.inning >= 9 && s.score.home > s.score.away) break; // home doesn't need to bat
      s.half = 'bottom';
    } else {
      if (s.inning >= 9 && s.score.home !== s.score.away) break;
      if (s.inning >= MAX_INNINGS) {
        // Practically unreachable; break the tie deterministically in the home team's favor.
        s.score.home += 1;
        break;
      }
      s.inning += 1;
      s.half = 'top';
    }
  }

  const homeWon = s.score.home > s.score.away;
  emit({ kind: 'gameEnd', winnerId: homeWon ? home.id : away.id, loserId: homeWon ? away.id : home.id });

  return {
    gameId: game.id,
    awayId: away.id,
    homeId: home.id,
    awayScore: s.score.away,
    homeScore: s.score.home,
    innings: s.inning,
    events,
  };
}
