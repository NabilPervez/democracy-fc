import { useEffect, useMemo, useState } from 'react';
import { generateSoccerLeague } from '../../world/soccer/generate';
import { SOCCER_LEAGUE_SIZES, type SoccerSettings } from '../../world/soccer/universe';
import type { Chaos } from '../../world/soccer/weird';
import { Bulletin } from './Bulletin';
import { Coins, Crest, ErrorBanner } from './bits';
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
  const { view, tab, setTab, init, finishIntro, showPicker, busy } = useAssembly();
  const u = useAssembly((s) => s.u);
  useEffect(() => {
    void init();
  }, [init]);

  if (view === 'loading') return <p className="solo muted">Loading…</p>;
  if (view === 'intro') return <Onboarding onDone={() => void finishIntro()} />;
  if (view === 'picker') return <Picker />;
  if (view === 'create') return <Create />;
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
          {busy && <span className="muted small" role="status">Simulating…</span>}
          <Coins />
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
        DEMOCRACY <span style={{ color: 'var(--accent)' }}>FC</span>
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
                {m.sport === 'soccer' ? 'Democracy FC' : 'Blastball (legacy)'} · Season {m.season}, day {m.currentDay}
              </span>
            </button>
            <button className="chip" onClick={() => confirm(`Delete "${m.name}"? This can't be undone.`) && void remove(m.id)} aria-label={`Delete ${m.name}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button className="link-btn" onClick={showIntro}>
        How does this work?
      </button>
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
          void create({ name: name.trim() || 'The Assembly', seed, leagueSize: size, chaos, timeMode: 'manual', dayLengthMinutes: 60 }, club);
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
  { title: 'Every club is fan-run', text: 'Before each match, the fans vote on the tactic and the captain. Make a prediction to earn coins. Skip it and the other fans decide.' },
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
