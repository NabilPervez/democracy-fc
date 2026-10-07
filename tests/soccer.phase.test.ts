import { describe, expect, it } from 'vitest';
import { createRng } from '../src/engine/core/rng';
import { simulateSoccer } from '../src/engine/soccer/game';
import { ALL_PHASES, chooseBlock, phaseOf, phaseStats, validPhases } from '../src/engine/soccer/phase';
import type { Block, SoccerResult } from '../src/engine/soccer/types';
import { generateSoccerLeague } from '../src/world/soccer/generate';

const league = generateSoccerLeague({ seed: 'phases', teamCount: 12 });
const results: SoccerResult[] = Array.from({ length: 600 }, (_, i) =>
  simulateSoccer(league, { id: `p${i}`, day: 1, homeId: league.teams[i % 12].id, awayId: league.teams[(i + 1 + (i % 11)) % 12 === i % 12 ? (i + 1) % 12 : (i + 1 + (i % 11)) % 12].id }));

describe('Phase Engine (S4b)', () => {
  it('every event has a valid, consistent phase / defPhase pair', () => {
    for (const r of results.slice(0, 200)) for (const e of r.events) expect(validPhases(e), `${e.kind} ${e.phase}/${e.defPhase}`).toBe(true);
  });

  it('all 10 phases appear in a 100-match sample', () => {
    const seen = new Set<string>();
    for (const r of results.slice(0, 100)) for (const e of r.events) seen.add(e.phase).add(e.defPhase);
    expect([...seen].sort()).toEqual([...ALL_PHASES].sort());
  });

  it('phaseOf is pure and maps zones and blocks', () => {
    expect(phaseOf({ zone: 'def', block: 'high', moment: 'open' })).toEqual({ phase: 'buildUp', defPhase: 'highBlock' });
    expect(phaseOf({ zone: 'att', block: 'low', moment: 'open' })).toEqual({ phase: 'creation', defPhase: 'lowBlock' });
    expect(phaseOf({ zone: 'mid', block: 'mid', moment: 'transition' })).toEqual({ phase: 'attTransition', defPhase: 'defTransition' });
    expect(phaseOf({ zone: 'mid', block: 'mid', moment: 'setPiece' })).toEqual({ phase: 'attSetPiece', defPhase: 'defSetPiece' });
  });

  it('a High Block forces more turnovers in the opponent’s Build-up than a Low Block', () => {
    const actions: Record<Block, number> = { high: 0, mid: 0, low: 0 };
    const lost: Record<Block, number> = { high: 0, mid: 0, low: 0 };
    for (const r of results) {
      for (const e of r.events) {
        if (e.zone !== 'def' || !e.block || !['pass', 'dribble', 'longBall'].includes(e.kind)) continue;
        actions[e.block]++;
        if ('success' in e && !e.success) lost[e.block]++;
      }
    }
    const rate = (b: Block) => lost[b] / actions[b];
    expect(actions.high).toBeGreaterThan(500);
    expect(actions.low).toBeGreaterThan(500);
    expect(rate('high')).toBeGreaterThan(rate('low') * 1.3);
  });

  it('Park the Bus sits deeper than All-Out Attack; a late lead drops the block', () => {
    const rng = createRng('blocks');
    const count = (style: 'parkTheBus' | 'allOutAttack', lead = 0, secondsLeft = 1800) => {
      const c = { high: 0, mid: 0, low: 0 };
      for (let i = 0; i < 2000; i++) c[chooseBlock(rng, { style, lead, secondsLeft })]++;
      return c;
    };
    expect(count('parkTheBus').low).toBeGreaterThan(count('allOutAttack').low);
    expect(count('allOutAttack').high).toBeGreaterThan(count('parkTheBus').high);
    expect(count('allOutAttack', 2, 300).low).toBeGreaterThan(count('allOutAttack', 0, 300).low);
  });

  it('transitions are rolled on turnovers and counters produce goals', () => {
    let transitions = 0, counterGoals = 0, setPieceGoals = 0, breakaways = 0;
    for (const r of results) {
      transitions += r.events.filter((e) => e.kind === 'transition').length;
      breakaways += r.events.filter((e) => e.kind === 'transition' && e.outcome === 'breakaway').length;
      for (const t of Object.values(phaseStats(r))) {
        counterGoals += t.countersScored;
        setPieceGoals += t.setPieceGoals;
      }
    }
    expect(transitions / results.length).toBeGreaterThan(20);
    expect(breakaways).toBeGreaterThan(0);
    expect(counterGoals).toBeGreaterThan(0);
    expect(setPieceGoals).toBeGreaterThan(0);
  });

  it('phase time adds up to the match for both teams', () => {
    const r = results[0];
    const st = phaseStats(r);
    const home = Object.values(st[r.homeId].seconds).reduce((a, b) => a + b, 0);
    const away = Object.values(st[r.awayId].seconds).reduce((a, b) => a + b, 0);
    expect(home).toBe(away);
    expect(home).toBeGreaterThan(2000);
  });

  it('free kicks roll a defensive setup', () => {
    const setups = new Set(results.flatMap((r) => r.events.flatMap((e) => (e.kind === 'setPieceSetup' ? [e.setup] : []))));
    expect([...setups].sort()).toEqual(['man', 'wall', 'zonal']);
  });
});
