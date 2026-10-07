import names from '../../content/names.json';
import { createRng } from '../engine/core/rng';
import type { League, Player, Role, Team } from '../engine/baseball/types';
import { LINEUP_SIZE, makeRatings, ROTATION_SIZE, uniqueName } from './generate';

/**
 * Relegation: when a season ends, the last-place team is dissolved. Its slot in the league is
 * taken by a brand-new franchise — new city, name, colors and a whole new roster. The slot keeps
 * its id so schedules, fan factions and history tables keep working; old players keep their stats
 * and are marked as no longer playing.
 */

const EXTRA_CITIES = ['Hollowmere', 'Cinder Flats', 'Brass Harbor', 'Wickerton', 'Fogbank', 'Lantern Cove', 'Marrowgate', 'Thistledown', 'Copperline', 'Rook Hill', 'Starling Bay', 'Pale Creek', 'Ironvale', 'Murmur Springs', 'Gloam City', 'Saffron Reach'];
const EXTRA_MASCOTS = ['Foghorns', 'Magpies', 'Wraiths', 'Pistons', 'Badgers', 'Meteors', 'Lamplighters', 'Krakens', 'Typhoons', 'Gargoyles', 'Sparrows', 'Golems', 'Locksmiths', 'Mirages', 'Beacons', 'Yetis'];
const BATTER_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

export interface Relegation {
  league: League;
  oldTeam: Team;
  newTeam: Team;
  /** Players who left the league with the old team. */
  removed: string[];
  /** The new roster. */
  added: string[];
}

export function relegate(league: League, teamId: string, seed: string, season: number): Relegation {
  const rng = createRng(seed, season, 'relegation', teamId);
  const oldTeam = league.teams.find((t) => t.id === teamId)!;
  const usedCities = new Set(league.teams.map((t) => t.city));
  const usedMascots = new Set(league.teams.map((t) => t.name));
  const freshCity = [...names.cities, ...EXTRA_CITIES].filter((c) => !usedCities.has(c));
  const freshMascot = [...names.mascots, ...EXTRA_MASCOTS].filter((m) => !usedMascots.has(m));
  const city = freshCity.length ? rng.pick(freshCity) : `New ${oldTeam.city}`;
  const mascot = freshMascot.length ? rng.pick(freshMascot) : `${oldTeam.name} II`;
  const colors = rng.pick(names.colors.filter((c) => c[0] !== oldTeam.colors[0])) as [string, string];

  const used = new Set(Object.values(league.players).map((p) => p.name));
  const players: Record<string, Player> = { ...league.players };
  const lineup: string[] = [];
  const rotation: string[] = [];
  for (let i = 0; i < LINEUP_SIZE + ROTATION_SIZE; i++) {
    const role: Role = i < LINEUP_SIZE ? 'batter' : 'pitcher';
    const id = `${teamId}n${season}p${i + 1}`;
    players[id] = { id, name: uniqueName(rng, used), teamId, role, position: role === 'batter' ? BATTER_POSITIONS[i] : `SP${i - LINEUP_SIZE + 1}`, ratings: makeRatings(rng, role) };
    (role === 'batter' ? lineup : rotation).push(id);
  }
  const newTeam: Team = {
    id: teamId,
    city,
    name: mascot,
    abbr: (city.replace(/[^A-Z]/g, '') + mascot[0]).slice(0, 3).padEnd(3, mascot[1].toUpperCase()),
    colors,
    lineup,
    rotation,
  };
  return {
    league: { ...league, players, teams: league.teams.map((t) => (t.id === teamId ? newTeam : t)) },
    oldTeam,
    newTeam,
    removed: [...oldTeam.lineup, ...oldTeam.rotation],
    added: [...lineup, ...rotation],
  };
}
