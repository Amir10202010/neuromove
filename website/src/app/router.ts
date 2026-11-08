// Маленький маршрутизатор на адресах вида #/patients/p01.
// Почему «#»: приложение открывается и с GitHub Pages, и прямо с диска (file://),
// а адреса с решёткой не требуют настройки сервера.

import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'welcome' }
  | { name: 'onboarding' }
  | { name: 'overview' }
  | { name: 'patients' }
  | { name: 'patient'; id: string; tab: 'overview' | 'sessions' | 'goals' }
  | { name: 'family'; id: string }
  | { name: 'sessionNew'; patientId: string | null; protocol?: string | null }
  | { name: 'sessionRun' }
  | { name: 'sessions' }
  | { name: 'session'; id: string; complete: boolean }
  | { name: 'sessionPrint'; id: string }
  | { name: 'analytics' }
  | { name: 'devices' }
  | { name: 'settings' }
  | { name: 'lab' }
  | { name: 'research' }
  | { name: 'researchProtocols' }
  | { name: 'researchNew'; protocolKey: string | null }
  | { name: 'researchSession'; id: string }
  | { name: 'researchDatasets' }
  | { name: 'rehab' }
  | { name: 'rehabParticipant'; id: string; tab: RehabTab; review: string | null }
  | { name: 'rehabActivities' }
  | { name: 'rehabStudies' }
  | { name: 'familyHome'; id: string }
  | { name: 'childPlay'; id: string }
  | { name: 'notFound' };

/** Tabs of a participant's rehabilitation page. */
export const REHAB_TABS = ['overview', 'goals', 'program', 'timeline', 'movement', 'assessments', 'family', 'review'] as const;
export type RehabTab = (typeof REHAB_TABS)[number];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path = '/', query = ''] = raw.split('?');
  const q = new URLSearchParams(query);
  let parts: string[];
  try { parts = path.split('/').filter(Boolean).map(decodeURIComponent); }
  catch { return { name: 'notFound' }; }
  const [a, b, c] = parts;
  if (parts.length === 0) return { name: 'welcome' };
  switch (a) {
    // Адреса сайта из версии от 27 сентября: страниц больше нет — ведём на стартовую
    // или сразу в приложение, а не на «страница не найдена»
    // ('research' was one of them until 8 Nov 2026; it is now the research module)
    case 'technology': case 'product': case 'company': case 'contact': case 'privacy':
      return parts.length === 1 ? { name: 'welcome' } : { name: 'notFound' };
    case 'portal':
      return { name: 'overview' };
    case 'onboarding':
      return { name: 'onboarding' };
    case 'overview':
      return { name: 'overview' };
    case 'patients':
      if (!b) return { name: 'patients' };
      if (c === 'family') return { name: 'family', id: b };
      return { name: 'patient', id: b, tab: (['sessions', 'goals'].includes(q.get('tab') ?? '') ? q.get('tab') : 'overview') as 'overview' | 'sessions' | 'goals' };
    case 'session':
      if (b === 'new') return { name: 'sessionNew', patientId: q.get('patient'), protocol: q.get('protocol') };
      if (b === 'run') return { name: 'sessionRun' };
      return { name: 'notFound' };
    case 'sessions':
      if (!b) return { name: 'sessions' };
      if (c === 'print') return { name: 'sessionPrint', id: b };
      return { name: 'session', id: b, complete: q.get('complete') === '1' };
    case 'analytics':
      return { name: 'analytics' };
    case 'devices':
      return { name: 'devices' };
    case 'settings':
      return { name: 'settings' };
    // Research platform: goniometer validation, protocols, datasets
    case 'research':
      if (!b) return { name: 'research' };
      if (b === 'protocols' && !c) return { name: 'researchProtocols' };
      if (b === 'datasets' && !c) return { name: 'researchDatasets' };
      if (b === 'new' && !c) return { name: 'researchNew', protocolKey: q.get('protocol') };
      if (b === 'sessions' && c) return { name: 'researchSession', id: c };
      return { name: 'notFound' };
    // Functional Progression System: professional workspace, family workspace, child practice
    case 'rehab': {
      if (!b) return { name: 'rehab' };
      if (b === 'activities' && !c) return { name: 'rehabActivities' };
      if (b === 'studies' && !c) return { name: 'rehabStudies' };
      if (b === 'p' && c && parts.length === 3) {
        const tab = q.get('tab') ?? 'overview';
        return { name: 'rehabParticipant', id: c, tab: (REHAB_TABS as readonly string[]).includes(tab) ? (tab as RehabTab) : 'overview', review: q.get('review') };
      }
      return { name: 'notFound' };
    }
    case 'home':
      return b && parts.length === 2 ? { name: 'familyHome', id: b } : { name: 'notFound' };
    case 'play':
      return b && parts.length === 2 ? { name: 'childPlay', id: b } : { name: 'notFound' };
    // Лаборатория рисунков — только в режиме разработки (App.tsx), в сборке это «не найдено»
    case 'lab':
      return { name: 'lab' };
    default:
      return { name: 'notFound' };
  }
}

export function href(r: Route): string {
  const e = encodeURIComponent;
  switch (r.name) {
    case 'welcome':
      return '#/';
    case 'onboarding':
      return '#/onboarding';
    case 'overview':
      return '#/overview';
    case 'patients':
      return '#/patients';
    case 'patient':
      return `#/patients/${e(r.id)}${r.tab !== 'overview' ? `?tab=${r.tab}` : ''}`;
    case 'family':
      return `#/patients/${e(r.id)}/family`;
    case 'sessionNew': {
      const q = new URLSearchParams();
      if (r.patientId) q.set('patient', r.patientId);
      if (r.protocol) q.set('protocol', r.protocol);
      const qs = q.toString();
      return `#/session/new${qs ? `?${qs}` : ''}`;
    }
    case 'sessionRun':
      return '#/session/run';
    case 'sessions':
      return '#/sessions';
    case 'session':
      return `#/sessions/${e(r.id)}${r.complete ? '?complete=1' : ''}`;
    case 'sessionPrint':
      return `#/sessions/${e(r.id)}/print`;
    case 'analytics':
      return '#/analytics';
    case 'devices':
      return '#/devices';
    case 'settings':
      return '#/settings';
    case 'lab':
      return '#/lab';
    case 'research':
      return '#/research';
    case 'researchProtocols':
      return '#/research/protocols';
    case 'researchDatasets':
      return '#/research/datasets';
    case 'researchNew':
      return `#/research/new${r.protocolKey ? `?protocol=${e(r.protocolKey)}` : ''}`;
    case 'researchSession':
      return `#/research/sessions/${e(r.id)}`;
    case 'rehab':
      return '#/rehab';
    case 'rehabActivities':
      return '#/rehab/activities';
    case 'rehabStudies':
      return '#/rehab/studies';
    case 'rehabParticipant': {
      const q = new URLSearchParams();
      if (r.tab !== 'overview') q.set('tab', r.tab);
      if (r.review) q.set('review', r.review);
      const qs = q.toString();
      return `#/rehab/p/${e(r.id)}${qs ? `?${qs}` : ''}`;
    }
    case 'familyHome':
      return `#/home/${e(r.id)}`;
    case 'childPlay':
      return `#/play/${e(r.id)}`;
    case 'notFound':
      return '#/404';
  }
}

export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const target = href(r);
  if (opts.replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

let cachedHash = '';
let cachedRoute: Route = { name: 'welcome' };
function getRoute(): Route {
  const h = window.location.hash;
  if (h !== cachedHash) {
    cachedHash = h;
    cachedRoute = parseHash(h);
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute, getRoute);
}
