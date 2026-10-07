import { describe, expect, it } from 'vitest';
import raw from '../content/narrative/templates.json';
import { simulateGame } from '../src/engine/baseball/game';
import { generateSchedule } from '../src/engine/season';
import type { GameEvent, GameResult, ScheduledGame } from '../src/engine/baseball/types';
import { buildContext } from '../src/narrative/context';
import { describeEvent, templateFor, templateKind } from '../src/narrative/playByPlay';
import { PLAY_TEMPLATES, TEMPLATE_KINDS, validateTemplates } from '../src/narrative/templates';
import { generateLeague } from '../src/world/generate';

const league = generateLeague({ seed: 'narrative-v2' });
const schedule = generateSchedule(league.teams, 60);
const games: { game: ScheduledGame; result: GameResult }[] = schedule.slice(0, 400).map((game) => ({ game, result: simulateGame(league, game) }));

const V1_KINDS = TEMPLATE_KINDS.filter((k) => !['stealAttempt', 'pickoff', 'error', 'doublePlay', 'wildPitch', 'hitByPitch'].includes(k));
const E1_KINDS = TEMPLATE_KINDS.filter((k) => !V1_KINDS.includes(k));

/** Finds the first play matching `pred` across the simmed games. */
function findPlay(pred: (events: GameEvent[], i: number, game: ScheduledGame) => boolean) {
  for (const { game, result } of games) {
    const i = result.events.findIndex((_, j) => pred(result.events, j, game));
    if (i >= 0) return { game, events: result.events, i };
  }
  throw new Error('no such play in the sample');
}

describe('narrative templates v2', () => {
  it('the shipped content validates', () => {
    expect(() => validateTemplates(raw)).not.toThrow();
  });

  it('has at least 300 templates in total', () => {
    const doc = raw as { playByPlay: unknown[]; story: unknown[]; chapterTitles: unknown[]; share: unknown[] };
    expect(doc.playByPlay.length + doc.story.length + doc.chapterTitles.length + doc.share.length).toBeGreaterThanOrEqual(300);
  });

  it('every current event kind has ≥ 3 no-condition fallbacks, and every engine v2 kind has templates', () => {
    for (const k of V1_KINDS) expect(PLAY_TEMPLATES[k].filter((t) => !t.when).length, k).toBeGreaterThanOrEqual(3);
    for (const k of E1_KINDS) expect(PLAY_TEMPLATES[k].length, k).toBeGreaterThanOrEqual(3);
  });

  it('rejects unknown variables, when keys and event kinds', () => {
    const one = (t: object) => ({ playByPlay: [{ id: 'x', on: 'walk', weight: 1, text: '{b} walks.', ...t }] });
    expect(() => validateTemplates(one({ text: '{xyz} walks.' }))).toThrow(/unknown variable \{xyz\}/);
    expect(() => validateTemplates(one({ when: { sunny: true } }))).toThrow(/unknown when key/);
    expect(() => validateTemplates(one({ on: 'teleport' }))).toThrow(/unknown on/);
    expect(() => validateTemplates(one({ weight: 0 }))).toThrow(/weight/);
  });

  it('a walk-off home run is written from a walkoff template', () => {
    const { game, events, i } = findPlay((ev, j) => {
      const e = ev[j];
      return e.kind === 'hit' && e.hit === 'homeRun' && e.half === 'bottom' && e.inning >= 9 && e.score.home <= e.score.away && ev[ev.length - 1].kind === 'gameEnd' && ev.slice(j + 1, -1).every((x) => x.kind === 'run');
    });
    expect(buildContext(events, i, game).walkoff).toBe(true);
    expect(templateFor(league, game, events, i)?.when).toEqual({ walkoff: true });
  });

  it('a blowout home run uses a blowout or fallback template', () => {
    const { game, events, i } = findPlay((ev, j) => {
      const e = ev[j];
      if (e.kind !== 'hit' || e.hit !== 'homeRun') return false;
      const m = e.half === 'top' ? e.score.away - e.score.home : e.score.home - e.score.away;
      return m >= 6 && (e.bases.filter(Boolean).length < 3);
    });
    const when = templateFor(league, game, events, i)?.when;
    expect(when === undefined || 'blowout' in when).toBe(true);
  });

  it('the same game renders identical text twice', () => {
    const { game, result } = games[3];
    const render = () => result.events.map((_, i) => describeEvent(league, game, result.events, i, { stadium: 'Echo Park', rivalry: true }));
    expect(render()).toEqual(render());
  });

  it('never renders an empty line or a leftover {variable}', () => {
    for (const { game, result } of games.slice(0, 60)) {
      result.events.forEach((_, i) => {
        const line = describeEvent(league, game, result.events, i, { favoriteTeamId: game.homeId, modName: () => 'Glasses' });
        expect(line.trim().length, templateKind(result.events[i])).toBeGreaterThan(0);
        expect(line).not.toMatch(/[{}]/);
        expect(line).not.toMatch(/(^|(?<!\.\.)[.!?] )[a-z]/);
        expect(line).not.toMatch(/\.\.\. [A-Z][a-z]+n't/); // "had it... And didn't"
      });
    }
  });

  it('rarely repeats a line within a game’s first 30 plays (≤ 2% of games)', () => {
    const pitches = new Set(['ball', 'calledStrike', 'swingingStrike', 'foul', 'atBat']);
    const sample = games.slice(0, 200);
    const repeating = sample.filter(({ game, result }) => {
      const ev = result.events;
      const lines = ev.flatMap((e, i) => (pitches.has(e.kind) ? [] : [describeEvent(league, game, ev, i, { modName: () => 'Cursed' })])).slice(0, 30);
      return new Set(lines).size < lines.length;
    });
    expect(repeating.length).toBeLessThanOrEqual(sample.length * 0.02);
  });

  it('context: a go-ahead run and the final from the winner’s view', () => {
    const { game, events, i } = findPlay((ev, j) => ev[j].kind === 'run' && buildContext(ev, j, { awayId: '', homeId: '' }).goAhead === true);
    const ctx = buildContext(events, i, game);
    expect(ctx.goAhead).toBe(true);
    expect(ctx.tying).toBe(false);
    const last = events.length - 1;
    expect(buildContext(events, last, game).margin).toBeGreaterThan(0);
  });
});
