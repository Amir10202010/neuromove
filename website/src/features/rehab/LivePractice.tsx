// Live sensor feedback in child mode. Uses the existing device controller and motion pipeline — the same
// angle the clinic test computes — with purpose 'practice': display only, no crash-recovery copy, never
// saved as a session or shown as a measurement afterwards. An adult connects the sensors; the child sees
// the live angle next to the professional's individual target, the repetitions the detector counted and
// whether the sensors are delivering data. In the demo the simulator is used and labelled.

import { Activity, CircleCheck, CircleX, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EXERCISES, type ExerciseId } from '../../core/exercises';
import type { Patient } from '../../data/models';
import type { DeviceKind, Side } from '../../devices/types';
import { requiredForValidation } from '../../research/capabilities';
import { SessionController } from '../../state/sessionController';
import { useControllerState, useEngineSnapshot } from '../../state/sessionStore';
import { useAppStore } from '../../state/appStore';
import { ConnectPanel } from '../session/ConnectPanel';
import { controllerFor, release, retain } from '../research/controllers';
import { exerciseLabel, useXT } from './common';
import { useI18n } from '../../i18n';
import { isLabRecord, trialRecordingStatus, type LabRecord } from '../../lab/records';
import { storeTrialSet, trialSetFromEngine } from '../../lab/practice';
import type { ConsentRecord } from '../../rehab/model';
import { useRehabStore } from '../../rehab/store';
import { scheduleSync } from '../../sync/engine';

export interface LiveTarget {
  exercise: ExerciseId;
  side: Side;
  /** Professional-set feedback target, degrees (null = no target line). */
  targetDeg: number | null;
}

/** Sensor side for the activity: the affected side when it is one side, else right. */
export function practiceSide(p: Patient): Side {
  return p.affectedSide === 'left' || p.affectedSide === 'right' ? p.affectedSide : 'right';
}

export function LivePractice({ patient, target, onClose, reduceMotion }: { patient: Patient; target: LiveTarget; onClose: () => void; reduceMotion: boolean }) {
  const { xt } = useXT();
  const ws = patient.workspace;
  const preferred = useAppStore((s) => s.settings.preferredDevice);
  const [kind, setKind] = useState<DeviceKind | null>(ws === 'demo' ? 'simulator' : preferred === 'usb' || preferred === 'ble' ? preferred : null);
  if (!kind)
    return (
      <div className="rh-live rh-live--setup" role="region" aria-label={xt('Live sensor feedback')}>
        <h2 className="child-h2">{xt('For the grown-up: connect the sensors')}</h2>
        <p className="child-msg">{xt('Put the sensors on as the therapist showed you, then choose how they connect.')}</p>
        <div className="child-actions">
          <button type="button" className="child-btn child-btn--go" onClick={() => setKind('usb')}>
            USB
          </button>
          <button type="button" className="child-btn child-btn--break" onClick={() => setKind('ble')}>
            Bluetooth
          </button>
          <button type="button" className="child-btn child-btn--stop" onClick={onClose}>
            <X aria-hidden /> {xt('Close')}
          </button>
        </div>
      </div>
    );
  return <LiveRun patient={patient} target={target} kind={kind} onClose={onClose} reduceMotion={reduceMotion} />;
}

function LiveRun({ patient, target, kind, onClose, reduceMotion }: { patient: Patient; target: LiveTarget; kind: DeviceKind; onClose: () => void; reduceMotion: boolean }) {
  const { xt } = useXT();
  const { t } = useI18n();
  const key = `practice:${patient.id}:${target.exercise}:${target.side}:${kind}`;
  const controller = controllerFor(
    key,
    () =>
      new SessionController(
        {
          workspace: patient.workspace,
          patientId: patient.id,
          protocolId: 'custom',
          steps: [{ exercise: target.exercise, side: target.side, reps: 0, durationSec: 2 * 3600 }],
          deviceKind: kind,
          scenario: 'normal',
          autoAdvance: false,
          purpose: 'practice',
          requiredOverride: requiredForValidation(target.exercise, target.side),
        },
        patient,
        [],
      ),
  );
  useEffect(() => {
    retain(key);
    return () => release(key);
  }, [key]);
  const state = useControllerState(controller);
  const snap = useEngineSnapshot(controller.engine);
  // Practice-trial recording for research: only when a professional enabled it for this child AND (clinic) an
  // active consent exists. The adult sees the notice below; nothing is recorded otherwise.
  const rehabRecords = useRehabStore((s) => s.records);
  const [labRecords, setLabRecords] = useState<LabRecord[] | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const startedAt = useRef(new Date());
  useEffect(() => {
    const st = useAppStore.getState().storage();
    if (!st) return;
    let alive = true;
    void st.getAllResearch('lab').then((all) => {
      if (alive) setLabRecords(all.filter(isLabRecord));
    });
    return () => {
      alive = false;
    };
  }, []);
  const consents = rehabRecords.filter((r): r is ConsentRecord => r.kind === 'consent');
  const recording = labRecords ? trialRecordingStatus(patient.id, patient.workspace, labRecords, consents) : null;
  const stop = async () => {
    const engine = controller.engine;
    const st = useAppStore.getState().storage();
    if (recording?.enabled && engine && st) {
      const set = trialSetFromEngine({ result: engine.result(), workspace: patient.workspace, participantId: patient.id, exercise: target.exercise, side: target.side, targetDeg: target.targetDeg, startedAt: startedAt.current, endedAt: new Date(), consentId: recording.consent?.id ?? null, simulated: kind === 'simulator' || state?.device.info?.simulated === true, raw: { frames: engine.rawFrames, rateHz: state?.device.info?.rateHz ?? 100, deviceKind: kind, accCalibrated: !!state?.device.info?.accCal && Object.keys(state.device.info.accCal).length > 0 } });
      if (set) {
        const ok = await storeTrialSet(st, set, engine.rawFrames).catch(() => false);
        if (!ok) {
          setSaveFailed(true);
          return;
        }
        if (set.workspace === 'clinic') scheduleSync();
      }
    }
    onClose();
  };
  const { angle, best } = useLiveAngle(controller);
  const simulated = kind === 'simulator' || state?.device.info?.simulated === true;

  if (!state) return null;
  const header = (
    <div className="rh-live__head">
      <span className="rh-live__label">
        <Activity aria-hidden className="rh-inline-icon" /> {xt('Live practice feedback — not saved as a measurement')}
        {simulated && <span className="badge badge--demo">{xt('simulator')}</span>}
      </span>
      {recording?.enabled && <span className="rh-live__label" role="note">{xt('Practice trials are recorded for the study — not a clinical measurement')}</span>}
      {saveFailed && <span className="rh-live__bad" role="alert">{xt('Practice trials were not saved.')}</span>}
      <button type="button" className="child-btn child-btn--stop rh-live__close" onClick={() => void stop()}>
        <X aria-hidden /> {xt('Stop sensors')}
      </button>
    </div>
  );

  if (state.stage === 'connect')
    return (
      <div className="rh-live rh-live--setup" role="region" aria-label={xt('Live sensor feedback')}>
        {header}
        <p className="child-msg">{xt('For the grown-up: wait until the needed sensors are connected, then start the calibration.')}</p>
        <div className="rh-live__connect">
          <ConnectPanel controller={controller} state={state} />
        </div>
      </div>
    );

  const phase = snap?.phase ?? 'ready';
  const reps = snap?.steps[0]?.reps.length ?? 0;
  const signalOk = (snap?.quality.percent ?? 0) >= 90 && snap?.connection !== 'lost' && (snap?.missing.length ?? 0) === 0;
  return (
    <div className={`rh-live${reduceMotion ? ' child-calm' : ''}`} role="region" aria-label={xt('Live sensor feedback')}>
      {header}
      {phase === 'calibrating' ? (
        <div className="rh-live__big">
          <p className="child-h2">{xt('Hold still like a statue')}</p>
          <div className="child-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((snap?.calibration.progress ?? 0) * 100)}>
            <span className="is-on" style={{ width: `${Math.max(8, (snap?.calibration.progress ?? 0) * 200)}px` }} />
          </div>
          {snap?.calibration.moved && <p className="child-msg">{xt('A little movement — we start again.')}</p>}
        </div>
      ) : phase === 'positioning' ? (
        <div className="rh-live__big">
          <p className="child-h2">{t('run.positioningTitle')}</p>
          <p className="child-msg">{t('run.positioningText')}</p>
        </div>
      ) : phase === 'interrupted' || snap?.connection === 'lost' ? (
        <div className="rh-live__big">
          <p className="child-h2">{xt('The sensors are not sending data. Wait a moment.')}</p>
        </div>
      ) : (
        <LiveGauge exercise={target.exercise} angle={angle} best={best} targetDeg={target.targetDeg} />
      )}
      <div className="rh-live__status">
        <span>{exerciseLabel(t, target.exercise)} · {target.side === 'left' ? xt('left') : xt('right')}</span>
        <span>
          {xt('Movements counted')}: <strong className="num">{reps}</strong>
        </span>
        <span className={signalOk ? 'rh-live__ok' : 'rh-live__bad'} role="status">
          {signalOk ? <CircleCheck aria-hidden className="rh-inline-icon" /> : <CircleX aria-hidden className="rh-inline-icon" />} {signalOk ? xt('Sensors OK') : xt('Sensor data incomplete')}
        </span>
      </div>
    </div>
  );
}

/** Reads the engine's live angle about 10 times a second (no 60 fps React renders) and the highest so far. */
function useLiveAngle(controller: SessionController): { angle: number | null; best: number | null } {
  const [v, setV] = useState<{ angle: number | null; best: number | null }>({ angle: null, best: null });
  useEffect(() => {
    const id = setInterval(() => {
      const recording = controller.engine?.getSnapshot().phase === 'recording';
      const a = recording ? (controller.engine?.live.angle ?? null) : null;
      setV((prev) => ({ angle: a, best: a === null ? prev.best : prev.best === null ? a : Math.max(prev.best, a) }));
    }, 100);
    return () => clearInterval(id);
  }, [controller]);
  return v;
}

export function LiveGauge({ exercise, angle, best, targetDeg }: { exercise: ExerciseId; angle: number | null; best: number | null; targetDeg: number | null }) {
  const { xt } = useXT();
  const { min, max } = EXERCISES[exercise].gauge;
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%`;
  const reached = targetDeg !== null && angle !== null && angle >= targetDeg;
  const label = useMemo(() => (angle === null ? '—' : `${Math.round(angle)}°`), [angle]);
  return (
    <figure className="rh-live__gauge" aria-label={xt('Live angle {a}', { a: label })}>
      <div className="rh-live__angle num" aria-live="off">
        {label}
      </div>
      <div className="rh-live__bar">
        <span className={`rh-live__fill${reached ? ' is-reached' : ''}`} style={{ width: angle === null ? '0%' : pos(angle) }} />
        {best !== null && <span className="rh-live__best" style={{ left: pos(best) }} title={xt('Highest this time')} />}
        {targetDeg !== null && <span className="rh-live__target" style={{ left: pos(targetDeg) }} title={xt('Your target')} />}
      </div>
      <figcaption className="child-msg">
        {targetDeg !== null ? (reached ? xt('At your target line') : xt('Your target line: {t}°', { t: targetDeg })) : xt('Move as the therapist showed you.')}
      </figcaption>
    </figure>
  );
}
