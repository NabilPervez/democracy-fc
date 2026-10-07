import { getArena } from '../../engine/soccer/arenas';
import { getSignature } from '../../engine/soccer/arenas';
import type { SoccerLeague } from '../../engine/soccer/types';
import type { PitchFrame } from '../pitch/pitchState';

/**
 * The walled arena (PRD §B10a): SVG, no canvas, no physics. All ten players at engine-derived
 * spots, the ball, the defending block as a band, the lit third, and phase overlays.
 * aria-hidden: the play log is the accessible source.
 */

const W = 100;
const H = 56;
const ys = (y: number) => 4 + (y / 100) * (H - 8);
const xs = (x: number) => 4 + (x / 100) * (W - 8);

const SHOT_GLYPH: Record<string, string> = { goal: '⚽', saved: '🧤', wide: '✕', woodwork: '▮', blocked: '◼' };

export function PitchView({ frame, league, arenaId, colors }: { frame: PitchFrame; league: SoccerLeague; arenaId: string; colors: Record<string, string> }) {
  const arena = getArena(arenaId);
  const narrow = arena.shape === 'narrow';
  const octagon = arena.shape === 'octagon';
  const top = narrow ? 10 : 2;
  const bottom = narrow ? H - 10 : H - 2;
  const outline = octagon
    ? `M8,${top} L92,${top} L98,${top + 6} L98,${bottom - 6} L92,${bottom} L8,${bottom} L2,${bottom - 6} L2,${top + 6} Z`
    : `M2,${top} L98,${top} L98,${bottom} L2,${bottom} Z`;
  const wallColor = arena.wall === 'concrete' ? '#8a8f99' : arena.wall === 'mirror' ? '#c9e3ff' : arena.wall === 'frosted' ? '#dff4ff' : arena.wall === 'steel' ? '#9aa3b3' : '#5fb0ff';
  const overlay = frame.overlay;
  const banner =
    overlay.kind === 'goal' ? { cls: 'goal', text: 'GOAL' }
    : overlay.kind === 'transition' ? { cls: 'transition', text: overlay.label }
    : overlay.kind === 'setPiece' ? { cls: 'transition', text: overlay.label }
    : overlay.kind === 'facility' ? { cls: 'facility', text: overlay.text }
    : overlay.kind === 'signature' ? { cls: 'signature', text: `★ ${getSignature(overlay.signatureId)?.name ?? 'Signature'}` }
    : overlay.kind === 'awakening' ? { cls: 'signature', text: '✷ AWAKENING' }
    : overlay.kind === 'card' ? { cls: 'transition', text: overlay.color === 'red' ? 'RED CARD' : 'YELLOW CARD' }
    : null;
  const shot = overlay.kind === 'shot' ? overlay : null;
  const lit = frame.litThird;
  const blockY0 = ys(top + 2);

  return (
    <div className="pitch-wrap" aria-hidden="true">
      <svg className="pitch" viewBox={`0 0 ${W} ${H}`} role="presentation">
        {/* Lit third in the attacking club's colour. */}
        {lit && <rect x={2 + lit.index * 32} y={top} width={32} height={bottom - top} fill={colors[lit.teamId] ?? '#ff7a1a'} opacity={0.12} />}
        {/* Defending block band. */}
        {frame.block && <rect x={xs(frame.block.x0)} y={blockY0} width={Math.max(2, xs(frame.block.x1) - xs(frame.block.x0))} height={bottom - top - 4} fill="#3a3f4b" opacity={0.35} />}
        {/* Floor markings. */}
        <line x1={50} y1={top} x2={50} y2={bottom} stroke="rgba(255,255,255,0.18)" strokeWidth={0.3} />
        <circle cx={50} cy={H / 2} r={6} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={0.3} />
        <rect x={2} y={H / 2 - 9} width={9} height={18} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={0.3} />
        <rect x={89} y={H / 2 - 9} width={9} height={18} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={0.3} />
        <rect x={0.5} y={H / 2 - 4} width={1.5} height={8} fill="#fff" opacity={0.6} />
        <rect x={98} y={H / 2 - 4} width={1.5} height={8} fill="#fff" opacity={0.6} />
        {/* Walls: thick outline, coloured by material. */}
        <path d={outline} fill="none" stroke={wallColor} strokeWidth={1.4} opacity={0.9} />
        {/* Bank line off a wall. */}
        {frame.bank && (
          <polyline
            points={`${xs(frame.ball.x)},${ys(frame.ball.y)} ${xs(frame.ball.x) + (frame.ball.x < 50 ? 10 : -10)},${frame.bank === 'left' ? top : bottom} ${frame.ball.x < 50 ? 98 : 2},${H / 2}`}
            fill="none" stroke="#ffc93c" strokeWidth={0.4} strokeDasharray="1 0.8"
          />
        )}
        {/* Shot line to goal. */}
        {shot && !frame.bank && <line x1={xs(frame.ball.x)} y1={ys(frame.ball.y)} x2={frame.ball.x < 50 ? 1 : 99} y2={H / 2} stroke="#fff" strokeWidth={0.35} strokeDasharray="1 0.6" />}
        {/* Players. */}
        {frame.tokens.map((t) => {
          const p = league.players[t.id];
          const initials = p ? p.name.split(' ').map((w) => w[0]).join('').slice(0, 2) : '';
          return (
            <g key={`${t.teamId}-${t.slot}-${t.id || 'empty'}`} className="tween" style={{ transform: `translate(${xs(t.x)}px, ${ys(t.y)}px)` }}>
              <circle r={2.6} fill={t.empty ? 'none' : colors[t.teamId] ?? '#999'} stroke={t.carrier ? '#fff' : 'rgba(0,0,0,0.5)'} strokeWidth={t.carrier ? 0.6 : 0.3} strokeDasharray={t.empty ? '0.8 0.6' : undefined} />
              {!t.empty && <text className="token-label">{initials}</text>}
              <text className="token-pos" y={4.4}>
                {t.slot}
              </text>
            </g>
          );
        })}
        {/* Ball. */}
        <circle className="tween" r={1} fill="#fff" stroke="#000" strokeWidth={0.2} style={{ transform: `translate(${xs(frame.ball.x)}px, ${ys(frame.ball.y)}px)` }} />
        {shot && (
          <text x={frame.ball.x < 50 ? 4 : 92} y={H / 2 - 4} fontSize={4}>
            {SHOT_GLYPH[shot.outcome]}
          </text>
        )}
      </svg>
      {banner && <div className={`pitch-banner ${banner.cls}`}>{banner.text}</div>}
    </div>
  );
}
