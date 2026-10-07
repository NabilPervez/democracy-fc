import { useEffect, type ReactNode } from 'react';
import { setSetting } from '../../storage/db';
import { MAX_CATCHUP_DAYS } from '../../world/clock';
import { ORGANIZER_DISCOUNT_PCT } from '../../world/elections';
import { FACTION_BUDGET } from '../../world/factions';
import { DIEHARD_BONUS_PCT, GAMBLER_UNDERDOG_PCT, LEVEL_THRESHOLDS, PERSONA_KINDS, PERSONAS, REBRAND_COST, xpOf } from '../../world/persona';
import { PersonaLevels } from '../components/PersonaBits';
import { FINAL_BEST_OF, SEMIS_BEST_OF } from '../../world/seasons';
import { MAX_BACKED, MAX_FADED, PICK_RATES } from '../../world/picks';
import { ENVIRONMENT } from '../../world/environment';
import { BAILOUT_COINS, DAILY_STIPEND, FAVORITE_WIN_BONUS, PATRON_BLESSING, PATRON_COST, PATRON_FROM_SEASON, RULES, STARTING_COINS } from '../../world/universe';
import { BACKUP_EVERY_DAYS } from '../components/TimeBits';
import { useGame } from '../store';
import { RIVAL_MIN_GAMES, TEAM_PERKS } from '../../world/teams';
import { GROUP_HELP, RATING_HELP, describeDelta } from '../../world/statHelp';
import type { RatingKey } from '../../engine/baseball/types';

type Status = 'live' | 'soon';

const SECTIONS = [
  ['idea', 'The idea'],
  ['loop', 'The core loop'],
  ['ladder', 'Your powers'],
  ['time', 'Time'],
  ['watch', 'Watching games'],
  ['bet', 'Coins & betting'],
  ['persona', 'Fan personas'],
  ['picks', 'Favorite team & player picks'],
  ['vote', 'Elections & factions'],
  ['stats', 'What the ratings do'],
  ['weird', 'Weirdness'],
  ['death', 'Death & the Departed'],
  ['seasons', 'Seasons, playoffs & aging'],
  ['patron', 'Patron'],
  ['cards', 'Player cards'],
  ['history', 'History & news'],
  ['saves', 'Saves, backups & offline'],
  ['soon', 'Coming soon'],
  ['faq', 'FAQ'],
] as const;

function Section({ id, title, status = 'live', children }: { id: string; title: string; status?: Status; children: ReactNode }) {
  return (
    <section id={`g-${id}`} className="guide-section card pad" aria-labelledby={`gt-${id}`}>
      <h2 id={`gt-${id}`} className="guide-h">
        {title} {status === 'soon' && <span className="pill">Coming soon</span>}
      </h2>
      {children}
    </section>
  );
}

function Ladder() {
  const u = useGame((s) => s.u);
  const rows: { tier: string; unlock: string; ability: string; unlocked: boolean | null; soon?: boolean }[] = [
    { tier: 'Observer', unlock: 'From the start', ability: 'Watch games, follow teams and players', unlocked: true },
    { tier: 'Gambler', unlock: 'From the start', ability: 'Bet coins on games', unlocked: true },
    { tier: 'Voter', unlock: 'First election', ability: 'Buy votes to shape the rules', unlocked: u ? u.elections.length > 0 : null },
    { tier: 'Patron', unlock: `Season ${PATRON_FROM_SEASON}`, ability: `Sponsor a team (+${PATRON_BLESSING} to its players for a season)`, unlocked: u ? u.season >= PATRON_FROM_SEASON : null },
    { tier: 'Commissioner', unlock: 'Toggle any time', ability: 'Edit the world directly — marks the save as Commissioner forever', unlocked: false, soon: true },
  ];
  return (
    <div className="table-wrap">
      <table className="stat-table guide-table">
        <thead>
          <tr>
            <th scope="col">Tier</th>
            <th scope="col">Unlocks</th>
            <th scope="col">What you can do</th>
            <th scope="col">{u ? 'You' : ''}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tier}>
              <th scope="row">{r.tier}</th>
              <td>{r.unlock}</td>
              <td>{r.ability}</td>
              <td>{r.soon ? <span className="pill">Soon</span> : r.unlocked === null ? '' : r.unlocked ? '✓ Unlocked' : 'Locked'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Guide() {
  const { showIntro } = useGame();
  const u = useGame((s) => s.u);
  useEffect(() => {
    void setSetting('guideOpened', true);
  }, []);

  return (
    <section className="guide">
      <header className="screen-head">
        <h1>Guide</h1>
        <button className="btn" onClick={showIntro}>
          Replay the intro
        </button>
      </header>
      <p className="muted">Everything you can do in Blastball — what's here now, and what's on the way.</p>

      <nav className="card pad guide-toc" aria-label="Guide contents">
        <ol>
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#g-${id}`}>{label}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="idea" title="The idea">
        <p>Blastball is a fictional, slightly absurd sports league that plays itself. You never control a game. You're a fan living inside a strange sports universe: you watch, bet, vote, and over many seasons the simulation tells its own stories — rivalries, slumps, curses, deaths, returns, rules nobody asked for.</p>
        <p>Every league comes from a <strong>seed</strong>. The same seed always builds the same league, so you can share yours with a friend.</p>
      </Section>

      <Section id="loop" title="The core loop">
        <ol className="guide-steps">
          <li>Check in and read <em>While You Were Gone</em>.</li>
          <li>Watch or skim today's games.</li>
          <li>Bet coins on games you have a feeling about.</li>
          <li>Spend coins on votes in the weekly election.</li>
          <li>The election resolves, the rules change, the world gets stranger. Repeat.</li>
        </ol>
        <p className="muted small">Betting is how you earn influence; influence is how you shape the world.</p>
      </Section>

      <Section id="ladder" title="Your powers">
        <Ladder />
      </Section>

      <Section id="time" title="Time">
        <p>
          <strong>Living</strong> (default): one in-game day passes every 15 minutes, 30 minutes, 1 hour, 4 hours or 1 real day — your choice, changeable any time in Settings. The league keeps playing while the app is closed. When you return it catches up on up to {MAX_CATCHUP_DAYS} missed days; after a week away it pauses and waits for you.
        </p>
        <p>
          <strong>Manual</strong>: time only moves when you press a control — <em>Next game</em>, <em>Finish day</em>, <em>Next week</em>, or <em>To season end</em>.
        </p>
      </Section>

      <Section id="watch" title="Watching games">
        <p>
          <strong>Now playing</strong>: games you start (open one, or press <em>Play all</em> on Games) play live in a bar at the top of every screen. It shows the score, inning, bases, outs and the latest play. In Manual mode nothing starts on its own. In Living mode every game starts together at <em>first pitch</em> (25% into the day by default — change it in Settings); come back later and they'll be exactly as far along as the clock says. Tap it to watch the full feed, or pause it with ❚❚.
        </p>
        <p>Open any of today's games to watch it pitch by pitch, with a scoreboard, the bases, the count and outs. Choose Live, 2× or 5× speed, pause, or jump to the final with Instant.</p>
        <p>
          Beyond hits, walks and outs, games have <strong>stolen bases</strong> (and runners caught stealing), <strong>pickoffs</strong>, <strong>errors</strong>, <strong>double plays</strong>, <strong>wild pitches</strong> and batters <strong>hit by pitches</strong>. Player stats track them: SB, CS, GIDP, HBP and E for hitters, WP and HBP for pitchers. League leaders include stolen bases and fielding (fewest errors per game).
        </p>
        <p className="small muted">Leagues started before this update keep their current season exactly as it was and gain these plays from their next season.</p>
        <p>Play-by-play is kept for the last 7 days. <strong>Pin</strong> a finished game to keep its feed forever — find pinned games in History.</p>
        <p className="muted small">Opening a game counts as starting it: bets on that game close.</p>
      </Section>

      <Section id="bet" title="Coins & betting">
        <p>
          You start with {STARTING_COINS} coins and get a {DAILY_STIPEND}-coin stipend every day, so you can never be shut out. Bet on any of today's games before it starts. Odds come only from public information — star ratings, today's starting pitcher and the standings — with a small house edge. A winning bet pays your stake times the multiplier shown.
        </p>
        <p className="muted small">You can add to a bet, but you can't back both sides of the same game.</p>
        <p>
          <strong>Quick bets</strong>: on the Games tab, pick an amount and tap once to put it on every favorite (or every underdog) in today's open games.
        </p>
        <p>
          <strong>Broke?</strong> If you run out of coins with no bets still riding, the league office hands you {BAILOUT_COINS} coins to get back in the game (at most once a day).
        </p>
      </Section>

      <Section id="persona" title="Fan personas">
        <p>
          You pick a persona when you create a league. Doing things that fit it earns <strong>Devotion XP</strong>: a Gambler winning underdog bets, an Organizer voting on the winning side, a Storm Chaser seeing the weather change a play. At {LEVEL_THRESHOLDS[1]} XP you reach Level 2 and a second perk; at {LEVEL_THRESHOLDS[2]} XP, Level 3 and a signature ability (used from the Today tab) plus a gold edge on your fan card. Level 2 takes about one or two seasons of regular play, Level 3 about three to five.
        </p>
        <p className="small">
          You can <strong>Rebrand</strong> into a different persona from your fan card for {REBRAND_COST} coins. XP starts over.
        </p>
        <div className="guide-personas">
          {PERSONA_KINDS.map((k) => (
            <div key={k} className="card pad">
              <p>
                <strong>{PERSONAS[k].label}</strong> {PERSONAS[k].isNew && <span className="pill new-pill">New</span>} — <span className="muted">{PERSONAS[k].flavor}</span>
                {u?.persona?.kind === k && <span className="pill"> yours</span>}
              </p>
              <PersonaLevels kind={k} xp={u?.persona?.kind === k ? xpOf(u.persona) : null} compact />
            </div>
          ))}
        </div>
        <p className="muted small">
          Exact numbers: Diehard +{DIEHARD_BONUS_PCT}% of the stake on winning bets for their team; Gambler +{GAMBLER_UNDERDOG_PCT}% on underdog odds; Organizer −{ORGANIZER_DISCOUNT_PCT}% vote prices. Locked perks show 🔒; perks for your persona unlock as your XP grows.
        </p>
      </Section>

      <Section id="picks" title="Favorite team & player picks">
        <p>
          <strong>Favorite team</strong>: pick (or change) your team any time during Season 1 from the fan card on Today. Every time they win you get +{FAVORITE_WIN_BONUS} coins. It locks in after Season 1 — choose wisely.
        </p>
        <p>
          <strong>Player picks</strong>: open any player and choose ▲ <em>Back</em> or ▼ <em>Fade</em>. You can back up to {MAX_BACKED} players and fade up to {MAX_FADED}. After every game:
        </p>
        <ul className="guide-list">
          <li>Backed hitter: +{PICK_RATES.backHit} per hit, +{PICK_RATES.backHomeRun} more per home run, and +{PICK_RATES.backSteal} per stolen base.</li>
          <li>Backed pitcher: +{PICK_RATES.backStrikeout} per strikeout thrown.</li>
          <li>Faded hitter: +{PICK_RATES.fadeStrikeout} per strikeout, +{PICK_RATES.fadeHitless} for a hitless game (3+ at-bats), and +{PICK_RATES.fadeCaught} each time they're caught stealing, picked off, or ground into a double play.</li>
          <li>Faded pitcher: +{PICK_RATES.fadeHitAllowed} per hit, +{PICK_RATES.fadeRunAllowed} per run allowed, and +{PICK_RATES.fadeWildPitch} per wild pitch.</li>
        </ul>
        <p className="muted small">Your picks and what they've earned this season are on Today. The League tab's leaderboards show who's hot — hitters and pitchers ranked separately.</p>
      </Section>

      <Section id="vote" title="Elections & factions">
        <p>Each in-game week has an election with three proposals — one is always <em>Keep Things As They Are</em>. Proposals do real things: batting practice for a team, a hand up for last place, humbling the leader, juiced or dead balls, greased basepaths, trading two players, or bringing back one of the Departed.</p>
        <p>
          Six factions — the Statheads, Loyalists, Chaos Choir, Purists, Lore Divers and Casuals — each cast {FACTION_BUDGET} votes, based only on public information and their own tastes and favorite teams. You can see how they're leaning before you vote.
        </p>
        <p>
          Factions react in the news to elections, departures, returns, champions and Patrons. Each one keeps an <strong>opinion of you</strong> — it rises when you vote their way and falls when you don't — and once you've cast enough votes they'll start naming you in headlines.
        </p>
        <p>
          You buy votes with coins at a rising price: <strong>n votes cost n² coins</strong> (1, 4, 9, 16…). Saving up lets you swing a close race; no one can buy everything. Ties go to the status quo.
        </p>
      </Section>

      <Section id="weird" title="Weirdness">
        <p>Most nights something strange might happen. Your league's <strong>chaos</strong> level (Calm, Normal, Weird, Unhinged) sets how often.</p>
        <ul className="guide-list">
          <li>
            <strong>Player traits</strong> (named on every card; some, like Ageless or Burning Bright, change how a player ages):{' '}
            {RULES.playerMods
              .filter((m) => !m.returnedOnly && !m.comboOnly)
              .map((m) => `${m.icon} ${m.name}`)
              .join(', ')}
            . Some last days, some are permanent. Many players are born with one or two, so every season opens with a mix of card rarities.
          </li>
          <li>
            <strong>Combos</strong>: when a player holds two traits that belong together, they fuse into something stronger —{' '}
            {(RULES.combos ?? [])
              .map((c) => `${c.needs.map((n) => RULES.playerMods.find((m) => m.id === n)!.name).join(' + ')} = ${RULES.playerMods.find((m) => m.id === c.result)!.name}`)
              .join('; ')}
            .
          </li>
          <li>
            <strong>Contagious traits</strong> spread to teammates for a few days:{' '}
            {RULES.playerMods
              .filter((m) => m.contagion)
              .map((m) => `${m.icon} ${m.name}`)
              .join(', ')}
            . Higher chaos spreads them faster, and a spread can set off a combo.
          </li>
          <li>
            <strong>Stadium effects</strong>: {RULES.stadiumMods.map((m) => `${m.icon} ${m.name}`).join(', ')}. See them on a team's page.
          </li>
          <li>
            <strong>Climates and environment events</strong>: every stadium has one or two climates ({ENVIRONMENT.climates.map((c) => `${c.icon} ${c.name}`).join(', ')}), shown on its team page. During a game the climate can stir up an event, at most one per half-inning, that changes a real play: a crosswind turns a flyout into a double, a ghost whispers ball four. The play-by-play names the cause on the next line, and a finished game lists what changed. Higher chaos means more of them, and some only happen with a stadium effect (a funnel cloud needs Tornado Alley). Events are never known before the game, only what <em>could</em> happen. Leagues started before this update get them from their next season.
          </li>
          <li>
            <strong>Breakthroughs and slumps</strong> permanently nudge players' ratings.
          </li>
        </ul>
        <p className="muted small">All weirdness is data in a rule pack, so new strangeness can be added without changing the game itself.</p>
      </Section>

      <Section id="death" title="Death & the Departed">
        <p>Very rarely — about 1 to 3 times a season on Normal chaos — a player departs forever. A rookie takes their place, and their card goes grey in the <strong>Hall of the Departed</strong>.</p>
        <p>
          Nobody comes back by chance. The only way back is an election: sometimes a <em>Bring Back…</em> proposal appears. If it wins, the player returns to their old team — changed, with a new modifier — and their card glows blue. Whoever held their spot moves to the Reserves.
        </p>
      </Section>

      <Section id="seasons" title="Seasons, playoffs & aging">
        <p>
          After the regular season the top four teams (top two in a 4-team league) play for the <strong>Blastball Cup</strong>: semifinals are best of {SEMIS_BEST_OF}, the final best of {FINAL_BEST_OF}. Playoff games don't count in the standings. The season's MVP and Ace (best pitcher) are named at the end.
        </p>
        <p><strong>Relegation:</strong> the team that finishes last in the regular season is dissolved. A brand-new franchise — new city, name, colors and a whole new roster — takes its place next season. The old players' stats stay in the record books.</p>
        <p>Then comes a one-day offseason. Everyone ages a year. Careers have an arc: players are <em>Rising</em> until 26, in their <em>Prime</em> from 27 to 30, then <em>Fading</em> and finally in their <em>Twilight</em> before they retire, replaced by rookies. A new league starts mid-history, so most players already have a few seasons behind them. A new schedule is drawn and Season N+1 begins.</p>
      </Section>

      <Section id="stats" title="What the ratings do">
        <p>Every player has eight hidden ratings from 0 to 100. Cards show them as stars (0–5). Traits, team perks, stadiums, rivalries and Patron blessings all add to these numbers on game day — the game engine only ever sees the final ratings. Hover or tap a rating on a player's page for a reminder.</p>
        <dl className="guide-stats">
          {(Object.keys(RATING_HELP) as RatingKey[]).map((k) => (
            <div key={k}>
              <dt>
                {RATING_HELP[k].label} <span className="muted small">· {RATING_HELP[k].who}</span>
              </dt>
              <dd>{RATING_HELP[k].text}</dd>
            </div>
          ))}
        </dl>
        <p className="small">{GROUP_HELP.batting} {GROUP_HELP.pitching} {GROUP_HELP.baserunning} {GROUP_HELP.defense}</p>
        <p className="small muted">Batters use all eight ratings — their pitching ratings count a little (arm, eye, bat). A pitcher's batting, speed and defense ratings never come up, so a trait that only boosts those does nothing for a pitcher.</p>
      </Section>

      <Section id="teams" title="Teams & rivalries">
        <p>Every team has a short history, a motto, and one <strong>team perk</strong> no other team has — a ratings boost for every player on the roster:</p>
        <ul className="small">
          {TEAM_PERKS.map((p) => (
            <li key={p.id}>
              {p.icon} <strong>{p.name}</strong> — {describeDelta(p.delta)}
              {p.homeOnly ? ' (home games only)' : ''}
            </li>
          ))}
        </ul>
        <p>
          A team's page keeps its all-time record and head-to-head results against every opponent. Teams that meet {RIVAL_MIN_GAMES}+ times with a close record become <strong>rivals</strong>: both sides play harder (+3 contact, power, velocity and stuff) whenever they meet.
        </p>
      </Section>

      <Section id="patron" title="Patron">
        <p>
          From Season {PATRON_FROM_SEASON}, you can become a team's Patron for {PATRON_COST} coins: every player on that team gets +{PATRON_BLESSING} to all ratings for the rest of the season. One team per season. Sponsor from Today or from the team's page.
        </p>
      </Section>

      <Section id="cards" title="Player cards">
        <p>Every player is a collectible card with procedurally drawn art, star ratings, their age and career phase, their traits, and a border showing how strange their story is:</p>
        <ul className="guide-list">
          <li>
            Border tiers: <strong>Common</strong> → <strong>Uncommon</strong> → <strong>Rare</strong> → <strong>Epic</strong> → <strong>Legendary</strong>. Traits count most (permanent ones double), then big moments, a trip to the Departed and a long career.
          </li>
          <li>
            <strong>Rookie</strong> (first season) → <strong>Veteran</strong> → <strong>Legend</strong> (a career full of moments).
          </li>
          <li>Some traits change how the card looks: Blessed shimmers, Cursed cracks, Foggy blurs.</li>
          <li>
            Tap <strong>♡ Add to collection</strong> on any player to keep their card in the History tab — as many favorites as you like. It's just for keeps, and the card stays even if they retire or depart.
          </li>
          <li>
            <strong>Departed</strong> cards are desaturated; <strong>Returned</strong> cards glow.
          </li>
        </ul>
        <p>Flip a card on a player's page for their stats. Star groups: Batting, Pitching, Baserunning and Defense, each rolled up from hidden ratings.</p>
      </Section>

      <Section id="history" title="History & news">
        <p>The Today screen shows breaking news; the Vote tab keeps a longer feed. The <strong>History</strong> tab keeps a permanent timeline — elections, departures, returns, strange events, retirements and champions — plus past seasons, pinned games and the Hall of the Departed.</p>
      </Section>

      <Section id="saves" title="Saves, backups & offline">
        <p>There are no accounts and no servers. Your universes are saved automatically in this browser and the app works offline after the first visit.</p>
        <ul className="guide-list">
          <li>
            <strong>Export</strong> a .league file from Settings to back up or move a league; <strong>Import</strong> it anywhere. You'll get a gentle reminder every {BACKUP_EVERY_DAYS} in-game days.
          </li>
          <li>
            <strong>Install</strong> Blastball to your home screen — on iPhone especially, installed apps keep their saves far more reliably.
          </li>
          <li>You can keep several universes and switch between them from the top bar.</li>
        </ul>
      </Section>

      <Section id="soon" title="Coming soon" status="soon">
        <ul className="guide-list">
          <li>
            <strong>Commissioner Mode</strong> — edit the world directly. Using it permanently badges the save as a Commissioner save.
          </li>
          <li>
            <strong>“What If?” branches</strong> — rewind to an earlier snapshot and play out a different future, nested under the original league.
          </li>
          <li>
            <strong>Card motion</strong> — cards that tilt with your pointer or phone, with a foil sheen.
          </li>
          <li>
            <strong>Optional AI headlines</strong> — bring your own AI key for generated recaps (stored only on your device).
          </li>
          <li>Later, maybe: shared rule packs, a community seed gallery, achievements.</li>
        </ul>
      </Section>

      <Section id="faq" title="FAQ">
        <dl className="guide-faq">
          <dt>Can I control the players?</dt>
          <dd>No — that's the point. You influence the world through bets, votes and (later) sponsorship.</dd>
          <dt>I ran out of coins.</dt>
          <dd>You get {DAILY_STIPEND} coins every day. Small, careful bets add up.</dd>
          <dt>Why did my old game lose its play-by-play?</dt>
          <dd>Feeds are kept for 7 days to keep saves small. Pin games you want to keep.</dd>
          <dt>Is the game the same on every device?</dt>
          <dd>Yes — the simulation is deterministic. Same seed and same choices, same results.</dd>
        </dl>
      </Section>
    </section>
  );
}
