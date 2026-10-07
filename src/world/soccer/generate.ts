import names from '../../../content/soccer/names.json';
import { createRng, type Rng } from '../../engine/core/rng';
import type { Drive, SoccerLeague, SoccerPlayer, SoccerPosition, SoccerRatingKey, SoccerRatings, SoccerTeam, Style } from '../../engine/soccer/types';

export const SOCCER_RATING_KEYS: SoccerRatingKey[] = [
  'finishing', 'dribbling', 'firstTouch', 'passing', 'vision', 'tackling', 'positioning', 'aerial',
  'pace', 'stamina', 'composure', 'reflexes', 'handling',
];

/** Squad shape (§B4): 5 starters K, A, W, W, P, then reserves: a backup keeper and two outfielders. */
export const SQUAD_POSITIONS: SoccerPosition[] = ['K', 'A', 'W', 'W', 'P', 'K', 'A', 'W'];
export const STYLES: Style[] = ['allOutAttack', 'counterPunch', 'possessionWall', 'longBallSiege', 'parkTheBus'];
export const DRIVES: Drive[] = ['selfish', 'conductor', 'predator', 'wall', 'showboat', 'ice', 'spark'];

/** Rating biases per position: what each role is built for. Keeping ratings are near-useless outfield. */
const BIAS: Record<SoccerPosition, Partial<Record<SoccerRatingKey, number>>> = {
  K: { reflexes: 14, handling: 12, positioning: 6, finishing: -25, dribbling: -15, pace: -10 },
  A: { tackling: 12, positioning: 10, aerial: 8, passing: 4, finishing: -8, reflexes: -30, handling: -30 },
  W: { pace: 12, dribbling: 10, stamina: 8, passing: 4, reflexes: -30, handling: -30 },
  P: { finishing: 12, firstTouch: 10, composure: 6, aerial: 4, tackling: -8, reflexes: -30, handling: -30 },
};

/** Drives each position tends toward (repeats weight the draw). Keepers are Walls, Ice or Sparks. */
const DRIVE_POOL: Record<SoccerPosition, Drive[]> = {
  K: ['wall', 'wall', 'ice', 'spark'],
  A: ['wall', 'wall', 'conductor', 'ice', 'spark'],
  W: ['conductor', 'showboat', 'selfish', 'spark', 'ice', 'predator'],
  P: ['predator', 'predator', 'selfish', 'selfish', 'ice', 'showboat', 'spark'],
};

function roll(rng: Rng, bias = 0): number {
  const v = Math.floor((rng.int(101) + rng.int(101) + rng.int(101)) / 3) + bias;
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

export function makeSoccerRatings(rng: Rng, position: SoccerPosition): SoccerRatings {
  const r = {} as SoccerRatings;
  for (const k of SOCCER_RATING_KEYS) r[k] = roll(rng, BIAS[position][k] ?? 0);
  return r;
}

export function makeSoccerPlayer(rng: Rng, id: string, teamId: string, position: SoccerPosition, used: Set<string>): SoccerPlayer {
  let name = '';
  for (let tries = 0; tries < 50; tries++) {
    name = `${rng.pick(names.first)} ${rng.pick(names.last)}`;
    if (!used.has(name)) break;
  }
  used.add(name);
  return {
    id,
    name,
    teamId,
    position,
    drive: rng.pick(DRIVE_POOL[position]),
    ratings: makeSoccerRatings(rng, position),
    catchphrase: rng.pick(names.catchphrases),
  };
}

export const abbrOf = (city: string) => city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();

export interface SoccerLeagueOptions {
  seed: string;
  name?: string;
  /** 8 / 12 / 16 (default 12, PRD §B1). */
  teamCount?: number;
}

export function generateSoccerLeague(opts: SoccerLeagueOptions): SoccerLeague {
  const rng = createRng('soccer-league', opts.seed);
  const count = opts.teamCount ?? 12;
  const cities = [...names.cities];
  const clubs = [...names.clubs];
  const used = new Set<string>();
  const teams: SoccerTeam[] = [];
  const players: Record<string, SoccerPlayer> = {};
  for (let t = 0; t < count; t++) {
    const city = cities.splice(rng.int(cities.length), 1)[0];
    const club = clubs.splice(rng.int(clubs.length), 1)[0];
    const id = `t${t + 1}`;
    const squad = SQUAD_POSITIONS.map((pos, i) => {
      const p = makeSoccerPlayer(rng, `${id}p${i + 1}`, id, pos, used);
      players[p.id] = p;
      return p.id;
    });
    teams.push({
      id,
      city,
      name: club,
      abbr: abbrOf(city),
      colors: names.colors[t % names.colors.length] as [string, string],
      style: rng.pick(STYLES),
      squad,
      fanSize: rng.range(40, 100),
    });
  }
  return { seed: opts.seed, name: opts.name ?? 'The Assembly', teams, players };
}
