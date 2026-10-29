// Устройства: источники данных, проверка сигнала, контракт с железом.
// Все источники подключаются через один интерфейс NeuroMoveDevice.

import { Bluetooth, CircleAlert, FileUp, FlaskConical, PlugZap, Square, Usb } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { href } from '../../app/router';
import { BodyMap } from '../../charts/BodyMap';
import { MotionPipeline } from '../../core/pipeline';
import { angleBetween } from '../../core/orientation';
import { BleDevice, isWebBluetoothSupported } from '../../devices/BleDevice';
import { ReplayDevice } from '../../devices/ReplayDevice';
import { SerialDevice, isWebSerialSupported } from '../../devices/SerialDevice';
import { SimulatorDevice } from '../../devices/SimulatorDevice';
import { emptyStatus, type DeviceKind, type DeviceStatus, type NeuroMoveDevice, type Placement } from '../../devices/types';
import { useI18n } from '../../i18n';
import { AccuracyCheck } from './AccuracyCheck';
import { MAX_RECORDING_MB, readTextFile } from '../../lib/files';
import type { Vec3 } from '../../lib/vec3';
import { PageHeader } from '../../layout/PageHeader';
import { useAppStore } from '../../state/appStore';
import { useDeviceMonitor } from '../../state/deviceMonitor';
import { useControllerState, useSessionStore } from '../../state/sessionStore';
import { buildProfile } from '../../simulation/profiles';
import { Button, LinkButton } from '../../ui/Button';

const EMPTY_STATUS: DeviceStatus = emptyStatus();

interface Live {
  tilt: Partial<Record<Placement, number>>;
  gyro: Partial<Record<Placement, number>>;
  rate: number;
}

/** publish — показывать ли это устройство в боковой панели (не для устройства сеанса). */
function useDevice(device: NeuroMoveDevice | null, publish: boolean) {
  const subscribe = useCallback((cb: () => void) => (device ? device.onStatus(() => cb()) : () => undefined), [device]);
  const status = useSyncExternalStore(subscribe, () => device?.getStatus() ?? EMPTY_STATUS);
  const [live, setLive] = useState<Live>({ tilt: {}, gyro: {}, rate: 0 });
  useEffect(() => {
    if (!device) return;
    const unsubStatus = device.onStatus((s) => {
      if (publish) useDeviceMonitor.getState().publish(s.phase === 'idle' ? null : s);
      if (s.phase === 'connected') void device.start();
    });
    const pipe = new MotionPipeline();
    const ref: Partial<Record<Placement, Vec3>> = {};
    let count = 0;
    let lastT = performance.now();
    const unsubData = device.onData((frames) => {
      count += frames.length;
      const rate = device.getStatus().info?.rateHz ?? 100;
      for (const fr of frames) pipe.process(fr, rate);
    });
    const timer = setInterval(() => {
      const now = performance.now();
      const tilt: Live['tilt'] = {};
      const gyro: Live['gyro'] = {};
      for (const [p, r] of Object.entries(pipe.latest) as [Placement, { up: Vec3; gyro: Vec3 }][]) {
        if (!ref[p]) ref[p] = r.up;
        tilt[p] = angleBetween(r.up, ref[p] as Vec3);
        gyro[p] = Math.hypot(...r.gyro);
      }
      setLive({ tilt, gyro, rate: (count * 1000) / (now - lastT) });
      count = 0;
      lastT = now;
    }, 250);
    return () => {
      unsubStatus();
      unsubData();
      clearInterval(timer);
      if (publish) useDeviceMonitor.getState().publish(null);
    };
  }, [device, publish]);
  return { status, live };
}

export function DevicesPage() {
  const { t } = useI18n();
  const ws = useAppStore((s) => s.settings.workspace);
  const controller = useSessionStore((s) => s.controller);
  const busyState = useControllerState(controller);
  const busy = !!controller && busyState?.stage === 'test';
  const [device, setDevice] = useState<NeuroMoveDevice | null>(null);
  const [kind, setKind] = useState<DeviceKind>(ws === 'demo' ? 'simulator' : 'usb');
  const [replayError, setReplayError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const shown = busy && controller ? controller.device : device;
  const { status, live } = useDevice(shown, !busy);

  // Уходим со страницы — отключаем проверочное устройство
  useEffect(() => {
    return () => {
      void device?.disconnect();
    };
  }, [device]);

  const connect = async (k: DeviceKind, csv?: { name: string; text: string }) => {
    await device?.disconnect();
    const d = createCheckDevice(k, csv);
    setDevice(d);
    await d.connect();
  };

  const serial = isWebSerialSupported();
  const ble = isWebBluetoothSupported();
  const sources: { k: DeviceKind; icon: ReactNode; title: string; text: string; disabled: boolean; badge: string }[] = [
    { k: 'simulator', icon: <FlaskConical />, title: t('device.simulator'), text: ws === 'demo' ? t('device.kinds.simulatorText') : t('device.kinds.notInDemo'), disabled: ws !== 'demo', badge: ws === 'demo' ? '' : t('device.kinds.demoOnly') },
    { k: 'usb', icon: <Usb />, title: t('device.usb'), text: t('device.kinds.usbText'), disabled: !serial, badge: serial ? t('device.supported') : t('device.kinds.notSupported') },
    { k: 'ble', icon: <Bluetooth />, title: t('device.ble'), text: t('device.kinds.bleText'), disabled: !ble, badge: ble ? t('device.supported') : t('device.kinds.notSupported') },
    { k: 'replay', icon: <FileUp />, title: t('device.replay'), text: t('device.kinds.replayText'), disabled: false, badge: 'imu-csv v1' },
  ];

  const phase = status.phase;
  const active = phase !== 'idle';

  return (
    <div className="page">
      <PageHeader title={t('devicesPage.title')} lead={t('devicesPage.lead')} />

      {busy && (
        <div className="callout callout--info">
          <PlugZap aria-hidden />
          <span style={{ flex: 1 }}>{t('devicesPage.busy')}</span>
          <LinkButton size="sm" href={href({ name: 'sessionRun' })}>
            {t('run.stages.test')}
          </LinkButton>
        </div>
      )}

      <div className="grid grid--main-side">
        <section className="card">
          <div className="card__header">
            <div>
              <h2 className="card__title">{t('devicesPage.current')}</h2>
              <div className="card__subtitle">{status.info?.name ?? t('devicesPage.noDevice')}</div>
            </div>
            <span className={`badge ${phase === 'streaming' ? 'badge--good' : phase === 'error' ? 'badge--critical' : phase === 'reconnecting' ? 'badge--warn' : ''}`}>
              {t(`device.phase.${phase}`)}
            </span>
          </div>
          <div className="card__body stack">
            {!active ? (
              <p className="secondary">{t('devicesPage.noDeviceText')}</p>
            ) : (
              <>
                {status.info && (
                  <dl className="kv kv--wide">
                    <dt>{t('device.format')}</dt>
                    <dd className="mono">{status.info.format}</dd>
                    <dt>{t('device.firmware')}</dt>
                    <dd className="mono">{status.info.firmware}</dd>
                    <dt>{t('device.rate')}</dt>
                    <dd>
                      {status.info.rateHz} Hz · {Math.round(live.rate)}/s
                    </dd>
                    <dt>{t('device.ranges')}</dt>
                    <dd>
                      ±{status.info.accRangeG} g · ±{status.info.gyroRangeDps} °/s
                    </dd>
                  </dl>
                )}
                {status.error && (
                  <div className="callout callout--critical" role="alert">
                    <CircleAlert aria-hidden />
                    <span>{t(`device.errors.${status.error.code}`)}</span>
                  </div>
                )}
                {status.sensors.length > 0 && (
                  <div className="table-wrap">
                    <table className="table table--compact">
                      <thead>
                        <tr>
                          <th>{t('devicesPage.sensors')}</th>
                          <th className="num">{t('device.battery')}</th>
                          <th className="num">{t('device.link')}</th>
                          <th>{t('device.signalCheck')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {status.sensors.map((s) => (
                          <tr key={s.placement}>
                            <td>
                              <span className="row" style={{ gap: 6 }}>
                                <span className={`dot ${s.online ? 'dot--good' : ''}`} aria-hidden />
                                {t(`device.placementLong.${s.placement}`)}
                              </span>
                            </td>
                            <td className="num">
                              <span className={s.lowBattery ? 'quality-low' : ''}>{s.battery === null ? '–' : `${s.battery}%`}</span>
                            </td>
                            <td className="num">{s.online ? `${Math.round(s.link * 100)}%` : '–'}</td>
                            <td>
                              <div className="row" style={{ gap: 8 }}>
                                <div className="signal-bar">
                                  <div className="signal-bar__fill" style={{ width: `${Math.min(100, ((live.tilt[s.placement] ?? 0) / 150) * 100)}%` }} />
                                </div>
                                <span className="num muted" style={{ fontSize: 'var(--fs-xs)', minWidth: 36 }}>
                                  {live.tilt[s.placement] !== undefined ? `${Math.round(live.tilt[s.placement] as number)}°` : '–'}
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="field__hint">{t('device.signalCheckText')}</p>
              </>
            )}
            {!busy && active && (
              <div>
                <Button icon={<Square />} onClick={() => void device?.disconnect().then(() => setDevice(null))}>
                  {t('device.disconnect')}
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* Схема комплекта — крупно, с подписью каждого места и зарядом: видно, какой датчик
            на связи, какой нет, и куда его надевать */}
        <aside className="card devices__map">
          <div className="card__body stack" style={{ alignItems: 'center', gap: 10 }}>
            <BodyMap sensors={status.sensors} required={[]} phase={status.phase} size={340} />
            <p className="field__hint" style={{ textAlign: 'center', maxWidth: 360 }}>
              {t('device.mountHint')}
            </p>
          </div>
        </aside>
      </div>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="section-title">{t('devicesPage.sources')}</h2>
        <div className="grid grid--2">
          {sources.map((s) => (
            <div key={s.k} className={`card source${kind === s.k ? ' is-selected' : ''}`}>
              <div className="card__body source__body">
                <span className="option__icon">{s.icon}</span>
                <div className="stack" style={{ gap: 6, flex: 1 }}>
                  <div className="row row--wrap" style={{ gap: 8 }}>
                    <strong>{s.title}</strong>
                    {s.badge && <span className={`badge ${s.k === 'simulator' ? 'badge--demo' : s.disabled ? '' : 'badge--good'}`}>{s.badge}</span>}
                  </div>
                  <p className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>
                    {s.text}
                  </p>
                  <div>
                    {s.k === 'replay' ? (
                      <>
                        <input
                          ref={fileInput}
                          type="file"
                          accept=".csv,text/csv,text/plain"
                          hidden
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const text = await readTextFile(file, MAX_RECORDING_MB);
                            e.target.value = '';
                            const test = text === null ? null : new ReplayDevice(text, file.name);
                            if (!text || !test?.frameCount) {
                              setReplayError(true);
                              return;
                            }
                            setReplayError(false);
                            setKind('replay');
                            await connect('replay', { name: file.name, text });
                          }}
                        />
                        <Button size="sm" icon={<FileUp />} disabled={busy} onClick={() => fileInput.current?.click()}>
                          {t('device.replayPick')}
                        </Button>
                        {replayError && <span className="field__error" style={{ marginLeft: 8 }}>{t('device.replayError')}</span>}
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant={kind === s.k && active ? 'secondary' : 'primary'}
                        icon={<PlugZap />}
                        disabled={s.disabled || busy}
                        onClick={() => {
                          setKind(s.k);
                          void connect(s.k);
                        }}
                      >
                        {t('device.connect')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <AccuracyCheck device={busy ? null : device} streaming={!busy && status.phase === 'streaming'} />

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{t('device.contract')}</h2>
        </div>
        <div className="card__body stack">
          <p className="secondary">{t('device.contractText')}</p>
          <pre className="code-block">
            {`# imu-csv v1
# device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=trunk,upper_r,fore_r
seq,trunk_ax,trunk_ay,trunk_az,trunk_gx,trunk_gy,trunk_gz,upper_r_ax,…,fore_r_gz
0,152,-40,8174,12,-35,7,98,15,8201,-4,20,11,…`}
          </pre>
        </div>
      </section>
    </div>
  );
}

/** Устройство для проверки сигнала. Доброволец симулятора поднимает руку — чтобы было что увидеть. */
function createCheckDevice(k: DeviceKind, csv?: { name: string; text: string }): NeuroMoveDevice {
  if (k === 'simulator') {
    const sim = new SimulatorDevice({ seed: Date.now() >>> 0, profile: buildProfile({ left: 0.05, right: 0.05 }) });
    sim.instruct({ kind: 'exercise', exercise: 'shoulder_flexion', side: 'right' });
    return sim;
  }
  if (k === 'usb') return new SerialDevice();
  if (k === 'ble') return new BleDevice();
  return new ReplayDevice(csv?.text ?? '', csv?.name ?? 'recording.csv');
}
