import type React from 'react';
import type { Bases, Team } from '../../engine/baseball/types';

export function Stars({ value, label }: { value: number; label: string }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <span className="stars" aria-label={`${label}: ${value} out of 5 stars`} title={`${label} ${value}★`}>
      {'★'.repeat(full)}
      {half ? <span className="star-half">★</span> : ''}
      <span className="stars-empty">{'☆'.repeat(5 - full - (half ? 1 : 0))}</span>
    </span>
  );
}

export function TeamBadge({ team, size = 32 }: { team: Team; size?: number }) {
  return (
    <span
      className="team-badge"
      style={{ width: size, height: size, background: team.colors[1], color: team.colors[0], borderColor: team.colors[0], fontSize: size * 0.34 }}
      aria-hidden="true"
    >
      {team.abbr}
    </span>
  );
}

export function BaseDiamond({ bases }: { bases: Bases }) {
  const label = ['first', 'second', 'third'].filter((_, i) => bases[i]).join(', ');
  const base = (on: boolean, x: number, y: number) => (
    <rect x={x - 7} y={y - 7} width="14" height="14" transform={`rotate(45 ${x} ${y})`} className={on ? 'base on' : 'base'} />
  );
  return (
    <svg viewBox="0 0 60 44" width="60" height="44" role="img" aria-label={label ? `Runners on ${label}` : 'Bases empty'}>
      {base(!!bases[1], 30, 10)}
      {base(!!bases[2], 12, 28)}
      {base(!!bases[0], 48, 28)}
    </svg>
  );
}

export function Outs({ outs }: { outs: number }) {
  return (
    <span className="outs" aria-label={`${outs} out${outs === 1 ? '' : 's'}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < outs ? 'dot on' : 'dot'} />
      ))}
    </span>
  );
}

/** Hover (or tap/focus on touch screens) to read an explanation. */
export function Tip({ text, children, className = '' }: { text: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={`tip ${className}`} tabIndex={0} data-tip={text} aria-label={typeof children === 'string' ? `${children}: ${text}` : undefined}>
      {children}
    </span>
  );
}
