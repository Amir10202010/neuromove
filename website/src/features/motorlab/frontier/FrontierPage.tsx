// Research-frontier workspaces of the motor lab: measurement & observability, learning observatory, strategy atlas,
// twin workspace, scientific sandbox, hypothesis registry and report builder. Each view is its own lazily loaded
// chunk, so opening one does not load the engines of the others.
//
// Research tool only. Nothing on these pages is a diagnosis, a severity grade, a treatment recommendation or a
// safety clearance, and none of them changes a participant's programme.

import { Activity, BookOpenCheck, Dices, Gauge, Layers, Lightbulb, Route as RouteIcon, ShieldAlert } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { FRONTIER_VIEWS, href, type FrontierView } from '../../../app/router';
import { PageHeader } from '../../../layout/PageHeader';
import { FRONTIER_VERSIONS } from '../../../lab/version';
import { SimulatedBanner, useLabData } from '../common';
import { useFT, type FT } from './i18n';
import '../../../styles/frontier.css';

const MeasurementView = lazy(() => import('./MeasurementView').then((m) => ({ default: m.MeasurementView })));
const ObservatoryView = lazy(() => import('./ObservatoryView').then((m) => ({ default: m.ObservatoryView })));
const StrategyView = lazy(() => import('./StrategyView').then((m) => ({ default: m.StrategyView })));
const TwinView = lazy(() => import('./TwinView').then((m) => ({ default: m.TwinView })));
const SandboxView = lazy(() => import('./SandboxView').then((m) => ({ default: m.SandboxView })));
const HypothesesView = lazy(() => import('./HypothesesView').then((m) => ({ default: m.HypothesesView })));
const ReportsView = lazy(() => import('./ReportsView').then((m) => ({ default: m.ReportsView })));

const NEEDS_PARTICIPANT: readonly FrontierView[] = ['observatory', 'strategy', 'twin'];
const ICONS: Record<FrontierView, ReactNode> = {
  measurement: <Gauge aria-hidden />,
  observatory: <Activity aria-hidden />,
  strategy: <RouteIcon aria-hidden />,
  twin: <Layers aria-hidden />,
  sandbox: <Dices aria-hidden />,
  hypotheses: <Lightbulb aria-hidden />,
  reports: <BookOpenCheck aria-hidden />,
};

export function viewTitle(ft: FT, v: FrontierView): string {
  switch (v) {
    case 'measurement':
      return ft('Measurement & observability');
    case 'observatory':
      return ft('Learning observatory');
    case 'strategy':
      return ft('Strategy atlas');
    case 'twin':
      return ft('Twin workspace');
    case 'sandbox':
      return ft('Scientific sandbox');
    case 'hypotheses':
      return ft('Hypotheses');
    case 'reports':
      return ft('Report builder');
  }
}

function viewLead(ft: FT, v: FrontierView): string {
  switch (v) {
    case 'measurement':
      return ft('What three inertial sensors can and cannot observe, what every derived quantity rests on, and how much of a number is sensor error or sensor placement.');
    case 'observatory':
      return ft('Whether the session level has changed, how sure that is, what else could explain it, and which parts of learning these data can separate.');
    case 'strategy':
      return ft('How each recording was organised across trunk and arm, whether two recordings with a similar result were performed differently, and whether a difference survives sensor re-attachment.');
    case 'twin':
      return ft('The layers of the computational twin of one participant, its maturity against fixed criteria, and predictions that are issued with their calibration or refused.');
    case 'sandbox':
      return ft('Generative scenarios with known hidden truth, run through the real engine, and the benchmark registry with every result — including the failures.');
    case 'hypotheses':
      return ft('Formal research hypotheses with their null, test and falsification condition, judged against the data that actually exist.');
    case 'reports':
      return ft('Scientific reports built from frozen analysis runs: every statement is tagged by kind and traced to the sessions and raw streams behind it.');
  }
}

export function FrontierPage({ view, participant }: { view: FrontierView; participant: string | null }) {
  const ft = useFT();
  const { patients, includeSimulated } = useLabData();
  const needsParticipant = NEEDS_PARTICIPANT.includes(view);
  const pid = participant ?? patients[0]?.id ?? null;
  return (
    <div className="page">
      <PageHeader back={{ href: href({ name: 'labOverview' }), label: ft('Motor learning lab') }} eyebrow={ft('Research frontier')} title={viewTitle(ft, view)} lead={viewLead(ft, view)} actions={<span className="mlmuted">{FRONTIER_VERSIONS[view === 'measurement' ? 'measure' : view === 'observatory' ? 'observatory' : view === 'strategy' ? 'strategy' : view === 'twin' ? 'twin' : view === 'sandbox' ? 'scenario' : 'discovery']}</span>} />
      <nav aria-label={ft('Research frontier workspaces')}>
        <ul className="fr-tabs">
          {FRONTIER_VIEWS.map((v) => (
            <li key={v}>
              <a href={href({ name: 'labFrontier', view: v, participant: pid })} aria-current={v === view ? 'page' : undefined}>
                {ICONS[v]}
                {viewTitle(ft, v)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="callout callout--info" role="note">
        <ShieldAlert aria-hidden />
        <div>
          <div className="callout__title">{ft('Research tool — not clinical decision support')}</div>
          {ft('These pages describe measured movement and its uncertainty. They do not diagnose, grade severity, choose or change treatment, clear anyone for activity, or say anything about the nervous system. Decisions stay with the clinician and the family.')}
        </div>
      </div>
      {view !== 'sandbox' && view !== 'measurement' && <SimulatedBanner show={includeSimulated} />}
      {needsParticipant && (
        <section className="card card__body mlfilters">
          <label className="field">
            <span className="field__label">{ft('Participant')}</span>
            <select className="select" value={pid ?? ''} onChange={(e) => (window.location.hash = href({ name: 'labFrontier', view, participant: e.target.value || null }))}>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
      <Suspense fallback={<p className="mlmuted" role="status" aria-busy="true">{ft('Loading…')}</p>}>
        {view === 'measurement' && <MeasurementView ft={ft} />}
        {view === 'observatory' && <ObservatoryView key={pid ?? ''} ft={ft} participant={pid} />}
        {view === 'strategy' && <StrategyView key={pid ?? ''} ft={ft} participant={pid} />}
        {view === 'twin' && <TwinView key={pid ?? ''} ft={ft} participant={pid} />}
        {view === 'sandbox' && <SandboxView ft={ft} />}
        {view === 'hypotheses' && <HypothesesView ft={ft} />}
        {view === 'reports' && <ReportsView ft={ft} />}
      </Suspense>
    </div>
  );
}
