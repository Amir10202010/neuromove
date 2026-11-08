// Seeds the demo workspace with an invented rehabilitation history (demo-p01, demo-p02) once the demo
// sensor sessions exist. Re-seeded when the day or language changes, unless the user edited demo records.

import { useEffect } from 'react';
import { demoRehabRecords } from '../../rehab/demoSeed';
import { useRehabStore } from '../../rehab/store';
import { useAppStore } from '../../state/appStore';
import { translateX } from './common';

/** Bump when the demo content changes, so stored demo records are re-generated. */
const DEMO_REHAB_VERSION = 2;

interface DemoMeta {
  version?: number;
  day: string;
  locale: string;
  modified: boolean;
}

let running = false;

export async function ensureDemoRehab(force = false): Promise<void> {
  const app = useAppStore.getState();
  const st = app.storage();
  const rs = useRehabStore.getState();
  if (!st || !rs.loaded || running) return;
  const sessions = app.sessions.filter((s) => s.workspace === 'demo');
  if (!app.patients.some((p) => p.id === 'demo-p01')) return;
  const locale = app.settings.locale;
  const today = new Date().toISOString().slice(0, 10);
  const meta = (await st.getMeta('rehabDemo')) as DemoMeta | undefined;
  const has = rs.records.some((r) => r.workspace === 'demo');
  if (!force && has && meta && meta.version === DEMO_REHAB_VERSION && (meta.modified || (meta.day === today && meta.locale === locale))) return;
  running = true;
  try {
    const records = demoRehabRecords(new Date(), (en) => translateX(locale, en), sessions, locale);
    await rs.replaceDemo(records);
    await st.setMeta('rehabDemo', { version: DEMO_REHAB_VERSION, day: today, locale, modified: false } satisfies DemoMeta);
  } finally {
    running = false;
  }
}


export function useEnsureDemo(): void {
  const ws = useAppStore((s) => s.settings.workspace);
  const locale = useAppStore((s) => s.settings.locale);
  const loaded = useRehabStore((s) => s.loaded);
  useEffect(() => {
    if (ws === 'demo' && loaded) void ensureDemoRehab();
  }, [ws, loaded, locale]);
}
