import type { ScheduledGame } from '../engine/baseball/types';
import { isRivalry } from '../world/teams';
import { RULES, type UniverseState } from '../world/universe';
import { findPlayerMod, isActiveMod } from '../world/weird';
import type { NarrativeExtras } from './context';

/** The universe facts play-by-play text uses: stadium, rivalry, favorite team, named mods. */
export function narrativeExtras(u: UniverseState, game: ScheduledGame): NarrativeExtras {
  return {
    stadium: u.weird.stadiums[game.homeId]?.name,
    rivalry: isRivalry(u.h2h, game.awayId, game.homeId),
    favoriteTeamId: u.persona?.favoriteTeamId ?? null,
    modName: (playerId) => {
      const held = (u.weird.playerMods[playerId] ?? []).find((m) => isActiveMod(m, u.season, game.day));
      return held ? (findPlayerMod(RULES, held.id)?.name ?? null) : null;
    },
  };
}
