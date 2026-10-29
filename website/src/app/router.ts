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
  | { name: 'notFound' };

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
    case 'technology': case 'product': case 'research': case 'company': case 'contact': case 'privacy':
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
