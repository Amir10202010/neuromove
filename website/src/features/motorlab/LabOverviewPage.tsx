// Research Overview of the computational motor-learning lab: longitudinal coverage per participant, data quality,
// raw availability, frozen runs and protocols, with entry points to every workspace. Counts only — no model is fitted
// here, so the page is fast and shows no estimate without its context.

import { Activity, BookOpenCheck, ClipboardList, Database, Dices, FileText, Gauge, Layers, Lightbulb, LineChart, Network, Route as RouteIcon, Waves, Workflow } from 'lucide-react';
import { useMemo } from 'react';
import { href } from '../../app/router';
import { PageHeader } from '../../layout/PageHeader';
import { buildParticipantSeries } from '../../lab/dataset';
import { LAB_ENGINE_VERSION } from '../../lab/version';
import { EmptyState } from '../../ui/EmptyState';
import { SimulatedBanner, useLabData } from './common';
import { ReliabilitySection } from './ReliabilitySection';
import { useLT } from './i18n';
import { useCT } from './coordination/i18n';
import { useLabRecords } from './store';

export function LabOverviewPage() {
  const lt = useLT();
  const ct = useCT();
  const { ws, patients, sessions, practice, includeSimulated } = useLabData();
  const { runs, protocols } = useLabRecords(ws);
  const rows = useMemo(
    () =>
      patients
        .map((p) => {
          const mine = sessions.filter((s) => s.patientId === p.id);
          const series = buildParticipantSeries(p.id, sessions, { includeSimulated, practice }).filter((s) => s.metric === 'rom');
          const inc = series.map((s) => s.sessions.filter((x) => x.included).length);
          const issues = new Set(series.flatMap((s) => s.sessions.filter((x) => !x.included).map((x) => x.sessionId)));
          const span = mine.length ? (Math.max(...mine.map((s) => Date.parse(s.startedAt))) - Math.min(...mine.map((s) => Date.parse(s.startedAt)))) / 86_400_000 : 0;
          return {
            p,
            sessions: mine.length,
            raw: mine.filter((s) => s.hasRaw).length,
            tasks: series.length,
            modelReady: inc.filter((n) => n >= 5).length,
            issues: issues.size,
            span,
            practice: practice.filter((x) => x.participantId === p.id).length,
            runs: runs.filter((r) => r.participantId === p.id).length,
          };
        })
        .filter((r) => r.sessions > 0),
    [patients, sessions, includeSimulated, practice, runs],
  );
  const first = rows[0]?.p.id ?? null;
  return (
    <div className="page">
      <PageHeader
        back={{ href: href({ name: 'research' }), label: lt('Research') }}
        title={lt('Motor learning lab')}
        lead={lt('Computational investigation of individual motor learning from repeated IMU movement observations: learning dynamics, individual computational models, study design and reproducible reports.')}
        actions={<span className="mlmuted">{LAB_ENGINE_VERSION}</span>}
      />
      <SimulatedBanner show={includeSimulated} />
      <section className="mlgrid mlgrid--3">
        <Tile icon={<LineChart />} title={lt('Motor Learning Explorer')} text={lt('Learning trajectories, model comparison, uncertainty, performance vs learning.')} to={href({ name: 'labLearning', participant: rows[0]?.p.id ?? null, task: null, metric: null })} />
        <Tile icon={<Waves />} title={lt('Movement Analysis Lab')} text={lt('Raw 100 Hz signals, quality, velocity events and movement features.')} to={href({ name: 'labMovement', sessionId: null })} />
        <Tile icon={<ClipboardList />} title={lt('Study Designer')} text={`${lt('Versioned learning-study protocols with a pre-specified analysis plan.')} (${protocols.length})`} to={href({ name: 'labDesigner' })} />
        <Tile icon={<BookOpenCheck />} title={lt('Research reports')} text={`${lt('Frozen, reproducible analysis runs and pseudonymised exports.')} (${runs.length})`} to={href({ name: 'labRuns' })} />
        <Tile icon={<Workflow />} title={ct('Coordination & Strategy Lab')} text={ct('Multi-segment coordination, movement strategies and performance–strategy dissociation from raw sensor frames.')} to={href({ name: 'labCoordination', participant: rows[0]?.p.id ?? null, exercise: null })} />
        <Tile icon={<Database />} title={lt('Foundation-model readiness')} text={lt('What the dataset would need before a movement representation model could be trained.')} to={href({ name: 'labReadiness' })} />
      </section>
      <section className="mlsection">
        <h2 className="section-title">{lt('Research frontier')}</h2>
        <div className="mlgrid mlgrid--3">
          <Tile icon={<Gauge />} title={lt('Measurement & observability')} text={lt('What the sensors can and cannot observe; sensor error and placement behind every number.')} to={href({ name: 'labFrontier', view: 'measurement', participant: null })} />
          <Tile icon={<Activity />} title={lt('Learning observatory')} text={lt('Change detection against the personal envelope, competing explanations, what the data can separate.')} to={href({ name: 'labFrontier', view: 'observatory', participant: first })} />
          <Tile icon={<RouteIcon />} title={lt('Strategy atlas')} text={lt('How each raw recording was organised across trunk and arm, and what survives sensor re-attachment.')} to={href({ name: 'labFrontier', view: 'strategy', participant: first })} />
          <Tile icon={<Layers />} title={lt('Twin workspace')} text={lt('Twin layers, maturity level and predictions that are issued with calibration or refused.')} to={href({ name: 'labFrontier', view: 'twin', participant: first })} />
          <Tile icon={<Dices />} title={lt('Scientific sandbox')} text={lt('Ground-truth scenarios and the benchmark registry, including failed criteria.')} to={href({ name: 'labFrontier', view: 'sandbox', participant: null })} />
          <Tile icon={<Lightbulb />} title={lt('Hypotheses')} text={lt('Formal hypotheses with null, test and falsification condition, against the data that exist.')} to={href({ name: 'labFrontier', view: 'hypotheses', participant: null })} />
          <Tile icon={<FileText />} title={lt('Report builder')} text={lt('Reports from frozen runs with every statement traced to its evidence.')} to={href({ name: 'labFrontier', view: 'reports', participant: null })} />
        </div>
      </section>
      <section className="mlsection">
        <h2 className="section-title">{lt('Participants and longitudinal coverage')}</h2>
        {!rows.length ? (
          <EmptyState title={lt('No sensor sessions')} text={lt('Record sensor sessions to build longitudinal series.')} />
        ) : (
          <div className="card mlscroll" tabIndex={0}>
            <table className="table table--compact mltable">
              <thead>
                <tr>
                  <th>{lt('Participant')}</th>
                  <th className="num">{lt('Sessions')}</th>
                  <th className="num">{lt('Span, days')}</th>
                  <th className="num">{lt('Task series')}</th>
                  <th className="num">{lt('Model-ready (≥ 5 sessions)')}</th>
                  <th className="num">{lt('Sessions failing quality')}</th>
                  <th className="num">{lt('With raw 100 Hz')}</th>
                  <th className="num">{lt('Practice records')}</th>
                  <th className="num">{lt('Frozen runs')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.p.id}>
                    <td>{r.p.code}</td>
                    <td className="num">{r.sessions}</td>
                    <td className="num">{Math.round(r.span)}</td>
                    <td className="num">{r.tasks}</td>
                    <td className="num">{r.modelReady}</td>
                    <td className="num">{r.issues}</td>
                    <td className="num">{r.raw}</td>
                    <td className="num">{r.practice}</td>
                    <td className="num">{r.runs}</td>
                    <td className="mlrow">
                      <a href={href({ name: 'labLearning', participant: r.p.id, task: null, metric: null })}>{lt('Explorer')}</a>
                      <a href={href({ name: 'labTwin', id: r.p.id })}><Network aria-hidden size={14} /> {lt('Twin')}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mlmuted">{lt('Counts for the range-of-motion series. "Model-ready" = series with at least 5 included sessions, the minimum for the dose-driven and exponential models.')}</p>
      </section>
      <ReliabilitySection />
    </div>
  );
}

function Tile({ icon, title, text, to }: { icon: React.ReactNode; title: string; text: string; to: string }) {
  return (
    <a className="card card--interactive card__body" href={to} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="mlrow">{icon}<strong>{title}</strong></div>
      <p className="mlmuted">{text}</p>
    </a>
  );
}

