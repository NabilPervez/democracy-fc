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

## S3 — Soccer engine v1 — ✅
Types, generator (8-player squads, drives, styles), possession chains on the 3×3 grid, shots, goals, halves, auto lineup.

**DoD**
- [x] `tests/soccer.calibration.test.ts` passes §B5 targets over 1,000 seeded matches.
- [x] Property test: same seed ⇒ identical events (`tests/soccer.determinism.test.ts`).
- [x] No `Math.random`; `engine/soccer` has zero UI/storage imports.

## S4 — Set pieces, cards, injuries, momentum, shootouts — ✅
**DoD**
- [x] Calibration still in range.
- [x] Red card measurably reduces that team's goals (aggregate test).
- [x] Shootout always produces a winner.

## S4b — Phase Engine — ✅
`phase.ts`, block selection, transitions, route/lane, set-piece setups, phase stats in box score.

**DoD**
- [x] Every event has a valid `phase`/`defPhase`; all 10 phases appear in a 100-match sample.
- [x] High Block yields more `def`-zone turnovers than Low Block (aggregate).
- [x] Calibration still passes.

## S4c — Arena & personality layer — ✅
Walls (`wallPass`, `wallShot`, scrambles), signature moves (accumulated fouls, Spot Kicks and power plays already landed in S4), bonds/rivalries, awakening, `arenas.json`.

**DoD**
- [x] Calibration (5v5) passes; no throw-in/corner/goal-kick events ever.
- [x] Power play measurably raises opponent scoring.
- [x] Each arena moves its target stat in the expected direction over 500 matches.
- [x] ≤3 Awakenings per season over 20 seeds.

## S5 — Soccer world & content — ✅
Universe runs soccer seasons end to end (league/schedule/results/stats through the soccer engine). Names, arenas, weird-pack retheme, Vanished / Sub-Level Archive, Director events, ~150 templates.

**DoD**
- [x] A full soccer season at each chaos level runs with no exceptions.
- [x] Vanish counts per season within ±50% of config over 20 seeds.

## S6 — Club fan-base voting — ✅
`favoriteClubId`, fan size, `benefit()`, proposals with `favors/hurts`, sabotage/boost/ejection proposals, coalition lean.

**DoD**
- [x] Long-Ball club scores the wind rule higher than a Park-the-Bus club.
- [x] Top club votes against "best record" sabotage.
- [x] Player coins measurably swing a close election.

## S6b — Matchday Ballot — ✅
`tactics.json`, ballot generation (3 tactics + 3 captains), supporter blocs, free + quadratic votes, resolution at kickoff as a world event, captain bonus/burden, recap cause lines.

**DoD**
- [x] Ballots resolve identically on replay.
- [x] Each tactic moves its target stat the right way over 500 matches; counters give a measurable edge.
- [x] Skipping the ballot never blocks a match.

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

### S3 — 2026-10-07
- New `src/engine/soccer/`: `types.ts` (§C3), `lineup.ts` (auto five K/A/W/W/P by slot fit, backup keeper), `game.ts` (possession chains on zones × lanes, pass / dribble / long ball / shot, rebounds off the walls, rolling subs on stamina, Spark swing, Ice late composure, Selfish/Conductor/Predator/Wall/Showboat action + quality effects, home bonus, stoppage), `boxScore.ts`, `calibrate.ts`, `sport.ts` (registered as `soccer`, star groups incl. Keeping for keepers only).
- New `src/world/soccer/generate.ts` + `content/soccer/names.json` (original names only): 8-player squads, positions, drives, styles, fan size, default 12 clubs.
- Calibration (seed `calibration`, 1,000 matches): goals 5.9, draws 15.7%, home wins 48.5%, 0–0 0.2%, 21 shots/team, 105 chains — all in band. Extra check over 3 other league seeds (goals 6.5–7.4) because league make-up shifts scoring.
- Phases are a first-pass label from zone (`buildUp/progression/creation` vs blocks, transitions on turnovers, set pieces on restarts); S4b replaces this with the real Phase Engine.
- Not yet wired into `universe.ts` (the world layer is still baseball-typed) — that is the first task of S5.
- 250 tests pass, lint + typecheck clean. **S3 done.**

### S4 — 2026-10-07
- Fouls on dribbles (beaten defenders foul more), team-foul counts per half, **accumulated-foul Spot Kicks from the 6th foul** and **red-card power plays** (2 min or until conceding, then a reserve) — both pulled forward from S4c since they live in the same foul code.
- Free kicks (direct shot in the attacking third), penalties (best Finishing+Composure taker on the floor), yellow / second yellow / straight red, injuries (1–4 matches, reported in `SoccerResult.injuries`, player subbed off), momentum (−10..+10, goals +4, saves +1, cards; fades 1 per possession; ±2 rating), knockout shootouts (best of 5, then sudden death).
- Calibration now also asserts Spot Kicks 0.3–0.8/match (0.71) and reds < 0.15 (0.11).
- `tests/soccer.setpieces.test.ts`: power-play scoring drop over 3,000 matches, one power play at a time, momentum bounds, injuries leave the floor, shootout-always-has-a-winner property (300 runs).
- 255 tests pass, lint + typecheck clean. **S4 done.**

### S4b — 2026-10-07
- `src/engine/soccer/phase.ts`: `phaseOf` (pure), `chooseBlock` (Style weights + late-game score state + optional tactic preference for S6b), `rollTransition` (counter/secure vs counter-press/retreat → regained / breakaway / settled), `chooseSetup` (wall/man/zonal), `phaseStats` (seconds per phase, regains by block, counters launched/scored, set-piece goals), `validPhases`.
- Engine: block per chain (emits `blockChange`), block effects (High Block: −pass/−dribble in opponent's Build-up, more space behind, ×1.25 stamina drain; Mid Block: `through` passes −, `around` +; Low Block: shot quality −8, more blocked shots, easier build-up), transition mini-resolution on every turnover (`transition` event; breakaways start in Creation with a 2v1 bonus), free-kick setups with shot modifiers, `lane` + `route` + `block` on every event.
- Retuned chain length (8–16 s start) and foul rates; calibration (1,000 matches): goals 6.3, draws 14%, home 50.5%, shots 21.8/team, 113 chains, Spot Kicks 0.68, reds 0.12.
- `tests/soccer.phase.test.ts` (8 tests). 263 tests pass, lint + typecheck clean. **S4b done.**

### S4c — 2026-10-07
- Walls: `wallPass` (Wing one-two off the glass), banked shots (`shot.wall`, no woodwork, keeper Reflexes count less), loose-ball **scrambles** (Pace + First Touch) after blocks, woodwork, parries and deflected passes.
- `content/soccer/arenas.json` (9 arenas, effects as data) + `engine/soccer/arenas.ts`. Every club has a home arena; `opts.arenaId` overrides it (for Facility rules). Effects: Echo Chamber, Slope, Narrows, Octagon, Cold Room, Mirror Hall, The Pit (no momentum), Rotating Floor (`arenaShift` + scramble every 10 min).
- `content/soccer/signatures.json` (7 original Signature Moves). ~55% of eligible players carry one; fire at 9% per trigger, max 2 per match, own `signature` event.
- Bonds (+pass success, +assist quality, `pass.bond`) and Rivalries (+foul chance in duels, `dribble.rivals`) read from player data; `world/soccer/personality.ts` grows them from events (`applyRelations`), applies Awakenings (`awaken`: +12 to the position's key rating, Drive may evolve) and runs a full season with the league-wide cap of 3 (`simulateSoccerSeason`).
- Stamina drain slowed (players were being subbed ~12× per team per match); Cold Room now clearly raises subs.
- `generateSchedule`/`computeStandings` accept any `{ id }[]` (sport-agnostic).
- `tests/soccer.walls.test.ts` (8 tests). 271 tests pass, lint + typecheck clean. **S4c done.**

### S5 — 2026-10-07
**Architecture decision.** The Blastball world (`world/universe.ts`, 1,481 lines, plus weird/persona/picks/leaders/careers) is wired to baseball ratings and stat lines throughout. Rather than thread `if (sport)` through all of it (and risk the byte-identical baseball guarantee), soccer gets its own world module that reuses the sport-neutral shell: RNG, `season.ts` (schedule, W/D/L standings), `odds.ts` (multipliers), `factions.ts`, election vote pricing (S6), storage and worker (S7 adds a sport switch). Old baseball saves keep the old world untouched.
- `src/world/soccer/universe.ts`: event-sourced `SoccerUniverse` (`reduceSoccer`, `runSoccerCommand`, `reduceAllSoccer`), double round-robin league phase, top-4 knockout (shootouts, no draws), champion, **Ejection** of the bottom club and a new club from outside, new seasons, injuries (miss N club matches), stats, 3-way **Predictions** with draw settlement, favourite-club win bonus, stipend, **club switching** (once per season, costs all coins, `clubHistory`), Director news lines.
- `src/world/soccer/weird.ts` + `content/soccer/weird/core.json` (original): player mods with soccer deltas, **Vanished → Sub-Level Archive** with replacement arrivals, **Director facility events** per match (Lights Out, Ball Swap, Sealed Door, Wall Shift, The Drill, Fog / Wind Tunnel / Heat / Rain).
- Engine options for the world: `teamDeltas`, `playerDeltas`, `facilityEvents` (logged at kickoff).
- `src/world/soccer/odds.ts`: 3-way odds from public star groups + form; closer matches draw more.
- `content/soccer/templates.json` (**~200 original templates**) + `src/narrative/soccer.ts` (seeded, replay-stable lines; Key Moments flag; tones for the play log).
- `computeStandings` skips results for clubs that have since been Ejected.
- Vitest `testTimeout` raised to 30 s: the pre-existing baseball death-rate test passes alone in ~5 s but hit the 5 s default once the soccer season suites ran in parallel. No assertion changed.
- Not yet: Living-time mode and personas for soccer (S7), elections (S6), Echo Goal event (S8).
- `tests/soccer.world.test.ts` (16 tests). 287 tests pass, lint + typecheck clean. **S5 done.**

### S6 — 2026-10-07
- `content/soccer/proposals.json` (14 original proposals with `favors` / `hurts` / `factionLean`): match rules (wall goals ×2, long-range ×2, Spot Kicks from the 4th foul, 3-minute power plays, Heavy Ball), facility rules (Wind Tunnel, all matches in The Narrows / The Octagon, double facility events), sabotage (leaders to the Cold Room), boost (Drill buff for the bottom club), Ejection rules (eject two / none), plus Return proposals generated for Vanished players.
- `src/world/soccer/elections.ts`: `clubView` (public star groups, drives, Style, rank), `benefit()` (integer favors − hurts + standings/target term), club budgets from `fanSize`, `clubSplit` (self-interested), `factionSplitSoccer` (ideology lean, rethemed factions), `coalitions()`, quadratic vote pricing reused from the base.
- World: weekly ballots open at creation (`createSoccerWorld`) and every 7 days; `votesBought` adds the player's votes to their club's bloc; winning rules apply as `activeRules` (engine `MatchRules`: goal values, Spot Kick threshold, power-play length; arena overrides; forced facility events; facility chance) or `clubEffects` (sabotage arena / boost deltas counted down per match); Ejection count per season; Return brings a player back with a permanent mod and a new Drive.
- Match summaries carry `bonusPoints` when a rule made a goal count double.
- `tests/elections.clubs.test.ts` (6 tests). 293 tests pass, lint + typecheck clean. **S6 done.**

### S6b — 2026-10-07
- `content/soccer/tactics.json`: the 7 tactics (bonus, penalty, action weights, block/transition preference, Counter Blitz skip, Lock the Door shot-quality cut, High Press stamina ×1.5, Air Raid set-piece bonus, fitting Styles, `beats[]`) and 3 supporter blocs (Old Guard / Ultras / Tacticians).
- Engine (`engine/soccer/tactics.ts` + `opts.matchday`): tactic deltas with **+5 counter bonus** and **−3 unfamiliar** penalty (tactic doesn't fit the club's Style); the elected **captain** gets +6 Composure, an amplified Drive and takes the penalties.
- World (`world/soccer/matchday.ts` + universe): seeded ballot per club per match (3 tactics weighted to fit, 3 captains by form with Drive variety), simulated supporter-bloc votes scaled by fan size (lower after a Captain's Burden), public **tactic lean** for scouting, player's votes on their own club only (1 free vote per question, extras n²), resolution at kickoff recorded on the match summary, "The fans have spoken" line, **Captain's Bonus** (+10 coins when the backed captain scores/assists/keeps a clean sheet), **Captain's Burden** (red card or missed penalty), captaincy streaks (**Fan Favorite** at 5 and 9).
- Election votes now cost 2n² (PRD: elections have a higher base than matchday votes' n²).
- `world/soccer/recap.ts`: recap cause lines (tactic vote + possession + counters, Director events, arena, double-goal rules, burden).
- `tests/matchday.test.ts` (8 tests). 301 tests pass, lint + typecheck clean. **S6b done.**
