import { createRng } from '../engine/core/rng';
import type { Election } from './elections';
import type { Faction } from './factions';
import { PERSONAS, type Persona } from './persona';

/**
 * Factions react to the world — and, once you matter, to you by name (PRD §7, §11).
 * Each faction keeps an opinion of the player (-5..5) that moves with how you vote and spend.
 * Pure and seeded: the same history always produces the same headlines.
 */

export const OPINION_MIN = -5;
export const OPINION_MAX = 5;
/** Lifetime votes cast before factions start naming you in headlines. */
export const NAMED_AFTER_VOTES = 12;

export interface FactionNews {
  factionId: string;
  text: string;
}

export interface Reaction {
  news: FactionNews[];
  opinion: Record<string, number>;
}

export interface FanContext {
  persona: Persona | null;
  /** Votes the player has bought across all elections. */
  lifetimeVotes: number;
  opinion: Record<string, number>;
}

export function opinionLabel(n: number): string {
  if (n >= 4) return 'Adores you';
  if (n >= 2) return 'Fond of you';
  if (n <= -4) return 'Despises you';
  if (n <= -2) return 'Wary of you';
  return 'Neutral';
}

const clampOpinion = (n: number) => Math.max(OPINION_MIN, Math.min(OPINION_MAX, n));

function bump(opinion: Record<string, number>, deltas: Record<string, number>): Record<string, number> {
  const next = { ...opinion };
  for (const [id, d] of Object.entries(deltas)) if (d) next[id] = clampOpinion((next[id] ?? 0) + d);
  return next;
}

/** How the faction would refer to the player, or null if the player isn't famous enough yet. */
function fanName(fan: FanContext, force = false): string | null {
  if (!fan.persona?.fanName) return null;
  if (!force && fan.lifetimeVotes < NAMED_AFTER_VOTES) return null;
  return `${PERSONAS[fan.persona.kind].label.replace(/^The /, 'the ')} ${fan.persona.fanName}`;
}

/** Fill a template. A faction named mid-sentence reads "the Purists", at the start "The Purists". */
const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string, offset: number) => {
    const v = vars[k] ?? '';
    return k === 'faction' && offset > 0 ? v.replace(/^The /, 'the ') : v;
  });

const WIN = [
  '{faction} are celebrating “{proposal}”. “The people have spoken,” says a spokesperson, loudly.',
  '{faction} toast the passing of “{proposal}”.',
  '“Exactly as we planned,” claim {faction} after “{proposal}” passes.',
];
const LOSE = [
  '{faction} call the result “a dark day for Blastball”.',
  '{faction} demand a recount. There will be no recount.',
  '{faction} vow to remember this election.',
];
const THANK_FAN = [
  '{faction} credit {fan} with tipping the scales: “A true fan.”',
  '{faction} are printing {fan}’s name on a banner.',
];
const BLAME_FAN = [
  '{faction} blame {fan}: “We won’t forget this.”',
  '{faction} have started a chant about {fan}. It is not flattering.',
];
const NOTICE_FAN = ['{faction} have noticed {fan} buying votes. They’re watching.'];

/** Reactions to an election result. */
export function reactToElection(factions: Faction[], e: Election, winner: number, swung: boolean, fan: FanContext, seed: string): Reaction {
  const rng = createRng(seed, 'faction-news', e.season, e.id);
  const top = (f: Faction) => {
    const votes = e.factionVotes[f.id];
    return votes.indexOf(Math.max(...votes));
  };
  const playerTotal = e.playerVotes.reduce((a, b) => a + b, 0);
  const playerPick = playerTotal ? e.playerVotes.indexOf(Math.max(...e.playerVotes)) : -1;

  // Opinion: factions like players who vote their way, and dislike those who vote against them.
  const deltas: Record<string, number> = {};
  if (playerPick >= 0) for (const f of factions) deltas[f.id] = top(f) === playerPick ? 1 : -1;
  const opinion = bump(fan.opinion, deltas);

  const winners = factions.filter((f) => top(f) === winner);
  const losers = factions.filter((f) => top(f) !== winner);
  const proposal = e.proposals[winner].title;
  const news: FactionNews[] = [];
  const name = fanName(fan, swung);

  if (winners.length) {
    const f = rng.pick(winners);
    const thanked = name && playerPick === winner;
    news.push({ factionId: f.id, text: fill(rng.pick(thanked ? THANK_FAN : WIN), { faction: f.name, proposal, fan: name ?? '' }) });
  }
  if (losers.length) {
    const f = rng.pick(losers);
    const blamed = name && playerPick === winner && swung;
    news.push({ factionId: f.id, text: fill(rng.pick(blamed ? BLAME_FAN : LOSE), { faction: f.name, proposal, fan: name ?? '' }) });
  }
  if (name && !swung && playerTotal > 0 && rng.chance(350)) {
    const f = rng.pick(factions);
    news.push({ factionId: f.id, text: fill(rng.pick(NOTICE_FAN), { faction: f.name, fan: name }) });
  }
  return { news, opinion };
}

const byId = (factions: Faction[], id: string) => factions.find((f) => f.id === id);

/** A player departs: the Lore Divers mourn; a fan faction of their team grieves. */
export function reactToDeath(factions: Faction[], playerName: string, teamId: string, teamName: string, seed: string, season: number, day: number): FactionNews[] {
  const rng = createRng(seed, 'faction-death', season, day);
  const fans = factions.filter((f) => f.favoriteTeams.includes(teamId));
  const f = fans.length ? rng.pick(fans) : byId(factions, 'lore');
  if (!f) return [];
  const lines = fans.length
    ? ['{faction} hold a candlelight vigil for {player} outside the {team} stadium.', '{faction} retire {player}’s number in their hearts.']
    : ['{faction} have already started a petition to bring {player} back.', '{faction} add {player} to the lore. “This isn’t the end.”'];
  return [{ factionId: f.id, text: fill(rng.pick(lines), { faction: f.name, player: playerName, team: teamName }) }];
}

/** A player returns: the Lore Divers rejoice, the Purists grumble. */
export function reactToReturn(factions: Faction[], playerName: string, seed: string, season: number, day: number): FactionNews[] {
  const rng = createRng(seed, 'faction-return', season, day);
  const out: FactionNews[] = [];
  const lore = byId(factions, 'lore');
  const purists = byId(factions, 'purists');
  if (lore) out.push({ factionId: lore.id, text: `${lore.name}: “We told you ${playerName} would be back.”` });
  if (purists && rng.chance(600)) out.push({ factionId: purists.id, text: `${purists.name} call ${playerName}’s return “deeply unnatural”.` });
  return out;
}

/** The Cup is won. */
export function reactToChampion(factions: Faction[], teamId: string, teamName: string, seed: string, season: number): FactionNews[] {
  const rng = createRng(seed, 'faction-champ', season);
  const fans = factions.filter((f) => f.favoriteTeams.includes(teamId));
  if (fans.length) {
    const f = rng.pick(fans);
    return [{ factionId: f.id, text: `${f.name} flood the streets: the ${teamName} are champions!` }];
  }
  const casuals = byId(factions, 'casuals');
  return casuals ? [{ factionId: casuals.id, text: `${casuals.name} say they always liked the ${teamName}. They did not.` }] : [];
}

/** The player sponsors a team: its fans love it, the Purists call it buying wins. */
export function reactToPatron(factions: Faction[], teamId: string, teamName: string, fan: FanContext, seed: string, season: number): Reaction {
  const rng = createRng(seed, 'faction-patron', season);
  const name = fanName(fan, true) ?? 'A new Patron';
  const deltas: Record<string, number> = {};
  const news: FactionNews[] = [];
  for (const f of factions) {
    if (f.favoriteTeams.includes(teamId)) deltas[f.id] = 2;
    else if (f.id === 'purists') deltas[f.id] = -1;
  }
  const fans = factions.filter((f) => f.favoriteTeams.includes(teamId));
  if (fans.length) {
    const f = rng.pick(fans);
    news.push({ factionId: f.id, text: `${f.name} salute ${name}, new Patron of the ${teamName}.` });
  }
  const purists = byId(factions, 'purists');
  if (purists) news.push({ factionId: purists.id, text: `${purists.name}: “${name} is trying to buy the Cup.”` });
  return { news, opinion: bump(fan.opinion, deltas) };
}
