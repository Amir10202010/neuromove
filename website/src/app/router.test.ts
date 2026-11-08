import { describe, expect, it } from 'vitest';
import { href, parseHash, type Route } from './router';

describe('маршруты', () => {
  it('туда и обратно: адрес → экран → адрес', () => {
    const routes: Route[] = [
      { name: 'welcome' },
      { name: 'onboarding' },
      { name: 'overview' },
      { name: 'patients' },
      { name: 'patient', id: 'demo-p01', tab: 'overview' },
      { name: 'patient', id: 'demo-p01', tab: 'goals' },
      { name: 'family', id: 'demo-p01' },
      { name: 'sessionNew', patientId: 'demo-p01', protocol: 'upper_quick' },
      { name: 'sessionRun' },
      { name: 'sessions' },
      { name: 'session', id: 's1', complete: true },
      { name: 'sessionPrint', id: 's1' },
      { name: 'analytics' },
      { name: 'devices' },
      { name: 'settings' },
      { name: 'labOverview' },
      { name: 'labLearning', participant: 'demo-p01', task: 'shoulder_flexion:right', metric: 'rom' },
      { name: 'labLearning', participant: null, task: null, metric: null },
      { name: 'labTwin', id: 'demo-p01' },
      { name: 'labMovement', sessionId: null },
      { name: 'labMovement', sessionId: 's 1/2' },
      { name: 'labDesigner' },
      { name: 'labRuns' },
      { name: 'labRun', id: 'run_abc' },
      { name: 'labReadiness' },
      { name: 'labCoordination', participant: 'p_1', exercise: 'shoulder_flexion' },
      { name: 'labCoordination', participant: null, exercise: null },
    ];
    for (const route of routes) expect(parseHash(href(route))).toEqual(route);
  });

  it('коды пациентов и параметры сеанса не ломаются при кодировании', () => {
    const route: Route = { name: 'patient', id: 'P 01/2', tab: 'sessions' };
    expect(parseHash(href(route))).toEqual(route);
    expect(parseHash('#/session/new?patient=P01&protocol=upper_quick')).toEqual({ name: 'sessionNew', patientId: 'P01', protocol: 'upper_quick' });
  });

  it('битые адреса — «не найдено», а не падение', () => {
    expect(parseHash('#/patients/%E0%A4%A')).toEqual({ name: 'notFound' });
    expect(parseHash('#/research/fake-trial')).toEqual({ name: 'notFound' });
    expect(parseHash('#/nothing-here')).toEqual({ name: 'notFound' });
  });

  it('адреса прежнего сайта ведут на стартовую, портал — в приложение', () => {
    for (const page of ['technology', 'product', 'company', 'contact', 'privacy']) {
      expect(parseHash(`#/${page}`)).toEqual({ name: 'welcome' });
    }
    expect(parseHash('#/portal')).toEqual({ name: 'overview' });
  });

  it('research module routes round-trip', () => {
    for (const r of [
      { name: 'research' },
      { name: 'researchProtocols' },
      { name: 'researchDatasets' },
      { name: 'researchNew', protocolKey: null },
      { name: 'researchNew', protocolKey: 'prot_1@2' },
      { name: 'researchSession', id: 'vs_abc' },
    ] as const) {
      expect(parseHash(href(r))).toEqual(r);
    }
  });
});
