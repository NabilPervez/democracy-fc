import names from '../../content/names.json';
import { createRng, type Rng } from '../engine/core/rng';
import type { League, Player, RatingKey, Ratings, Role, Team } from '../engine/baseball/types';

const RATING_KEYS: RatingKey[] = ['contact', 'power', 'discipline', 'velocity', 'control', 'stuff', 'speed', 'defense'];
const BATTER_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const BATTING_KEYS: RatingKey[] = ['contact', 'power', 'discipline'];
const PITCHING_KEYS: RatingKey[] = ['velocity', 'control', 'stuff'];

export const LINEUP_SIZE = 9;
export const ROTATION_SIZE = 4;

/** Bell-ish rating: average of three rolls, so extremes are rare. */
function roll(rng: Rng, bias = 0): number {
  const v = Math.floor((rng.int(101) + rng.int(101) + rng.int(101)) / 3) + bias;
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

export function makeRatings(rng: Rng, role: Role): Ratings {
  const r = {} as Ratings;
  for (const k of RATING_KEYS) {
    const primary = role === 'batter' ? BATTING_KEYS.includes(k) : PITCHING_KEYS.includes(k);
    const offRole = role === 'batter' ? PITCHING_KEYS.includes(k) : BATTING_KEYS.includes(k);
    r[k] = roll(rng, primary ? 8 : offRole ? -25 : 0);
  }
  return r;
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface LeagueOptions {
  seed: string;
  name?: string;
  teamCount?: number;
}

/** Same seed ⇒ same league. */
export function generateLeague({ seed, name = 'The Blastball League', teamCount = 8 }: LeagueOptions): League {
  const rng = createRng(seed, 'world');
  const cities = shuffled(rng, names.cities);
  const mascots = shuffled(rng, names.mascots);
  const colors = shuffled(rng, names.colors);
  const usedNames = new Set<string>();
  const players: Record<string, Player> = {};
  const teams: Team[] = [];

  const playerName = () => {
    for (;;) {
      const n = `${rng.pick(names.firstNames)} ${rng.pick(names.lastNames)}`;
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
  };

  for (let t = 0; t < teamCount; t++) {
    const teamId = `t${t + 1}`;
    const city = cities[t];
    const mascot = mascots[t];
    const team: Team = {
      id: teamId,
      city,
      name: mascot,
      abbr: (city.replace(/[^A-Z]/g, '') + mascot[0]).slice(0, 3).padEnd(3, mascot[1].toUpperCase()),
      colors: colors[t] as [string, string],
      lineup: [],
      rotation: [],
    };
    for (let i = 0; i < LINEUP_SIZE + ROTATION_SIZE; i++) {
      const role: Role = i < LINEUP_SIZE ? 'batter' : 'pitcher';
      const id = `${teamId}p${i + 1}`;
      players[id] = {
        id,
        name: playerName(),
        teamId,
        role,
        position: role === 'batter' ? BATTER_POSITIONS[i] : `SP${i - LINEUP_SIZE + 1}`,
        ratings: makeRatings(rng, role),
      };
      (role === 'batter' ? team.lineup : team.rotation).push(id);
    }
    teams.push(team);
  }

  return { seed, name, teams, players };
}

/** A name not already used in the league. */
export function uniqueName(rng: Rng, used: Set<string>): string {
  for (let i = 0; ; i++) {
    const n = `${rng.pick(names.firstNames)} ${rng.pick(names.lastNames)}`;
    const name = i < 50 ? n : `${n} ${['II', 'III', 'IV', 'V'][i % 4]}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
}

/** A fresh rookie to fill a roster slot (e.g. after a player departs). */
export function makeRookie(rng: Rng, id: string, teamId: string, role: Role, position: string, used: Set<string>): Player {
  return { id, name: uniqueName(rng, used), teamId, role, position, ratings: makeRatings(rng, role) };
}

/** A fresh shareable seed derived from a caller-supplied entropy string (e.g. the current time). */
export function newSeed(entropy: string): string {
  const words = ['amber', 'basalt', 'cinder', 'drift', 'ember', 'flux', 'gale', 'haze', 'ion', 'jolt', 'kiln', 'lumen', 'murk', 'nova', 'onyx', 'pulse'];
  const rng = createRng(entropy);
  return `${rng.pick(words)}-${rng.pick(words)}-${rng.range(100, 999)}`;
}
