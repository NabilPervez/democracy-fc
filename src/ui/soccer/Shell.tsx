import { useEffect, useMemo, useRef, useState } from 'react';
import { exportUniverse, importLeague, leagueFileName } from '../../storage/exportImport';
import { DAY_LENGTHS, formatDuration, msUntilNextDay } from '../../world/clock';
import { PERSONAS, type PersonaId } from '../../world/soccer/persona';
import { generateSoccerLeague } from '../../world/soccer/generate';
import { DEFAULT_DAY_MINUTES, GAME_LENGTHS, PLAYOFF_SIZES, roundsFor, SEASON_LENGTHS, SOCCER_LEAGUE_SIZES, type SeasonLength, type SoccerSettings } from '../../world/soccer/universe';
import type { Chaos } from '../../world/soccer/weird';
import { Bulletin } from './Bulletin';
import { Coins, Crest, ErrorBanner, Tip, useNow } from './bits';
import { HELP } from './help';
import { Archive, Facility, Matches, VoteScreen } from './Screens';
import { useAssembly, type SoccerTab } from './store';

const TABS: { id: SoccerTab; label: string; icon: string }[] = [
  { id: 'bulletin', label: 'Bulletin', icon: '◉' },
  { id: 'matches', label: 'Matches', icon: '◆' },
  { id: 'facility', label: 'Facility', icon: '▤' },
  { id: 'vote', label: 'Vote', icon: '✦' },
  { id: 'archive', label: 'Archive', icon: '⧗' },
];

export function SoccerApp() {
  const { view, tab, setTab, init, finishIntro, showPicker, busy, catchUp, showSettings, catchingUp } = useAssembly();
  const u = useAssembly((s) => s.u);
  useEffect(() => {
    void init();
  }, [init]);

  // Living time: keep the facility turning while the app is open, and catch up when it comes back into view.
  useEffect(() => {
    const tick = () => void catchUp();
    const t = setInterval(tick, 30_000);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [catchUp]);

  if (view === 'loading') return <p className="solo muted">Loading…</p>;
  if (view === 'intro') return <Onboarding onDone={() => void finishIntro()} />;
  if (view === 'picker') return <Picker />;
  if (view === 'create') return <Create />;
  if (view === 'settings') return <Settings />;
  if (!u) return <Picker />;

  return (
    <div className="app dfc">
      <ErrorBanner />
      <nav className="nav" aria-label="Main">
        <div className="brand display">
          DEMOCRACY <span>FC</span>
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={`nav-item ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span className="nav-icon" aria-hidden="true">
              {t.icon}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <main className="main">
        <header className="topbar">
          <button className="topbar-universe" onClick={() => void showPicker()} aria-label="Switch universe">
            <span className="brand-mini display">
              D<span>FC</span>
            </span>
            <span className="topbar-name">{u.settings.name}</span>
            <span className="muted small">⇄</span>
          </button>
          {busy && <span className="muted small" role="status">{catchingUp ? `Catching up ${catchingUp.done}/${catchingUp.total}…` : 'Simulating…'}</span>}
          <Coins />
          <button className="chip" onClick={showSettings} aria-label="Settings">
            ⚙
          </button>
        </header>
        {tab === 'bulletin' && <Bulletin />}
        {tab === 'matches' && <Matches />}
        {tab === 'facility' && <Facility />}
        {tab === 'vote' && <VoteScreen />}
        {tab === 'archive' && <Archive />}
      </main>
    </div>
  );
}

function Picker() {
  const { universes, open, remove, showCreate, showIntro } = useAssembly();
  return (
    <div className="solo dfc">
      <ErrorBanner />
      <p className="eyebrow">The Assembly</p>
      <h1 className="display big">
        DEMOCRACY <span style={{ color: 'var(--primary)' }}>FC</span>
      </h1>
      <p className="muted">A sealed facility. A league that plays itself. You vote on how.</p>
      <button className="btn primary" onClick={showCreate} style={{ margin: '12px 0' }}>
        + New universe
      </button>
      <ul className="universe-list">
        {universes.map((m) => (
          <li key={m.id} className="universe-row card">
            <button className="universe-open" onClick={() => void open(m.id)}>
              <strong>{m.name}</strong>
              <span className="small muted">
                Season {m.season}, day {m.currentDay} · seed {m.seed}
              </span>
            </button>
            <button className="chip" onClick={() => confirm(`Delete "${m.name}"? This can't be undone.`) && void remove(m.id)} aria-label={`Delete ${m.name}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <ImportButton />
      <button className="link-btn" onClick={showIntro}>
        How does this work?
      </button>
    </div>
  );
}

function ImportButton() {
  const input = useRef<HTMLInputElement>(null);
  const { open, showPicker } = useAssembly();
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".league"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const id = await importLeague(file);
            await showPicker();
            await open(id);
          } catch (err) {
            useAssembly.setState({ error: err instanceof Error ? err.message : String(err) });
          }
        }}
      />
      <button className="btn" onClick={() => input.current?.click()}>
        Restore a backup (.league)
      </button>
    </>
  );
}

function Settings() {
  const u = useAssembly((s) => s.u);
  const { closeSettings, dispatch, remove, showIntro } = useAssembly();
  const now = useNow();
  if (!u) return null;
  const living = u.settings.timeMode === 'living';
  const next = u.clock ? msUntilNextDay(u.clock, u.settings.dayLengthMinutes, u.dayCount, now) : null;
  const setTime = (timeMode: 'manual' | 'living', dayLengthMinutes = u.settings.dayLengthMinutes) =>
    void dispatch({ type: 'timeSettingsChanged', timeMode, dayLengthMinutes, nowMs: Date.now() });
  const backup = async () => {
    const blob = await exportUniverse(u.id, { includePlayByPlay: true });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = leagueFileName(u.settings.name);
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="solo dfc">
      <ErrorBanner />
      <button className="link-btn" onClick={closeSettings}>
        ← Back
      </button>
      <h1>Settings</h1>
      <h2>Time</h2>
      <fieldset className="choice-row">
        <legend>How the facility's days pass</legend>
        <button type="button" className="chip" aria-pressed={!living} onClick={() => setTime('manual')}>
          Manual
        </button>
        <button type="button" className="chip" aria-pressed={living} onClick={() => setTime('living')}>
          Living
        </button>
      </fieldset>
      <p className="muted small">
        {living
          ? `A matchday passes every ${DAY_LENGTHS.find((d) => d.minutes === u.settings.dayLengthMinutes)?.label ?? `${u.settings.dayLengthMinutes} minutes`} of real time, even while you're away (up to a week catches up when you return).${next !== null ? ` Next matchday in ${formatDuration(next)}.` : ''}`
          : 'Days only pass when you press play. Good for binge sessions.'}
      </p>
      {living && (
        <fieldset className="choice-row">
          <legend>Day length</legend>
          {DAY_LENGTHS.map((d) => (
            <button type="button" key={d.minutes} className="chip" aria-pressed={u.settings.dayLengthMinutes === d.minutes} onClick={() => setTime('living', d.minutes)}>
              {d.label}
            </button>
          ))}
        </fieldset>
      )}
      <h2>
        <Tip label="Your persona" text={HELP.persona} />
      </h2>
      <PersonaPicker value={u.persona} onChange={(p) => void dispatch({ type: 'personaChosen', persona: p })} />
      <h2>Backup</h2>
      <p className="muted small">Everything lives on this device only. Save a backup file to move or protect your universe.</p>
      <button className="btn" onClick={() => void backup()}>
        Download backup
      </button>
      <h2>Other</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button className="btn" onClick={showIntro}>
          Replay the intro
        </button>
        <a className="btn" href="/privacy.html" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
          Privacy
        </a>
        <button className="btn" onClick={() => confirm(`Delete "${u.settings.name}"? This can't be undone.`) && void remove(u.id)}>
          Delete this universe
        </button>
      </div>
    </div>
  );
}

export function PersonaPicker({ value, onChange }: { value: PersonaId | null; onChange: (p: PersonaId) => void }) {
  return (
    <div className="club-pick">
      {PERSONAS.map((p) => (
        <button type="button" key={p.id} className="card" aria-pressed={value === p.id} onClick={() => onChange(p.id)}>
          <span className="crest" aria-hidden="true" style={{ width: 28, height: 28, background: 'var(--surface-2)', color: 'var(--primary)' }}>
            {p.icon}
          </span>
          <span>
            <strong>{p.name}</strong>
            <br />
            <span className="small muted">{p.perk}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const CHAOS: { id: Chaos; label: string; text: string }[] = [
  { id: 'calm', label: 'Calm', text: 'Rare oddities.' },
  { id: 'normal', label: 'Normal', text: 'The facility is strange.' },
  { id: 'weird', label: 'Weird', text: 'Rules bend weekly.' },
  { id: 'unhinged', label: 'Unhinged', text: 'Nothing is safe.' },
];

function Create() {
  const { create, showPicker } = useAssembly();
  const [name, setName] = useState('The Assembly');
  const [seed, setSeed] = useState(() => crypto.randomUUID().slice(0, 8));
  const [size, setSize] = useState<SoccerSettings['leagueSize']>(12);
  const [chaos, setChaos] = useState<Chaos>('normal');
  const [club, setClub] = useState<number | null>(null);
  const [persona, setPersona] = useState<PersonaId | null>(null);
  const [living, setLiving] = useState(true);
  const [gameLength, setGameLength] = useState<number>(DEFAULT_DAY_MINUTES);
  const [seasonLength, setSeasonLength] = useState<SeasonLength>('standard');
  const [playoffTeams, setPlayoffTeams] = useState<4 | 8>(4);
  const league = useMemo(() => generateSoccerLeague({ seed, name, teamCount: size }), [seed, name, size]);
  return (
    <div className="solo dfc">
      <button className="link-btn" onClick={() => void showPicker()}>
        ← Back
      </button>
      <h1>New universe</h1>
      <form
        className="create-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (club === null) return;
          void create({ name: name.trim() || 'The Assembly', seed, leagueSize: size, chaos, timeMode: living ? 'living' : 'manual', dayLengthMinutes: gameLength, seasonLength, playoffTeams }, club, persona);
        }}
      >
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <label>
          Seed <span className="muted small">(same seed, same world)</span>
          <input value={seed} onChange={(e) => setSeed(e.target.value.slice(0, 24))} />
        </label>
        <fieldset className="choice-row">
          <legend>Clubs</legend>
          {SOCCER_LEAGUE_SIZES.map((n) => (
            <button type="button" key={n} className="chip" aria-pressed={size === n} onClick={() => setSize(n)}>
              {n}
            </button>
          ))}
        </fieldset>
        <fieldset className="choice-row">
          <legend>Chaos</legend>
          {CHAOS.map((c) => (
            <button type="button" key={c.id} className="chip" aria-pressed={chaos === c.id} onClick={() => setChaos(c.id)} title={c.text}>
              {c.label}
            </button>
          ))}
        </fieldset>
        <fieldset className="choice-row">
          <legend>Time</legend>
          <button type="button" className="chip" aria-pressed={!living} onClick={() => setLiving(false)} title="Days pass when you press play">
            Manual
          </button>
          <button type="button" className="chip" aria-pressed={living} onClick={() => setLiving(true)} title="Matchdays pass in real time, even while you're away">
            Living
          </button>
        </fieldset>
        {living && (
          <fieldset className="choice-row">
            <legend>Game length (real time per matchday)</legend>
            {GAME_LENGTHS.map((m) => (
              <button type="button" key={m} className="chip" aria-pressed={gameLength === m} onClick={() => setGameLength(m)}>
                {m} min
              </button>
            ))}
          </fieldset>
        )}
        <fieldset className="choice-row">
          <legend>Games per season</legend>
          {SEASON_LENGTHS.map((l) => (
            <button type="button" key={l.id} className="chip" aria-pressed={seasonLength === l.id} onClick={() => setSeasonLength(l.id)}>
              {l.label} · {roundsFor(size, l.id)} games
            </button>
          ))}
        </fieldset>
        <fieldset className="choice-row">
          <legend>Playoff bracket</legend>
          {PLAYOFF_SIZES.filter((n) => n <= size).map((n) => (
            <button type="button" key={n} className="chip" aria-pressed={playoffTeams === n} onClick={() => setPlayoffTeams(n)}>
              Top {n}
            </button>
          ))}
        </fieldset>
        <fieldset>
          <legend>Your fan persona (optional)</legend>
          <PersonaPicker value={persona} onChange={setPersona} />
        </fieldset>
        <fieldset>
          <legend>Pick your club (required)</legend>
          <div className="club-pick">
            {league.teams.map((t, i) => (
              <button type="button" key={t.id} className="card" aria-pressed={club === i} onClick={() => setClub(i)}>
                <Crest team={t} />
                <span>
                  <strong>{t.name}</strong>
                  <br />
                  <span className="small muted">{t.city}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <button className="btn primary" type="submit" disabled={club === null}>
          {club === null ? 'Pick a club to start' : `Enter The Assembly with the ${league.teams[club].name}`}
        </button>
      </form>
    </div>
  );
}

const INTRO = [
  { title: 'The Assembly', text: 'A sealed soccer facility. Twelve clubs play 5-a-side in glass-walled arenas. There is no out of bounds — the walls are part of the game.' },
  { title: 'You are a fan', text: "You can't touch the ball. You pick a club and watch its players through the facility's broadcast feed." },
  { title: 'Every club is fan-run', text: 'Before each match, the fans vote on the tactic and the captain. Call the result to build credibility — your influence in every vote. Skip it and the other fans decide.' },
  { title: 'Vote on the rules', text: 'Every week the fans of every club vote on the facility’s rules — each for what helps their club. The Director enforces the winners. Strange things happen.' },
];

function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = INTRO[i];
  return (
    <div className="intro dfc">
      <div className="card intro-card">
        <p className="eyebrow">
          {i + 1} / {INTRO.length}
        </p>
        <h1>{step.title}</h1>
        <p>{step.text}</p>
        <div className="intro-dots" aria-hidden="true">
          {INTRO.map((_, j) => (
            <span key={j} className={j === i ? 'on' : ''} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button className="btn" onClick={onDone}>
            Skip
          </button>
          <button className="btn primary" onClick={() => (i + 1 < INTRO.length ? setI(i + 1) : onDone())}>
            {i + 1 < INTRO.length ? 'Next' : 'Pick a club'}
          </button>
        </div>
      </div>
    </div>
  );
}
