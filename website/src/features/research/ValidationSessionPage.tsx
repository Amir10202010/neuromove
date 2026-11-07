// Validation session: connect → calibrate → [capture IMU → PAUSE → goniometer value → save] × N → report.
//
// The operator's next action is always one obvious control:
//   no pending capture  → "Capture" (Space) — or automatic at the end of a repetition in rep-peak mode
//   pending capture     → goniometer input has focus; Enter = Save & continue
// Every action is written to IndexedDB (with its sync op) BEFORE the screen moves on; the header shows
// "Saved on this device" only after that confirmation, and cloud sync state separately.

import { CircleAlert, ClipboardCheck, Crosshair, Pencil, Printer, RotateCcw, SkipForward, Ban, Check, FileDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { href, navigate } from '../../app/router';
import type { Patient } from '../../data/models';
import { downloadText, exportName, stamp } from '../../data/export';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { requiredForValidation, capabilityOf } from '../../research/capabilities';
import { completedRepBlocks, holdCapture, repPeakCapture, viewOf } from '../../research/capture';
import { datasetJson, dictionaryCsv, newDatasetId, sessionStatistics, trialsCsv } from '../../research/export';
import type { DeviceSnapshot, ImuCapture, Trial, ValidationSession } from '../../research/model';
import { flagPairs, drift, type Sufficiency } from '../../research/stats';
import { useResearchStore } from '../../research/store';
import { capture, correctTrial, cursor, markInvalid, parseReference, repeatMeasurement, saveReference, skip, validPairs, currentTrials, type WorkflowError } from '../../research/workflow';
import { currentClinician, useAppStore } from '../../state/appStore';
import { SessionController } from '../../state/sessionController';
import { useControllerState, useEngineSnapshot } from '../../state/sessionStore';
import { Button, LinkButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Modal, ConfirmDialog } from '../../ui/Modal';
import { CalibrationPanel } from '../session/CalibrationPanel';
import { ConnectPanel } from '../session/ConnectPanel';
import { XYChart, baRules, histogram } from './charts';
import { useRT, fmtDeg, fmtNum, type RT } from './i18n';
import { SaveStatus } from './SaveStatus';
import { controllerFor, release, retain } from './controllers';

const LEFT = 'var(--left)';
const RIGHT = 'var(--right)';
const INK = 'var(--text)';

export function ValidationSessionPage({ id }: { id: string }) {
  const rt = useRT();
  const loaded = useResearchStore((s) => s.loaded);
  const load = useResearchStore((s) => s.load);
  const session = useResearchStore((s) => s.sessions.find((x) => x.id === id));
  const patient = useAppStore((s) => s.patients.find((p) => p.id === session?.participantId));
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  if (!loaded) return <div className="page muted">{rt('Loading…')}</div>;
  if (!session || !patient)
    return (
      <div className="page">
        <div className="card">
          <EmptyState title={rt('Validation session not found')} action={<LinkButton href={href({ name: 'research' })}>{rt('Research')}</LinkButton>} />
        </div>
      </div>
    );
  return session.status === 'active' ? <Run session={session} patient={patient} /> : <Report session={session} patient={patient} />;
}

// ── Run ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The device controller is created inside an effect and disposed by the same effect: every mount owns
 * exactly one live controller (React StrictMode mounts twice in development; a controller created in
 * useState was disposed by the first cleanup and then reused dead).
 */
function Run({ session, patient }: { session: ValidationSession; patient: Patient }) {
  const p = session.protocol;
  // One controller per session: protocol snapshot and connection kind never change within a session
  const controller = controllerFor(
    session.id,
    () =>
      new SessionController(
        {
          workspace: session.workspace,
          patientId: session.participantId,
          protocolId: 'custom',
          steps: [{ exercise: p.exercise, side: p.side, reps: 0, durationSec: 6 * 3600 }],
          deviceKind: session.device.kind,
          scenario: 'normal',
          autoAdvance: false,
          purpose: 'validation',
          requiredOverride: requiredForValidation(p.exercise, p.side),
        },
        patient,
        [],
      ),
  );
  useEffect(() => {
    retain(session.id);
    return () => release(session.id);
  }, [session.id]);
  return <RunWith key={session.id} controller={controller} session={session} patient={patient} />;
}

function RunWith({ controller, session, patient }: { controller: SessionController; session: ValidationSession; patient: Patient }) {
  const rt = useRT();
  const p = session.protocol;
  const state = useControllerState(controller);
  const engine = controller.engine;
  const snap = useEngineSnapshot(engine);
  const update = useResearchStore((s) => s.updateSession);
  const allTrials = useResearchStore((s) => s.trials);
  const trials = useMemo(() => allTrials.filter((t) => t.sessionId === session.id), [allTrials, session.id]);
  const c = cursor(p, trials);
  const [finishOpen, setFinishOpen] = useState(false);

  // Device passport → session record (once streaming): name, firmware, rate, module ids, accel calibration
  const deviceSaved = useRef(false);
  useEffect(() => {
    const info = state?.device.info;
    if (!info || deviceSaved.current || state?.device.phase !== 'streaming') return;
    deviceSaved.current = true;
    const snapDev: DeviceSnapshot = {
      kind: controller.device.kind,
      name: info.name,
      firmware: info.firmware,
      format: info.format,
      rateHz: info.rateHz,
      simulated: info.simulated,
      ...(info.accCal && Object.keys(info.accCal).length ? { accCal: info.accCal } : {}),
      sensors: requiredForValidation(p.exercise, p.side).map((pl) => ({ placement: pl, moduleId: info.moduleIds?.[pl] ?? null })),
    };
    void update(session.id, { device: snapDev });
  }, [state?.device, controller, p.exercise, p.side, session.id, update]);

  // Calibration result → session record (once per calibration)
  const calSaved = useRef<number>(-1);
  useEffect(() => {
    if (!snap || snap.phase !== 'recording' || calSaved.current === snap.calibration.attempt) return;
    calSaved.current = snap.calibration.attempt;
    const pose = engine?.result().calibrationPose ?? {};
    void update(session.id, { calibration: { at: new Date().toISOString(), attempts: snap.calibration.attempt, poseDeg: pose } });
  }, [snap, engine, session.id, update]);

  const finish = async (status: 'completed' | 'abandoned') => {
    const q = engine?.getSnapshot().quality;
    await update(session.id, { status, endedAt: new Date().toISOString(), ...(q ? { signal: q } : {}) });
    setFinishOpen(false);
    await controller.dispose();
  };

  const stage = state?.stage ?? 'connect';
  return (
    <div className="page vrun">
      <PageHeader
        back={{ href: href({ name: 'research' }), label: rt('Research') }}
        title={`${p.name} · v${session.protocolVersion}`}
        lead={`${patient.code} · ${rt(p.side === 'left' ? 'Left' : 'Right')} · ${rt('Session')} ${session.id}`}
        actions={
          <>
            <SaveStatus />
            <Button variant="ghost" onClick={() => setFinishOpen(true)}>
              {rt('End session')}
            </Button>
          </>
        }
      />
      {session.device.simulated && <div className="callout callout--demo">{rt('Simulated device: these values are not measurements and are labelled as simulated in every export.')}</div>}
      <Progress closed={c.closed} total={c.total} rt={rt} />

      {stage === 'connect' && state && <ConnectPanel controller={controller} state={state} />}
      {stage !== 'connect' && engine && snap && snap.phase === 'calibrating' && state && <CalibrationPanel engine={engine} snap={snap} device={state.device} />}
      {stage !== 'connect' && snap && snap.phase === 'positioning' && (
        <div className="callout callout--info">
          <Crosshair aria-hidden />
          <div>{rt('Hold the forearm horizontal, elbow at 90°, thumb up — the neutral position is being set.')}</div>
        </div>
      )}
      {stage !== 'connect' && engine && snap && (snap.phase === 'recording' || snap.phase === 'interrupted' || snap.phase === 'paused') && (
        <CaptureDesk session={session} trials={trials} engine={engine} snap={snap} onComplete={() => setFinishOpen(true)} />
      )}

      <LiveReport session={session} trials={trials} />

      <Modal
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        title={c.complete ? rt('All repetitions recorded') : rt('End session early?')}
        description={c.complete ? rt('Close the session and open the report.') : rt('{n} of {total} measurement slots are not closed. They will be reported as missing.', { n: c.total - c.closed, total: c.total })}
        footer={
          <>
            {!c.complete && (
              <Button variant="danger" onClick={() => void finish('abandoned')}>
                {rt('Abandon')}
              </Button>
            )}
            <Button onClick={() => setFinishOpen(false)}>{rt('Continue measuring')}</Button>
            <Button variant="primary" onClick={() => void finish('completed')} data-autofocus>
              {rt('Complete & open report')}
            </Button>
          </>
        }
      />
    </div>
  );
}

function Progress({ closed, total, rt }: { closed: number; total: number; rt: RT }) {
  return (
    <div className="vprogress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={closed} aria-label={rt('Session progress')}>
      <div className="vprogress__bar" style={{ width: `${total ? (100 * closed) / total : 0}%` }} />
      <span className="vprogress__label num">
        {closed} / {total}
      </span>
    </div>
  );
}

const ERRORS: Record<WorkflowError | 'no_samples' | 'too_few_samples', string> = {
  not_current_slot: 'This trial is not the current one.',
  already_pending: 'Enter the goniometer value for the captured repetition first.',
  not_pending: 'No capture is waiting for a goniometer value.',
  invalid_reference: 'Enter a number between −180 and 360°.',
  reason_required: 'A reason is required.',
  session_closed: 'The session is closed.',
  no_samples: 'No joint-angle samples yet — is the sensor streaming and calibrated?',
  too_few_samples: 'Too few samples in the window. Hold the position a little longer.',
};

function CaptureDesk({
  session,
  trials,
  engine,
  snap,
  onComplete,
}: {
  session: ValidationSession;
  trials: Trial[];
  engine: NonNullable<SessionController['engine']>;
  snap: NonNullable<ReturnType<typeof useEngineSnapshot>>;
  onComplete: () => void;
}) {
  const rt = useRT();
  const apply = useResearchStore((s) => s.apply);
  const p = session.protocol;
  const c = cursor(p, trials);
  const point = p.measurementPoints.find((x) => x.id === c.slot?.pointId);
  const operator = currentClinician() || session.operator;
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<'invalid' | 'skip' | null>(null);
  const [reason, setReason] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const live = engine.live.angle;
  const interrupted = snap.phase === 'interrupted' || snap.missing.length > 0;

  // Live window stability (same window the capture will use)
  const v = viewOf(engine.series);
  const preview = holdCapture(v, p.holdWindowSec, p.quality.minWindowSamples);
  const stable = typeof preview !== 'string' && preview.windowSdDeg <= p.quality.maxWindowSdDeg;

  const run = async (fn: () => ReturnType<typeof apply>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(ERRORS[r.error as WorkflowError] ? rt(ERRORS[r.error as WorkflowError] as never) : `${rt('Not saved')}: ${r.error}`);
    return r.ok;
  };

  const doCapture = async (imu: ImuCapture | string) => {
    if (typeof imu === 'string') {
      setError(rt(ERRORS[imu as 'no_samples'] as never));
      return;
    }
    if (await run(() => apply(capture(session, trials, imu, operator)))) {
      setValue('');
      setNote('');
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  const doHold = () => void doCapture(holdCapture(viewOf(engine.series), p.holdWindowSec, p.quality.minWindowSamples));

  // Rep-peak mode: a repetition that just ended is captured automatically and the session pauses
  const reps = completedRepBlocks(v);
  const lastReps = useRef(reps);
  useEffect(() => {
    if (p.captureMode !== 'rep_peak') return;
    if (reps > lastReps.current && !c.pending && !c.complete && !busy) void doCapture(repPeakCapture(viewOf(engine.series), point?.kind ?? 'max_flexion', 5));
    lastReps.current = reps;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reps]);

  // Space = capture (when no field has focus and nothing is pending)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.code !== 'Space' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return;
      if (c.pending || c.complete || busy || p.captureMode !== 'hold') return;
      e.preventDefault();
      doHold();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const ref = parseReference(value);
  const pendingImu = c.pending?.imu?.angleDeg ?? null;
  const save = () => {
    if (!c.pending) return;
    if (ref === null) {
      setError(rt(ERRORS.invalid_reference as never));
      return;
    }
    void run(() => apply(saveReference(session, trials, c.pending!.id, ref, note.trim())));
  };

  if (c.complete)
    return (
      <section className="card vdesk vdesk--done">
        <ClipboardCheck aria-hidden />
        <div>
          <h2 className="card__title">{rt('All repetitions recorded')}</h2>
          <p className="secondary">{rt('Review the live report below, then complete the session.')}</p>
        </div>
        <Button variant="primary" onClick={onComplete}>
          {rt('Complete & open report')}
        </Button>
      </section>
    );

  return (
    <section className={`card vdesk${c.pending ? ' is-paused' : ''}`} aria-live="polite">
      <div className="vdesk__slot">
        <span className="eyebrow">
          {p.sets > 1 ? `${rt('Set')} ${c.slot!.set} / ${p.sets} · ` : ''}
          {rt('Repetition')} {c.slot!.repetition} / {p.repetitions}
        </span>
        <h2 className="vdesk__point">{point?.label}</h2>
        <span className="muted">
          {rt(c.pending ? 'Paused — waiting for the goniometer value' : p.captureMode === 'hold' ? 'Hold the position, then capture' : 'Perform the repetition — capture is automatic')}
        </span>
      </div>

      <div className="vdesk__live">
        <span className="stat__label">{rt('Live IMU angle')}</span>
        <span className="vdesk__angle num">{interrupted || live === null ? '—' : `${live.toFixed(1)}°`}</span>
        <span className={`badge ${interrupted ? 'badge--critical' : stable ? 'badge--good' : 'badge--warn'}`}>
          {interrupted ? rt('Sensor signal missing') : stable ? rt('Stable') : rt('Moving')}
          {typeof preview !== 'string' && !interrupted && ` · SD ${preview.windowSdDeg.toFixed(2)}°`}
        </span>
      </div>

      {!c.pending ? (
        <div className="vdesk__actions">
          {p.captureMode === 'hold' && (
            <Button variant="primary" size="lg" icon={<Crosshair />} onClick={doHold} disabled={busy || interrupted} data-autofocus>
              {rt('Capture IMU value')} <kbd>Space</kbd>
            </Button>
          )}
          <Button variant="ghost" icon={<SkipForward />} onClick={() => setReasonFor('skip')} disabled={busy}>
            {rt('Skip with reason')}
          </Button>
        </div>
      ) : (
        <form
          className="vdesk__entry"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="vdesk__pair">
            <div>
              <span className="stat__label">{rt('IMU reading')}</span>
              <span className="vdesk__value num">{fmtDeg(pendingImu, 1)}</span>
              {c.pending.imu && c.pending.imu.windowSdDeg > p.quality.maxWindowSdDeg && <span className="badge badge--warn">{rt('Unstable hold')}</span>}
            </div>
            <label className="vdesk__gonio">
              <span className="stat__label">{rt('Goniometer reading')}</span>
              <span className="input-group">
                <input
                  ref={input}
                  className="input vdesk__input num"
                  inputMode="decimal"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  aria-invalid={value !== '' && ref === null}
                  autoFocus
                />
                <span className="vdesk__unit">°</span>
              </span>
            </label>
            <div>
              <span className="stat__label">{rt('Signed error')}</span>
              <span className="vdesk__value num">{ref === null || pendingImu === null ? '—' : fmtDeg(pendingImu - ref, 2, true)}</span>
            </div>
            <div>
              <span className="stat__label">{rt('Absolute error')}</span>
              <span className="vdesk__value num">{ref === null || pendingImu === null ? '—' : fmtDeg(Math.abs(pendingImu - ref), 2)}</span>
            </div>
          </div>
          <input className="input" placeholder={rt('Note (optional)')} value={note} onChange={(e) => setNote(e.target.value)} aria-label={rt('Note (optional)')} />
          <div className="vdesk__actions">
            <Button type="submit" variant="primary" size="lg" icon={<Check />} loading={busy} disabled={ref === null}>
              {rt('Save & continue')} <kbd>Enter</kbd>
            </Button>
            <Button icon={<RotateCcw />} onClick={() => void run(() => apply(repeatMeasurement(session, trials, 'repeat requested by operator')))} disabled={busy}>
              {rt('Repeat measurement')}
            </Button>
            <Button variant="ghost" icon={<Ban />} onClick={() => setReasonFor('invalid')} disabled={busy}>
              {rt('Mark invalid')}
            </Button>
            <Button variant="ghost" icon={<SkipForward />} onClick={() => setReasonFor('skip')} disabled={busy}>
              {rt('Skip with reason')}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <div className="callout callout--critical" role="alert">
          <CircleAlert aria-hidden />
          <div>{error}</div>
        </div>
      )}

      <Modal
        open={reasonFor !== null}
        onClose={() => setReasonFor(null)}
        title={reasonFor === 'invalid' ? rt('Mark invalid') : rt('Skip with reason')}
        description={rt('The record is kept and counted; it is excluded from agreement statistics.')}
        footer={
          <>
            <Button onClick={() => setReasonFor(null)}>{rt('Cancel')}</Button>
            <Button
              variant="primary"
              disabled={!reason.trim()}
              onClick={async () => {
                const kind = reasonFor;
                const ok = await run(() => apply(kind === 'invalid' ? markInvalid(session, trials, reason.trim(), operator) : skip(session, trials, reason.trim(), operator)));
                if (ok) {
                  setReasonFor(null);
                  setReason('');
                }
              }}
            >
              {rt('Save')}
            </Button>
          </>
        }
      >
        <input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={rt('Reason (required)')} aria-label={rt('Reason (required)')} />
      </Modal>
    </section>
  );
}

// ── Live report (also the body of the final report) ────────────────────────────────────────────

const SUFF: Record<Sufficiency, string> = { none: 'No data', insufficient: 'Insufficient', limited: 'Limited', adequate: 'Adequate' };

export function LiveReport({ session, trials, printable }: { session: ValidationSession; trials: Trial[]; printable?: boolean }) {
  const rt = useRT();
  const s = useMemo(() => sessionStatistics(session, trials), [session, trials]);
  const pairs = useMemo(() => validPairs(trials), [trials]);
  const flags = useMemo(() => flagPairs(pairs, session.protocol.quality.reviewAbsErrorDeg), [pairs, session.protocol.quality.reviewAbsErrorDeg]);
  const order = pairs.map((_, i) => i + 1);
  const d = pairs.map((p) => p.imu - p.ref);
  const dr = drift(d);
  const [edit, setEdit] = useState<Trial | null>(null);
  const o = s.overall;
  const ba = s.agreement;
  const labels = { bias: rt('Bias'), lower: rt('Lower LoA'), upper: rt('Upper LoA') };
  const kpi = (label: string, value: string, meta?: string) => (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value num">{value}</span>
      {meta && <span className="stat__meta">{meta}</span>}
    </div>
  );
  return (
    <section className="vreport" aria-label={rt('Live report')}>
      <h2 className="section-title">{rt(printable ? 'Statistical metrics' : 'Live report')}</h2>
      <div className="grid grid--kpi vkpis">
        {kpi(rt('Valid'), String(s.counts.valid), `${rt('Invalid')} ${s.counts.invalid} · ${rt('Skipped')} ${s.counts.skipped} · ${rt('Missing')} ${s.counts.missing}`)}
        {kpi(rt('Mean IMU angle'), fmtDeg(o.meanImu, 1))}
        {kpi(rt('Mean goniometer angle'), fmtDeg(o.meanRef, 1))}
        {kpi(rt('Mean signed error (bias)'), fmtDeg(o.bias, 2, true), o.biasCi ? `95% CI ${fmtDeg(o.biasCi[0], 2, true)} … ${fmtDeg(o.biasCi[1], 2, true)}` : rt('CI needs ≥ 2 pairs'))}
        {kpi('MAE', fmtDeg(o.mae, 2))}
        {kpi('RMSE', fmtDeg(o.rmse, 2))}
        {kpi(rt('SD of errors'), fmtDeg(o.sd, 2))}
        {kpi(rt('Median |error|'), fmtDeg(o.medianAbs, 2), o.maxAbs !== null ? `${rt('max')} ${fmtDeg(o.maxAbs, 2)}` : undefined)}
      </div>
      <p className="muted vnote">
        {rt('Data sufficiency')}: {rt('summary')} — {rt(SUFF[s.sufficiency.summary] as never)}; Bland–Altman — {rt(SUFF[s.sufficiency.blandAltman] as never)}; ICC — {rt(SUFF[s.sufficiency.icc] as never)}.{' '}
        {rt('Errors = IMU − goniometer. Values are rounded for display only.')}
      </p>

      <div className="grid grid--2 vcharts">
        <XYChart
          title={rt('IMU vs goniometer per repetition')}
          xLabel={rt('Valid pair #')}
          yLabel={rt('Angle, °')}
          xInteger
          empty={rt('No valid pairs yet.')}
          series={[
            { kind: 'line', name: 'IMU', color: LEFT, points: pairs.map((p, i) => ({ x: i + 1, y: p.imu, label: `#${i + 1} IMU ${p.imu.toFixed(2)}°` })) },
            { kind: 'line', name: rt('Goniometer'), color: RIGHT, points: pairs.map((p, i) => ({ x: i + 1, y: p.ref, label: `#${i + 1} ${rt('Goniometer')} ${p.ref}°` })) },
          ]}
        />
        <XYChart
          title={rt('Signed error per repetition (with trend)')}
          xLabel={rt('Valid pair #')}
          yLabel={rt('IMU − goniometer, °')}
          xInteger
          empty={rt('No valid pairs yet.')}
          series={[{ kind: 'points', name: rt('Signed error'), color: INK, points: d.map((y, i) => ({ x: order[i] as number, y, flagged: flags.has(i), label: `#${i + 1}: ${y.toFixed(2)}°` })) }]}
          rules={baRules(ba, labels)}
          {...(ba ? { band: ba.loa } : {})}
          {...(dr ? { trend: { intercept: dr.intercept, slope: dr.slope, label: 'trend' } } : {})}
        />
        <XYChart
          title={rt('Absolute error per repetition')}
          xLabel={rt('Valid pair #')}
          yLabel={rt('|IMU − goniometer|, °')}
          xInteger
          empty={rt('No valid pairs yet.')}
          series={[{ kind: 'bars', name: rt('Absolute error'), color: 'var(--muted-series)', points: d.map((y, i) => ({ x: i + 1, y: Math.abs(y), flagged: flags.has(i) })) }]}
          rules={o.mae !== null ? [{ y: o.mae, label: `MAE ${o.mae.toFixed(2)}°` }] : []}
        />
        <XYChart
          title={rt('Error distribution (1° bins)')}
          xLabel={rt('IMU − goniometer, °')}
          yLabel={rt('Count')}
          empty={rt('No valid pairs yet.')}
          series={[{ kind: 'bars', name: rt('Count'), color: 'var(--muted-series)', points: histogram(d, 1) }]}
        />
        <XYChart
          title={ba?.method === 'repeated_measures' ? rt('Bland–Altman (repeated measures)') : 'Bland–Altman'}
          xLabel={rt('Mean of IMU and goniometer, °')}
          yLabel={rt('IMU − goniometer, °')}
          empty={rt('Bland–Altman needs at least 3 valid pairs.')}
          series={ba ? [{ kind: 'points', name: rt('Pairs'), color: INK, points: ba.points.map((pt, i) => ({ x: pt.mean, y: pt.diff, flagged: flags.has(i) })) }] : []}
          rules={baRules(ba, labels)}
          {...(ba ? { band: ba.loa } : {})}
        />
        <div className="rchart vagree">
          <div className="rchart__title">{rt('Agreement analysis')}</div>
          {ba ? (
            <dl className="vdl">
              <dt>{rt('Method')}</dt>
              <dd>{ba.method === 'repeated_measures' ? rt('Bland & Altman 2007, repeated measures (true value varies)') : rt('Bland & Altman 1986, independent pairs')}</dd>
              <dt>{rt('Bias')}</dt>
              <dd className="num">
                {fmtDeg(ba.bias, 2, true)}
                {ba.biasCi && ` [${fmtDeg(ba.biasCi[0], 2, true)}, ${fmtDeg(ba.biasCi[1], 2, true)}]`}
              </dd>
              <dt>{rt('Limits of agreement')}</dt>
              <dd className="num">
                {fmtDeg(ba.loa[0], 2, true)} … {fmtDeg(ba.loa[1], 2, true)}
              </dd>
              {ba.lowerCi && ba.upperCi && (
                <>
                  <dt>{rt('95% CI of limits')}</dt>
                  <dd className="num">
                    {rt('lower')} {fmtDeg(ba.lowerCi[0], 2, true)}…{fmtDeg(ba.lowerCi[1], 2, true)}; {rt('upper')} {fmtDeg(ba.upperCi[0], 2, true)}…{fmtDeg(ba.upperCi[1], 2, true)}
                  </dd>
                </>
              )}
              {ba.proportional && (
                <>
                  <dt>{rt('Proportional bias (slope of difference on mean)')}</dt>
                  <dd className="num">
                    {fmtNum(ba.proportional.slope, 3)}
                    {ba.proportional.slopeCi && ` [${fmtNum(ba.proportional.slopeCi[0], 3)}, ${fmtNum(ba.proportional.slopeCi[1], 3)}]`}
                  </dd>
                </>
              )}
              {dr?.slopeCi && (
                <>
                  <dt>{rt('Error drift over the session')}</dt>
                  <dd className="num">
                    {fmtNum(dr.slope, 3)} °/{rt('pair')} [{fmtNum(dr.slopeCi[0], 3)}, {fmtNum(dr.slopeCi[1], 3)}]
                  </dd>
                </>
              )}
              {s.icc && (
                <>
                  <dt>ICC(A,1) {rt('IMU vs goniometer')}</dt>
                  <dd className="num">
                    {fmtNum(s.icc.agreement, 3)}
                    {s.icc.agreementCi && ` [${fmtNum(s.icc.agreementCi[0], 3)}, ${fmtNum(s.icc.agreementCi[1], 3)}]`} · SEM {fmtDeg(s.icc.semAgreement, 2)} · MDC95 {fmtDeg(s.icc.mdc95, 2)}
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <div className="rchart__empty">{rt('Bland–Altman needs at least 3 valid pairs.')}</div>
          )}
          <p className="muted vnote">
            {rt('Assumptions: constant bias and SD across the range, approximately normal differences. Repetitions of one participant describe agreement for that participant only. ICC across trials of one participant is descriptive. Agreement is not proof of clinical accuracy.')}
          </p>
        </div>
      </div>

      {s.ranges.length > 1 && (
        <div className="table-wrap card">
          <table className="table table--compact">
            <caption className="card__title" style={{ textAlign: 'left', padding: '12px 12px 0' }}>
              {rt('Agreement across the measured range (by goniometer angle)')}
            </caption>
            <thead>
              <tr>
                <th>{rt('Range')}</th>
                <th className="num">n</th>
                <th className="num">{rt('Bias')}</th>
                <th className="num">MAE</th>
                <th className="num">SD</th>
              </tr>
            </thead>
            <tbody>
              {s.ranges.map((r) => (
                <tr key={r.from}>
                  <td className="num">
                    {r.from}…{r.to}°
                  </td>
                  <td className="num">{r.summary.n}</td>
                  <td className="num">{fmtDeg(r.summary.bias, 2, true)}</td>
                  <td className="num">{fmtDeg(r.summary.mae, 2)}</td>
                  <td className="num">{fmtDeg(r.summary.sd, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TrialTable session={session} trials={trials} flags={flags} pairs={pairs} onEdit={printable ? undefined : setEdit} />
      {edit && <CorrectDialog trial={edit} trials={trials} onClose={() => setEdit(null)} />}
    </section>
  );
}

function TrialTable({ session, trials, flags, pairs, onEdit }: { session: ValidationSession; trials: Trial[]; flags: Map<number, string[]>; pairs: ReturnType<typeof validPairs>; onEdit: ((t: Trial) => void) | undefined }) {
  const rt = useRT();
  const { f } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const cur = new Set([...currentTrials(trials).values()].map((t) => t.id));
  const flagOf = (t: Trial) => flags.get(pairs.findIndex((p) => p.trial.id === t.id)) ?? [];
  const rows = [...trials]
    .filter((t) => showAll || cur.has(t.id))
    .sort((a, b) => a.set - b.set || a.repetition - b.repetition || a.pointId.localeCompare(b.pointId) || a.attempt - b.attempt);
  if (!trials.length) return <div className="card"><EmptyState compact title={rt('No repetitions recorded yet.')} /></div>;
  return (
    <div className="card">
      <div className="card__header">
        <h3 className="card__title">{rt('Repetition table')}</h3>
        <label className="checkbox">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {rt('Show superseded attempts')}
        </label>
      </div>
      <div className="table-wrap">
        <table className="table table--compact">
          <thead>
            <tr>
              <th>{rt('Set')}</th>
              <th>{rt('Rep')}</th>
              <th>{rt('Point')}</th>
              <th className="num">{rt('Attempt')}</th>
              <th>{rt('Status')}</th>
              <th className="num">IMU, °</th>
              <th className="num">{rt('Goniometer')}, °</th>
              <th className="num">{rt('Signed')}, °</th>
              <th className="num">|{rt('err')}|, °</th>
              <th className="num">{rt('Window SD')}, °</th>
              <th>{rt('Flags / reason')}</th>
              <th>{rt('Operator')}</th>
              <th>{rt('Time')}</th>
              {onEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const e = t.imu && t.referenceDeg !== null ? t.imu.angleDeg - t.referenceDeg : null;
              const fl = flagOf(t);
              return (
                <tr key={t.id} className={t.status === 'superseded' ? 'is-muted' : fl.length ? 'is-flagged' : undefined}>
                  <td className="num">{t.set}</td>
                  <td className="num">{t.repetition}</td>
                  <td>{session.protocol.measurementPoints.find((p) => p.id === t.pointId)?.label ?? t.pointId}</td>
                  <td className="num">{t.attempt}</td>
                  <td>
                    <span className={`badge ${t.status === 'valid' ? 'badge--good' : t.status === 'invalid' ? 'badge--critical' : t.status === 'pending_reference' ? 'badge--info' : 'badge--outline'}`}>{rt(STATUS[t.status] as never)}</span>
                  </td>
                  <td className="num">{fmtNum(t.imu?.angleDeg ?? null, 2)}</td>
                  <td className="num">{fmtNum(t.referenceDeg, 2)}</td>
                  <td className="num">{fmtNum(e, 2, true)}</td>
                  <td className="num">{fmtNum(e === null ? null : Math.abs(e), 2)}</td>
                  <td className="num">{fmtNum(t.imu?.windowSdDeg ?? null, 2)}</td>
                  <td className="small">{[...fl.map((x) => rt(FLAG[x] as never)), t.reason].filter(Boolean).join(' · ')}</td>
                  <td className="small">{t.operator}</td>
                  <td className="small num">{f.time(t.updatedAt)}</td>
                  {onEdit && (
                    <td>
                      {(t.status === 'valid' || t.status === 'invalid') && (
                        <Button size="sm" variant="ghost" iconOnly aria-label={rt('Review / correct')} icon={<Pencil />} onClick={() => onEdit(t)} />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STATUS: Record<Trial['status'], string> = { valid: 'Valid', invalid: 'Invalid', skipped: 'Skipped', superseded: 'Superseded', pending_reference: 'Waiting for goniometer' };
const FLAG: Record<string, string> = { outside_loa: 'outside LoA', robust_outlier: 'outlier (MAD)', above_review_threshold: 'above review threshold' };

function CorrectDialog({ trial, trials, onClose }: { trial: Trial; trials: Trial[]; onClose: () => void }) {
  const rt = useRT();
  const apply = useResearchStore((s) => s.apply);
  const [value, setValue] = useState(trial.referenceDeg === null ? '' : String(trial.referenceDeg));
  const [status, setStatus] = useState<'valid' | 'invalid'>(trial.status === 'invalid' ? 'invalid' : 'valid');
  const [reason, setReason] = useState(trial.reason);
  const [error, setError] = useState<string | null>(null);
  const ref = parseReference(value);
  return (
    <Modal
      open
      onClose={onClose}
      title={rt('Review / correct')}
      description={rt('The original record is kept as superseded; the correction is a new attempt with your name and time.')}
      footer={
        <>
          <Button onClick={onClose}>{rt('Cancel')}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const r = await apply(correctTrial(trials, trial.id, { ...(ref !== null ? { referenceDeg: ref } : {}), status, reason }, currentClinician() || trial.operator));
              if (r.ok) onClose();
              else setError(rt(ERRORS[r.error as WorkflowError] as never) || r.error);
            }}
          >
            {rt('Save correction')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="muted">
          IMU {fmtDeg(trial.imu?.angleDeg ?? null, 2)} · {rt('Set')} {trial.set} · {rt('Rep')} {trial.repetition}
        </div>
        <label className="field">
          <span className="field__label">{rt('Goniometer reading')}, °</span>
          <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{rt('Status')}</span>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as 'valid' | 'invalid')}>
            <option value="valid">{rt('Valid')}</option>
            <option value="invalid">{rt('Invalid')}</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">{rt('Reason')}</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <div className="callout callout--critical">{error}</div>}
      </div>
    </Modal>
  );
}

// ── Final report ──────────────────────────────────────────────────────────────────────────────

function Report({ session, patient }: { session: ValidationSession; patient: Patient }) {
  const rt = useRT();
  const { f } = useI18n();
  const allTrials = useResearchStore((s) => s.trials);
  const protocols = useResearchStore((s) => s.protocols);
  const update = useResearchStore((s) => s.updateSession);
  const trials = useMemo(() => allTrials.filter((t) => t.sessionId === session.id), [allTrials, session.id]);
  const [reopen, setReopen] = useState(false);
  const p = session.protocol;
  const cap = capabilityOf(p.exercise);
  const demo = session.workspace === 'demo' || session.device.simulated;
  const stats = sessionStatistics(session, trials);
  const exportAll = (kind: 'csv' | 'json' | 'dict') => {
    const id = newDatasetId();
    const filter = { sessionIds: [session.id], includeSuperseded: true };
    if (kind === 'csv') downloadText(exportName(demo, ['validation', session.id, stamp()], 'csv'), trialsCsv(id, [session], trials, [patient], filter), 'text/csv;charset=utf-8');
    if (kind === 'dict') downloadText(exportName(demo, ['validation-dictionary'], 'csv'), dictionaryCsv(), 'text/csv;charset=utf-8');
    if (kind === 'json') downloadText(exportName(demo, ['validation', session.id, stamp()], 'json'), datasetJson(id, [session], trials, [patient], protocols, filter), 'application/json');
  };
  const warnings: string[] = [];
  if (demo) warnings.push(rt('Simulated / demo data — not a measurement.'));
  if (stats.counts.missing > 0) warnings.push(rt('{n} measurement slots missing.', { n: stats.counts.missing }));
  if (stats.sufficiency.blandAltman !== 'adequate') warnings.push(rt('Fewer than 30 valid pairs: limits of agreement are imprecise.'));
  if (cap.status !== 'operational') warnings.push(`${rt('Measurement status')}: ${rt(cap.status === 'experimental' ? 'Experimental' : 'Future')} — ${cap.limitation}`);
  if (session.signal && session.signal.percent < 95) warnings.push(rt('Signal quality {p}% (lost or saturated samples).', { p: session.signal.percent.toFixed(1) }));
  const unstable = trials.filter((t) => t.status === 'valid' && t.imu && t.imu.windowSdDeg > p.quality.maxWindowSdDeg).length;
  if (unstable) warnings.push(rt('{n} valid trials had an unstable hold (window SD above the protocol limit).', { n: unstable }));

  return (
    <div className="page vreport-page">
      <PageHeader
        back={{ href: href({ name: 'research' }), label: rt('Research') }}
        eyebrow={<span className="eyebrow">{rt('Validation report')}</span>}
        title={`${p.name} · v${session.protocolVersion}`}
        lead={`${patient.code} · ${f.dateTime(session.startedAt)} · ${rt(session.status === 'completed' ? 'Completed' : 'Abandoned')}`}
        actions={
          <div className="row row--wrap print-hide">
            <Button icon={<Printer />} onClick={() => window.print()}>
              PDF
            </Button>
            <Button icon={<FileDown />} onClick={() => exportAll('csv')}>
              CSV
            </Button>
            <Button icon={<FileDown />} onClick={() => exportAll('json')}>
              JSON
            </Button>
            <Button variant="ghost" onClick={() => exportAll('dict')}>
              {rt('Data dictionary')}
            </Button>
            <Button variant="ghost" onClick={() => setReopen(true)}>
              {rt('Reopen')}
            </Button>
          </div>
        }
      />
      {warnings.length > 0 && (
        <div className="callout callout--warn">
          <CircleAlert aria-hidden />
          <div>
            <div className="callout__title">{rt('Data quality warnings')}</div>
            <ul className="vlist">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="grid grid--2">
        <section className="card card__body">
          <h2 className="card__title">{rt('Session information')}</h2>
          <dl className="vdl">
            <dt>{rt('Participant')}</dt>
            <dd>
              {patient.code} <span className="muted">({session.participantId})</span>
            </dd>
            <dt>{rt('Operator')}</dt>
            <dd>{session.operator || '—'}</dd>
            <dt>{rt('Protocol')}</dt>
            <dd>
              {p.name} · {session.protocolKey}
            </dd>
            <dt>{rt('Joint / movement / side')}</dt>
            <dd>
              {p.joint} · {p.movementType} · {rt(p.side === 'left' ? 'Left' : 'Right')}
            </dd>
            <dt>{rt('Design')}</dt>
            <dd>
              {p.sets} × {p.repetitions} × {p.measurementPoints.map((m) => m.label).join(' / ')} · {rt(p.captureMode === 'hold' ? 'hold capture' : 'repetition-peak capture')}, {p.holdWindowSec} s
            </dd>
            <dt>{rt('Started / ended')}</dt>
            <dd>
              {f.dateTime(session.startedAt)} — {session.endedAt ? f.dateTime(session.endedAt) : '—'}
            </dd>
            <dt>{rt('Notes')}</dt>
            <dd>{session.notes || '—'}</dd>
          </dl>
        </section>
        <section className="card card__body">
          <h2 className="card__title">{rt('Sensor configuration & calibration')}</h2>
          <dl className="vdl">
            <dt>{rt('Device')}</dt>
            <dd>
              {session.device.name} · {session.device.kind} · {rt('firmware')} {session.device.firmware} · {session.device.rateHz} Hz
            </dd>
            <dt>{rt('Sensors')}</dt>
            <dd>{session.device.sensors.length ? session.device.sensors.map((s) => `${s.placement} (${s.moduleId ?? rt('id not reported')})`).join(', ') : '—'}</dd>
            <dt>{rt('Accelerometer calibration')}</dt>
            <dd>{session.device.accCal && Object.keys(session.device.accCal).length ? `${rt('six-position, from device passport')}: ${Object.keys(session.device.accCal).join(', ')}` : rt('none in passport')}</dd>
            <dt>{rt('Stand-still calibration')}</dt>
            <dd>
              {session.calibration
                ? `${f.time(session.calibration.at)} · ${rt('attempts')} ${session.calibration.attempts} · ${Object.entries(session.calibration.poseDeg)
                    .map(([k, v]) => `${k} ${v}°`)
                    .join(', ')}`
                : '—'}
            </dd>
            <dt>{rt('Signal quality')}</dt>
            <dd>{session.signal ? `${session.signal.percent.toFixed(1)}% · ${rt('received')} ${session.signal.received} · ${rt('lost')} ${session.signal.lost} · ${rt('saturated')} ${session.signal.saturated}` : '—'}</dd>
            <dt>{rt('Algorithm / app')}</dt>
            <dd>
              {session.algorithmVersion} / {session.appVersion}
            </dd>
            <dt>{rt('Measurement status')}</dt>
            <dd>{rt(cap.status === 'operational' ? 'Operational' : cap.status === 'experimental' ? 'Experimental' : 'Future')}</dd>
          </dl>
        </section>
      </div>
      <LiveReport session={session} trials={trials} printable />
      <p className="muted vnote">
        {rt('Observed values: IMU angle and goniometer angle. Calculated values: errors, statistics, limits. Interpretation is left to the research team. NeuroMove is a research tool, not a diagnostic device.')}
      </p>
      <ConfirmDialog
        open={reopen}
        title={rt('Reopen the session?')}
        text={rt('Recorded trials stay as they are; you can continue measuring missing slots.')}
        confirmLabel={rt('Reopen')}
        onCancel={() => setReopen(false)}
        onConfirm={() => {
          setReopen(false);
          void update(session.id, { status: 'active', endedAt: null }).then(() => navigate({ name: 'researchSession', id: session.id }, { replace: true }));
        }}
      />
    </div>
  );
}
