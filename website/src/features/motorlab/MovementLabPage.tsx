// Movement Analysis Lab — the 100 Hz layer: per-sensor signal quality, angular speed and inclination over time,
// velocity-defined movement events, movement features, and a comparison with the existing angle-threshold
// repetition detector. Works on stored raw frames of a session or on an imu-csv v1 recording file (not saved).

import { FileUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { href } from '../../app/router';
import { isSimulatedRecording, parseImuCsv } from '../../devices/contract';
import type { Placement, RawFrame } from '../../devices/types';
import { isSimulatedSession, type Session } from '../../data/models';
import { PageHeader } from '../../layout/PageHeader';
import { detectMovements, pairRepetitions } from '../../lab/events';
import { FEATURES, movementFeatures, type FeatureId } from '../../lab/features';
import { meanOf } from '../../lab/numeric';
import { assessRecording, type Confidence } from '../../lab/quality';
import { sensorSignals } from '../../lab/signals';
import { useAppStore } from '../../state/appStore';
import { EmptyState } from '../../ui/EmptyState';
import { SignalChart } from './charts';
import { fmt, Prov, SimulatedBanner, useDates, useLabData, useNames } from './common';
import { useLT, type LKey, type LT } from './i18n';

const MAX_FILE = 64 * 1024 * 1024;

type Source = { kind: 'session'; session: Session; frames: RawFrame[] } | { kind: 'file'; name: string; frames: RawFrame[]; rateHz: number; simulated: boolean; errors: number };

export function MovementLabPage({ sessionId }: { sessionId: string | null }) {
  const lt = useLT();
  const { sessions, patients, includeSimulated } = useLabData();
  const getRaw = useAppStore((s) => s.getRaw);
  const dates = useDates();
  const session = sessionId ? sessions.find((s) => s.id === sessionId) ?? null : null;
  const [fileSrc, setFileSrc] = useState<Source | null>(null);
  const [stored, setStored] = useState<{ id: string; frames: RawFrame[] | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!session || !session.hasRaw) return;
    void getRaw(session.id).then((frames) => {
      if (alive) setStored({ id: session.id, frames: frames && frames.length ? frames : null });
    });
    return () => {
      alive = false;
    };
  }, [session, getRaw]);
  const loading = !!session?.hasRaw && stored?.id !== session.id;
  const readFailed = !!session && stored?.id === session.id && stored.frames === null;
  const src: Source | null = session && stored?.id === session.id && stored.frames ? { kind: 'session', session, frames: stored.frames } : fileSrc;
  const withRaw = sessions.filter((s) => s.hasRaw).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const onFile = async (f: File) => {
    setErr(null);
    if (f.size > MAX_FILE) return setErr(lt('The file is larger than 64 MB — not a single-session recording.'));
    const parsed = parseImuCsv(await f.text());
    if (!parsed.frames.length) return setErr(lt('No frames could be read from this file.'));
    setFileSrc({ kind: 'file', name: f.name, frames: parsed.frames, rateHz: parsed.passport.rateHz || 100, simulated: isSimulatedRecording(parsed.passport), errors: parsed.errors });
  };
  const simulated = src ? (src.kind === 'session' ? isSimulatedSession(src.session) : src.simulated) : includeSimulated;
  return (
    <div className="page">
      <PageHeader back={{ href: href({ name: 'labOverview' }), label: lt('Motor learning lab') }} title={lt('Movement Analysis Lab')} lead={lt('The 100 Hz layer: signal quality, angular speed, inclination, velocity-defined movements and their features — from the raw sensor numbers.')} />
      <SimulatedBanner show={simulated} />
      <section className="card card__body mlfilters">
        <label className="field">
          <span className="field__label">{lt('Session with raw data')}</span>
          <select className="select" value={sessionId ?? ''} onChange={(e) => (window.location.hash = href({ name: 'labMovement', sessionId: e.target.value || null }))}>
            <option value="">{lt('Choose…')}</option>
            {withRaw.map((s) => (
              <option key={s.id} value={s.id}>
                {patients.find((p) => p.id === s.patientId)?.code ?? '—'} · {dates.dateTime(s.startedAt)}
              </option>
            ))}
          </select>
        </label>
        <label className="btn btn--secondary">
          <FileUp aria-hidden /> {lt('Analyse an imu-csv file')}
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
        <span className="mlmuted">{lt('A file is analysed in this tab only and is not saved.')}</span>
      </section>
      {err && <div className="callout callout--critical">{err}</div>}
      {readFailed && <div className="callout callout--critical">{lt('Raw frames for this session could not be read.')}</div>}
      {session && !session.hasRaw && <div className="callout callout--info">{lt('This session was saved without raw frames (demo history and older sessions). Only its stored repetition metrics are available.')}</div>}
      {loading && <p className="mlmuted">{lt('Reading raw frames…')}</p>}
      {!src && !loading && !withRaw.length && <EmptyState title={lt('No raw recordings yet')} text={lt('Raw 100 Hz frames are stored for live sensor sessions. Record a session, or analyse an imu-csv v1 file from the device or the bench.')} />}
      {src && <Analysis key={src.kind === 'session' ? src.session.id : src.name} src={src} lt={lt} />}
    </div>
  );
}

const CONF: Record<Confidence, LKey> = { high: 'high', medium: 'medium', low: 'low', unusable: 'unusable' };

function Analysis({ src, lt }: { src: Source; lt: LT }) {
  const names = useNames();
  const rate = src.kind === 'session' ? src.session.device.rateHz || 100 : src.rateHz;
  const qc = useMemo(() => assessRecording(src.frames, rate), [src.frames, rate]);
  const moving = qc.placements.filter((p) => p !== 'trunk');
  const energy = (p: Placement) => {
    const s = sensorSignals(src.frames, p, rate);
    return s ? meanOf(s.speed) : 0;
  };
  const [sensor, setSensor] = useState<Placement | null>(() => [...moving].sort((a, b) => energy(b) - energy(a))[0] ?? qc.placements[0] ?? null);
  const sig = useMemo(() => (sensor ? sensorSignals(src.frames, sensor, rate) : null), [src.frames, sensor, rate]);
  const trunk = useMemo(() => (qc.placements.includes('trunk') && sensor !== 'trunk' ? sensorSignals(src.frames, 'trunk', rate) : null), [src.frames, qc.placements, sensor, rate]);
  const ev = useMemo(() => (sig ? detectMovements(sig, rate) : null), [sig, rate]);
  const feats = useMemo(() => (sig && ev ? ev.events.map((e) => movementFeatures(e, sig, ev.speedFiltered, rate, trunk)) : []), [sig, ev, rate, trunk]);
  const dur = sig ? (sig.t[sig.t.length - 1] ?? 0) : 0;
  const [w0, setW0] = useState(0);
  const [len, setLen] = useState(30);
  const win: [number, number] = [w0, Math.min(dur, w0 + len)];
  const reps = ev ? pairRepetitions(ev.events) : [];
  const engineReps = src.kind === 'session' ? src.session.steps.flatMap((st) => st.summary.reps.map((r) => ({ ...r, exercise: st.summary.exercise, side: st.summary.side }))) : [];
  const t0raw = src.frames[0]?.t ?? 0;
  const FEATS: FeatureId[] = ['duration', 'peak_speed', 'time_to_peak_fraction', 'speed_peaks', 'sparc', 'inclination_change', 'trunk_tilt', 'trunk_ratio', 'trunk_lag'];
  return (
    <>
      <section className="mlsection">
        <h2 className="section-title">{lt('Signal quality')} <span className={`badge ${qc.confidence === 'high' ? 'badge--good' : qc.confidence === 'medium' ? 'badge--warn' : 'badge--critical'}`}>{lt(CONF[qc.confidence])}</span></h2>
        <p className="mlmuted">
          {fmt(qc.durationSec, 1)} s · {qc.frames} {lt('frames')} · {rate} Hz · {lt('missing by sequence number')}: {qc.seqMissing} · {lt('frames with every sensor')}: {fmt(qc.syncFraction * 100, 1)} % · {lt('Sensors share one clock: the firmware reads all modules in one loop and sends one line per sample.')}
          {src.kind === 'file' && src.errors > 0 ? ` · ${lt('unreadable lines')}: ${src.errors}` : ''}
        </p>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable">
            <thead>
              <tr>
                <th>{lt('Sensor')}</th>
                <th>{lt('Confidence')}</th>
                <th className="num">{lt('Completeness')}</th>
                <th className="num">{lt('Longest gap, s')}</th>
                <th className="num">{lt('Interval median / p95, ms')}</th>
                <th className="num">{lt('Saturated')}</th>
                <th className="num">{lt('|a| at rest, g')}</th>
                <th className="num">{lt('Gyro bias drift, °/s')}</th>
                <th>{lt('Reasons')}</th>
              </tr>
            </thead>
            <tbody>
              {qc.sensors.map((s) => (
                <tr key={s.placement} className={s.placement === sensor ? 'is-selected' : ''}>
                  <td>{s.placement}</td>
                  <td>{lt(CONF[s.confidence])}</td>
                  <td className="num">{fmt(s.completeness * 100, 1)} %</td>
                  <td className="num">{fmt(s.longestGapSec, 2)}</td>
                  <td className="num">{fmt(s.dtMedianMs, 1)} / {fmt(s.dtP95Ms, 1)}</td>
                  <td className="num">{fmt(s.saturatedFraction * 100, 2)} %</td>
                  <td className="num">{fmt(s.restAccNorm, 3)}</td>
                  <td className="num">{fmt(s.biasDriftDps, 2)}</td>
                  <td>{s.reasons.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mlmuted"><Prov kind="measured" /> {lt('Thresholds are conditions for valid processing, not clinical norms (research/measurement-model.md).')}</p>
      </section>

      <section className="mlsection">
        <h2 className="section-title">{lt('Time series')}</h2>
        <div className="card card__body mlfilters">
          <label className="field">
            <span className="field__label">{lt('Segment sensor')}</span>
            <select className="select" value={sensor ?? ''} onChange={(e) => setSensor(e.target.value as Placement)}>
              {qc.placements.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{lt('Window start, s')}</span>
            <input className="input" type="range" min={0} max={Math.max(0, dur - 1)} step={1} value={w0} onChange={(e) => setW0(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="field__label">{lt('Window length, s')}</span>
            <select className="select" value={len} onChange={(e) => setLen(Number(e.target.value))}>
              {[10, 30, 60, 120, 600].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <span className="mlmuted">{fmt(win[0], 0)}–{fmt(win[1], 0)} s / {fmt(dur, 0)} s</span>
        </div>
        {sig && ev && (
          <div className="card card__body">
            <SignalChart title={`${lt('Angular speed |ω|, 6 Hz low-pass')} — ${sensor}`} yLabel="°/s" xLabel={lt('Time, s')} t={sig.t} y={ev.speedFiltered} threshold={ev.highThreshold} spans={ev.events.map((e) => ({ a: e.onset, b: e.offset, kind: e.direction, incomplete: e.incomplete }))} window={win} fmt={(v) => fmt(v, 0)} />
            <SignalChart title={`${lt('Inclination from vertical (gravity-referenced)')} — ${sensor}`} yLabel="°" xLabel={lt('Time, s')} t={sig.t} y={sig.elevation} spans={ev.events.map((e) => ({ a: e.onset, b: e.offset, kind: e.direction, incomplete: e.incomplete }))} window={win} fmt={(v) => fmt(v, 0)} />
            {trunk && <SignalChart title={lt('Trunk tilt from its first still orientation')} yLabel="°" xLabel={lt('Time, s')} t={trunk.t} y={trunk.tiltFromStart} spans={ev.events.map((e) => ({ a: e.onset, b: e.offset, kind: e.direction, incomplete: e.incomplete }))} window={win} fmt={(v) => fmt(v, 0)} />}
            <p className="mlmuted">
              <Prov kind="derived" /> {lt('Blue spans: raising movements; orange: lowering; grey: no clear direction; pale: incomplete (touches a gap or the recording edge). Dashed line: detection threshold.')} {lt('Gyroscope bias')}: {sig.biasSource === 'first_still_period' ? `${sig.biasDps.map((v) => fmt(v, 2)).join(' / ')} °/s` : lt('no still period found — bias not removed')}.
            </p>
          </div>
        )}
      </section>

      <section className="mlsection">
        <h2 className="section-title">{lt('Movements and features')} ({ev?.events.length ?? 0})</h2>
        <p className="mlmuted">{lt('Velocity-defined: onset and offset at 5 % of each movement’s peak speed. Smoothness from gyroscope speed (SPARC), not accelerometer jerk, which gravity contaminates.')}</p>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable">
            <thead>
              <tr>
                <th>#</th>
                <th className="num">{lt('Onset, s')}</th>
                <th>{lt('Direction')}</th>
                {FEATS.map((f) => (
                  <th key={f} className="num" title={FEATURES[f].definition}>{f}{FEATURES[f].unit ? `, ${FEATURES[f].unit}` : ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {feats.slice(0, 200).map((m) => (
                <tr key={m.event.index} className={m.event.incomplete ? 'is-muted' : ''}>
                  <td>{m.event.index + 1}</td>
                  <td className="num">{fmt(m.event.onset, 2)}</td>
                  <td>{lt(m.event.direction === 'raise' ? 'raise' : m.event.direction === 'lower' ? 'lower' : 'other')}</td>
                  {FEATS.map((f) => (
                    <td key={f} className="num" title={m.missing[f] ?? ''}>{m.values[f] === undefined ? '—' : fmt(m.values[f], f === 'speed_peaks' ? 0 : 2)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {src.kind === 'session' && (
        <section className="mlsection">
          <h2 className="section-title">{lt('Processing comparison')}</h2>
          <p className="mlmuted">{lt('Existing detector (core/reps.ts): joint-angle thresholds with hysteresis, per protocol step. This lab: velocity-defined raise → lower pairs on the selected sensor. They answer different questions; a disagreement is information, not an error by itself.')}</p>
          <div className="card mlscroll" tabIndex={0}>
            <table className="table table--compact mltable">
              <thead>
                <tr>
                  <th>{lt('Engine repetition')}</th>
                  <th className="num">{lt('Window, s')}</th>
                  <th className="num">{lt('Engine ROM, °')}</th>
                  <th className="num">{lt('Matching raise: inclination change, °')}</th>
                  <th className="num">{lt('Raise duration, s')}</th>
                </tr>
              </thead>
              <tbody>
                {engineReps.map((r, i) => {
                  const raise = reps.find((x) => x.raise.peak + t0raw >= r.tStart - 2 && x.raise.peak + t0raw <= r.tEnd)?.raise;
                  const f = raise ? feats.find((m) => m.event.index === raise.index) : undefined;
                  return (
                    <tr key={i}>
                      <td>{names.task(r.exercise, r.side)} · {r.index + 1}</td>
                      <td className="num">{fmt(r.tStart, 1)}–{fmt(r.tEnd, 1)}</td>
                      <td className="num">{fmt(r.rom, 1)}</td>
                      <td className="num">{f ? fmt(f.values.inclination_change, 1) : '—'}</td>
                      <td className="num">{f ? fmt(f.values.duration, 2) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mlmuted">{lt('Inclination change equals ROM only for shoulder elevation with the upper-arm sensor selected; elbow and forearm angles use other definitions.')}</p>
        </section>
      )}
    </>
  );
}
