# PRD + Game Design Document: Democracy FC — Vote Chaos (Blastball soccer conversion)

| | |
|---|---|
| **Status** | Draft v3 — **5v5 walled-arena format**, expanded personalities, arena architecture |
| **Base repo** | `NabilPervez/blastball` (engine v4, ~5.3k lines in `src/engine` + `src/world`) |
| **Game name** | **Democracy FC — Vote Chaos** (pending trademark check; see §B12) |
| **Platform** | Unchanged: mobile-first PWA, local-first, offline, static hosting, no backend |
| **Inspiration** | Blaseball (absurdist self-playing league) + "elite striker facility" anime tone |

> **IP rule (non-negotiable).** The facility-academy *premise* is inspired by Blue Lock, but **no Blue Lock names, characters, terms, logos, art style, or plot beats** may appear in code, content, or UI. That means no "Blue Lock", "Ego", "egoist", "Neo Egoist League", named characters, or their facility layouts. Everything below is original. This is the same rule the original PRD applied to Blaseball.

---

## 0. How to read this doc (for Claude Code)

- **Part A (PRD)** = what and why. **Part B (GDD)** = how it plays. **Part C (Tech)** = exactly which files change.
- Rule of thumb: **keep the shell, replace the sport, reskin the world.** Every system in the base repo that isn't baseball-specific should survive with renamed labels only.
- Work in the sprint order in §C7. Each sprint must leave `npm test` and `npm run lint` green.
- Determinism rules from the base repo still apply: seeded PRNG only, `Math.random()` banned, integer/rational math in outcome-critical code, `engine/` may not import `ui/` or `storage/`.

---

# PART A — PRD

## A1. Product summary

A browser game about a mysterious, isolated **soccer facility** — The Assembly — where elite young players from rival clubs live, train, and play a **5-a-side league inside sealed glass-walled arenas** that runs itself. There is no out of bounds: the walls are part of the game. The facility is strange: rules change overnight, pitches rearrange, weather is manufactured, and sometimes players vanish into the sub-levels.

**You are not in the facility.** You're a fan outside the walls, watching your club's players through the facility's broadcast feed. You bet on matches to earn coins, spend coins on votes, and — with every other fan base — vote on the rules the facility enforces next. Every fan base votes for rules that help *their* club.

**Every club is fan-owned and run democratically.** Fans don't just vote on facility rules — they vote on how their own club plays each match: the tactic, the captain, the call. The whole game is votes, all the way down.

> You can't touch the ball. But you and your fellow fans decide how it's played.

## A2. Why this conversion

- The base repo's core loop (watch → bet → vote → world changes) is sport-agnostic. Only the match engine and labels are baseball.
- Soccer is the world's biggest sport, but management sims (Football Manager) are intimidating. This game is the opposite: **3 taps a week, zero tactics menus, maximum chaos.**
- The facility framing explains the chaos diegetically: weird things happen because the facility *designs* them. It also explains why fans can only vote and not manage.

## A3. Goals

1. Keep ≥80% of the base codebase (storage, time, economy, elections, factions, narrative, cards, PWA) with relabeling only.
2. A soccer match engine that produces readable, dramatic, deterministic text feeds.
3. Make club loyalty the emotional core: fans vote selfishly for their club, and rival fan bases visibly scheme against you.
4. Accessible: a new player understands a match feed and casts a vote within 3 minutes, with no tutorial longer than 4 screens.
5. Short mobile sessions (2–5 min) and deeper desktop sessions, as before.

## A4. Non-goals (v1)

- Real clubs, real players, real leagues, or real kits. All fictional.
- Lineups, formations, tactics sliders, training schedules, or transfers controlled by the player.
- Multiplayer, accounts, global leaderboards, server.
- Monetization of any kind. (Note: in-game betting uses fictional coins only; never real money or anything purchasable.)
- 3D or broadcast-style animated rendering. v1 ships a **2D top-down arena** (§B10a) showing all 10 players at engine-assigned spots — no physics, no free movement.
- Real futsal or indoor-league rules. The format is original: walled 5v5 with its own rulebook (§B5).

## A5. Target player

- Soccer fans who bounce off Football Manager's complexity.
- Anime / tournament-arc fans who love "elite facility, survival, rivals" tension.
- Former Blaseball / Blastball players who want the same vibe with a familiar sport.

## A6. Success metrics (local, privacy-preserving — same as base)

D7 return rate · seasons per universe · % sessions with a bet or vote · % elections where the player's club-backed rule passed · exports per universe.

## A7. Risks

| Risk | Mitigation |
|---|---|
| Too close to Blue Lock | Original names, facility, factions, art; review checklist before any public launch (§B12) |
| Soccer is low scoring → dull feeds | Possession chains with "Key Moments" mode; chance events surface even without goals; chaos rules that inflate drama |
| Player can't tell why they lost | Every match recap gives a one-line *cause* ("Your keeper was blinded by the Floodlight Rule you voted against") |
| Votes feel meaningless vs. sim fan bases | Keep base quadratic vote pricing + fixed faction budgets; add **club fan bases** that vote predictably for self-interest so the player can form coalitions |
| Engine rewrite breaks saves | New `sport: 'soccer'` universes only; old baseball saves remain playable on old engine path or are marked legacy (§C6) |
| Gambling framing concerns | Coins are earn-only, never purchasable, no real-money link; all UI copy says "Predictions" (decided) |

---

# PART B — GAME DESIGN DOCUMENT

## B1. The world: The Assembly

An enclosed, ever-changing training-and-competition complex. Nobody outside knows who runs it — only **The Director**, an unseen voice who issues announcements, enforces rules fans vote in, and occasionally adds rules nobody voted for.

**Structure**
- **12 clubs** send squads into the facility (**default 12**; configurable 8/12/16 at universe creation).
- Each club has **8 players**: 5 starters + 3 reserves. Small squads mean every player is a known character.
- The facility has **Wings** (training dorms) and **Arenas** (sealed, glass-walled match boxes). Each arena has an architecture that changes play (§B6).
- **Survival pressure:** at the end of each season, the bottom clubs are **Ejected** (relegated out of the facility) and replaced by new clubs from outside. This reuses `src/world/relegation.ts`.

**Tone:** sleek, cold, institutional — glass, steel, floodlights, countdown clocks — with absurd events delivered in a flat corporate voice. ("Pitch 4 has been rotated 90°. Please adjust accordingly.")

## B2. The fan (player) fantasy

- At universe creation you **pick a club to support** (required, new) and a **fan persona** (existing system).
- You see the facility only through its feed: match broadcasts, Director announcements, leaked "dorm rumors," and your fan base's chatter.
- Your club is not guaranteed to be good. Following a bad club through survival fights is a feature.
- **Switching clubs (decided):** the player can switch supported club at any time, but **at most once per season**, and switching **resets coins to 0**. Votes already cast this election stay with the old club. UI: a confirm dialog stating both costs plainly ("You'll lose all N coins. You can't switch again until next season."). Store `favoriteClubId`, `lastClubSwitchSeasonId`, and a `clubHistory[]` (for narrative: "a former Ironvale fan").

## B3. Core loop

```
Check in → "While You Were Gone" (facility bulletin)
  → Matchday Ballot (Tactic + Armband + Prediction)
  → Watch / skim matches → Earn coins from predictions & captain bonuses
  → Earn coins → Join your fan base's vote push
  → Director enforces winning rules → Facility changes → repeat
```

Unchanged from base, relabeled. The **new layer** is club self-interest in voting (§B7).

## B4. Clubs and players

### Player attributes (replace baseball ratings)

Hidden ratings, integers 0–100, rolled into **4 visible star groups** (same UI pattern as base):

| Star group | Hidden ratings | Used for |
|---|---|---|
| **Attack** | `finishing`, `dribbling`, `firstTouch` | Shot quality, beating defenders, keeping possession under pressure |
| **Playmaking** | `passing`, `vision` | Chain progression, chance creation, assists |
| **Defense** | `tackling`, `positioning`, `aerial` | Turnovers, blocking shots, headers on set pieces |
| **Engine** | `pace`, `stamina`, `composure` | Breakaways, late-game fade, big-moment performance |

Goalkeepers additionally use `reflexes` and `handling` (displayed as a 5th star group **Keeping** on Keeper cards only).

### Positions

| Position | Count in the five | Role |
|---|---|---|
| **Keeper** | 1 (fixed, never rotates) | Shot-stopping, distribution, wall rebounds behind the goal |
| **Anchor** | 1 | Last outfield defender; builds play from the back |
| **Wing** | 2 | Wide runners; use the side walls for one-twos and overlaps |
| **Pivot** | 1 | Target player up top; holds the ball, lays off, finishes |

Reserves: 3 (typically 1 backup Keeper-capable player + 2 outfield). **Rolling substitutions** (unlimited, any time) — the engine subs tired players automatically; stamina matters a lot more in 5v5. The **AI picks the five automatically** (best available by position-weighted stars, rested players preferred).

### Ego / spotlight trait (original mechanic — the "facility striker" feel)

Every player has one hidden **Drive** trait (personality), shown on the card as an icon after a few matches:

| Drive | Effect in engine |
|---|---|
| **Selfish** | Shoots more often instead of passing; higher goal volume, lower assist rate |
| **Conductor** | Passes into better positions; raises teammates' shot quality |
| **Predator** | Big bonus in the box, weak outside it |
| **Wall** | Defensive bonus, never shoots |
| **Showboat** | Dribble-heavy; occasional spectacular goals and spectacular turnovers |
| **Ice** | Composure bonus in final 10 minutes and penalties |
| **Spark** | Performance swings wildly match to match |

Drives make players feel like characters without any manual tactics.

### Personality layer (expanded for 5v5)

With only 5 on the floor, personality *is* the strategy. Each player has three visible character elements, all original and generated:

1. **Drive** (above) — how they play.
2. **Signature Move** — one named, rare, high-impact action unlocked by Drive + ratings. Fires at most once or twice a match, gets its own log callout and pitch flash. Examples (original): *Glass Ricochet* (shot banked off the side wall), *Floodlight Volley*, *The Closing Door* (Anchor's last-ditch block), *Countdown Turn* (Pivot spin in the last minute). Defined in `content/soccer/signatures.json` as data (trigger, condition, effect).
3. **Bonds & Rivalries** — pairwise relationships, formed from events (assists between two players → **Bond**; a player who repeatedly beats or fouls another → **Rivalry**).
   - Bond: +passing/+vision between that pair, combo lines in the log ("Okafor and Lindqvist — they've done this a hundred times in the Wing dorms").
   - Rivalry: when rivals face each other, both get +composure and +aggression (foul chance up). Rivalry matches get a pre-match Director callout.

**Awakening (the big anime beat, original).** A rare, seeded event when a player hits a dramatic trigger (scores while trailing late, survives a Vanish rumor, captains 5 times in a row). The player gains a permanent **Awakened** state: one rating jumps, Drive may evolve (e.g. Spark → Ice), card gets an animated frame. Max ~1–3 per season league-wide so it stays special.

**Voice.** Each player gets a short generated **catchphrase** and **dorm bio** (3 lines) from original templates. These feed the log ("Vance, again: 'The goal is mine.'") and the PlayerCard.

> IP guardrail: archetypes come from our Drive system, not from any anime cast. No borrowed character types (e.g., the "genius with a monster inside", named "weapons", ego rankings). Review against §B12.

## B5. Match engine: possession chains

Replace innings/outs with **possession chains**. The arena is 3 **zones** (`def → mid → att`, relative to the team in possession) × 3 **lanes** (`left / center / right`) = a **3×3 grid**. Each player occupies one grid cell at any moment (engine-assigned, not physics), which is enough to draw all 10 players.

### The walls (core rule)
- **No out of bounds.** No throw-ins, corners, or goal kicks. The ball stays live until a goal, a foul, or a keeper hold.
- Walls are a playable surface. Two new actions:
  - `wallPass` — a one-two off the side wall (Wing specialty); beats a defender with passing + vision vs. positioning.
  - `wallShot` — a banked shot off a side or back wall; lower base quality, but keeper reflexes count less (unpredictable).
- Loose balls rebounding off walls create **scramble** steps: a 50/50 contest (pace + firstTouch vs. same) to decide possession.
- A Keeper holding the ball restarts play with a throw or roll (Build-up begins).

### Match structure
- 2 halves × **20 minutes**, running clock + stoppage (0–2 seeded minutes).
- Each chain consumes **10–40 seconds** of game time (seeded, weighted by style). Target: **~90–120 chains per match** — more possessions than 11v11, so more drama.
- Kick-off at the start of each half; after a goal, the conceding team kicks off.

### A chain
1. **Start:** team A gains possession in a zone (from kick-off, turnover, scramble, keeper restart).
2. **Step loop:** each step, the ball carrier attempts an **action** chosen by weighted roll:
   - `pass` (Playmaking vs. opponent Defense) → advance 0–1 zone or keep
   - `dribble` (Attack.dribbling + pace vs. tackling) → advance 1 zone or lose ball
   - `longBall` (passing vs. aerial) → skip a zone, high risk
   - `shot` (only in attack zone, or rare long shot from middle)
3. **End conditions:** turnover (→ new chain for team B in mirrored zone), foul (→ free kick / Spot Kick / penalty / card), keeper hold, or shot. Wall rebounds never end a chain — they trigger a scramble.
4. **Shot resolution:** compute **shot quality** (0–100) from finishing, assist bonus, Drive, defenders' positioning, and rule modifiers. Then roll vs. keeper reflexes/handling → `goal | save | wide | blocked | woodwork`.
5. Max 8 steps per chain (prevents infinite loops; final step forces a resolution).

### Team style (auto, readable)
Each club has one **Style** generated at creation and changeable only by elections/events:
`All-Out Attack`, `Counter-Punch`, `Possession Wall`, `Long-Ball Siege`, `Park the Bus`. Style is a set of action-weight multipliers. That's the entire "tactics" system.

### Fouls, set pieces, cards, injuries
- **Free kicks** after fouls: direct shot (finishing vs. reflexes) or short restart; defending team can form a 1–2 player wall.
- **Accumulated fouls (original arena rule):** each team's fouls are counted per half. From the **6th team foul onward**, every foul gives the opponent a **Spot Kick** from a mark 10m out, no wall. Creates late-half tension and rewards disciplined Anchors.
- **Penalties:** fouls inside the box → penalty. Composure + finishing vs. reflexes; Ice drive bonus; the elected Captain takes them.
- **Cards:** foul severity roll → yellow / red (two yellows = red). **Red = power play:** the team plays with 4 for 2 game minutes or until it concedes, then a reserve comes on. (The sent-off player is out of the match.) Severe in 5v5, so red rates must stay low.
- No aerial set pieces (no corners), so `aerial` matters mainly for long balls, wall rebounds, and headers from crosses.
- **Injuries:** low seeded chance on tackles; injured players miss N matches (reuses base status system).

### Momentum
A small bounded modifier (−10..+10) that shifts after goals, big saves, and cards, and decays each chain. It makes comebacks and collapses happen without randomness feeling arbitrary. Must be integer math.

### Draws
League matches can draw. **Knockout** matches (playoffs, special events) go to a **penalty shootout** (5 each, then sudden death). Note: Elections can change this (e.g., "Golden Goal" rule).

### Calibration targets (put in a test)
Over 1,000 seeded neutral matches with chaos = calm. *These are starting estimates, not researched benchmarks — tune after the first engine build:*
- Mean total goals **5.5–7.5**
- Draw rate **12–18%**
- Home win rate **44–52%**
- 0–0 rate **< 2%**
- Mean shots per team **18–28**
- Spot kicks per match **0.3–0.8**; red cards per match **< 0.15**


## B5a. Phases of play (the Phase Engine)

Every moment of a match belongs to exactly one of **10 phases**, grouped into 4 families. The chain engine (§B5) already produces zones and possession changes; phases are a **deterministic label derived from those events**, plus a small set of phase decisions that feed back into the sim. Phases are what the pitch view and play log show.

### In-possession (defined by ball location, relative to the attacking team)
| # | Phase | Zone | Goal of the team | Engine hook |
|---|---|---|---|---|
| 1 | **Build-up** | `def` | Play out from the back and break the opponent's first line of pressure | Pass/dribble vs. opponent block; failure vs. a High Block = turnover in own third (dangerous) |
| 2 | **Progression** | `mid` | Get into the middle third and penetrate the final third — **around** (wide), **through** (central), or **over** (long ball) the block | Records `route: 'around' \| 'through' \| 'over'` on the advancing action |
| 3 | **Creation / Finishing** | `att` | Establish play in the final third and create a shot | Shot quality, cutbacks, crosses |

### Out-of-possession (defined by the defending team's block depth — mirrors 1–3)
| # | Phase | Mirrors | Behavior | Engine hook |
|---|---|---|---|---|
| 4 | **High Block** | opponent Build-up | Press high while they play out from the back | +turnover chance in opponent's `def`; stamina drain ×1.25 |
| 5 | **Mid Block** | opponent Progression | Medium depth, aggressive, force play wide | "around" routes favored for attacker, "through" penalized |
| 6 | **Low Block** | opponent Creation | Very compact near own goal, protect the box | Opponent shot quality −8, more blocked shots, more corners conceded |

The defender's block is chosen per chain by **Style + Tactic + score state** (e.g. Park the Bus → Low Block; High Press tactic → High Block; a team leading by 2 after 75' drops a block). Seeded, integer-weighted.

### Transitions (the 5–8 second window after possession changes)
| # | Phase | Who | Decision (seeded, weighted) |
|---|---|---|---|
| 7 | **Defensive Transition** | team that just lost the ball | **Counter-press** (win it back fast; high reward, leaves space behind) vs. **Retreat** (recover shape into a block) |
| 8 | **Attacking Transition** | team that just won the ball | **Counter-attack** (skip straight forward; Counter Blitz amplifies) vs. **Secure possession** (reset into Build-up) |

Transitions are modeled as a **1-step mini-resolution at the start of every turnover chain**: the two decisions are rolled, and the matchup decides the outcome (counter-attack vs. retreat → usually ends in Progression; counter-attack vs. counter-press → 50/50 instant regain or a breakaway into Creation). In game time this is ~0 minutes; it exists so the log and pitch can show it.

### Set pieces
| # | Phase | Covers |
|---|---|---|
| 9 | **Attacking Set Piece** | Kick-offs, free kicks, Spot Kicks (6th+ foul), penalties, keeper restarts |
| 10 | **Defensive Set Piece** | The opponent's response: wall (0–2 players), marking setup, keeper positioning |

No throw-ins, corners, or goal kicks exist (walled arena). Each free kick rolls a **defensive setup** (`wall | man | zonal`) that shifts shot vs. pass odds. Kick-offs count as Attacking Set Piece for the kicking team.

**5v5 note on transitions:** with only 4 outfield players, a failed Counter-press often leaves a 2v1 or a direct run at the Keeper. Transitions are expected to be the single biggest source of goals — that's the intended feel.

### Phase rules
- **Single source of truth:** phase is computed by `src/engine/soccer/phase.ts → phaseOf(state)` from possession, zone, block, and whether the last event was a turnover or dead ball. UI never infers phases itself.
- Every `SoccerEvent` carries `phase` (attacking perspective) and `defPhase` (defending perspective), e.g. `Progression` vs. `Mid Block`.
- **Phase stats per match** (for recaps & the Analyst persona): % time in each phase, regains by block, counter-attacks launched/scored, set-piece goals. Recap line example: "Ironvale's High Block forced 9 turnovers in your Build-up."
- Tactics map onto phases (no new menus): High Press → prefers High Block + Counter-press; Lock the Door → Low Block + Retreat; Counter Blitz → Counter-attack; Tiki-Taka → Secure possession; Air Raid → "over" routes + set-piece bonus.
- Calibration targets in §B5 must still pass with the Phase Engine on.

## B6. The facility's chaos (weirdness system — reuse, retheme)

Rules and mods stay **data, not code** (`trigger`, `condition`, `effect`, `duration`) in `content/weird/*.json`. Chaos levels Calm → Normal → Weird → Unhinged unchanged.

### Arena architecture (replace stadium/environment traits)

Every arena is a sealed box. The facility's architecture is a character: cold, monumental, and occasionally hostile. Each arena has a **name, a shape, a wall material, and 1–2 traits**, all data in `content/soccer/arenas.json`. The pitch view renders shape and walls, so architecture is *visible*.

| Arena (examples) | Architecture | Effect |
|---|---|---|
| **The Glass Box** | Standard rectangle, clear walls, floodlights above | Baseline |
| **The Echo Chamber** | Concrete walls | Wall rebounds faster: `wallShot` +quality, scrambles more frequent |
| **The Slope** | Floor tilts toward one goal | Downhill team +shot quality; swaps at half |
| **The Narrows** | Long, thin box | Center lane only half-width: Wings dominate, `through` routes harder |
| **The Octagon** | Angled corners | Corner rebounds come back toward goal: more chaos in `att` zone |
| **The Cold Room** | Frosted glass, chilled air | Stamina drains 2×; more substitutions |
| **Mirror Hall** | Mirrored walls | Keepers −reflexes on `wallShot`; Showboats +composure |
| **The Pit** | Sunken floor, spectators look down through glass ceiling | No crowd momentum; Silent |
| **Rotating Floor** | Floor turns 90° every 10 minutes | Attack direction shifts; log + pitch rotate |

Architecture can be changed by **Facility rule** elections ("All matches move to The Narrows for 2 weeks") — the facility literally rebuilds itself on vote.

### Facility events (random, Director-issued)
- **Lights Out:** 5 minutes played in darkness; passing accuracy drops.
- **Ball Swap:** a heavier ball is introduced mid-match.
- **Sealed Door:** a player is locked out of the arena and misses the match (huge in 5v5 — a reserve starts).
- **Wall Shift:** a wall panel slides in, shrinking the arena for 5 minutes.
- **The Drill:** a surprise skill test before kickoff; the winner gets a temporary buff.
- **Echo Goal:** a goal is "replayed" and counts twice (rare, Unhinged).
- **Weather Simulation:** fog, wind tunnel, artificial rain, heat chamber.

### Player mods (retheme base `playerMods`)
Keep the mechanic; remap deltas to soccer ratings. Examples: **Running Hot** (+finishing, −composure), **Glass Boots** (+dribbling, injury-prone), **Tunnel Vision** (+finishing, −passing), **Blessed**, **Cursed**, **Magnetized** (+tackling, −pace).

### Disappearance & return (replaces death)
Death is too dark for this theme and doesn't fit the facility. Replace with **Vanished**:
- A player is "**taken to the Sub-Levels**." Flavor causes, e.g., "walked into the lower training wing and the door sealed behind them."
- Rate same as base deaths (calm 0.5, normal 2, weird 4, unhinged 8 per season).
- Vanished players go to the **Sub-Level Archive** (renamed Hall of the Departed). Card desaturates.
- **Return only by election** (base rule kept). Returned players come back **changed** (gain a new mod and a changed Drive). Card gains blue glow.

Keep the existing code path; rename labels and narrative strings only.

## B7. Voting: fan bases fighting for their clubs (the key new design)

This is the heart of the theme: *fans vote for rules that benefit their club.*

### Two kinds of voters
1. **Club fan bases (new):** one per club, including yours. Each has a vote budget scaled by club **fan size** (generated; grows with wins, shrinks after Ejection scares). They vote **self-interestedly**: they compute which proposal most helps their club's current Style/roster and vote for it.
2. **Ideological factions (existing):** keep the 6 base factions, rethemed: **The Analysts, The Loyal End, The Chaos Choir, The Purists, The Lore Hunters, The Casuals**. They vote by ideology, not club, and act as swing voters.

### How self-interest is computed (deterministic, public-info only)
For each proposal, each club fan base scores `benefit(club, proposal)` using only public info (star groups, Style, standings, current rules). Example: a club with Long-Ball Siege style scores **"Heavy Ball rule"** low and **"Wind Tunnel Pitches"** high. Rules declare their beneficiaries in data via `favors` tags (see schema §C4), so scoring stays simple and testable.

### The player's vote
- Player buys votes with coins, **quadratic cost** (unchanged).
- Your vote is **added to your club's fan-base bloc**. Your club's bloc almost always agrees with you (it has the same interest), so your coins *amplify your club*.
- **Coalitions (new, small):** before an election closes, the UI shows which other clubs' fan bases are leaning the same way. That turns elections into readable alliances ("3 clubs + The Chaos Choir back Golden Goal").

### Proposal types (each election offers 3–4)
| Type | Example |
|---|---|
| **Match rule** | Golden Goal; wall goals count double; Spot Kick from the 4th foul instead of 6th; 3-minute power plays |
| **Facility rule** | All pitches become Short Pitches for 2 weeks; Lights Out events doubled |
| **Club-targeted (sabotage)** | "Club with the best record plays next 3 matches in the Cold Room" |
| **Club-boost** | "Lowest-ranked club gets a Drill buff each match" |
| **Return** | Bring back a Vanished player |
| **Ejection rule** | Change how many clubs are Ejected this season |

Sabotage and boost proposals make club self-interest obvious and dramatic. The Director occasionally adds a **wildcard** proposal nobody asked for.

### Election cadence
Unchanged: end of each in-game week. Ballots open 2 in-game days before.

## B7a. Club Democracy: the Matchday Ballot (pre-match interactions)

Every club is fan-owned. Before **each of your club's matches**, a **Matchday Ballot** opens. It gives the player **three ways to act before kickoff**, all on one screen, all optional:

| # | Interaction | What you decide | Cost |
|---|---|---|---|
| 1 | **Tactic Vote** | How your club plays this match | 1 free vote; extra votes cost coins |
| 2 | **Armband Vote** | Who captains this match (the spotlight player) | 1 free vote; extra votes cost coins |
| 3 | **Prediction** | Result of the match (§B8) | Coins staked |

**Design rules**
- **Skippable.** If the player ignores the ballot, the club's simulated fans decide. You never lose because you didn't open a menu.
- **Free baseline, coins amplify.** Each fan gets 1 free vote per question. Extra votes use the same quadratic pricing as elections, but **cheaper** (`cost(n) = n²` coins vs elections' higher base) — matchday votes are the small, frequent decisions; elections are the big, rare ones.
- **Ballot window:** opens at the end of the club's previous match, closes at kickoff. In Living mode, a push-style "Ballot closes in 20 min" banner appears on the Bulletin.
- **Your club's simulated fans vote too** (budget scaled by `fanSize`), split into internal **supporter blocs** with leanings (e.g. "The Old Guard" prefers defensive tactics, "The Ultras" prefer attack). The player can swing close ballots but can't dictate every one — same philosophy as elections.
- **Results lock at kickoff** and are announced in the feed: "The fans have spoken: SHOOT ON SIGHT (54%). Captain: Vance."
- **Every match recap ties back to the vote:** "Your Tiki-Taka vote produced 71% possession, but Ironvale's Counter Blitz caught you twice."

### 1. Tactic Vote

The ballot offers **3 tactics** (drawn from the pool below, weighted by what suits the roster, seeded). Each tactic applies **rating bonuses and penalties** for this match only, plus action-weight changes in the chain engine.

| Tactic | Bonus | Penalty | Engine effect |
|---|---|---|---|
| **Shoot on Sight** | +8 finishing | −6 passing | Shot attempts +40%, long shots allowed from mid zone |
| **Tiki-Taka** | +8 passing, +4 vision | −5 finishing | More pass steps per chain, fewer turnovers |
| **Lock the Door** | +8 tackling, +6 positioning | −8 finishing | Opponent shot quality −10, own shots −30% |
| **Counter Blitz** | +8 pace | −5 passing in own half | Turnovers in def zone can skip straight to attack zone |
| **High Press** | +6 tackling (in attack zone) | Stamina drain 1.5× | More turnovers high up the pitch; late-game fade |
| **Air Raid** | +8 aerial | −6 dribbling | Long balls & crosses favored, set-piece bonus |
| **Showtime** | +8 dribbling | −6 composure | Showboat-style chaos: more highlight goals and more giveaways |

**Matchups (rock-paper-scissors layer).** Opponents vote on their own tactic. Some tactics counter others; the counter gives the winning side **+5 to its tactic's bonus stats**:
- High Press beats Tiki-Taka · Counter Blitz beats High Press & Shoot on Sight · Lock the Door beats Shoot on Sight & Showtime · Air Raid beats Lock the Door · Tiki-Taka beats Counter Blitz & Air Raid · Showtime beats High Press.

**Scouting (the strategy hook):** the ballot shows the **opponent fan base's current lean** (e.g. "Ironvale fans: 48% High Press"). Their final vote isn't revealed until kickoff, so the player is reading a rival crowd, not a fixed answer. The Analyst persona sees the lean with more precision; the Prophet gets a hint of late swings.

**Tactic ≠ Style.** A club's **Style** (§B5) is its long-term identity (changed only by elections/events). The **Tactic** is a one-match overlay on top of it. Voting against your club's Style is allowed but carries a −3 "unfamiliar" penalty, so fans are rewarded for building an identity.

### 2. Armband Vote (captain for the match)

The ballot lists **3 candidates** from the starting five (seeded, favoring form and Drive variety). The elected **Captain**:
- Gets **+6 composure** and their **Drive is amplified** for the match (a Selfish captain shoots even more; a Conductor captain boosts teammates more).
- Takes penalties and gets priority in late-game "big moment" rolls.
- **Captain's Bonus:** if the captain scores, assists, or (for Anchor/Keeper) the team keeps a clean sheet, every fan who voted for them gets a small coin reward.
- **Captain's Burden:** if the captain gets a red card or misses a penalty, club fan morale drops for a week (small negative to next match's free-vote budget for simulated fans — not the player's).
- Repeated captaincy builds a visible **"Fan Favorite"** badge on the player card and feeds narrative ("Elected captain 9 times in a row").

### 3. Prediction
Existing betting, relabeled (§B8). Placed on the same ballot screen so all three decisions happen in one visit.

### Why these three
Tactic = *how* the club plays (system-level), Armband = *who* the club backs (character-level), Prediction = *what* you think will happen (personal stake). Three different kinds of decision, one tap each, under 30 seconds total.

### Alternative interactions (backlog, not MVP)
- **Lineup Recall:** vote to bench one starter (fans can be cruel; benched players may get a "Spurned" mod).
- **Chant of the Match:** pick a chant that gives a small momentum boost at a chosen phase (first 15 / last 15 minutes).
- **Halftime Referendum:** a 1-question vote at halftime to switch tactic (great for live viewing, harder for catch-up sim — needs a default).

## B8. Predictions (betting)

**Decided:** the UI says **"Predictions"** everywhere from day one — never "bet", "wager", "odds", or "gamble" in user-facing copy (use "payout" sparingly, prefer "reward"). Code may keep internal `bet` identifiers. Coins are earn-only and never purchasable.

Reuse base betting/odds (`src/engine/odds.ts`) with soccer markets:
- **Match result:** home / draw / away (3-way, replaces 2-way).
- **Both teams score:** yes/no.
- **First scorer:** pick a player (higher payout).
- **Over/under 2.5 goals.**

Persona perks map 1:1: Diehard (bonus on own club), Gambler (better underdog payouts), etc. MVP 1 ships 3-way result only; other markets in MVP 2.

## B9. Narrative voice

- **The Director:** cold, institutional announcements. Template category `director.*`.
- **Broadcast feed:** energetic commentary for play-by-play.
- **Fan base chatter:** each club's fans react in headlines ("Ironvale fans furious after Cold Room vote passes 61–39").
- **Dorm rumors:** low-confidence hints about upcoming events (Prophet persona sees more).

Play-by-play examples (templates, original):
- "Okafor wins it back in midfield — threads it wide to Lindqvist."
- "Lindqvist cuts inside… SHOT… off the post! The facility goes silent."
- "GOAL. Vance. 78'. The Selfish one wanted that all to himself."
- "Director: Lights Out in effect. Five minutes. Good luck."

Target ~300 templates at launch (base already supports this volume).

## B10. Screens (base tabs, relabeled)

| Base tab | New label | Changes |
|---|---|---|
| Today | **Bulletin** | Director announcement card, **Matchday Ballot card** (countdown + 3 decisions), your club's next match, election countdown, coins |
| Games | **Matches** | Live feed with minute clock, score, zone strip (3-segment bar showing ball zone), Key Moments speed mode |
| League | **Facility** | Standings (W/D/L, GD, Pts), clubs, players, Ejection line shown on table |
| Vote | **Vote** | Proposals with **"helps / hurts your club"** badge, coalition lean bars, vote purchase |
| History | **Archive** | Seasons, notable events, pinned matches, Sub-Level Archive |

**Key Moments mode (new speed option):** Live / 2× / 5× / **Key Moments** / Instant. Key Moments skips chains with no shot, card, or chaos event. This is the fix for low-scoring dullness.

**Accessibility (unchanged):** reduced motion, color never the only signal, 44px targets, screen-reader feed.

## B10a. Live Pitch View + Play Log (Matches screen)

When a match is simulating (Live / 2× / 5× / Key Moments), the Matches screen shows a **schematic pitch on top and the play log underneath**. Instant mode skips straight to the recap with a static "phase map".

### Layout (380px phone, portrait)
```
┌───────────────────────────────┐
│ IRN 1 – 0 VSP     63'   ◐ M+3 │  score · clock · momentum
├───────────────────────────────┤
│▐ K  A  │ W    W  │  P      ▐│  walled arena, all 10 shown
│▐   a   │  w ●→w  │    k    ▐│  ● ball, bank lines off walls
│ [Mid Block ▏▏▏ line]          │  defending block shown as a band
├───────────────────────────────┤
│ IRN: PROGRESSION · through    │  phase chip (attack)
│ VSP: MID BLOCK                │  phase chip (defense)
├───────────────────────────────┤
│ 63' Okafor threads it through │  play log (newest on top)
│ 62' ⚡ TRANSITION: VSP counter-│
│     press fails — IRN break   │
└───────────────────────────────┘
```

### What the pitch draws (SVG, no canvas, no physics)
- **Arena:** drawn from the arena's shape data (rectangle, Narrows, Octagon…) with thick wall outlines; the third holding the ball is highlighted in the attacking club's color. Orientation flips so the **player's own club always attacks left→right**.
- **All 10 players are drawn** as tokens (club color, initials, position letter K/A/W/P, Drive icon). Each sits in its engine-assigned 3×3 cell, offset within the cell so tokens don't overlap. Tokens tween between cells (~300ms).
- **Ball:** a dot that moves between the carrier's token and the target; `wallPass` / `wallShot` draw a **bank line** that bounces off the wall.
- **Bonds & Rivalries:** a faint line between bonded teammates when they combine; a red pulse when rivals duel.
- **Defensive block:** a translucent band at High / Mid / Low depth for the defending team — this is how phases 4–6 become visible.
- **Phase-specific overlays:**
  - Build-up / Progression / Creation → third highlight + route arrow
  - High / Mid / Low Block → block band position
  - Transitions → a 1-second **flash ring** at the turnover spot plus a chip "COUNTER-PRESS" / "RETREAT" / "COUNTER!" / "RESET"
  - Set pieces → ball snaps to the free-kick spot, Spot Kick mark, or penalty spot; wall players shown in place
  - Signature Moves & Awakenings → full-arena flash, name banner, extended log card
  - Power play → the missing player's slot shown as an empty dashed token with a countdown
  - Shots → line to goal; result glyph (⚽ goal, 🧤 save, ✕ wide, ▮ woodwork, ◼ blocked)
  - Facility events → electric-blue border pulse + Director line in monospace

### Play log
- Newest at top, grouped by **phase sequence** (one possession chain = one collapsible row in 5× / Key Moments; expanded in Live).
- Each row: minute · **phase tag** (colored chip with icon *and* text label, so color is never the only signal) · narrative line from templates.
- Filter chips: All · Key Moments · Goals & Shots · Transitions · Set Pieces · Facility.
- Tapping a log row **scrubs the pitch** to that moment (replay is free because events are deterministic).

### Phase chip colors (from §B11 palette)
In-possession = Blast Orange tints · Out-of-possession = Facility Steel · Transitions = white flash · Set pieces = amber · Facility = Electric Blue.

### Post-match recap additions
- **Phase bar:** a stacked horizontal bar per team showing % of match time in each phase.
- **Phase map:** small static pitch with dots for every shot (colored by phase it came from: open play / transition / set piece).
- One cause line that references phases when relevant: "3 of Vespera's 4 shots came from counter-attacks after your Counter-press failed."

### Accessibility & performance
- Reduced motion: no tweening; ball jumps to anchors; flashes become static outlines.
- Screen reader: pitch is `aria-hidden`; the log is the accessible source, and each row announces phase + text.
- Pitch renders from the event stream only (pure function `pitchStateAt(events, index)`), so it costs nothing in the worker and stays deterministic.

## B11. Visual identity

Keep base palette and card system. Adjust:
- **Base** `#0B0B0F`, **Surface** `#16161D` — unchanged (fits the facility).
- **Primary** Blast Orange `#FF7A1A` → live match / goals.
- **Accent** Electric Blue `#2E8BFF` → **The Director, facility events, Vanished/Returned** (the "strange").
- Add **Facility Steel** `#3A3F4B` for panels/frames that read as glass-and-steel.
- **Cards:** same rarity frames; add club crest (procedural geometric) and Drive icon. Position badge replaces baseball position.
- Director messages render in a monospace "system" style to separate the facility's voice.

## B12. IP review checklist (before any public release)

- [ ] No Blue Lock names, character archetypes named after its cast, or facility terms
- [ ] No anime art style copy; procedural geometric art only
- [ ] No real clubs, leagues, crests, kits, players
- [ ] Trademark search on "Democracy FC"
- [ ] Faction and club names generated from original lists only

---

# PART C — TECHNICAL CONVERSION PLAN

## C1. Strategy

Introduce a **sport abstraction** so the shell is sport-agnostic, then add soccer as a new sport. Do not delete baseball in the first pass; it keeps old saves loadable and proves the abstraction.

```
src/
  engine/
    core/          # NEW: rng.ts (moved), sport.ts (SportEngine interface), types-core.ts
    baseball/      # MOVED: game.ts, v2/, boxScore.ts, baseball types
    soccer/        # NEW: game.ts, chain.ts, setPieces.ts, boxScore.ts, types.ts, calibrate.ts
    season.ts      # becomes sport-agnostic (uses SportEngine)
    odds.ts        # gains 3-way market
  world/           # mostly relabel; generate/teams/players become sport-aware
  narrative/       # playByPlay.ts gets per-sport template sets
content/
  soccer/          # NEW: names, pitch traits, weird packs, templates, proposals
```

## C2. SportEngine interface

```ts
// src/engine/core/sport.ts
export type SportId = 'baseball' | 'soccer';

export interface SportEngine<P, T, E extends { kind: string }> {
  id: SportId;
  engineVersion: number;
  /** Pure, deterministic. Same inputs => same output. */
  simulate(league: League<P, T>, game: ScheduledGame, ctx: SimContext): MatchResult<E>;
  /** Rolls hidden ratings into visible star groups. */
  starGroups(player: P): Record<string, number>;
  /** Picks lineup for a match (auto, no player input). */
  selectLineup(team: T, league: League<P, T>, day: number): string[];
  /** Win/draw/loss probabilities for odds. */
  estimateOdds(league: League<P, T>, game: ScheduledGame, ctx: SimContext): Outcome3Way;
  allowsDraws: boolean;
}

export interface SimContext {
  universeSeed: string;
  seasonId: number;
  env?: GameEnvironment;      // existing
  activeRules: RuleRef[];     // existing weirdness
  /** Matchday Ballot results per team (soccer). Resolved BEFORE simulate() is called. */
  matchday?: Record<string /*teamId*/, { tactic: TacticId; captainId: string }>;
  knockout?: boolean;
}

export interface MatchResult<E> {
  events: E[];
  score: { home: number; away: number };
  winnerId: string | null;    // null = draw (NEW: base assumes a winner)
  statDeltas: Record<string, Record<string, number>>;
}
```

Universe gains `sport: SportId` (default `'baseball'` for migrated saves). A registry `getSport(id)` returns the engine. `season.ts`, the worker, digest, and odds call through the registry.

**Important:** grep for every place that assumes a winner exists (`winnerId`, `loserId`, standings W/L, bet settlement, digests). Draws break those. Make a checklist from the grep and fix each one.

## C3. Soccer types

```ts
// src/engine/soccer/types.ts
export type SoccerRatingKey =
  | 'finishing' | 'dribbling' | 'firstTouch'
  | 'passing' | 'vision'
  | 'tackling' | 'positioning' | 'aerial'
  | 'pace' | 'stamina' | 'composure'
  | 'reflexes' | 'handling';

export type SoccerPosition = 'K' | 'A' | 'W' | 'P'; // Keeper, Anchor, Wing, Pivot
export type Drive = 'selfish' | 'conductor' | 'predator' | 'wall' | 'showboat' | 'ice' | 'spark';
export type Style = 'allOutAttack' | 'counterPunch' | 'possessionWall' | 'longBallSiege' | 'parkTheBus';
export type Zone = 'def' | 'mid' | 'att';
export type Lane = 'left' | 'center' | 'right';
export type Route = 'around' | 'through' | 'over';
export type Block = 'high' | 'mid' | 'low';
export type Phase =
  | 'buildUp' | 'progression' | 'creation'          // in possession
  | 'highBlock' | 'midBlock' | 'lowBlock'           // out of possession
  | 'defTransition' | 'attTransition'               // transitions
  | 'attSetPiece' | 'defSetPiece';                  // set pieces
export type TacticId = 'shootOnSight' | 'tikiTaka' | 'lockTheDoor' | 'counterBlitz' | 'highPress' | 'airRaid' | 'showtime';

export interface SoccerPlayer {
  id: string; name: string; teamId: string;
  position: SoccerPosition;
  drive: Drive;
  ratings: Record<SoccerRatingKey, number>; // 0–100, hidden
  stamina: number;                          // current, resets per match
  signatureId?: string;
  bonds: Record<string, number>;            // playerId -> strength
  rivals: Record<string, number>;
  awakened?: { seasonId: number; boost: SoccerRatingKey };
  catchphrase: string;
  cell?: { zone: Zone; lane: Lane };        // match-time position
}

export interface SoccerTeam {
  id: string; city: string; name: string; abbr: string;
  colors: [string, string];
  style: Style;
  squad: string[];        // 8 player ids (5 + 3)
  arenaId: string;        // home arena
  fanSize: number;        // NEW: drives fan-base vote budget
}

interface SEventBase {
  minute: number;           // 0–90+
  half: 1 | 2;
  score: { home: number; away: number };
  possessionTeamId?: string;
  zone?: Zone;
  cause?: CauseRef;         // existing environment/weird cause
  momentum?: number;        // -10..+10 (home perspective)
  phase: Phase;             // attacking-team perspective
  defPhase: Phase;          // defending-team perspective
  lane?: Lane;              // for pitch anchor
  route?: Route;            // on advancing actions
  block?: Block;            // defending team's current block
}

export type SoccerEvent = SEventBase & (
  | { kind: 'kickoff'; teamId: string }
  | { kind: 'possession'; teamId: string; playerId: string; zone: Zone }
  | { kind: 'pass'; from: string; to: string; success: boolean; advanced: boolean }
  | { kind: 'dribble'; playerId: string; defenderId: string; success: boolean }
  | { kind: 'longBall'; from: string; to: string | null; success: boolean }
  | { kind: 'tackle'; defenderId: string; victimId: string; foul: boolean }
  | { kind: 'shot'; playerId: string; assistId?: string; quality: number;
      outcome: 'goal' | 'saved' | 'wide' | 'blocked' | 'woodwork'; keeperId: string }
  | { kind: 'goal'; scorerId: string; assistId?: string; teamId: string; ownGoal?: boolean }
  | { kind: 'freeKick' | 'spotKick' | 'keeperRestart'; teamId: string }
  | { kind: 'wallPass'; from: string; to: string; wall: 'left' | 'right'; success: boolean }
  | { kind: 'wallShot'; playerId: string; quality: number; outcome: 'goal' | 'saved' | 'wide' | 'blocked' }
  | { kind: 'scramble'; winnerId: string; loserId: string }
  | { kind: 'teamFouls'; teamId: string; count: number }
  | { kind: 'powerPlay'; teamId: string; untilMinute: number }
  | { kind: 'signature'; playerId: string; signatureId: string }
  | { kind: 'awakening'; playerId: string }
  | { kind: 'penalty'; takerId: string; keeperId: string; scored: boolean }
  | { kind: 'card'; playerId: string; color: 'yellow' | 'red' }
  | { kind: 'injury'; playerId: string; matches: number }
  | { kind: 'sub'; outId: string; inId: string }
  | { kind: 'halfTime' } | { kind: 'fullTime'; winnerId: string | null }
  | { kind: 'shootout'; kicks: { takerId: string; scored: boolean }[]; winnerId: string }
  | { kind: 'facilityEvent'; eventId: string; text: string }   // Director chaos
  | { kind: 'transition'; wonBy: string; lostBy: string;
      attChoice: 'counter' | 'secure'; defChoice: 'counterPress' | 'retreat';
      outcome: 'regained' | 'breakaway' | 'settled' }
  | { kind: 'blockChange'; teamId: string; block: Block }
  | { kind: 'setPieceSetup'; teamId: string; setup: 'zonal' | 'man' | 'mixed' }
);
```

## C4. Content schemas (JSON)

`content/soccer/weird/core.json` — same shape as base `content/weird/core.json`; rename `deathsPerSeason` → keep key for compatibility but read as vanish rate, and add soccer `deathCauses` → `vanishCauses`. Player mods use `SoccerRatingKey` deltas.

`content/soccer/proposals.json` — **new `favors` field** for club self-interest:

```json
{
  "id": "outside-box-double",
  "title": "Long-Range Goals Count Double",
  "type": "matchRule",
  "effect": { "goalValue": { "condition": "shotZone=mid", "value": 2 } },
  "duration": { "weeks": 2 },
  "favors": { "stars": { "attack": 1 }, "drives": ["showboat", "selfish"], "styles": ["longBallSiege"] },
  "hurts":  { "styles": ["parkTheBus"] },
  "factionLean": { "chaosChoir": 2, "purists": -2 }
}
```

`benefit(club, proposal)` = weighted sum of how much the club's roster/style matches `favors` minus `hurts`, plus a **standings term** for targeted proposals (top club opposes sabotage on "best record"). Integer math. Unit-test with fixtures.

`content/soccer/pitches.json` — pitch traits (replaces stadium env). `content/soccer/templates.json` — narrative templates keyed by `SoccerEvent.kind` + context. `content/soccer/names.json` — original player/club/city name lists.

## C5. File-by-file change map

| File | Action | Notes |
|---|---|---|
| `src/engine/rng.ts` | **Move** → `engine/core/rng.ts` | No logic change |
| `src/engine/types.ts` | **Split** | Core types → `core/types-core.ts`; baseball → `baseball/types.ts` |
| `src/engine/game.ts`, `v2/game.ts`, `boxScore.ts` | **Move** → `engine/baseball/` | Wrap in `SportEngine` adapter |
| `src/engine/season.ts` | **Refactor** | Call `getSport(universe.sport)`; support draws in standings (W/D/L, points = 3/1/0 for soccer) |
| `src/engine/odds.ts` | **Extend** | 3-way market; keep 2-way for baseball |
| `src/engine/soccer/*` | **New** | `walls.ts` (wallPass, wallShot, scrambles), `fouls.ts` (accumulated fouls, Spot Kicks, power plays), `personality.ts` (signatures, bonds, rivalries, awakening), `phase.ts` (phaseOf, block choice, transition roll), `game.ts` (match loop), `chain.ts`, `setPieces.ts`, `momentum.ts`, `lineup.ts`, `boxScore.ts`, `calibrate.ts` |
| `src/world/generate.ts`, `teams.ts` | **Sport-aware** | Soccer squads (16), style, fanSize, drives |
| `src/world/universe.ts` (1,448 lines) | **Careful refactor** | Largest file; add `sport` + `favoriteClubId`; replace baseball assumptions with engine calls. Do this in small commits. |
| `src/world/elections.ts` | **Extend** | Add club fan-base voters + `benefit()`; keep faction + quadratic logic |
| `src/world/factions.ts`, `factionNews.ts` | **Retheme** | New names; club fan-base headlines |
| `src/world/weird.ts`, `environment.ts` | **Generalize** | Read rating keys from sport; pitch traits for soccer |
| `src/world/relegation.ts` | **Reuse** | Becomes Ejection; label change |
| `src/world/digest.ts` | **Extend** | Draws; Director bulletin items ranked first |
| `src/world/persona.ts`, `rarity.ts`, `clock.ts`, `seasons.ts`, `leaders.ts`, `picks.ts` | **Mostly keep** | Leaders: goals/assists/clean sheets; picks: soccer markets |
| `src/narrative/playByPlay.ts`, `templates.ts` | **Per-sport** | Template set chosen by sport |
| `src/storage/*` | **Keep** | Add migration: `sport` defaults to `'baseball'`; bump `saveVersion` |
| `src/worker/*` | **Keep** | Engine selected by universe sport |
| `src/ui/screens/*` | **Relabel + adapt** | GameView: minute clock, zone strip, Key Moments; League: W/D/L/GD/Pts table; Vote: helps/hurts badges, coalition bars; Universes: sport + club picker |
| `src/ui/components/PitchView.tsx` | **New** | SVG schematic pitch; renders from `pitchStateAt(events, i)` (§B10a) |
| `src/ui/components/PlayLog.tsx` | **New** | Phase-tagged, filterable, tap-to-scrub log |
| `src/ui/pitch/pitchState.ts` | **New** | Pure reducer: events → ball anchor, tokens, block band, overlays |
| `src/ui/components/PlayerCard.tsx` | **Adapt** | Star groups from engine; Drive, signature, bonds, catchphrase; Keeper group |
| `src/ui/components/BetPanel.tsx` | **Adapt** | 3-way result |
| `src/ui/components/Onboarding.tsx` | **Rewrite copy** | Facility framing, ≤4 screens, pick club |

## C6. Saves & migration

- Bump `saveVersion`. Migration: existing universes get `sport: 'baseball'`, `favoriteClubId: null`.
- Soccer is the only option in new-universe creation (**decided: baseball is hidden**). Old baseball saves still load and play on the baseball engine.
- Export extension stays `.league`; include `sport` in metadata.
- Determinism guarantee is per engine major version, per sport.

## C7. Sprint plan (each with definition of done)

**S1 — Sport abstraction (no behavior change)**
Create `engine/core`, move baseball under `engine/baseball`, add `SportEngine` + registry, route `season.ts`/worker through it.
*DoD:* all existing tests pass unchanged; a determinism test proves baseball output is byte-identical to before.

**S2 — Draw support across the shell**
W/D/L standings, points, `winnerId: null`, bet settlement for draws, digest wording.
*DoD:* a stub soccer engine returning fixed draws flows through standings, bets, digest without errors.

**S3 — Soccer engine v1**
Types, generator (squads, drives, styles), possession chains, shots, goals, half/full time, auto lineup.
*DoD:* calibration test (§B5 targets) passes on 1,000 seeded matches; property test: same seed ⇒ identical events; no `Math.random`; engine has zero UI/storage imports.

**S4 — Set pieces, cards, injuries, momentum, shootouts**
*DoD:* calibration still in range; red card measurably reduces that team's goals in aggregate test; shootout always produces a winner.

**S4b — Phase Engine**
`phase.ts`, block selection, transitions, route/lane on actions, set-piece setups, phase stats in box score.
*DoD:* every event has a valid `phase`/`defPhase`; all 10 phases appear in a 100-match sample; High Block produces more `def`-zone turnovers than Low Block (aggregate test); calibration (§B5) still passes.

**S4c — Arena & personality layer**
Walls (`wallPass`, `wallShot`, scrambles), accumulated fouls + Spot Kicks + power plays, signature moves, bonds/rivalries, awakening, arenas.json.
*DoD:* calibration (§B5, 5v5 targets) passes; power play measurably raises opponent scoring; each arena moves its target stat in the expected direction over 500 matches; ≤3 Awakenings per season over 20 seeds.

**S5 — Soccer world & content**
Names, pitch traits, weird pack retheme, Vanished/Sub-Level Archive, Director events, ~150 templates.
*DoD:* a full season at each chaos level runs with no exceptions; vanish counts per season within ±50% of config over 20 seeds.

**S6 — Club fan-base voting**
`favoriteClubId`, fan size, `benefit()`, proposals with `favors/hurts`, sabotage/boost/ejection proposals, coalition lean data.
*DoD:* unit tests: a Long-Ball club scores the wind rule higher than a Park-the-Bus club; top club votes against "best record" sabotage; player's coins measurably swing a close election.

**S6b — Matchday Ballot (club democracy)**
`content/soccer/tactics.json` (bonuses, penalties, engine weights, `beats[]`), ballot generation (3 tactics + 3 captains, seeded), supporter blocs per club, free vote + quadratic coin votes, resolution at kickoff (stored as a world event so replays stay deterministic), captain bonus/burden, recap cause lines.
*DoD:* ballots resolve identically on replay; aggregate test shows each tactic moves its target stat in the right direction over 500 matches; counter matchups produce a measurable edge; skipping the ballot never blocks a match.

**S7 — UI conversion**
Relabel tabs; match view with **Live Pitch View + Play Log (§B10a)**, minute clock, Key Moments; league table; vote helps/hurts + coalition bars; club picker in universe creation; PlayerCard star groups/Drive; onboarding copy.
*DoD:* new player can create a universe, watch a match in Key Moments, place a bet, and vote in under 3 minutes on a 380px screen; Lighthouse PWA checks still pass.

**S8 — Polish & content fill**
Templates to ~300, fan-base headlines, Director voice pass, extra bet markets, IP checklist §B12.
*DoD:* checklist complete; 3-season soak test on mid-range phone without load-time regression > 20% vs. baseball.

## C8. Testing additions

- `tests/soccer.calibration.test.ts` — statistical targets (§B5).
- `tests/soccer.determinism.test.ts` — fast-check: random seeds ⇒ replay identical.
- `tests/elections.clubs.test.ts` — benefit scoring fixtures.
- `tests/matchday.test.ts` — ballot generation, resolution determinism, tactic effects, counters, captain rewards.
- `tests/soccer.phase.test.ts` — phase coverage, block/transition effects, phaseOf purity.
- `tests/pitchState.test.ts` — same events ⇒ same pitch frames; every event maps to a valid anchor.
- `tests/soccer.walls.test.ts` — no throw-in/corner/goal-kick events ever emitted; wall actions resolve.
- `tests/soccer.personality.test.ts` — bonds/rivalries form from events; awakening rate bounded.
- `tests/draws.test.ts` — standings, bets, digest with draws.
- `tests/migrate.sport.test.ts` — old baseball save loads with `sport: 'baseball'`.

---

## D. Decisions log
1. Theme: isolated elite facility; player is an outside fan, never a manager.
2. Death replaced by **Vanished** (Sub-Levels); return only by election.
3. Club fan bases vote self-interestedly; ideological factions remain as swing voters.
4. Tactics = one auto Style per club; no formations.
5. Baseball engine retained behind the sport abstraction for old saves, hidden from creation.
6. Club switching: once per season, resets coins to 0.
7. All wagering UI copy uses "Predictions".
8. Default league size 12.
9. Clubs are fan-run: Matchday Ballot (Tactic + Armband + Prediction) before every club match.
10. Every match moment is labeled with one of 10 phases (§B5a); a 2D arena + phase-tagged play log shows them live (§B10a).
11. **Format: 5v5 in sealed walled arenas.** Ball plays off walls; no throw-ins, corners, goal kicks.
12. Fouls, cards, penalties kept; accumulated-foul Spot Kicks; red card = 2-minute power play.
13. Squad 5 + 3; positions Keeper / Anchor / Wing ×2 / Pivot; fixed Keeper; rolling subs.
14. Two 20-minute halves.
15. Personality layer: Drive + Signature Move + Bonds/Rivalries + rare Awakening; arenas have visible architecture.

## E. Resolved decisions (were open questions)
1. **Name:** Democracy FC — Vote Chaos (trademark check still required; see §B12). Facility in-world name: **The Assembly**.
2. **Baseball:** hidden from new-universe creation; legacy saves still load.
3. **Club switching:** any time, once per season, costs all coins (§B2).
4. **Betting language:** "Predictions" in all UI copy from day one (§B8).
5. **League size:** default 12 clubs.
