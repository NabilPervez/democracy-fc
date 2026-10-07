import { createRng, type Rng } from '../core/rng';
import type { Bases, CauseRef, EnvEventDef, GameEnvironment, GameEvent, GameResult, Half, HitKind, League, OutKind, Player, ScheduledGame, Team } from './types';
import { simulateGameV2 } from './v2/game';

/**
 * Bump when a change would alter simulated outcomes for the same seed.
 * v3 (Sprint 12, "engine v2" in PRD 2): steals, pickoffs, errors, double plays, wild pitches, hit by pitch.
 * v4 (Sprint 13): stadium environment events. v3 is v4 with the environment switched off.
 */
export const ENGINE_VERSION = 4;

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

const fieldingRating = (r: Player['ratings']) => r.defense + armBonus(r.velocity);

function teamDefense(league: League, team: Team): number {
  const total = team.lineup.reduce((sum, id) => sum + fieldingRating(league.players[id].ratings), 0);
  return Math.floor(total / team.lineup.length);
}

/**
 * Pitching ratings matter a little at the plate too: Control is a batter's eye (adds to
 * Discipline) and Stuff is bat wizardry (adds to Power), each ±10 at the extremes.
 */
export function batterView(r: Player['ratings']): Player['ratings'] {
  return { ...r, discipline: r.discipline + Math.trunc((r.control - 50) / 5), power: r.power + Math.trunc((r.stuff - 50) / 5) };
}

/** Positions that can field each kind of out (DH never fields). Repeats weight the draw. */
const FIELDERS: Record<OutKind, readonly string[]> = {
  groundout: ['SS', 'SS', '2B', '2B', '3B', '3B', '1B', 'C'],
  popout: ['C', '1B', '2B', '3B', 'SS'],
  lineout: ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'],
  flyout: ['LF', 'CF', 'CF', 'RF'],
};

/**
 * Event rates, all integer math. Most are per ten-thousand (rolled with `rng.int(10000)`) since
 * per-mille is too coarse for once-a-game events. Tuned against PRD 2 §E1's bands by the rate test.
 */
export const RATES = {
  /** Per ten-thousand, each ball: the pitch hits the batter instead. */
  hbp: (control: number) => clamp(105 + (50 - control) * 2, 25, 220),
  /** Per ten-thousand, each ball with runners on: it gets past the catcher. */
  wildPitch: (control: number, stuff: number) => clamp(150 + (50 - control) * 3 + Math.trunc((stuff - 50) / 2), 40, 350),
  /** Per ten-thousand, each pitch a runner could steal: the pitcher throws over and gets him. */
  pickoff: (control: number, speed: number) => clamp(13 + Math.trunc((control - 50) / 3) + Math.trunc((50 - speed) / 3), 4, 50),
  /** Per ten-thousand, each pitch a runner could steal: he goes. */
  stealAttempt: (speed: number) => clamp(140 + (speed - 50) * 5, 15, 400),
  /** Per mille: the steal succeeds. */
  stealSuccess: (speed: number, control: number, catcher: number) => clamp(670 + (speed - 50) * 5 - (control - 50) * 2 - (catcher - 50) * 3, 300, 950),
  /** Per mille, each out in play: the fielder boots it. */
  error: (fielding: number) => clamp(26 + Math.trunc((50 - fielding) / 2), 6, 60),
  /** Per mille, each groundout with a runner on first and < 2 outs: they turn two. */
  doublePlay: (batterSpeed: number, teamDefense: number) => clamp(620 + (50 - batterSpeed) * 4 + (teamDefense - 50) * 3, 200, 850),
};

type EmitPayload = { kind: GameEvent['kind'] } & Record<string, unknown>;

/**
 * Simulate a game. `engineVersion` is the universe's: seasons started before Sprint 12 keep the
 * frozen v2 engine until their next season, so results never change mid-season.
 */
export function simulateGame(league: League, game: ScheduledGame, seasonId = 1, engineVersion = ENGINE_VERSION, env?: GameEnvironment): GameResult {
  if (engineVersion <= 2) return simulateGameV2(league, game, seasonId);
  return simulateModern(league, game, seasonId, engineVersion >= 4 && env && (env.events.length || env.forcedEnv || env.rally) ? env : null);
}

const HIT_UP: Record<HitKind, HitKind> = { single: 'double', double: 'triple', triple: 'homeRun', homeRun: 'homeRun' };
const HIT_DOWN: Record<HitKind, HitKind> = { single: 'single', double: 'single', triple: 'double', homeRun: 'double' };
const isHitKind = (k: string | undefined): k is HitKind => !!k && k in HIT_UP;

type PitchKind = 'ball' | 'called' | 'swinging' | 'foul' | 'inPlay';
const PITCH_NAMES: Record<PitchKind, string> = { ball: 'ball', called: 'called strike', swinging: 'swinging strike', foul: 'foul', inPlay: 'ball in play' };

/** Engines v3 and v4. With `env` null this is exactly v3: the environment has its own RNG stream. */
function simulateModern(league: League, game: ScheduledGame, seasonId: number, env: GameEnvironment | null): GameResult {
  const rng: Rng = createRng(...gameSeed(league.seed, seasonId, game.id));
  const away = league.teams.find((t) => t.id === game.awayId)!;
  const home = league.teams.find((t) => t.id === game.homeId)!;
  const p = (id: string): Player => league.players[id];
  const perTenK = (n: number) => rng.int(10000) < n;

  const pitchers = { away: startingPitcher(away, game.day), home: startingPitcher(home, game.day) };
  const defense = { away: teamDefense(league, away), home: teamDefense(league, home) };
  const order = { away: 0, home: 0 };

  /** Each team's fielder at a position (falls back to the first in the lineup). */
  const fielderAt = (team: Team, pos: string) => team.lineup.find((id) => p(id).position === pos) ?? team.lineup[0];

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

  // Environment (engine v4). At most one event per half-inning. Its rolls come from a separate
  // stream per plate appearance, so with no environment every other roll is unchanged.
  let paIndex = 0;
  let envRng: Rng | null = null;
  let envUsedThisHalf = false;
  let forcedUsed = false;
  let active: { def: EnvEventDef; effectsLeft: number; paLeft: number | null; changed: number } | null = null;

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
  const fieldingTeam = () => (s.half === 'top' ? home : away);

  const isWalkOff = () => s.half === 'bottom' && s.inning >= 9 && s.score.home > s.score.away;

  const scoreRun = (runnerId: string) => {
    s.score[battingSide()] += 1;
    emit({ kind: 'run', runnerId, teamId: battingTeam().id });
    if (isWalkOff()) over = true;
  };
  const scoreAll = (runners: string[]) => {
    for (const r of runners) {
      if (over) break;
      scoreRun(r);
    }
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
    scoreAll(scorers);
  };

  /** Batter to first; only forced runners move (walks, hit by pitch). */
  const forceToFirst = (batterId: string) => {
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

  /** Every runner moves up one base (wild pitches, errors). Returns who scored. */
  const everyoneUp = (batterId: string | null): string[] => {
    const [first, second, third] = s.bases;
    s.bases = [batterId, first, second];
    return third ? [third] : [];
  };

  const strike = (ids: { batterId: string; pitcherId: string }, called: boolean, cause?: CauseRef): boolean => {
    s.strikes += 1;
    if (s.strikes === 3) {
      s.outs += 1;
      s.balls = 0;
      s.strikes = 0;
      emit({ kind: 'strikeout', ...ids, swinging: !called, ...(cause && { cause }) });
      if (cause) envEffect();
      return true;
    }
    emit({ kind: called ? 'calledStrike' : 'swingingStrike', ...ids, ...(cause && { cause }) });
    if (cause) envEffect();
    return false;
  };

  // --- Environment ---------------------------------------------------------------------------

  const endEnv = () => {
    if (active && active.changed === 0 && active.def.fizzle) emit({ kind: 'envEnd', envId: active.def.id });
    active = null;
  };

  /** At the start of each plate appearance: age the active event, or maybe start one. */
  const envBeginPa = () => {
    if (!env) return;
    envRng = createRng(...gameSeed(league.seed, seasonId, game.id), 'env', paIndex);
    paIndex += 1;
    if (active && active.paLeft !== null && --active.paLeft < 0) endEnv();
    if (active || envUsedThisHalf) return;
    if (env.forcedEnv && !forcedUsed && s.half === 'bottom') {
      forcedUsed = true;
      active = { def: env.forcedEnv, effectsLeft: env.forcedEnv.maxEffects ?? 1, paLeft: env.forcedEnv.durationPA ?? null, changed: 0 };
      envUsedThisHalf = true;
      emit({ kind: 'envStart', envId: env.forcedEnv.id });
      return;
    }
    for (const def of env.events) {
      if (envRng.int(1_000_000) < def.chancePerMille * env.chaosPerMille) {
        active = { def, effectsLeft: def.maxEffects ?? 1, paLeft: def.durationPA ?? null, changed: 0 };
        envUsedThisHalf = true;
        emit({ kind: 'envStart', envId: def.id });
        return;
      }
    }
  };

  /** The active event if it fires here (spending one effect). Only call where it would change something. */
  const envFires = (phase: EnvEventDef['phase'], type: EnvEventDef['effect']['type'], original?: string): EnvEventDef | null => {
    if (!active || !envRng || active.def.phase !== phase || active.def.effect.type !== type || active.effectsLeft <= 0) return null;
    const from = active.def.effect.from;
    if (original && from && !from.includes(original)) return null;
    if (!envRng.chance(active.def.effect.chancePerMille)) return null;
    active.effectsLeft -= 1;
    active.changed += 1;
    return active.def;
  };
  const activeType = () => (active && active.effectsLeft > 0 ? active.def.effect.type : null);
  const causeOf = (def: EnvEventDef, original: string): CauseRef => ({ type: 'env', id: def.id, original });
  /** The attributed line that follows a changed play. */
  const envEffect = (extra: Record<string, unknown> = {}) => emit({ kind: 'envEffect', envId: active!.def.id, changed: 'play', ...extra });
  const leadRunner = (): number => (s.bases[2] ? 2 : s.bases[1] ? 1 : s.bases[0] ? 0 : -1);
  const onBase = () => s.bases.filter((x): x is string => x !== null);

  /** prePitch effects that aren't about the pitch itself. True if one happened. */
  const envPrePitch = (pitcherId: string): boolean => {
    if (!active || active.def.phase !== 'prePitch' || !s.bases.some(Boolean)) return false;
    const t = activeType();
    if (t === 'wildPitch') {
      const def = envFires('prePitch', t);
      if (!def) return false;
      emit({ kind: 'wildPitch', pitcherId, advanced: onBase(), cause: causeOf(def, 'no wild pitch') });
      envEffect();
      scoreAll(everyoneUp(null));
      return true;
    }
    if (t === 'runnersAdvance') {
      const def = envFires('prePitch', t);
      if (!def) return false;
      const advanced = onBase();
      const scored = everyoneUp(null);
      emit({ kind: 'envEffect', envId: def.id, changed: 'runners advance', advanced, cause: causeOf(def, 'runners held') });
      scoreAll(scored);
      return true;
    }
    if (t === 'pickoff') {
      const from: 1 | 2 | null = s.bases[1] ? 2 : s.bases[0] ? 1 : null;
      const def = from ? envFires('prePitch', t) : null;
      if (!from || !def) return false;
      const runnerId = s.bases[from - 1]!;
      s.bases[from - 1] = null;
      s.outs += 1;
      emit({ kind: 'pickoff', runnerId, base: from, pitcherId, cause: causeOf(def, 'runner safe') });
      envEffect();
      return true;
    }
    return false;
  };

  /** afterPlay effects, once a plate appearance is over and the inning isn't. */
  const envAfterPlay = () => {
    if (!active || active.def.phase !== 'afterPlay' || over || s.outs >= 3) return;
    const t = activeType();
    const lead = leadRunner();
    if (lead < 0 || !t) return;
    if (t === 'extraRun' || (t === 'runnerHome' && s.bases[2])) {
      const def = envFires('afterPlay', t);
      if (!def) return;
      const base = t === 'runnerHome' ? 2 : lead;
      const runner = s.bases[base]!;
      s.bases[base] = null;
      emit({ kind: 'envEffect', envId: def.id, changed: 'run scores', cause: causeOf(def, 'runner held') });
      scoreRun(runner);
    } else if (t === 'runnerRemoved') {
      const def = envFires('afterPlay', t);
      if (!def) return;
      const removedId = s.bases[lead]!;
      s.bases[lead] = null;
      emit({ kind: 'envEffect', envId: def.id, changed: 'runner removed', removedId, cause: causeOf(def, 'runner on base') });
    } else if (t === 'runnersAdvance') {
      const def = envFires('afterPlay', t);
      if (!def) return;
      const advanced = onBase();
      const scored = everyoneUp(null);
      emit({ kind: 'envEffect', envId: def.id, changed: 'runners advance', advanced, cause: causeOf(def, 'runners held') });
      scoreAll(scored);
    }
  };

  /**
   * Before a pitch: a lead runner with an open base ahead may be picked off or try to steal.
   * Returns true if the inning ended (a third out on the bases).
   */
  const runnerGame = (pitcherId: string): boolean => {
    const from: 1 | 2 | null = s.bases[1] && !s.bases[2] ? 2 : s.bases[0] && !s.bases[1] ? 1 : null;
    if (!from) return false;
    const runnerId = s.bases[from - 1]!;
    const speed = p(runnerId).ratings.speed;
    const control = p(pitcherId).ratings.control;
    if (perTenK(RATES.pickoff(control, speed))) {
      s.bases[from - 1] = null;
      s.outs += 1;
      emit({ kind: 'pickoff', runnerId, base: from, pitcherId });
      return s.outs >= 3;
    }
    if (!perTenK(RATES.stealAttempt(speed))) return false;
    const catcher = fieldingRating(p(fielderAt(fieldingTeam(), 'C')).ratings);
    const success = rng.chance(RATES.stealSuccess(speed, control, catcher));
    s.bases[from - 1] = null;
    if (success) s.bases[from] = runnerId;
    else s.outs += 1;
    emit({ kind: 'stealAttempt', runnerId, from, pitcherId, success });
    return s.outs >= 3;
  };

  /** onContact effects on a hit. True if the environment changed the play (and it's been played out). */
  const envContactOnHit = (ids: { batterId: string; pitcherId: string }, hit: HitKind): boolean => {
    const t = activeType();
    if (!t || active!.def.phase !== 'onContact') return false;
    let def: EnvEventDef | null = null;
    let to: string | undefined;
    if (t === 'upgradeHit' && hit !== 'homeRun') [def, to] = [envFires('onContact', t), HIT_UP[hit]];
    else if (t === 'downgradeHit' && hit !== 'single') [def, to] = [envFires('onContact', t), HIT_DOWN[hit]];
    else if (t === 'hitToOut') [def, to] = [envFires('onContact', t, hit), active!.def.effect.to ?? 'flyout'];
    else if (t === 'homeRunToOut' && hit === 'homeRun') [def, to] = [envFires('onContact', t), active!.def.effect.to ?? 'flyout'];
    if (!def || !to) return false;
    const cause = causeOf(def, hit);
    if (isHitKind(to)) {
      emit({ kind: 'hit', ...ids, hit: to, cause });
      envEffect();
      advanceOnHit(ids.batterId, to);
    } else {
      const out = to as OutKind;
      const fielderId = fielderAt(fieldingTeam(), FIELDERS[out][envRng!.int(FIELDERS[out].length)]);
      s.outs += 1;
      emit({ kind: 'out', ...ids, out, sacrifice: false, fielderId, cause });
      envEffect();
    }
    return true;
  };

  /** onContact effects on an out. True if the environment changed the play. */
  const envContactOnOut = (ids: { batterId: string; pitcherId: string }, out: OutKind, fielderId: string): boolean => {
    const t = activeType();
    if (!t || active!.def.phase !== 'onContact') return false;
    let def: EnvEventDef | null = null;
    if (t === 'outToHit' || t === 'outToHomeRun' || t === 'induceError') def = envFires('onContact', t, out);
    if (!def) return false;
    const cause = causeOf(def, out);
    if (t === 'induceError') {
      emit({ kind: 'error', fielderId, ...ids, onKind: out, bases: 1, cause });
      envEffect();
      scoreAll(everyoneUp(ids.batterId));
      return true;
    }
    const hit: HitKind = t === 'outToHomeRun' ? 'homeRun' : isHitKind(def.effect.to) ? def.effect.to : 'single';
    emit({ kind: 'hit', ...ids, hit, cause });
    envEffect();
    advanceOnHit(ids.batterId, hit);
    return true;
  };

  const plateAppearance = () => {
    envBeginPa();
    resolvePa();
    envAfterPlay();
  };

  const resolvePa = () => {
    const side = battingSide();
    const team = battingTeam();
    const batterId = team.lineup[order[side] % team.lineup.length];
    order[side] += 1;
    const pitcherId = pitchers[fieldingSide()];
    let b = batterView(p(batterId).ratings);
    const pr = p(pitcherId).ratings;
    const rally = env?.rally;
    if (rally && team.id === rally.teamId && s.inning >= 8) {
      const behind = s.score[fieldingSide()] - s.score[side];
      if (behind > 0) b = { ...b, contact: b.contact + Math.min(behind, rally.max) };
    }
    s.balls = 0;
    s.strikes = 0;
    emit({ kind: 'atBat', batterId, pitcherId });

    const ids = { batterId, pitcherId };
    const ballPm = clamp(330 + (b.discipline - pr.control) * 2, 180, 520);
    const contactPm = clamp(770 + (b.contact - pr.stuff) * 3, 500, 940);
    const hitPm = clamp(330 + (b.contact - pr.velocity) * 2 - (defense[fieldingSide()] - 50), 180, 460);

    for (;;) {
      if (runnerGame(pitcherId) || (envPrePitch(pitcherId) && s.outs >= 3)) {
        // Third out on the bases: this batter leads off next inning instead.
        order[side] -= 1;
        return;
      }
      if (over) return;
      // The pitch, rolled exactly as engine v3 does (same calls, same order).
      let pitch: PitchKind = rng.chance(ballPm) ? 'ball' : rng.chance(220) ? 'called' : !rng.chance(contactPm) ? 'swinging' : rng.chance(450) ? 'foul' : 'inPlay';
      let forced: CauseRef | undefined;
      const t = activeType();
      if (t === 'forceBall' && pitch !== 'ball') {
        const def = envFires('prePitch', t);
        if (def) {
          forced = causeOf(def, PITCH_NAMES[pitch]);
          pitch = 'ball';
        }
      } else if (t === 'forceStrike' && pitch === 'ball') {
        const def = envFires('prePitch', t);
        if (def) {
          forced = causeOf(def, PITCH_NAMES[pitch]);
          pitch = 'called';
        }
      }
      if (forced && pitch === 'ball') {
        s.balls += 1;
        if (s.balls === 4) {
          s.balls = 0;
          s.strikes = 0;
          emit({ kind: 'walk', ...ids, cause: forced });
          envEffect();
          forceToFirst(batterId);
          return;
        }
        emit({ kind: 'ball', ...ids, cause: forced });
        envEffect();
        continue;
      }
      if (forced) {
        if (strike(ids, true, forced)) return;
        continue;
      }
      if (pitch === 'ball') {
        if (perTenK(RATES.hbp(pr.control))) {
          s.balls = 0;
          s.strikes = 0;
          emit({ kind: 'hitByPitch', ...ids });
          forceToFirst(batterId);
          return;
        }
        s.balls += 1;
        if (s.balls === 4) {
          s.balls = 0;
          s.strikes = 0;
          emit({ kind: 'walk', ...ids });
          forceToFirst(batterId);
          return;
        }
        emit({ kind: 'ball', ...ids });
        if (s.bases.some(Boolean) && perTenK(RATES.wildPitch(pr.control, pr.stuff))) {
          const advanced = s.bases.filter((r): r is string => r !== null);
          const scored = everyoneUp(null);
          emit({ kind: 'wildPitch', pitcherId, advanced });
          scoreAll(scored);
          if (over) return;
        }
        continue;
      }
      if (pitch === 'called') {
        if (strike(ids, true)) return;
        continue;
      }
      if (pitch === 'swinging') {
        if (strike(ids, false)) return;
        continue;
      }
      if (pitch === 'foul') {
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
        if (envContactOnHit(ids, hit)) return;
        emit({ kind: 'hit', ...ids, hit });
        advanceOnHit(batterId, hit);
        return;
      }
      const out: OutKind = rng.pick(['groundout', 'groundout', 'flyout', 'flyout', 'lineout', 'popout'] as const);
      const fielderId = fielderAt(fieldingTeam(), rng.pick(FIELDERS[out]));
      if (envContactOnOut(ids, out, fielderId)) return;

      if (rng.chance(RATES.error(fieldingRating(p(fielderId).ratings)))) {
        emit({ kind: 'error', fielderId, batterId, pitcherId, onKind: out, bases: 1 });
        scoreAll(everyoneUp(batterId));
        return;
      }

      const runnerOnFirst = s.bases[0];
      if (out === 'groundout' && runnerOnFirst && s.outs < 2 && rng.chance(RATES.doublePlay(b.speed, defense[fieldingSide()]))) {
        s.outs += 2;
        const [, second, third] = s.bases;
        s.bases = [null, null, null];
        emit({ kind: 'doublePlay', batterId, pitcherId, runnerOutId: runnerOnFirst, fielderId });
        if (s.outs < 3) {
          s.bases = [null, null, second];
          if (third) scoreRun(third);
        }
        return;
      }

      const runnerOnThird = s.bases[2];
      const canTagUp = runnerOnThird !== null && s.outs < 2 && (out === 'flyout' || out === 'groundout');
      const sacrifice = canTagUp && extraBase(runnerOnThird, out === 'flyout' ? 650 : 300);
      s.outs += 1;
      emit({ kind: 'out', ...ids, out, sacrifice, fielderId });
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
    envUsedThisHalf = false;
    while (s.outs < 3 && !over) plateAppearance();
    endEnv();
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
