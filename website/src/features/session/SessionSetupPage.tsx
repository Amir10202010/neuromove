import { Bluetooth, Cable, FileUp, FlaskConical, PlugZap, Usb } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { href, navigate } from '../../website/router';
import { BodyMap } from '../../charts/BodyMap';
import { MoveIcon } from '../../charts/MoveFigures';
import { EXERCISE_IDS, type ExerciseId } from '../../core/exercises';
import { PROTOCOLS, SINGLE_SENSOR_EXERCISES, estimateSeconds, resolveSteps, singleSensorSteps, type ProtocolId, type ProtocolStep } from '../../core/protocols';
import { isWebBluetoothSupported } from '../../devices/BleDevice';
import { isSimulatedRecording, parseImuCsv } from '../../devices/contract';
import { isWebSerialSupported } from '../../devices/SerialDevice';
import { placementOf, type DeviceKind, type Side } from '../../devices/types';
import { useI18n } from '../../i18n';
import { MAX_RECORDING_MB, readTextFile } from '../../lib/files';
import { PageHeader } from '../../layout/PageHeader';
import { useAppStore, useWorkspaceData } from '../../state/appStore';
import { requiredPlacements, type DemoScenario } from '../../state/sessionController';
import { useControllerState, useSessionStore } from '../../state/sessionStore';
import { expectedRomFn } from '../../session/compare';
import { Button, LinkButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { EmptyArt } from '../../figures/EmptyArt';
import { Segmented } from '../../ui/Segmented';
import { Details } from '../common/Details';

const PROTOCOL_IDS: ProtocolId[] = ['upper_standard', 'upper_quick', 'elbow_endurance', 'custom', 'single'];
const SCENARIOS: DemoScenario[] = ['normal', 'unstable', 'low_battery', 'fatigue', 'fidget'];

function Option({ selected, onSelect, title, text, icon, disabled, badge }: { selected: boolean; onSelect: () => void; title: string; text?: string; icon?: ReactNode; disabled?: boolean; badge?: ReactNode }) {
  return (
    <button type="button" className="option" aria-pressed={selected} onClick={onSelect} disabled={disabled}>
      {icon && <span className="option__icon">{icon}</span>}
      <span className="option__body">
        <span className="option__title">
          {title}
          {badge}
        </span>
        {text && <span className="option__text">{text}</span>}
      </span>
    </button>
  );
}

export function SessionSetupPage({ patientId, protocol }: { patientId: string | null; protocol: string | null }) {
  const { t } = useI18n();
  const { ws, patients, sessions } = useWorkspaceData();
  const autoAdvanceDefault = useAppStore((s) => s.settings.autoAdvance);
  const details = useAppStore((s) => s.settings.details);
  const preferred = useAppStore((s) => s.settings.preferredDevice);
  const startSession = useSessionStore((s) => s.start);
  const running = useSessionStore((s) => s.controller);
  const runningState = useControllerState(running);

  const initialProtocol = (PROTOCOL_IDS as string[]).includes(protocol ?? '') ? (protocol as ProtocolId) : 'upper_standard';
  const [pid, setPid] = useState<string>(patientId ?? patients.find((p) => p.status === 'active')?.id ?? '');
  const [protocolId, setProtocolId] = useState<ProtocolId>(initialProtocol);
  const [reps, setReps] = useState(3);
  const [duration, setDuration] = useState(60);
  const [custom, setCustom] = useState<ExerciseId[]>(['shoulder_flexion', 'elbow_flexion']);
  const [customSides, setCustomSides] = useState<'both' | 'affected'>('both');
  // Тест одним датчиком: где он надет и какой рукой; движения — только те, что видит этот сегмент
  const [singleSegment, setSingleSegment] = useState<'upper' | 'fore'>('upper');
  const [singleSide, setSingleSide] = useState<Side>('right');
  const [singleExercises, setSingleExercises] = useState<ExerciseId[]>(SINGLE_SENSOR_EXERCISES.upper);
  const [device, setDevice] = useState<DeviceKind>(ws === 'demo' ? 'simulator' : (preferred ?? 'usb'));
  const [scenario, setScenario] = useState<DemoScenario>('normal');
  const [autoAdvance, setAutoAdvance] = useState(autoAdvanceDefault);
  const [replay, setReplay] = useState<{ name: string; text: string; frames: number; seconds: number } | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const patient = patients.find((p) => p.id === pid);
  const serial = isWebSerialSupported();
  const ble = isWebBluetoothSupported();

  const steps: ProtocolStep[] = useMemo(() => {
    if (!patient) return [];
    if (protocolId === 'single') return singleSensorSteps(singleSegment, singleSide, singleExercises, reps);
    if (protocolId === 'custom') {
      const ordered = EXERCISE_IDS.filter((e) => custom.includes(e));
      return resolveSteps({ id: 'custom', exercises: ordered, sides: customSides, reps }, patient.affectedSide);
    }
    const tpl = PROTOCOLS[protocolId];
    if (protocolId === 'elbow_endurance') return resolveSteps({ ...tpl, durationSec: duration }, patient.affectedSide);
    return resolveSteps({ ...tpl, reps }, patient.affectedSide);
  }, [patient, protocolId, custom, customSides, reps, duration, singleSegment, singleSide, singleExercises]);

  const expected = useMemo(() => (patient ? expectedRomFn(sessions, patient) : null), [sessions, patient]);
  const hasHistory = patient ? sessions.some((s) => s.patientId === patient.id) : false;
  const single = protocolId === 'single' ? { placement: placementOf(singleSegment, singleSide) } : undefined;
  const required = requiredPlacements(steps, single);
  const minutes = Math.max(1, Math.round(estimateSeconds(steps) / 60));

  const sourceLabel = device === 'simulator' ? t('device.simulator') : device === 'usb' ? t('device.usb') : device === 'ble' ? t('device.ble') : t('device.replay');
  const canStart = !!patient && steps.length > 0 && (device !== 'replay' || !!replay) && (device !== 'simulator' || ws === 'demo');

  const start = () => {
    if (!patient || !canStart) return;
    const history = sessions.filter((s) => s.patientId === patient.id);
    startSession(
      {
        workspace: ws,
        patientId: patient.id,
        protocolId,
        steps,
        deviceKind: device,
        scenario: ws === 'demo' && device === 'simulator' ? scenario : 'normal',
        autoAdvance,
        ...(device === 'replay' && replay ? { replay: { name: replay.name, text: replay.text } } : {}),
        ...(single ? { single } : {}),
      },
      patient,
      history,
    );
    navigate({ name: 'sessionRun' });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const refuse = (message: string) => {
      setReplay(null);
      setReplayError(message);
    };
    const text = await readTextFile(file, MAX_RECORDING_MB);
    if (text === null) return refuse(t('device.fileTooLarge', { mb: MAX_RECORDING_MB }));
    const parsed = parseImuCsv(text);
    if (!parsed.frames.length) return refuse(t('device.replayError'));
    // Выгрузка из демо — смоделированные данные: в историю настоящего ребёнка их не пускаем
    if (ws === 'clinic' && isSimulatedRecording(parsed.passport)) return refuse(t('device.replayDemoRefused'));
    setReplayError(null);
    const first = parsed.frames[0]?.t ?? 0;
    const last = parsed.frames[parsed.frames.length - 1]?.t ?? 0;
    setReplay({ name: file.name, text, frames: parsed.frames.length, seconds: Math.round(last - first) });
  };

  if (!patients.length) {
    return (
      <div className="page page--narrow">
        <PageHeader title={t('setup.title')} />
        <div className="card">
          <EmptyState
            art={<EmptyArt kind="patients" size={96} />}
            title={t('setup.noPatients')}
            text={t('patients.emptyText')}
            action={
              <LinkButton variant="primary" href={href({ name: 'patients' })}>
                {t('patients.add')}
              </LinkButton>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title={t('setup.title')} />

      {running && runningState?.stage === 'test' && (
        <div className="callout callout--warn">
          <PlugZap aria-hidden />
          <span style={{ flex: 1 }}>{t('devicesPage.busy')}</span>
          <LinkButton size="sm" href={href({ name: 'sessionRun' })}>
            {t('run.stages.test')}
          </LinkButton>
        </div>
      )}

      <div className="grid grid--main-side">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">1 · {t('setup.patient')}</h2>
            </div>
            <div className="card__body stack" style={{ gap: 12 }}>
              <label className="sr-only" htmlFor="setup-patient">
                {t('setup.choosePatient')}
              </label>
              <select id="setup-patient" className="select" value={pid} onChange={(e) => setPid(e.target.value)}>
                {!patient && <option value="">{t('setup.choosePatient')}</option>}
                {/* Только имя: возраст и диагноз — в карточке, здесь нужно лишь выбрать, кого тестируем */}
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="card">
            <div className="card__header">
              <h2 className="card__title">2 · {t('setup.protocol')}</h2>
            </div>
            <div className="card__body stack" style={{ gap: 12 }}>
              <div className="options options--2">
                {PROTOCOL_IDS.map((id) => (
                  // Что входит в протокол, видно в плане справа; описание — в подробностях
                  <Option
                    key={id}
                    selected={protocolId === id}
                    onSelect={() => {
                      setProtocolId(id);
                      // Один датчик — по умолчанию на поражённой руке: её и тестируют, если датчик один
                      if (id === 'single' && patient?.affectedSide === 'left') setSingleSide('left');
                    }}
                    title={t(`protocol.${id}`)}
                    text={details || id === 'single' ? t(`protocol.${id}Text`) : undefined}
                  />
                ))}
              </div>
              {protocolId === 'custom' && (
                <div className="stack" style={{ gap: 10 }}>
                  <span className="field__label">{t('setup.exercises')}</span>
                  <div className="checks">
                    {EXERCISE_IDS.map((ex) => (
                      <label key={ex} className="checkbox">
                        <input type="checkbox" checked={custom.includes(ex)} onChange={(e) => setCustom(e.target.checked ? [...custom, ex] : custom.filter((x) => x !== ex))} />
                        <span>{t(`exercise.${ex}.name`)}</span>
                      </label>
                    ))}
                  </div>
                  <div className="field">
                    <span className="field__label">{t('setup.sides')}</span>
                    <Segmented<'both' | 'affected'>
                      label={t('setup.sides')}
                      value={customSides}
                      onChange={setCustomSides}
                      options={[
                        { value: 'both', label: t('setup.sidesBoth') },
                        { value: 'affected', label: t('setup.sidesAffected') },
                      ]}
                    />
                  </div>
                  {custom.length === 0 && <div className="field__error">{t('setup.customEmpty')}</div>}
                </div>
              )}
              {protocolId === 'single' && (
                <div className="stack" style={{ gap: 10 }}>
                  <div className="row row--wrap" style={{ gap: 20 }}>
                    <div className="field">
                      <span className="field__label">{t('setup.singleWhere')}</span>
                      <Segmented<'upper' | 'fore'>
                        label={t('setup.singleWhere')}
                        value={singleSegment}
                        onChange={(seg) => {
                          setSingleSegment(seg);
                          setSingleExercises(SINGLE_SENSOR_EXERCISES[seg]);
                        }}
                        options={[
                          { value: 'upper', label: t('setup.singleUpper') },
                          { value: 'fore', label: t('setup.singleFore') },
                        ]}
                      />
                    </div>
                    <div className="field">
                      <span className="field__label">{t('setup.singleSide')}</span>
                      <Segmented<Side>
                        label={t('setup.singleSide')}
                        value={singleSide}
                        onChange={setSingleSide}
                        options={[
                          { value: 'left', label: t('side.leftArm') },
                          { value: 'right', label: t('side.rightArm') },
                        ]}
                      />
                    </div>
                  </div>
                  <span className="field__label">{t('setup.exercises')}</span>
                  <div className="checks">
                    {SINGLE_SENSOR_EXERCISES[singleSegment].map((ex) => (
                      <label key={ex} className="checkbox">
                        <input
                          type="checkbox"
                          checked={singleExercises.includes(ex)}
                          onChange={(e) => setSingleExercises(e.target.checked ? [...singleExercises, ex] : singleExercises.filter((x) => x !== ex))}
                        />
                        <span>{t(`exercise.${ex}.name`)}</span>
                      </label>
                    ))}
                  </div>
                  <span className="field__hint">{t(singleSegment === 'upper' ? 'setup.singleNoteUpper' : 'setup.singleNoteFore')}</span>
                  <span className="field__hint">{t('setup.singleWiring', { place: t(`device.placementLong.${placementOf(singleSegment, singleSide)}`) })}</span>
                  {singleExercises.length === 0 && <div className="field__error">{t('setup.customEmpty')}</div>}
                </div>
              )}
              {(details || protocolId === 'elbow_endurance') && (
              <div className="row row--wrap" style={{ gap: 20 }}>
                {protocolId === 'elbow_endurance' ? (
                  <div className="field">
                    <span className="field__label">{t('setup.duration')}</span>
                    <Segmented<number>
                      label={t('setup.duration')}
                      value={duration}
                      onChange={setDuration}
                      options={[30, 60, 90].map((s) => ({ value: s, label: `${s} ${t('common.sec')}` }))}
                    />
                  </div>
                ) : (
                  <div className="field">
                    <span className="field__label">{t('setup.reps')}</span>
                    <Segmented<number> label={t('setup.reps')} value={reps} onChange={setReps} options={[3, 5].map((r) => ({ value: r, label: String(r) }))} />
                  </div>
                )}
                {details && (
                  <label className="switch" style={{ alignSelf: 'flex-end', marginBottom: 6 }}>
                    <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
                    <span style={{ fontSize: 'var(--fs-sm)' }}>{t('setup.autoAdvance')}</span>
                  </label>
                )}
              </div>
              )}
            </div>
          </section>

          {/* Источник данных и сценарии симуляции — в подробном режиме. По умолчанию: в демо —
              симулятор, в клинике — способ подключения из знакомства */}
          <Details hint={t('details.setupHint', { source: sourceLabel })}>
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">3 · {t('setup.device')}</h2>
            </div>
            <div className="card__body stack" style={{ gap: 12 }}>
              <div className="options options--2">
                <Option
                  selected={device === 'simulator'}
                  onSelect={() => setDevice('simulator')}
                  icon={<FlaskConical />}
                  title={t('device.simulator')}
                  text={ws === 'demo' ? t('device.kinds.simulatorText') : t('device.kinds.notInDemo')}
                  disabled={ws !== 'demo'}
                  badge={ws === 'demo' ? undefined : <span className="badge badge--demo" style={{ marginLeft: 8 }}>{t('device.kinds.demoOnly')}</span>}
                />
                <Option
                  selected={device === 'usb'}
                  onSelect={() => setDevice('usb')}
                  icon={<Usb />}
                  title={t('device.usb')}
                  text={t('device.kinds.usbText')}
                  disabled={!serial}
                  badge={<span className="badge" style={{ marginLeft: 8 }}>{serial ? t('device.kinds.needsHardware') : t('device.kinds.notSupported')}</span>}
                />
                <Option
                  selected={device === 'ble'}
                  onSelect={() => setDevice('ble')}
                  icon={<Bluetooth />}
                  title={t('device.ble')}
                  text={t('device.kinds.bleText')}
                  disabled={!ble}
                  badge={<span className="badge" style={{ marginLeft: 8 }}>{ble ? t('device.kinds.needsHardware') : t('device.kinds.notSupported')}</span>}
                />
                <Option selected={device === 'replay'} onSelect={() => setDevice('replay')} icon={<FileUp />} title={t('device.replay')} text={t('device.kinds.replayText')} />
              </div>
              {device === 'replay' && (
                <div className="row row--wrap">
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    hidden
                    onChange={(e) => {
                      void onFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  <Button icon={<FileUp />} onClick={() => fileInput.current?.click()}>
                    {t('device.replayPick')}
                  </Button>
                  {replay && <span className="secondary">{t('device.replayLoaded', { name: replay.name, frames: replay.frames, seconds: replay.seconds })}</span>}
                  {replayError && (
                    <span className="field__error" role="alert">
                      {replayError}
                    </span>
                  )}
                  {replay && ws === 'clinic' && <span className="field__hint">{t('device.replayClinicNote')}</span>}
                </div>
              )}
              {(device === 'usb' || device === 'ble') && ws === 'demo' && (
                <div className="callout callout--info">
                  <Cable aria-hidden />
                  <span>{t('setup.hardwareMissing')}</span>
                </div>
              )}
              {ws === 'demo' && device === 'simulator' && (
                <div className="stack" style={{ gap: 8 }}>
                  <span className="field__label">{t('setup.scenario')}</span>
                  <span className="field__hint" style={{ marginTop: -4 }}>
                    {t('setup.scenarioHint')}
                  </span>
                  <div className="options options--scenarios">
                    {SCENARIOS.map((sc) => (
                      <Option key={sc} selected={scenario === sc} onSelect={() => setScenario(sc)} title={t(`setup.scenarios.${sc}`)} text={t(`setup.scenarios.${sc}Text`)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
          </Details>
        </div>

        <aside data-guide="plan" className="card setup-summary">
          <div className="card__header">
            <h2 className="card__title">{t('setup.plan')}</h2>
            {details && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('setup.estimate', { minutes })}</span>}
          </div>
          <div className="card__body stack" style={{ gap: 16 }}>
            <ol className="plan">
              {steps.map((st, i) => {
                const exp = expected?.(st.exercise, st.side);
                return (
                  <li key={i} className="plan__item">
                    {/* Что будет делать ребёнок — рисунком, цвет — рука (левая синяя, правая оранжевая) */}
                    <span className="plan__icon">
                      <MoveIcon exercise={st.exercise} side={st.side} ariaLabel="" />
                    </span>
                    <span className="plan__text">
                      <span className="plan__ex">{t(`exercise.${st.exercise}.name`)}</span>
                      <span className="plan__side">{st.side === 'left' ? t('side.leftArm') : t('side.rightArm')}</span>
                    </span>
                    <span className="plan__reps num">{st.durationSec ? t('setup.stepSeconds', { seconds: st.durationSec }) : t('setup.stepReps', { reps: st.reps })}</span>
                    {details && hasHistory && exp !== undefined && <span className="plan__prev">{t('setup.previousRom', { value: Math.round(exp) })}</span>}
                  </li>
                );
              })}
            </ol>
            {/* Какие датчики нужны, покажет следующий экран на схеме тела; здесь — только в подробностях */}
            {details && (
            <div className="setup-summary__map">
              <BodyMap sensors={required.map((p) => ({ placement: p, online: true, battery: null, lowBattery: false, link: 1 }))} required={required} size={110} showLabels={false} />
              <div className="stack" style={{ gap: 4 }}>
                <span className="field__label">{t('setup.sensorsNeeded')}</span>
                <ul className="sensor-list">
                  {required.map((p) => (
                    <li key={p}>{t(`device.placementLong.${p}`)}</li>
                  ))}
                </ul>
                <span className="field__hint">{t('device.mountHint')}</span>
              </div>
            </div>
            )}
            <Button variant="primary" size="lg" block icon={<PlugZap />} disabled={!canStart} onClick={start} data-guide="wear">
              {t('setup.connect')}
            </Button>
            {device === 'replay' && !replay && <span className="field__hint">{t('setup.replayRequired')}</span>}
          </div>
        </aside>
      </div>
    </div>
  );
}
