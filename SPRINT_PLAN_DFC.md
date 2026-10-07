# Democracy FC — Vote Chaos: Sprint Plan

Source of truth: [prd.md](prd.md) (§C7). Base: `NabilPervez/blastball` @ `77a7a76`.
Repo: `NabilPervez/democracy-fc`. Older Blastball plans: `SPRINT_PLAN.md`, `SPRINT_PLAN_2.md` (history only).

**Global Definition of Done (every sprint)**
- `npm test`, `npm run lint`, `npm run typecheck` green.
- Determinism rules hold: seeded PRNG only, no `Math.random()` in `src/engine` / `src/world`, `engine/` never imports `ui/` or `storage/`.
- Progress logged in this file (status + notes) before the sprint is marked done.

Status key: ⬜ not started · 🟨 in progress · ✅ done

---

## S1 — Sport abstraction (no behavior change) — ✅
Create `engine/core`, move baseball under `engine/baseball`, add `SportEngine` + registry, route `season.ts`/worker through it.

**DoD**
- [x] `src/engine/core/` holds `rng.ts`, `sport.ts` (`SportEngine`, `SimContext`, `MatchResult`, `Outcome3Way`), `registry.ts` (`getSport`).
- [x] Baseball (`game.ts`, `v2/`, `boxScore.ts`, `types.ts`) lives under `src/engine/baseball/`, wrapped in a `SportEngine` adapter.
- [x] `universe.ts` sims every game through `getSport(state.sport)`.
- [x] `Universe.sport` exists; save migration defaults old saves to `'baseball'` (saveVersion bump).
- [x] All pre-existing tests pass unchanged (only import paths edited).
- [x] Determinism test proves baseball output byte-identical to before the move (fixture captured on the pre-move build).

## S2 — Draw support across the shell — ✅
W/D/L standings, points, `winnerId: null`, prediction settlement for draws, digest wording.

**DoD**
- [x] Standings rows carry `draws` and `points` (3/1/0 for soccer; baseball ordering unchanged).
- [x] Grep checklist of every winner assumption (`winnerId`, `loserId`, `wins/losses`, bet settlement, digest) fixed.
- [x] A stub soccer engine returning fixed draws flows through standings, predictions and digest without errors (`tests/draws.test.ts`).
- [x] 3-way odds market (`home / draw / away`) in `odds.ts`; 2-way kept for baseball.

## S3 — Soccer engine v1 — ⬜
Types, generator (8-player squads, drives, styles), possession chains on the 3×3 grid, shots, goals, halves, auto lineup.

**DoD**
- [ ] `tests/soccer.calibration.test.ts` passes §B5 targets over 1,000 seeded matches.
- [ ] Property test: same seed ⇒ identical events (`tests/soccer.determinism.test.ts`).
- [ ] No `Math.random`; `engine/soccer` has zero UI/storage imports.

## S4 — Set pieces, cards, injuries, momentum, shootouts — ⬜
**DoD**
- [ ] Calibration still in range.
- [ ] Red card measurably reduces that team's goals (aggregate test).
- [ ] Shootout always produces a winner.

## S4b — Phase Engine — ⬜
`phase.ts`, block selection, transitions, route/lane, set-piece setups, phase stats in box score.

**DoD**
- [ ] Every event has a valid `phase`/`defPhase`; all 10 phases appear in a 100-match sample.
- [ ] High Block yields more `def`-zone turnovers than Low Block (aggregate).
- [ ] Calibration still passes.

## S4c — Arena & personality layer — ⬜
Walls (`wallPass`, `wallShot`, scrambles), accumulated fouls + Spot Kicks + power plays, signature moves, bonds/rivalries, awakening, `arenas.json`.

**DoD**
- [ ] Calibration (5v5) passes; no throw-in/corner/goal-kick events ever.
- [ ] Power play measurably raises opponent scoring.
- [ ] Each arena moves its target stat in the expected direction over 500 matches.
- [ ] ≤3 Awakenings per season over 20 seeds.

## S5 — Soccer world & content — ⬜
Names, arenas, weird-pack retheme, Vanished / Sub-Level Archive, Director events, ~150 templates.

**DoD**
- [ ] A full soccer season at each chaos level runs with no exceptions.
- [ ] Vanish counts per season within ±50% of config over 20 seeds.

## S6 — Club fan-base voting — ⬜
`favoriteClubId`, fan size, `benefit()`, proposals with `favors/hurts`, sabotage/boost/ejection proposals, coalition lean.

**DoD**
- [ ] Long-Ball club scores the wind rule higher than a Park-the-Bus club.
- [ ] Top club votes against "best record" sabotage.
- [ ] Player coins measurably swing a close election.

## S6b — Matchday Ballot — ⬜
`tactics.json`, ballot generation (3 tactics + 3 captains), supporter blocs, free + quadratic votes, resolution at kickoff as a world event, captain bonus/burden, recap cause lines.

**DoD**
- [ ] Ballots resolve identically on replay.
- [ ] Each tactic moves its target stat the right way over 500 matches; counters give a measurable edge.
- [ ] Skipping the ballot never blocks a match.

## S7 — UI conversion — ⬜
Relabel tabs (Bulletin / Matches / Facility / Vote / Archive), Live Pitch View + Play Log, minute clock, Key Moments, W/D/L table, helps/hurts + coalition bars, club picker, PlayerCard drives, onboarding copy, "Predictions" copy everywhere.

**DoD**
- [ ] New player creates a universe, watches a match in Key Moments, makes a prediction and votes in < 3 min at 380px.
- [ ] Lighthouse PWA checks still pass.

## S8 — Polish & content fill — ⬜
~300 templates, fan-base headlines, Director voice pass, extra prediction markets, IP checklist §B12.

**DoD**
- [ ] §B12 checklist complete.
- [ ] 3-season soak with no load-time regression > 20% vs. baseball.

---

## Progress log

### S1 — 2026-10-07
- Cloned `blastball` into `D:\Code\democracy-fc`, remote repointed to `democracy-fc`. Baseline: 233 tests passing, lint clean.
- Captured `tests/fixtures/baseball-v4-universe.json` (full-season result + world-event hashes at all 4 chaos levels) on the untouched build, then moved files.
- Moves: `engine/rng.ts → engine/core/rng.ts`; `engine/{types,game,boxScore}.ts` and `engine/v2/` → `engine/baseball/`. Imports rewritten by script (45 files, paths only).
- New: `engine/core/sport.ts` (`SportEngine`, `SimContext`, `MatchSummary`, `Outcome3Way`), `engine/core/registry.ts` (`getSport`, `registerSport`), `engine/baseball/sport.ts` adapter.
- `universe.ts`: all three sim call sites go through one `simulate(state, game)` → `getSport(state.sport)`. Worker needs no change (it calls `runCommand`).
- Save v13 → v14 adds `sport: 'baseball'`. Only test edit beyond import paths: added `sport` to the v6-fixture "new keys" strip list (same pattern every earlier migration used).
- Result: 236 tests pass, lint + typecheck clean, fingerprint test byte-identical. **S1 done.**

### S2 — 2026-10-07
Winner-assumption checklist (from grep) and what happened to each:
| Site | Fix |
|---|---|
| `engine/season.ts computeStandings` | `matchWinner()` helper; rows gain `draws`, `points`; sort = points → fewest losses → diff (→ goals for when draws exist). Baseball order provably unchanged (points = 3×wins). |
| `universe.ts afterGame` (h2h, rivalry, fav bonus, XP) | Draw skips win-only effects; shared tail split into `afterResult` (picks, bailout). |
| `universe.ts settleBets` | Draw ⇒ team predictions lose; `DRAW_PICK` prediction wins. |
| `universe.ts currentOdds / offeredMultiplier / betError / betPlaced pm` | 3-way via `odds.withDraw()` when `sport.allowsDraws` (flat 150‰ draw until S3 supplies a real one). |
| `world/digest.ts` team line | Shows `W–D–L` when there were draws. |
| `ui/screens/Games.tsx` winner highlight | `matchWinner()`; no highlight on draws. |
| `universe.ts` playoffs (`series` winners) | Left as is: soccer knockouts end in shootouts (S4), never draws. |
| `storage/migrate.ts:107` | Shipped migration — never edited. |
| `narrative/*` `gameEnd.winnerId` | Baseball-only events; soccer gets its own templates (S5). |
| UI tables (`League.tsx`, `Today.tsx`, `BetPanel.tsx`) | Deferred to S7 UI conversion (D column, Draw button). |
- `UniverseSettings.sport` (optional, defaults to baseball for now).
- 241 tests pass, lint + typecheck clean, baseball fingerprints unchanged. **S2 done.**
