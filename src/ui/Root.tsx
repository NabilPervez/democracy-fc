import { lazy, Suspense, useEffect, useState } from 'react';
import * as store from '../storage/db';
import { SoccerApp } from './soccer/Shell';
import { LAST_UNIVERSE, setLegacyOpener, useAssembly } from './soccer/store';
import { setLegacyExit } from './store';

/** The Blastball app only loads for legacy baseball saves. */
const LegacyApp = lazy(() => import('./App').then((m) => ({ default: m.App })));

/**
 * Democracy FC is the app; Blastball saves (baseball) still open in the legacy app (PRD §C6).
 * The last opened universe decides which shell starts; the Democracy FC picker lists both.
 */
export function Root() {
  const [shell, setShell] = useState<'loading' | 'soccer' | 'baseball'>('loading');

  useEffect(() => {
    setLegacyOpener(() => setShell('baseball'));
    setLegacyExit(() => {
      setShell('soccer');
      void useAssembly.getState().showPicker();
    });
    void (async () => {
      const last = await store.getSetting<string>(LAST_UNIVERSE);
      const row = last ? await store.db.universes.get(last) : undefined;
      const legacy = row && (row.state as { sport?: string }).sport !== 'soccer';
      setShell(legacy ? 'baseball' : 'soccer');
    })();
  }, []);

  if (shell === 'loading') return <p className="solo muted">Loading…</p>;
  return shell === 'baseball' ? (
    <Suspense fallback={<p className="solo muted">Loading…</p>}>
      <LegacyApp />
    </Suspense>
  ) : (
    <SoccerApp />
  );
}
