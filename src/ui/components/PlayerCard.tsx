import { useMemo, useState, type ReactNode } from 'react';
import { createRng } from '../../engine/core/rng';
import { stars } from '../../engine/season';
import type { Player, Team } from '../../engine/baseball/types';
import { flavorOf, RARITY_LABEL, rarityOf, TIER_LABEL, tierOf, type Rarity, type Tier } from '../../world/rarity';
import { careerPhase, PHASE_LABEL } from '../../world/seasons';
import type { UniverseState } from '../../world/universe';
import { Stars } from './bits';
import { playerModsOf, type ShownMod } from './Mods';
import { deltaNote, describeDelta, GROUP_HELP } from '../../world/statHelp';

const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** Everything a card needs to know about a player's place in this universe. */
export function cardPropsFor(u: UniverseState, playerId: string) {
  const age = u.ages[playerId];
  const exp = u.experience?.[playerId];
  const retired = u.weird.playerStatus[playerId] === 'retired';
  return {
    player: u.league.players[playerId],
    team: u.league.teams.find((t) => t.id === u.league.players[playerId].teamId)!,
    rarity: rarityOf(u, playerId),
    tier: tierOf(u, playerId),
    mods: playerModsOf(u, playerId),
    collected: u.collection?.some((c) => c.playerId === playerId) ?? false,
    career:
      age === undefined
        ? undefined
        : retired
          ? `Retired at ${age}`
          : `Age ${age}${exp === undefined ? '' : ` · ${ordinal(exp + 1)} season`} · ${PHASE_LABEL[careerPhase(age)]}`,
  };
}

/** Procedural geometric portrait: same player id ⇒ same art, works offline, scales to any roster size. */
export function CardArt({ player, team }: { player: Player; team: Team }) {
  const art = useMemo(() => {
    const rng = createRng(player.id, 'card-art');
    return {
      pattern: rng.int(4),
      angle: rng.range(-30, 30),
      head: rng.range(11, 14),
      shoulders: rng.range(24, 32),
      hat: rng.int(3),
      tilt: rng.range(-6, 6),
      orbs: Array.from({ length: 3 }, () => ({ x: rng.range(5, 95), y: rng.range(5, 60), r: rng.range(3, 12) })),
    };
  }, [player.id]);
  const [main, dark] = team.colors;
  const pid = `p-${player.id}`;
  return (
    <svg viewBox="0 0 100 100" className="card-art" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={pid} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform={`rotate(${art.angle})`}>
          {art.pattern === 0 && <rect width="4" height="10" fill={main} opacity="0.18" />}
          {art.pattern === 1 && <circle cx="5" cy="5" r="1.6" fill={main} opacity="0.3" />}
          {art.pattern === 2 && <path d="M0 10 L5 0 L10 10" stroke={main} strokeWidth="1.2" fill="none" opacity="0.25" />}
          {art.pattern === 3 && <rect x="0" y="0" width="5" height="5" fill={main} opacity="0.14" />}
        </pattern>
        <linearGradient id={`${pid}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dark} />
          <stop offset="1" stopColor="#0b0b0f" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${pid}-g)`} />
      <rect width="100" height="100" fill={`url(#${pid})`} />
      {art.orbs.map((o, i) => (
        <circle key={i} cx={o.x} cy={o.y} r={o.r} fill={main} opacity="0.12" />
      ))}
      <g transform={`rotate(${art.tilt} 50 70)`}>
        <path d={`M${50 - art.shoulders} 104 Q${50 - art.shoulders} 74 50 72 Q${50 + art.shoulders} 74 ${50 + art.shoulders} 104 Z`} fill={main} opacity="0.9" />
        <circle cx="50" cy={66 - art.head} r={art.head} fill={main} />
        {art.hat === 0 && <path d={`M${50 - art.head} ${62 - art.head} Q50 ${38 - art.head * 1.3} ${50 + art.head} ${62 - art.head} L${50 + art.head + 7} ${64 - art.head} Z`} fill={dark} opacity="0.85" />}
        {art.hat === 1 && <rect x={50 - art.head} y={64 - art.head * 2} width={art.head * 2} height="6" rx="3" fill={dark} opacity="0.85" />}
      </g>
    </svg>
  );
}

interface CardProps {
  player: Player;
  team: Team;
  rarity: Rarity;
  /** Weirdness tier: sets the border. */
  tier?: Tier;
  /** Age / season / career phase line. */
  career?: string;
  /** In the fan's keepsake collection. */
  collected?: boolean;
  size?: 'sm' | 'lg';
  /** Back face content; when given, tapping the card flips it. */
  back?: ReactNode;
  /** Extra line under the star groups (e.g. an Analyst's revealed hidden stat). */
  extra?: ReactNode;
  mods?: ShownMod[];
  onOpen?: () => void;
}

/** Trait chips: named, so a card says who the player is at a glance. */
function Traits({ mods, max, role }: { mods: ShownMod[]; max: number; role: 'batter' | 'pitcher' }) {
  if (!mods.length) return null;
  const shown = mods.slice(0, max);
  return (
    <span className="pc-traits">
      {shown.map((m) => (
        <span key={m.def.id} className={`pc-trait ${m.def.comboOnly ? 'combo' : ''}`} title={[`${m.def.name}: ${m.def.description}`, describeDelta(m.def.delta), deltaNote(m.def.delta, role)].filter(Boolean).join(' ')}>
          <span aria-hidden="true">{m.def.icon}</span> {m.def.name}
        </span>
      ))}
      {mods.length > max && <span className="pc-trait more">+{mods.length - max}</span>}
    </span>
  );
}

export function PlayerCard({ player, team, rarity, tier = 'common', career, collected, size = 'sm', back, extra, mods = [], onOpen }: CardProps) {
  const [flipped, setFlipped] = useState(false);
  const pitcher = player.role === 'pitcher';
  const groups = pitcher
    ? ([['pitching', 'PIT'], ['defense', 'DEF']] as const)
    : ([['batting', 'BAT'], ['baserunning', 'RUN'], ['defense', 'DEF']] as const);

  const front = (
    <div className="pc-face pc-front">
      <div className="pc-art">
        <CardArt player={player} team={team} />
        <span className="pc-pos">{player.position}</span>
        <span className="pc-rarity">{TIER_LABEL[tier]}</span>
        {collected && (
          <span className="pc-collected" title="In your collection" aria-label="In your collection">
            ♥
          </span>
        )}
      </div>
      <div className="pc-body">
        <strong className="pc-name display">{player.name}</strong>
        <span className="pc-team muted">
          {team.city} {team.name}
        </span>
        <span className="pc-career">
          <strong>{RARITY_LABEL[rarity]}</strong>
          {career && ` · ${career}`}
        </span>
        <Traits mods={mods} max={size === 'lg' ? 8 : 2} role={player.role} />
        <div className="pc-stars">
          {groups.map(([g, label]) => (
            <span key={g} className="pc-star-row" title={GROUP_HELP[g]}>
              <span className="pc-star-label">{label}</span>
              <Stars value={stars(player, g)} label={label} />
            </span>
          ))}
        </div>
        {size === 'lg' && <em className="pc-flavor">“{flavorOf(player.id)}”</em>}
        {extra}
      </div>
    </div>
  );
  const cls = `player-card ${size} r-${rarity} t-${tier} ${mods.map((m) => `m-${m.def.id}`).join(' ')}`;

  const label = `${player.name}, ${player.position}, ${team.name}, ${TIER_LABEL[tier]} ${RARITY_LABEL[rarity]}${mods.length ? `, traits: ${mods.map((m) => m.def.name).join(', ')}` : ''}`;
  if (onOpen) {
    return (
      <button className={cls} style={{ ['--team' as string]: team.colors[0] }} onClick={onOpen} aria-label={label}>
        {front}
      </button>
    );
  }
  return (
    <div className={`${cls} ${back ? 'flippable' : ''} ${flipped ? 'flipped' : ''}`} style={{ ['--team' as string]: team.colors[0] }}>
      <div className="pc-inner">
        {front}
        {back && <div className="pc-face pc-back">{back}</div>}
      </div>
      {back && (
        <button className="pc-flip chip" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped} aria-label={flipped ? `Show front of ${player.name}'s card` : `Flip ${player.name}'s card for stats`}>
          ⟲ {flipped ? 'Front' : 'Stats'}
        </button>
      )}
    </div>
  );
}
