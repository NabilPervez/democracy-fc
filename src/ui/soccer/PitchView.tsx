import { getArena, getSignature } from '../../engine/soccer/arenas';
import type { SoccerLeague } from '../../engine/soccer/types';
import { FLOOR, type PitchFrame } from '../pitch/pitchState';

/**
 * The walled arena (PRD §B10a, "Assembly Arena View" mockup): a 400 × 240 floor split into
 * DEF / MID / ATT thirds, rounded walls, every player as a lettered token with their surname,
 * the ball, the defending block band, bank and shot lines, transition flashes and Director
 * effects. aria-hidden: the play log is the accessible source.
 */

export const VIEW_COLOR = 'var(--primary)';
export const OPP_COLOR = '#B9C2D6';
const BLOCK_LABEL = { high: 'HIGH BLOCK', mid: 'MID BLOCK', low: 'LOW BLOCK' } as const;
const DIRECTOR = '#2E8BFF';

export function PitchView({ frame, league, arenaId, viewClubId, abbr }: {
  frame: PitchFrame;
  league: SoccerLeague;
  arenaId: string;
  viewClubId: string;
  abbr: Record<string, string>;
}) {
  const arena = getArena(arenaId);
  const colorOf = (teamId: string) => (teamId === viewClubId ? VIEW_COLOR : OPP_COLOR);
  const wall = arena.wall === 'concrete' ? '#7C828D' : arena.wall === 'mirror' ? '#C9E3FF' : arena.wall === 'frosted' ? '#DFF4FF' : '#5C6578';
  const rx = arena.shape === 'octagon' ? 34 : 16;
  const narrowY = arena.shape === 'narrow' ? 22 : 0;
  const overlay = frame.overlay;
  const surname = (id: string) => (league.players[id]?.name ?? '').split(' ').slice(-1)[0];
  const banner =
    overlay.kind === 'goal' ? { text: `GOAL · ${surname(overlay.scorerId).toUpperCase()}`, bg: VIEW_COLOR, fg: '#111' }
    : overlay.kind === 'transition' ? { text: overlay.label, bg: '#fff', fg: '#111' }
    : overlay.kind === 'setPiece' ? { text: overlay.label, bg: 'var(--amber)', fg: '#111' }
    : overlay.kind === 'facility' ? { text: overlay.eventId ? overlay.eventId.replace(/-/g, ' ').toUpperCase() : overlay.text, bg: DIRECTOR, fg: '#fff' }
    : overlay.kind === 'signature' ? { text: `${(getSignature(overlay.signatureId)?.name ?? 'SIGNATURE').toUpperCase()} · ${surname(overlay.playerId).toUpperCase()}`, bg: DIRECTOR, fg: '#fff' }
    : overlay.kind === 'awakening' ? { text: `AWAKENING · ${surname(overlay.playerId).toUpperCase()}`, bg: 'var(--secondary)', fg: '#111' }
    : overlay.kind === 'card' ? { text: overlay.color === 'red' ? 'RED CARD' : 'YELLOW CARD', bg: overlay.color === 'red' ? 'var(--bad)' : 'var(--amber)', fg: '#111' }
    : null;
  const lit = frame.litThird;
  const director = overlay.kind === 'facility';

  return (
    <div className="arena" aria-hidden="true">
      <svg viewBox={`0 0 ${FLOOR.w} ${FLOOR.h}`} role="presentation">
        <rect x={6} y={6 + narrowY} width={388} height={228 - narrowY * 2} rx={rx} fill="#0E1611" stroke={wall} strokeWidth={4} />
        {/* The third holding the ball, in the colour of the side in possession. */}
        {lit && <rect x={8 + lit.index * 128} y={8 + narrowY} width={128} height={224 - narrowY * 2} fill={colorOf(lit.teamId)} opacity={0.1} />}
        {[136, 264].map((x) => <line key={x} x1={x} y1={8} x2={x} y2={232} stroke="#22302A" strokeDasharray="4 6" />)}
        <line x1={200} y1={8} x2={200} y2={232} stroke="#3A4A42" />
        <circle cx={200} cy={120} r={26} fill="none" stroke="#3A4A42" />
        <path d="M8 70 h45 a20 20 0 0 1 20 20 v60 a20 20 0 0 1 -20 20 h-45" fill="none" stroke="#3A4A42" />
        <path d="M392 70 h-45 a20 20 0 0 0 -20 20 v60 a20 20 0 0 0 20 20 h45" fill="none" stroke="#3A4A42" />
        <rect x={0} y={98} width={8} height={44} fill={VIEW_COLOR} opacity={0.55} />
        <rect x={392} y={98} width={8} height={44} fill={OPP_COLOR} opacity={0.55} />
        <circle cx={65} cy={120} r={2} fill="#5C6578" />
        <circle cx={335} cy={120} r={2} fill="#5C6578" />
        {(['DEF', 'MID', 'ATT'] as const).map((t, i) => (
          <text key={t} x={72 + i * 128} y={226} textAnchor="middle" fill="#4B5A52" fontSize={9} fontFamily="var(--mono)" letterSpacing={2}>
            {t}
          </text>
        ))}
        {frame.wallShift && <rect x={6} y={6} width={388} height={16} fill={DIRECTOR} opacity={0.35} />}
        {/* Defending block. */}
        {frame.block && (
          <>
            <rect x={frame.block.x0} y={20} width={frame.block.x1 - frame.block.x0} height={200} rx={6} fill="#3A3F4B" opacity={0.35} />
            <text x={(frame.block.x0 + frame.block.x1) / 2} y={18} textAnchor="middle" fill="#9097A6" fontSize={8} fontFamily="var(--mono)" letterSpacing={1.5}>
              {abbr[frame.block.teamId]} {BLOCK_LABEL[frame.block.depth]}
            </text>
          </>
        )}
        {/* Effects. */}
        {frame.bank && <polyline points={frame.bank.map((p) => p.join(',')).join(' ')} fill="none" stroke={overlay.kind === 'signature' ? DIRECTOR : '#fff'} strokeWidth={2} strokeDasharray="5 4" />}
        {frame.shotLine && <line x1={frame.shotLine.from[0]} y1={frame.shotLine.from[1]} x2={frame.shotLine.to[0]} y2={frame.shotLine.to[1]} stroke={frame.shotLine.goal ? VIEW_COLOR : '#fff'} strokeWidth={2.5} />}
        {frame.flash && <circle className="flash" cx={frame.flash[0]} cy={frame.flash[1]} r={14} fill="none" stroke="#fff" strokeWidth={2.5} />}
        {frame.spot && <circle cx={frame.spot[0]} cy={frame.spot[1]} r={3} fill="var(--amber)" />}
        {director && <rect x={6} y={6} width={388} height={228} rx={16} fill="none" stroke={DIRECTOR} strokeWidth={4} />}
        {/* Players. */}
        {frame.tokens.map((t) => (
          <g key={`${t.teamId}-${t.role}`} className="tween" style={{ transform: `translate(${t.x}px, ${t.y}px)` }}>
            <circle r={11} fill={t.empty ? 'none' : colorOf(t.teamId)} stroke={t.empty ? colorOf(t.teamId) : t.carrier ? '#fff' : '#06110B'} strokeWidth={2} strokeDasharray={t.empty ? '3 3' : undefined} />
            {!t.empty && (
              <text y={3.5} textAnchor="middle" fontSize={9} fontWeight={700} fontFamily="var(--display)" fill="#111">
                {t.slot}
              </text>
            )}
            <text y={21} textAnchor="middle" fontSize={7.5} fill="#C9CDD8">
              {t.empty ? 'short' : surname(t.id)}
            </text>
          </g>
        ))}
        <circle className="tween" r={4.5} fill="#fff" stroke="#111" strokeWidth={1.5} style={{ transform: `translate(${frame.ball.x}px, ${frame.ball.y}px)` }} />
        <rect x={6} y={6} width={388} height={228} rx={16} fill="#000" opacity={frame.dark ? 0.45 : 0} style={{ transition: 'opacity .4s' }} pointerEvents="none" />
      </svg>
      {banner && (
        <div className="arena-banner" style={{ background: banner.bg, color: banner.fg }}>
          {banner.text}
        </div>
      )}
    </div>
  );
}
