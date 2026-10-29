import { Maximize2, Pause, Play, RotateCcw, SkipForward, Square, X, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { href, navigate } from '../../website/router';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { currentClinician, useAppStore } from '../../state/appStore';
import type { SessionController } from '../../state/sessionController';
import { useControllerState, useEngineSnapshot, useSessionStore } from '../../state/sessionStore';
import type { SimFault } from '../../devices/SimulatorDevice';
import { Button, LinkButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { EmptyArt } from '../../figures/EmptyArt';
import { ConfirmDialog } from '../../ui/Modal';
import { PatientAvatar } from '../../ui/PatientAvatar';
import { patientLine } from '../common/text';
import { CalibrationPanel } from './CalibrationPanel';
import { ConnectPanel } from './ConnectPanel';
import { InterruptionOverlay } from './InterruptionOverlay';
import { Details } from '../common/Details';
import { LiveExtras, LiveMain, StepsList, useMarkers } from './LivePanel';
import { PatientView } from './PatientView';
import { StatusRing } from '../../figures/StatusRing';

/** Ширина меню сбоев, px — то же число, что в .faults-menu. */
const FAULTS_MENU_W = 240;

type StageKey = 'connect' | 'calibrate' | 'test' | 'result';

/**
 * Этапы сеанса — те же статус-кольца, что у шагов теста и гида: пройденный — галочка,
 * текущий — сектор, который заполняется по ходу этапа (датчики на связи, секунды
 * калибровки, шаги теста), впереди — пустой круг.
 */
function Stepper({ current, progress }: { current: StageKey; progress: number }) {
  const { t } = useI18n();
  const order: StageKey[] = ['connect', 'calibrate', 'test', 'result'];
  const idx = order.indexOf(current);
  return (
    <ol className="stepper" aria-label={t('run.stepTrack')}>
      {order.map((k, i) => (
        <li key={k} className={i < idx ? 'is-done' : i === idx ? 'is-current' : ''} aria-current={i === idx ? 'step' : undefined}>
          <StatusRing state={i < idx ? 'done' : i === idx ? 'active' : 'todo'} progress={progress} size={18} />
          <span className="stepper__label">{t(`run.stages.${k}`)}</span>
        </li>
      ))}
    </ol>
  );
}

export function SessionRunPage() {
  const { t } = useI18n();
  const controller = useSessionStore((s) => s.controller);
  if (!controller) {
    return (
      <div className="page page--narrow">
        <PageHeader title={t('run.noSession')} />
        <div className="card">
          <EmptyState
            art={<EmptyArt kind="device" />}
            title={t('run.noSession')}
            text={t('run.noSessionText')}
            action={
              <LinkButton variant="primary" href={href({ name: 'sessionNew', patientId: null })}>
                {t('run.toSetup')}
              </LinkButton>
            }
          />
        </div>
      </div>
    );
  }
  return <Run controller={controller} key={controller.setup.patientId + controller.setup.protocolId} />;
}

function Run({ controller }: { controller: SessionController }) {
  const { t, f } = useI18n();
  const state = useControllerState(controller);
  const engine = controller.engine;
  const snap = useEngineSnapshot(engine);
  const saveSession = useAppStore((s) => s.saveSession);
  const details = useAppStore((s) => s.settings.details);
  const sessions = useAppStore((s) => s.sessions);
  const toast = useAppStore((s) => s.toast);
  const clear = useSessionStore((s) => s.clear);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [patientView, setPatientView] = useState(false);
  // Меню сбоев — в портале над нижней панелью: на телефоне панель прокручивается вбок
  // и обрезала бы выпадающее меню (найдено сквозным тестом на ширине Pixel 7)
  const [faultsAt, setFaultsAt] = useState<{ left: number; bottom: number } | null>(null);
  const faultsOpen = faultsAt !== null;
  const toggleFaults = (button: HTMLElement) => {
    if (faultsAt) return setFaultsAt(null);
    const r = button.getBoundingClientRect();
    const left = Math.max(12, Math.min(r.left, window.innerWidth - FAULTS_MENU_W - 12));
    setFaultsAt({ left, bottom: window.innerHeight - r.top + 8 });
  };
  useEffect(() => {
    if (!faultsAt) return;
    const close = () => setFaultsAt(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [faultsAt]);
  const saved = useRef(false);
  const patient = controller.patient;
  const history = sessions.filter((s) => s.patientId === patient.id && s.workspace === controller.setup.workspace);

  // Итог: движок закончил — сохраняем сеанс и открываем отчёт
  useEffect(() => {
    if (state?.stage !== 'saving' || saved.current) return;
    saved.current = true;
    const raw = controller.rawFrames();
    const session = controller.finalize(currentClinician());
    if (!session) return;
    saveSession(session, raw);
    navigate({ name: 'session', id: session.id, complete: true }, { replace: true });
    void clear();
  }, [state?.stage, controller, saveSession, clear]);

  // Ушли с экрана посреди теста — ставим на паузу: ребёнок не должен «записываться» без присмотра
  useEffect(() => {
    return () => {
      const e = controller.engine;
      if (e && !e.isFinished) e.pause();
    };
  }, [controller]);

  // Закрыть вкладку посреди теста — браузер переспросит; данные на случай перезагрузки сохраняются
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.engine && !controller.engine.isFinished) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [controller]);

  // Клавиши: пробел — пауза, N — следующий шаг, P — экран для пациента
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]')) return;
      if (!engine || engine.isFinished || confirmStop) return;
      const phase = engine.currentPhase;
      if (e.key === ' ') {
        e.preventDefault();
        if (phase === 'paused') engine.resume();
        else engine.pause();
      } else if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey) {
        engine.nextStep();
      } else if (e.key.toLowerCase() === 'p' && !e.metaKey && !e.ctrlKey && !patientView) {
        setPatientView(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, confirmStop, patientView]);

  const markers = useMarkers(
    snap ?? { phase: 'ready', resumeTo: null, connection: 'ok', stepIndex: 0, steps: [], calibration: { progress: 0, attempt: 0, moved: false }, positioning: { ready: false, progress: 0 }, activeSec: 0, quality: { received: 0, lost: 0, saturated: 0, percent: NaN }, hint: null, missing: [], flipped: null, events: [], version: 0 },
    patient,
    history,
  );

  if (!state) return null;
  const phase = snap?.phase;
  const stage: StageKey = state.stage === 'connect' ? 'connect' : phase === 'calibrating' ? 'calibrate' : state.stage === 'test' ? 'test' : 'result';
  // Доля текущего этапа — для сектора в его кольце
  const onlineNeeded = controller.required.filter((p) => state.device.sensors.find((x) => x.placement === p)?.online).length;
  const stageProgress =
    stage === 'connect'
      ? onlineNeeded / Math.max(1, controller.required.length)
      : stage === 'calibrate'
        ? (snap?.calibration.progress ?? 0)
        : stage === 'test'
          ? (snap?.steps.filter((x) => x.status === 'done' || x.status === 'skipped').length ?? 0) / Math.max(1, snap?.steps.length ?? 1)
          : 1;
  const sim = controller.simulator;
  const interrupted = phase === 'interrupted';
  const active = engine && !engine.isFinished && state.stage === 'test';

  const fault = (k: SimFault) => {
    sim?.injectFault(k);
    setFaultsAt(null);
  };

  return (
    <div className="page run">
      <header className="run__head">
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <PatientAvatar name={patient.code} demo={controller.setup.workspace === 'demo'} />
          <div style={{ minWidth: 0 }}>
            {/* Кто на тесте — по имени. Протокол и диагноз — в подробном виде: во время теста не нужны */}
            <div className="row" style={{ gap: 8 }}>
              <strong style={{ fontSize: 'var(--fs-lg)' }}>{patient.code}</strong>
              {details && <span className="badge">{t(`protocol.${controller.setup.protocolId}`)}</span>}
            </div>
            {details && <div className="muted run__line">{patientLine(t, patient, details)}</div>}
          </div>
        </div>
        <Stepper current={stage} progress={stageProgress} />
        <div className="run__timer" aria-live="off" title={t('run.elapsed')}>
          <span className="sr-only">{t('run.elapsed')}</span>
          <span className="num">{f.duration(snap?.activeSec ?? 0)}</span>
        </div>
      </header>

      {state.stage === 'connect' && <ConnectPanel controller={controller} state={state} />}

      {state.stage !== 'connect' && engine && snap && (
        <>
          {/* Простой вид: калибровка или одна карточка теста. Всё остальное — в подробностях */}
          {phase === 'calibrating' ? (
            <CalibrationPanel engine={engine} snap={snap} device={state.device} />
          ) : (
            <div className="run__main">
              <LiveMain engine={engine} snap={snap} device={state.device} markers={markers} onNext={() => engine.nextStep()} manualNext={!controller.setup.autoAdvance} details={details} />
              {phase === 'paused' && (
                  <div className="paused-banner" role="status">
                    <Pause aria-hidden />
                    <div style={{ flex: 1 }}>
                      <strong>{t('run.paused')}</strong>
                      <div className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>
                        {t('run.pausedText')}
                      </div>
                    </div>
                    <Button variant="primary" icon={<Play />} onClick={() => engine.resume()}>
                      {t('run.controls.resume')}
                    </Button>
                  </div>
                )}
            </div>
          )}
          {state.stage === 'test' && (
            <Details hint={t('details.liveHint')}>
              <div className="run__extras">
                <StepsList snap={snap} />
                <LiveExtras engine={engine} snap={snap} device={state.device} />
              </div>
            </Details>
          )}
          {interrupted && (
            <InterruptionOverlay snap={snap} device={state.device} required={controller.required} onResume={() => engine.resume()} onReconnect={() => void controller.reconnect()} onStop={() => setConfirmStop(true)} />
          )}
        </>
      )}

      {state.stage === 'saving' && (
        <div className="card">
          <EmptyState title={t('run.finished')} text={t('run.saving')} />
        </div>
      )}

      <div className="control-bar" role="toolbar" aria-label={t('run.stages.test')}>
        {active ? (
          <>
            {phase === 'paused' || interrupted ? (
              <Button variant="primary" icon={<Play />} onClick={() => engine.resume()} disabled={interrupted && snap?.connection !== 'restored'} aria-label={t('run.controls.resume')}>
                <span className="hide-xs">{t('run.controls.resume')}</span>
              </Button>
            ) : (
              <Button icon={<Pause />} onClick={() => engine.pause()} disabled={phase === 'step_done'} aria-label={t('run.controls.pause')}>
                <span className="hide-xs">{t('run.controls.pause')}</span>
              </Button>
            )}
            <Button icon={<SkipForward />} onClick={() => engine.nextStep()} disabled={phase === 'calibrating' || interrupted} aria-label={t('run.controls.next')}>
              <span className="hide-sm">{t('run.controls.next')}</span>
            </Button>
            <Button variant="ghost" icon={<Maximize2 />} onClick={() => setPatientView(true)} disabled={phase === 'calibrating'} aria-label={t('run.controls.patientView')}>
              <span className="hide-md">{t('run.controls.patientView')}</span>
            </Button>
            {/* Перекалибровка, сбои симулятора и подсказка по клавишам — в подробном режиме */}
            {details && (
              <Button variant="ghost" icon={<RotateCcw />} onClick={() => engine.recalibrate()} disabled={interrupted} aria-label={t('run.controls.recalibrate')}>
                <span className="hide-sm">{t('run.controls.recalibrate')}</span>
              </Button>
            )}
            {details && sim && (
              <div>
                <Button variant="ghost" icon={<Zap />} onClick={(e) => toggleFaults(e.currentTarget)} aria-expanded={faultsOpen} aria-haspopup="menu" aria-label={t('run.controls.faults')}>
                  <span className="hide-sm">{t('run.controls.faults')}</span>
                </Button>
                {faultsAt && createPortal(
                  <div className="faults-menu" role="menu" style={{ left: faultsAt.left, bottom: faultsAt.bottom }}>
                    <div className="faults-menu__title">{t('run.faults.title')}</div>
                    <button role="menuitem" type="button" onClick={() => fault('disconnect')} disabled={interrupted}>
                      {t('run.faults.disconnect')}
                    </button>
                    <button role="menuitem" type="button" onClick={() => fault('packet_loss')}>
                      {sim.packetLossActive ? t('run.faults.packetLossOff') : t('run.faults.packet_loss')}
                    </button>
                    <button role="menuitem" type="button" onClick={() => fault('low_battery')}>
                      {t('run.faults.low_battery')}
                    </button>
                    <button role="menuitem" type="button" onClick={() => fault('fatigue')}>
                      {t('run.faults.fatigue')}
                    </button>
                    <button role="menuitem" type="button" onClick={() => fault('sensor_drop')} disabled={interrupted}>
                      {t('run.faults.sensor_drop')}
                    </button>
                  </div>,
                  document.body,
                )}
              </div>
            )}
            <span className="spacer" />
            {details && (
              <span className="muted hide-md" style={{ fontSize: 'var(--fs-xs)' }}>
                {t('run.keyboard')}
              </span>
            )}
            <Button variant="danger" icon={<Square />} onClick={() => setConfirmStop(true)} aria-label={t('run.controls.stop')}>
              <span className="hide-sm">{t('run.controls.stop')}</span>
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" icon={<X />} onClick={() => setConfirmDiscard(true)}>
              {t('run.discard')}
            </Button>
            <span className="spacer" />
          </>
        )}
      </div>

      {patientView && engine && snap && <PatientView engine={engine} snap={snap} goal={markers.goal} onClose={() => setPatientView(false)} />}

      <ConfirmDialog
        open={confirmStop}
        title={t('run.stopConfirmTitle')}
        text={t('run.stopConfirmText')}
        confirmLabel={t('run.stopConfirm')}
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false);
          engine?.stop();
        }}
      />
      <ConfirmDialog
        open={confirmDiscard}
        danger
        title={t('run.discardConfirmTitle')}
        text={t('run.discardConfirmText')}
        confirmLabel={t('run.discard')}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={async () => {
          setConfirmDiscard(false);
          const pid = patient.id;
          await clear();
          toast('info', t('run.discard'));
          navigate({ name: 'patient', id: pid, tab: 'overview' });
        }}
      />
    </div>
  );
}
