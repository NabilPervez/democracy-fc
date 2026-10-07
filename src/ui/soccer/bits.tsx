import type { Phase, SoccerTeam } from '../../engine/soccer/types';
import { useAssembly } from './store';

export function Crest({ team, size = 28 }: { team: Pick<SoccerTeam, 'abbr' | 'colors' | 'city' | 'name'>; size?: number }) {
  return (
    <span
      className="crest"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.36, background: team.colors[0], color: team.colors[1] }}
      title={`${team.city} ${team.name}`}
    >
      {team.abbr}
    </span>
  );
}

/** 0–5 stars in half steps, with a text label for screen readers (color is never the only signal). */
export function Stars({ value, label }: { value: number; label: string }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <span aria-label={`${label}: ${value} of 5 stars`} className="stars">
      <span aria-hidden="true">
        {'★'.repeat(full)}
        {half ? '⯨' : ''}
        <span className="stars-empty">{'☆'.repeat(5 - full - (half ? 1 : 0))}</span>
      </span>
    </span>
  );
}

export const PHASE_LABEL: Record<Phase, string> = {
  buildUp: 'Build-up',
  progression: 'Progression',
  creation: 'Creation',
  highBlock: 'High Block',
  midBlock: 'Mid Block',
  lowBlock: 'Low Block',
  attTransition: 'Attacking Transition',
  defTransition: 'Defensive Transition',
  attSetPiece: 'Set Piece',
  defSetPiece: 'Defending Set Piece',
};

const PHASE_ICON: Record<Phase, string> = {
  buildUp: '▸', progression: '▸▸', creation: '▸▸▸', highBlock: '▀', midBlock: '▬', lowBlock: '▄',
  attTransition: '⚡', defTransition: '⚡', attSetPiece: '◎', defSetPiece: '◎',
};

const phaseClass = (p: Phase) =>
  p === 'attTransition' || p === 'defTransition' ? 'transition' : p === 'attSetPiece' || p === 'defSetPiece' ? 'setpiece' : ['highBlock', 'midBlock', 'lowBlock'].includes(p) ? 'out' : 'in';

export function PhaseChip({ phase, prefix }: { phase: Phase; prefix?: string }) {
  return (
    <span className={`phase-chip ${phaseClass(phase)}`}>
      <span aria-hidden="true">{PHASE_ICON[phase]}</span>
      {prefix ? `${prefix}: ` : ''}
      {PHASE_LABEL[phase]}
    </span>
  );
}

export const DRIVE_INFO: Record<string, { icon: string; label: string; text: string }> = {
  selfish: { icon: '◉', label: 'Selfish', text: 'Shoots instead of passing.' },
  conductor: { icon: '♪', label: 'Conductor', text: 'Makes teammates better.' },
  predator: { icon: '▲', label: 'Predator', text: 'Deadly in the box, weak outside it.' },
  wall: { icon: '▮', label: 'Wall', text: 'Defends. Never shoots.' },
  showboat: { icon: '✧', label: 'Showboat', text: 'Spectacular goals and spectacular giveaways.' },
  ice: { icon: '❄', label: 'Ice', text: 'Calmest in the last ten minutes.' },
  spark: { icon: 'ϟ', label: 'Spark', text: 'Wildly up and down, match to match.' },
};

export const POSITION_LABEL: Record<string, string> = { K: 'Keeper', A: 'Anchor', W: 'Wing', P: 'Pivot' };

export function ErrorBanner() {
  const { error, clearError } = useAssembly();
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <span>{error}</span>
      <button className="chip" onClick={clearError}>
        Dismiss
      </button>
    </div>
  );
}

export function Coins() {
  const coins = useAssembly((s) => s.u?.coins ?? 0);
  return (
    <span className="chip" aria-label={`${coins} coins`}>
      ◈ {coins}
    </span>
  );
}
