// Coordination & Strategy workspace (Motor Coordination & Strategy Discovery Engine, src/lab/coord).
// Shows, for one participant and movement: provenance and data sufficiency, the multi-segment trajectories behind
// every repetition, coordination components, strategy discovery (or its refusal), the strategy sequence,
// performance–strategy dissociation, a two-repetition comparison and longitudinal strategy change.
// The engine runs in a worker (or, where none can be started, in the same job function on the main thread);
// nothing here computes a number.

import { FlaskConical, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { href } from '../../../app/router';
import type { Side } from '../../../devices/types';
import { isSimulatedSession } from '../../../data/models';
import { CHANNELS, type ChannelId } from '../../../lab/coord/channels';
import type { McseRecordingInput, McseResult, RepRecord } from '../../../lab/coord/engine';
import { SUPPORTED_EXERCISES } from '../../../lab/coord/engine';
import { comparePair, type PairComparison } from '../../../lab/coord/dissociation';
import { practiceInput, sessionAvailability, sessionHasExercise, sessionInput } from '../../../lab/coord/inputs';
import { PageHeader } from '../../../layout/PageHeader';
import { useAppStore } from '../../../state/appStore';
import { fmt, useDates, useLabData } from '../common';
import { useLabRecords } from '../store';
import type { McseRequest } from '../../../lab/coord/mcseJob';
import McseWorker from '../../../lab/coord/mcse.worker?worker';
import { startJob, type JobHandle } from '../../../lib/workerJob';
import { CurveChart, ScatterChart, SequenceStrip, SERIES, UNCERTAIN } from './charts';
import { useCT, type CT } from './i18n';
import '../../../styles/coord.css';

const GRIDX = Array.from({ length: 101 }, (_, i) => i);
const LANDMARK_MARKS = [
  { x: 0, label: 'onset' },
  { x: 45, label: 'arrival' },
  { x: 55, label: 'departure' },
  { x: 100, label: 'offset' },
];

type Run = { state: 'idle' } | { state: 'running'; what: string } | { state: 'done'; result: McseResult; synthetic: boolean } | { state: 'error'; message: string };

function colorOf(label: string | null, labels: readonly string[]): string {
  if (!label) return UNCERTAIN;
  const i = labels.indexOf(label);
  return i >= 0 ? (SERIES[i % SERIES.length] as string) : UNCERTAIN;
}

export function CoordinationPage({ participant, exercise }: { participant: string | null; exercise: string | null }) {
  const ct = useCT();
  const dates = useDates();
  const { ws, patients, sessions } = useLabData();
  const { trialSets } = useLabRecords(ws);
  const getRaw = useAppStore((s) => s.getRaw);
  const [side, setSide] = useState<Side>('right');
  const [run, setRun] = useState<Run>({ state: 'idle' });
  const job = useRef<JobHandle | null>(null);
  useEffect(() => () => job.current?.cancel(), []);
  const ex = exercise && (SUPPORTED_EXERCISES as readonly string[]).includes(exercise) ? exercise : 'shoulder_flexion';
  const pid = participant ?? patients[0]?.id ?? null;
  const mine = useMemo(() => sessions.filter((s) => s.patientId === pid && sessionHasExercise(s, ex, side)).sort((a, b) => a.startedAt.localeCompare(b.startedAt)), [sessions, pid, ex, side]);
  const practiceSets = useMemo(() => trialSets.filter((t) => t.participantId === pid && t.exercise === ex && t.side === side), [trialSets, pid, ex, side]);
  const withRaw = mine.filter((s) => s.hasRaw);
  const practiceRaw = practiceSets.filter((t) => t.rawManifest);
  const go = (p: string | null, e: string) => (window.location.hash = href({ name: 'labCoordination', participant: p, exercise: e }));

  // The engine runs in a worker that is a file of the site (the content policy blocks blob: workers, which is what
  // `?worker&inline` creates — the analysis never finished in the built site). Where no worker can be started
  // (single-file demo opened from disk) the same job runs on the main thread: lib/workerJob.ts.
  const start = (req: McseRequest, synthetic: boolean) => {
    job.current?.cancel();
    setRun({ state: 'running', what: synthetic ? ct('Generating and analysing synthetic data…') : ct('Analysing raw recordings…') });
    job.current = startJob<McseRequest, McseResult>({
      make: () => new McseWorker(),
      local: (r) => import('../../../lab/coord/mcseJob').then((m) => m.runMcseJob(r)),
      req,
      done: (reply) => setRun(reply.ok ? { state: 'done', result: reply.result, synthetic } : { state: 'error', message: reply.error }),
    });
  };
  const analyse = async () => {
    setRun({ state: 'running', what: ct('Reading raw frames…') });
    const inputs: McseRecordingInput[] = [];
    for (const s of withRaw) {
      const frames = await getRaw(s.id);
      if (frames?.length) inputs.push(sessionInput(s, frames, side));
    }
    for (const t of practiceRaw) {
      const frames = await getRaw(t.id);
      const inp = frames?.length ? practiceInput(t, frames) : null;
      if (inp) inputs.push(inp);
    }
    if (!inputs.length) return setRun({ state: 'error', message: ct('No raw frames could be read for this participant and movement.') });
    start({ kind: 'analyse', inputs, options: { exercise: ex } }, false);
  };
  const demo = () => start({ kind: 'synthetic', seed: 1, options: { exercise: 'shoulder_flexion' } }, true);
  const anySimulated = mine.some(isSimulatedSession);

  return (
    <div className="page">
      <PageHeader back={{ href: href({ name: 'labOverview' }), label: ct('Motor learning lab') }} title={ct('Coordination & Strategy Lab')} lead={ct('How a movement is organised across trunk, upper arm and forearm; whether repetitions with similar outcomes use different coordination strategies; and how that changes with practice. Kinematic coordination only — no muscle or neural synergies are measured.')} />
      <section className="card card__body mlfilters">
        <label className="field">
          <span className="field__label">{ct('Participant')}</span>
          <select className="select" value={pid ?? ''} onChange={(e) => go(e.target.value || null, ex)}>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{ct('Movement')}</span>
          <select className="select" value={ex} onChange={(e) => go(pid, e.target.value)}>
            {SUPPORTED_EXERCISES.map((x) => (
              <option key={x} value={x}>
                {ct(x)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{ct('Arm')}</span>
          <select className="select" value={side} onChange={(e) => setSide(e.target.value as Side)}>
            <option value="right">{ct('right')}</option>
            <option value="left">{ct('left')}</option>
          </select>
        </label>
        <button type="button" className="btn btn--primary" disabled={run.state === 'running' || (!withRaw.length && !practiceRaw.length)} onClick={() => void analyse()}>
          <Play aria-hidden /> {ct('Analyse recordings')}
        </button>
        <button type="button" className="btn btn--secondary" disabled={run.state === 'running'} onClick={demo}>
          <FlaskConical aria-hidden /> {ct('Synthetic demonstration')}
        </button>
      </section>
      <DataAvailability ct={ct} total={mine.length} withRaw={withRaw.length} verified={mine.filter((s) => sessionAvailability(s) === 'raw_verified_manifest').length} practice={practiceSets.length} practiceRaw={practiceRaw.length} simulated={anySimulated} dates={mine.slice(-3).map((s) => dates.dateTime(s.startedAt))} />
      {run.state === 'running' && <p className="mlmuted" role="status">{run.what}</p>}
      {run.state === 'error' && <div className="callout callout--critical">{run.message}</div>}
      {run.state === 'done' && <Results key={run.result.reps.length + run.result.exercise + String(run.synthetic)} result={run.result} synthetic={run.synthetic} ct={ct} />}
    </div>
  );
}

function DataAvailability({ ct, total, withRaw, verified, practice, practiceRaw, simulated, dates }: { ct: CT; total: number; withRaw: number; verified: number; practice: number; practiceRaw: number; simulated: boolean; dates: string[] }) {
  return (
    <section className="mlsection">
      <h2 className="section-title">{ct('Data available')}</h2>
      <p className="mlmuted">
        {ct('Sessions with this movement')}: {total} · {ct('with raw multi-sensor frames')}: {withRaw} ({ct('with a verified raw manifest')}: {verified}) · {ct('aggregate-only (repetition metrics, no raw frames — cannot be analysed for coordination)')}: {total - withRaw} · {ct('practice sittings')}: {practice} ({ct('with raw frames')}: {practiceRaw})
        {dates.length ? ` · ${ct('latest')}: ${dates.join(', ')}` : ''}
      </p>
      {simulated && <p className="mlmuted">{ct('The demo workspace contains simulated sessions: seeded demo history has no raw frames.')}</p>}
    </section>
  );
}

function Results({ result: r, synthetic, ct }: { result: McseResult; synthetic: boolean; ct: CT }) {
  const [picked, setPicked] = useState<string[]>([]);
  const labels = r.strategies?.verdict === 'multiple_strategies' ? r.strategies.labels : [];
  const pick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  const repA = r.reps.find((x) => x.id === picked[0]) ?? null;
  const repB = r.reps.find((x) => x.id === picked[1]) ?? null;
  const sessionsIdx = [...new Set(r.reps.map((x) => x.recordingId))];
  return (
    <>
      {(synthetic || r.simulatedInputs) && (
        <div className="callout callout--demo" role="note">
          <FlaskConical aria-hidden />
          <div>
            <div className="callout__title">{synthetic ? ct('SYNTHETIC demonstration — not a participant') : ct('Simulated recordings')}</div>
            {synthetic ? ct('Generated by the MCSE ground-truth generator (participant SYN-DEMO): 4 sessions × 12 shoulder-flexion repetitions; the share of the arm-dominant strategy rises 0 → 25 → 58 → 83 %, the others are trunk-assisted with the same arm inclination. Every number below is computed by the real engine from simulated IMU frames.') : ct('These recordings come from the simulator. They describe simulated movements, not a child.')}
          </div>
        </div>
      )}
      <Provenance r={r} ct={ct} />
      {r.status === 'unsupported_exercise' || r.status === 'no_repetitions' ? null : (
        <>
          <Components r={r} ct={ct} />
          <Manifold r={r} ct={ct} labels={labels} picked={picked} pick={pick} sessionsIdx={sessionsIdx} />
          <Strategies r={r} ct={ct} labels={labels} picked={picked} pick={pick} />
          <Dissociation r={r} ct={ct} />
          <PairView r={r} ct={ct} a={repA} b={repB} labels={labels} />
          <Longitudinal r={r} ct={ct} />
        </>
      )}
      <details className="card card__body">
        <summary>{ct('Assumptions and versions')}</summary>
        <ul>
          {r.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p className="mlmuted">
          {Object.entries(r.versions)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ')}{' '}
          · {ct('representation')}: {r.representation}
        </p>
      </details>
    </>
  );
}

function Provenance({ r, ct }: { r: McseResult; ct: CT }) {
  return (
    <section className="mlsection">
      <h2 className="section-title">{ct('Recordings and provenance')}</h2>
      {r.messages.length > 0 && <p className="mlmuted">{r.messages.join(' · ')}</p>}
      <div className="card mlscroll" tabIndex={0}>
        <table className="table table--compact mltable">
          <thead>
            <tr>
              <th>{ct('Recording')}</th>
              <th>{ct('Source')}</th>
              <th>{ct('Raw manifest')}</th>
              <th>{ct('Signal quality')}</th>
              <th>{ct('Calibration')}</th>
              <th className="num">{ct('Repetitions found / complete')}</th>
              <th className="num">{ct('Relative heading drift bound, °/s')}</th>
              <th>{ct('Unavailable channels')}</th>
            </tr>
          </thead>
          <tbody>
            {r.recordings.map((x) => (
              <tr key={x.id} className={x.refused ? 'is-muted' : ''}>
                <td>
                  {x.startedAt.slice(0, 10)} {x.simulated ? <span className="badge">{ct('simulated')}</span> : null}
                </td>
                <td>{ct(x.source)}</td>
                <td>{ct(x.manifest)}</td>
                <td>{x.qcConfidence}</td>
                <td>{ct(x.calibration)}</td>
                <td className="num">
                  {x.repetitions} / {x.complete}
                </td>
                <td className="num">{fmt(x.drift.relativeHeadingDriftDps, 2)}</td>
                <td>{x.refused ?? (Object.keys(x.unavailable).join(', ') || '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mlmuted">
        {ct('Representation channels')}: {r.channels.representation.join(', ') || '—'} · {ct('display only (estimated)')}: {r.channels.display.filter((c) => !r.channels.representation.includes(c)).join(', ') || '—'} · {ct('repetitions used')}: {r.reps.length} · {ct('excluded')}: {r.excluded.length}
      </p>
    </section>
  );
}

function Components({ r, ct }: { r: McseResult; ct: CT }) {
  const c = r.components;
  if (!c) return null;
  const s = c.selection;
  const chans = r.channels.representation;
  return (
    <section className="mlsection">
      <h2 className="section-title">
        {ct('Coordination components')} <span className={`badge ${s.status === 'supported' ? 'badge--good' : 'badge--warn'}`}>{ct(s.status)}</span>
      </h2>
      <p className="mlmuted">{ct('Discretised functional PCA of landmark-registered excursion curves (performance-adjusted). A component is kept only if it beats column-permuted data (parallel analysis), is reproducible under bootstrap (congruence ≥ 0.85) and has enough repetitions.')}</p>
      <div className="card mlscroll" tabIndex={0}>
        <table className="table table--compact mltable">
          <thead>
            <tr>
              <th>{ct('Component')}</th>
              <th className="num">{ct('Variance explained')}</th>
              <th className="num">{ct('Variance / parallel-analysis 95 %')}</th>
              <th className="num">{ct('Bootstrap congruence')}</th>
              <th className="num">{ct('Cross-validated reconstruction RMSE, °')}</th>
              <th>{ct('Kept')}</th>
            </tr>
          </thead>
          <tbody>
            {s.observed.map((v, j) => (
              <tr key={j} className={j < s.k ? 'is-selected' : ''}>
                <td>C{j + 1}</td>
                <td className="num">{fmt((c.explained[j] ?? NaN) * 100, 1)} %</td>
                <td className="num">
                  {fmt(v, 0)} / {fmt(s.null95[j], 0)}
                </td>
                <td className="num">{fmt(s.congruence[j], 3)}</td>
                <td className="num">{fmt(s.cvRmse[j + 1], 2)}</td>
                <td>{j < s.k ? ct('yes') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mlmuted">
        {ct('Reasons')}: {s.reasons.join(', ') || '—'} · {ct('RMSE with no component (mean curve only)')}: {fmt(s.cvRmse[0], 2)} ° · {ct('alignment sensitivity: congruence landmark vs linear time normalisation')}: {c.alignmentCongruence.map((v) => fmt(v, 2)).join(', ')} · {ct('between-session share of score variance')}: {c.sessionShare.map((v) => fmt(v, 2)).join(', ')}
      </p>
      <div className="cogrid">
        {c.loadings.slice(0, Math.max(1, s.k)).map((L, j) => (
          <div key={j} className="card card__body">
            <strong>
              C{j + 1} — {chans.map((ch) => `${ch} ${fmt((c.channelShares[j]?.[ch] ?? 0) * 100, 0)} %`).join(' · ')}
            </strong>
            <CurveChart title={ct('Mean curve ± 2 SD along the component, per channel')} xLabel={ct('% of movement')} yLabel="°" x={GRIDX} fmt={(v) => fmt(v, 0)} markers={LANDMARK_MARKS.map((m) => ({ ...m, label: ct(m.label) }))} series={chans.flatMap((ch, ci) => componentSeries(c.mean, L, c.selection.observed[j] ?? 0, ci, ch, ci))} height={210} />
          </div>
        ))}
      </div>
    </section>
  );
}

function componentSeries(mu: number[], L: number[], variance: number, ci: number, ch: ChannelId, k: number) {
  const sd = Math.sqrt(Math.max(0, variance));
  const seg = (v: number[]) => v.slice(ci * 101, ci * 101 + 101);
  const m = seg(mu);
  const l = seg(L);
  const color = ['var(--text)', 'var(--left)', 'var(--right)', 'var(--good)', 'var(--warn)'][k % 5] as string;
  return [
    { name: ch, y: m, color, band: { lo: m.map((v, i) => v - 2 * sd * (l[i] as number)), hi: m.map((v, i) => v + 2 * sd * (l[i] as number)) } },
  ];
}

function Manifold({ r, ct, labels, picked, pick, sessionsIdx }: { r: McseResult; ct: CT; labels: readonly string[]; picked: string[]; pick: (id: string) => void; sessionsIdx: string[] }) {
  const k = r.components?.selection.k ?? 0;
  const pts = r.reps.map((q) => ({
    id: q.id,
    x: k >= 1 ? (q.scores[0] as number) : q.outcome,
    y: k >= 2 ? (q.scores[1] as number) : q.outcome,
    color: colorOf(q.strategy.label, labels),
    shape: sessionsIdx.indexOf(q.recordingId),
    title: `${q.id} · ${ct('outcome')} ${fmt(q.outcome, 1)}° · ${ct('strategy')} ${q.strategy.label ?? ct('uncertain')} (${fmt(q.strategy.posterior, 2)})`,
  }));
  return (
    <section className="mlsection">
      <h2 className="section-title">{ct('Coordination space')}</h2>
      <p className="mlmuted">{ct('Each mark is one measured repetition. Colour = strategy assignment (grey = uncertain or no supported strategies); shape = session. Select two repetitions to compare them below.')}</p>
      <div className="card card__body">
        <ScatterChart title={ct('Repetitions in coordination-component space')} xLabel={k >= 1 ? 'C1, °' : ct('outcome, °')} yLabel={k >= 2 ? 'C2, °' : ct('outcome, °')} points={pts} selected={picked} onPick={pick} fmt={(v) => fmt(v, 0)} />
      </div>
    </section>
  );
}

function Strategies({ r, ct, labels, picked, pick }: { r: McseResult; ct: CT; labels: readonly string[]; picked: string[]; pick: (id: string) => void }) {
  const s = r.strategies;
  if (!s) return null;
  const chans = r.channels.display;
  const sessions = [...new Set(r.reps.map((q) => q.recordingId))];
  return (
    <section className="mlsection">
      <h2 className="section-title">
        {ct('Movement strategies')} <span className={`badge ${s.verdict === 'multiple_strategies' ? 'badge--good' : 'badge--warn'}`}>{ct(s.verdict)}</span>
      </h2>
      <p className="mlmuted">
        {ct('Gaussian mixture in component space, K chosen by BIC with parsimony; reported only if stable under bootstrap, confirmed by Ward clustering, separated, large enough and co-occurring within a session. Labels are neutral; they do not mean better, worse or compensatory.')} {ct('Reasons')}: {s.reasons.join(', ') || '—'}
      </p>
      {s.bic.length > 0 && (
        <p className="mlmuted">
          BIC: {s.bic.map((b) => `K=${b.K} ${fmt(b.bic, 1)}`).join(' · ')} · {ct('chosen')} K={s.bestK} · ΔBIC {fmt(s.deltaBic, 1)}
          {s.checks ? ` · ${ct('bootstrap ARI')} ${fmt(s.checks.bootstrapAriMedian, 2)} · Jaccard ${s.checks.jaccard.map((j) => fmt(j, 2)).join('/')} · Ward ARI ${fmt(s.checks.wardAri, 2)} · ${ct('separation')} ${fmt(s.checks.minSeparationSd, 1)} SD` : ''}
        </p>
      )}
      <div className="card card__body">
        <strong>{ct('Strategy sequence (time order; gaps mark new sessions; faded = lower posterior)')}</strong>
        <SequenceStrip label={ct('Strategy sequence')} selected={picked} onPick={pick} items={r.reps.map((q) => ({ id: q.id, label: q.strategy.label, posterior: q.strategy.posterior, session: sessions.indexOf(q.recordingId), color: colorOf(q.strategy.label, labels), title: `${q.id}: ${q.strategy.label ?? ct('uncertain')} · p=${fmt(q.strategy.posterior, 2)} · ${fmt(q.outcome, 1)}°` }))} />
      </div>
      <div className="card mlscroll" tabIndex={0}>
        <table className="table table--compact mltable">
          <thead>
            <tr>
              <th>{ct('Pattern')}</th>
              <th className="num">n</th>
              <th className="num">{ct('Mean posterior')}</th>
              <th className="num">{ct('Outcome, °')}</th>
              {chans.map((c) => (
                <th key={c} className="num">
                  {c}, °
                </th>
              ))}
              <th className="num">{ct('Trunk contribution (observed ratio)')}</th>
              <th className="num">{ct('Trunk onset − arm onset, ms')}</th>
              <th className="num">{ct('Outbound / return, s')}</th>
              <th className="num">{ct('Within-pattern RMS, °')}</th>
            </tr>
          </thead>
          <tbody>
            {s.signatures.map((g) => (
              <tr key={g.label}>
                <td>
                  <i className="cokey" style={{ background: g.label === 'all' ? 'var(--text)' : colorOf(g.label, labels) }} aria-hidden /> {g.label === 'all' ? ct('all repetitions (descriptive)') : `${ct('Strategy')} ${g.label}`}
                </td>
                <td className="num">{g.n}</td>
                <td className="num">{fmt(g.meanPosterior, 2)}</td>
                <td className="num">
                  {fmt(g.outcome.mean, 1)} ± {fmt(g.outcome.sd, 1)}
                </td>
                {chans.map((c) => (
                  <td key={c} className="num">
                    {fmt(g.excursions[c]?.mean, 1)} ± {fmt(g.excursions[c]?.sd, 1)}
                  </td>
                ))}
                <td className="num">
                  {fmt(g.trunkContribution.mean, 2)} ± {fmt(g.trunkContribution.sd, 2)}
                </td>
                <td className="num">{g.onsetLagTrunkMs.n ? `${fmt(g.onsetLagTrunkMs.mean, 0)} ± ${fmt(g.onsetLagTrunkMs.sd, 0)} (n=${g.onsetLagTrunkMs.n})` : '—'}</td>
                <td className="num">
                  {fmt(g.durations.outbound.mean, 2)} / {fmt(g.durations.return.mean, 2)}
                </td>
                <td className="num">{fmt(g.withinRmsDeg, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mlmuted">{ct('Trunk contribution = |trunk tilt excursion in the task plane| / |upper-arm inclination excursion|, outbound phase: an observed kinematic ratio, not a diagnosis.')}</p>
      <div className="cogrid">
        {chans.map((c) => (
          <div key={c} className="card card__body">
            <CurveChart
              title={`${c} — ${CHANNELS[c].observability === 'estimated' ? ct('estimated channel') : ct('observable channel')}`}
              xLabel={ct('% of movement')}
              yLabel={`${ct('excursion')}, °`}
              x={GRIDX}
              fmt={(v) => fmt(v, 0)}
              markers={LANDMARK_MARKS.map((m) => ({ ...m, label: ct(m.label) }))}
              series={s.signatures.map((g) => ({ name: g.label === 'all' ? ct('all') : `${ct('Strategy')} ${g.label} (n=${g.n})`, y: g.curves[c]?.mean ?? [], color: g.label === 'all' ? 'var(--text)' : colorOf(g.label, labels), band: g.curves[c] ? { lo: g.curves[c]!.mean.map((m, i) => m - (g.curves[c]!.sd[i] ?? 0)), hi: g.curves[c]!.mean.map((m, i) => m + (g.curves[c]!.sd[i] ?? 0)) } : undefined }))}
            />
          </div>
        ))}
      </div>
      {r.longitudinal?.transitions && <Transitions t={r.longitudinal.transitions} ct={ct} />}
      {r.withinRepetition && (
        <p className="mlmuted">
          {ct('Within repetitions: outbound-phase discovery')} {ct(r.withinRepetition.outbound)}, {ct('return-phase discovery')} {ct(r.withinRepetition.return)}
          {r.withinRepetition.ari !== null ? ` · ARI ${fmt(r.withinRepetition.ari, 2)}` : ''}
        </p>
      )}
    </section>
  );
}

function Transitions({ t, ct }: { t: NonNullable<NonNullable<McseResult['longitudinal']>['transitions']>; ct: CT }) {
  return (
    <div className="card mlscroll" tabIndex={0}>
      <table className="table table--compact mltable">
        <caption className="mlmuted">
          {ct('Transitions between consecutive confident repetitions (Dirichlet(1) posterior mean, 95 % credible interval)')} · {ct('switch rate')} {fmt(t.switchRate, 2)} · {ct('persistence test p')} {fmt(t.persistenceP, 3)} · {ct('reappearing')}: {t.reappearing.join(', ') || '—'} · {ct('pairs')}: {t.pairs}
        </caption>
        <thead>
          <tr>
            <th>{ct('from \\ to')}</th>
            {t.labels.map((l) => (
              <th key={l} className="num">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.labels.map((a, i) => (
            <tr key={a}>
              <td>{a}</td>
              {t.labels.map((b, j) => (
                <td key={b} className="num">
                  {t.counts[i]?.[j]} · {fmt(t.posterior.mean[i]?.[j], 2)} [{fmt(t.posterior.lo[i]?.[j], 2)}, {fmt(t.posterior.hi[i]?.[j], 2)}]
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dissociation({ r, ct }: { r: McseResult; ct: CT }) {
  if (!r.dissociation.length)
    return (
      <section className="mlsection">
        <h2 className="section-title">{ct('Performance–Strategy Dissociation')}</h2>
        <p className="mlmuted">{ct('Needs either two supported strategies or at least two sessions.')}</p>
      </section>
    );
  return (
    <section className="mlsection">
      <h2 className="section-title">{ct('Performance–Strategy Dissociation')}</h2>
      <p className="mlmuted">{ct('Outcome-matched sets are compared only when their outcomes are equivalent (90 % CI within ±5°). Trajectory differences are tested at every channel × % of movement with family-wise error control (max-|t| permutation). Across sessions a difference must also exceed the provisional sensor re-placement margin.')}</p>
      {r.dissociation.map((d) => (
        <div key={`${d.a}-${d.b}`} className="card card__body cosub">
          <strong>
            {d.a} {ct('vs')} {d.b} — <span className={`badge ${d.verdict === 'dissociation' ? 'badge--good' : 'badge--warn'}`}>{ct(d.verdict)}</span>
          </strong>
          <p className="mlmuted">
            n = {d.nA} / {d.nB} ({ct('dropped by outcome matching')}: {d.matching.droppedA} / {d.matching.droppedB}) · {ct('outcome')} {fmt(d.outcome.meanA, 1)}° {ct('vs')} {fmt(d.outcome.meanB, 1)}°, Δ {fmt(d.outcome.diff, 1)}° [90 % CI {fmt(d.outcome.ci90[0], 1)}, {fmt(d.outcome.ci90[1], 1)}] {d.outcome.equivalent ? ct('equivalent') : ct('not equivalent')} · p<sub>FWE</sub> {fmt(d.trajectory.pFwe, 4)} · max|t| {fmt(d.trajectory.maxT, 1)} ({ct('critical')} {fmt(d.trajectory.criticalT, 1)}) · RMS {fmt(d.trajectory.rmsTotalDeg, 2)}° · {ct('split-half replication')} {fmt(d.stability.replication, 2)} ({d.stability.splits})
          </p>
          {d.reasons.length > 0 && <p className="mlmuted">{d.reasons.join(' · ')}</p>}
          {d.trajectory.rmsByChannel.length > 0 && (
            <>
              <table className="table table--compact mltable">
                <thead>
                  <tr>
                    <th>{ct('Channel')}</th>
                    <th className="num">{ct('RMS difference, ° [95 % CI]')}</th>
                    <th className="num">{ct('Share of difference')}</th>
                    <th>{ct('Significant regions (% of movement, peak Δ°)')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.trajectory.rmsByChannel.map((c) => (
                    <tr key={c.channel}>
                      <td>{c.channel}</td>
                      <td className="num">
                        {fmt(c.rmsDeg, 1)} [{fmt(c.ci95[0], 1)}, {fmt(c.ci95[1], 1)}]
                      </td>
                      <td className="num">{fmt(c.share * 100, 0)} %</td>
                      <td>
                        {d.trajectory.regions
                          .filter((g) => g.channel === c.channel)
                          .map((g) => `${g.fromPct}–${g.toPct} % (${fmt(g.peakDiffDeg, 1)}°)`)
                          .join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mlmuted">
                {ct('Share by phase')}: {ct('outbound')} {fmt(d.trajectory.shareByPhase.outbound * 100, 0)} % · {ct('hold')} {fmt(d.trajectory.shareByPhase.hold * 100, 0)} % · {ct('return')} {fmt(d.trajectory.shareByPhase.return * 100, 0)} % · {ct('component differences (Cohen d [95 % CI])')}: {d.components.map((c) => `C${c.index} ${fmt(c.d, 2)} [${fmt(c.ci95[0], 2)}, ${fmt(c.ci95[1], 2)}]`).join(' · ') || '—'}
              </p>
              <div className="cogrid">
                {d.trajectory.rmsByChannel.map((c) => (
                  <CurveChart key={c.channel} title={`${c.channel}: ${ct('mean difference')} ${d.b} − ${d.a}`} xLabel={ct('% of movement')} yLabel="Δ°" x={GRIDX} fmt={(v) => fmt(v, 1)} regions={d.trajectory.regions.filter((g) => g.channel === c.channel).map((g) => ({ a: g.fromPct, b: g.toPct }))} series={[{ name: `${d.b} − ${d.a}`, y: d.trajectory.meanDiff[c.channel] ?? [], color: 'var(--text)' }]} height={160} />
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

function PairView({ r, ct, a, b, labels }: { r: McseResult; ct: CT; a: RepRecord | null; b: RepRecord | null; labels: readonly string[] }) {
  const pair: PairComparison | null = useMemo(() => {
    if (!a || !b) return null;
    const groups = labels.length ? labels.map((l) => r.reps.filter((q) => q.strategy.label === l)) : [...new Set(r.reps.map((q) => q.recordingId))].map((sid) => r.reps.filter((q) => q.recordingId === sid));
    const v = (q: RepRecord) => ({ id: q.id, outcome: q.outcome, x: q.x, scores: q.scores });
    return comparePair(v(a), v(b), r.channels.representation, { kind: labels.length ? 'within_strategy' : 'within_session', groups: groups.map((g) => g.map(v)) });
  }, [a, b, labels, r]);
  return (
    <section className="mlsection">
      <h2 className="section-title">{ct('Compare two repetitions')}</h2>
      {!a || !b || !pair ? (
        <p className="mlmuted">{ct('Select two repetitions in the coordination space or the strategy sequence.')}</p>
      ) : (
        <>
          <p className="mlmuted">
            1 = {a.id} ({a.strategy.label ?? ct('uncertain')}, {fmt(a.outcome, 1)}°) · 2 = {b.id} ({b.strategy.label ?? ct('uncertain')}, {fmt(b.outcome, 1)}°) · {ct('outcome difference')} {fmt(pair.outcomeDiff, 1)}° ({pair.outcomeWithinMargin ? ct('within ±5°') : ct('outside ±5°')}) · RMS {fmt(pair.rmsDeg, 2)}°
            {pair.reference ? ` · ${ct('percentile among')} ${pair.reference.pairs} ${ct(pair.reference.kind)} ${ct('pairs')}: ${fmt(pair.reference.percentile * 100, 0)} % (p95 ${fmt(pair.reference.p95, 2)}°) → ${pair.exceedsTypicalVariability ? ct('exceeds typical repetition-to-repetition variability') : ct('within typical variability')}` : ` · ${ct('too few reference pairs')}`}
          </p>
          <p className="mlmuted">
            {ct('Where the difference is')}: {pair.byChannel.map((c) => `${c.channel} ${fmt(c.share * 100, 0)} % (${fmt(c.rmsDeg, 1)}°)`).join(' · ')} · {ct('outbound')} {fmt(pair.shareByPhase.outbound * 100, 0)} %
          </p>
          <div className="cogrid">
            {r.channels.display.map((c) => (
              <div key={c} className="card card__body">
                <CurveChart title={`${c} — ${ct('phase-normalised')}`} xLabel={ct('% of movement')} yLabel={`${ct('excursion')}, °`} x={GRIDX} fmt={(v) => fmt(v, 0)} markers={LANDMARK_MARKS.map((m) => ({ ...m, label: ct(m.label) }))} series={[{ name: '1', y: a.aligned.curves[c] ?? [], color: 'var(--left)' }, { name: '2', y: b.aligned.curves[c] ?? [], color: 'var(--right)' }]} height={170} />
                <CurveChart
                  title={`${c} — ${ct('original time (s from onset), with phase boundaries and their uncertainty')}`}
                  xLabel={ct('s from onset')}
                  yLabel="°"
                  x={a.aligned.timeDomain.t}
                  fmt={(v) => fmt(v, 0)}
                  markers={boundaryMarks(a, ct)}
                  series={[{ name: '1', y: a.aligned.timeDomain.values[c] ?? [], color: 'var(--left)' }]}
                  height={150}
                />
                <CurveChart title="" xLabel={ct('s from onset')} yLabel="°" x={b.aligned.timeDomain.t} fmt={(v) => fmt(v, 0)} markers={boundaryMarks(b, ct)} series={[{ name: '2', y: b.aligned.timeDomain.values[c] ?? [], color: 'var(--right)' }]} height={150} />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function boundaryMarks(q: RepRecord, ct: CT) {
  const t0 = q.rep.onset?.t ?? 0;
  const out: { x: number; label: string; lo?: number; hi?: number }[] = [];
  for (const [k, b] of [['onset', q.rep.onset], ['arrival', q.rep.arrival], ['departure', q.rep.departure], ['offset', q.rep.offset]] as const) if (b) out.push({ x: b.t - t0, label: ct(k), lo: b.lo - t0, hi: b.hi - t0 });
  return out;
}

function Longitudinal({ r, ct }: { r: McseResult; ct: CT }) {
  const L = r.longitudinal;
  if (!L) return null;
  const labels = L.transitions?.labels ?? [...new Set(L.sessions.flatMap((s) => Object.keys(s.counts)))];
  return (
    <section className="mlsection">
      <h2 className="section-title">{ct('Longitudinal strategy evolution')}</h2>
      <p className="mlmuted">{ct('Observed performance and observed coordination are reported side by side and modelled separately with the existing learning-model comparison. Lower variability is not assumed to be better, and a more frequent strategy is not assumed to be better.')}</p>
      <div className="card mlscroll" tabIndex={0}>
        <table className="table table--compact mltable">
          <thead>
            <tr>
              <th>{ct('Session')}</th>
              <th className="num">{ct('Day')}</th>
              <th className="num">n</th>
              <th className="num">{ct('Outcome, ° (performance)')}</th>
              {labels.map((l) => (
                <th key={l} className="num">
                  {ct('Strategy')} {l}
                </th>
              ))}
              <th className="num">{ct('uncertain')}</th>
              <th className="num">{ct('Strategy entropy, bits [95 % CI]')}</th>
              <th className="num">{ct('Coordination variability, ° [95 % CI]')}</th>
              <th className="num">{ct('Distance from baseline, ° [95 % CI], p')}</th>
              <th className="num">{ct('From previous, °')}</th>
            </tr>
          </thead>
          <tbody>
            {L.sessions.map((s) => (
              <tr key={s.sessionId}>
                <td>{s.sessionIndex + 1}</td>
                <td className="num">{fmt(s.day, 0)}</td>
                <td className="num">{s.n}</td>
                <td className="num">
                  {fmt(s.outcome.mean, 1)} ± {fmt(s.outcome.sd, 1)}
                </td>
                {labels.map((l) => (
                  <td key={l} className="num">
                    {s.counts[l] ?? 0}
                  </td>
                ))}
                <td className="num">{s.uncertain}</td>
                <td className="num">{s.entropyBits ? `${fmt(s.entropyBits.value, 2)} [${fmt(s.entropyBits.ci95[0], 2)}, ${fmt(s.entropyBits.ci95[1], 2)}]` : '—'}</td>
                <td className="num">
                  {fmt(s.variabilityDeg.value, 2)} [{fmt(s.variabilityDeg.ci95[0], 2)}, {fmt(s.variabilityDeg.ci95[1], 2)}]
                </td>
                <td className="num">{s.fromBaselineDeg ? `${fmt(s.fromBaselineDeg.value, 2)} [${fmt(s.fromBaselineDeg.ci95[0], 2)}, ${fmt(s.fromBaselineDeg.ci95[1], 2)}], p ${fmt(s.fromBaselineDeg.p, 3)}${s.fromBaselineDeg.changed ? ` — ${ct('changed')}` : ''}` : ct('baseline')}</td>
                <td className="num">{fmt(s.fromPreviousDeg, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mlmuted">
        {ct('"changed" requires p < 0.05 AND a distance above the provisional re-placement margin')} ({fmt(L.sessions.find((s) => s.fromBaselineDeg)?.fromBaselineDeg?.marginDeg, 1)}°). {ct('Learning-model selection (existing engine)')}: {L.models.map((m) => `${ct(m.metric)}: ${m.selected ?? '—'} (${m.reason.join(', ')})`).join(' · ') || L.notes.join(' · ')}
      </p>
    </section>
  );
}

