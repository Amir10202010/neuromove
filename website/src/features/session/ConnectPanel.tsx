// Этап 1 — датчики. Главное на экране — схема: ребёнок спереди, пять датчиков на ремешках,
// у каждого — подпись места и заряд. Датчик выходит на связь — его светодиод вспыхивает,
// пункт списка закрывается галочкой, а кнопка «Начать тест» становится доступной.
// Пока поток идёт, каждый датчик показывает свой наклон в подробностях: подвигайте —
// полоса ответит («датчик живой»).

import { CircleAlert, PlugZap, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BodyMap } from '../../charts/BodyMap';
import { MotionPipeline } from '../../core/pipeline';
import { angleBetween } from '../../core/orientation';
import type { NeuroMoveDevice, Placement } from '../../devices/types';
import { StatusRing, type RingState } from '../../figures/StatusRing';
import { useI18n } from '../../i18n';
import type { Vec3 } from '../../lib/vec3';
import type { ControllerState, SessionController } from '../../state/sessionController';
import { Button } from '../../ui/Button';
import { useAppStore } from '../../state/appStore';
import { Details } from '../common/Details';

/** Наклон каждого датчика от его первого положения — простая проверка «датчик живой». */
function useSignalCheck(device: NeuroMoveDevice, active: boolean): Partial<Record<Placement, number>> {
  const [tilts, setTilts] = useState<Partial<Record<Placement, number>>>({});
  useEffect(() => {
    if (!active) return;
    const pipe = new MotionPipeline();
    const ref: Partial<Record<Placement, Vec3>> = {};
    const rate = device.getStatus().info?.rateHz ?? 100;
    const unsub = device.onData((frames) => {
      for (const f of frames) pipe.process(f, rate);
    });
    const timer = setInterval(() => {
      const out: Partial<Record<Placement, number>> = {};
      for (const [p, r] of Object.entries(pipe.latest) as [Placement, { up: Vec3 }][]) {
        if (!ref[p]) ref[p] = r.up;
        out[p] = angleBetween(r.up, ref[p] as Vec3);
      }
      setTilts(out);
    }, 200);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [device, active]);
  return tilts;
}

export function ConnectPanel({ controller, state }: { controller: SessionController; state: ControllerState }) {
  const { t } = useI18n();
  const s = state.device;
  const phase = s.phase;
  const kind = controller.device.kind;
  const autoStarted = useRef(false);
  const required = controller.required;
  const tilts = useSignalCheck(controller.device, phase === 'streaming');
  const details = useAppStore((st) => st.settings.details);

  // Симулятор и файл записи подключаем сразу; USB и Bluetooth — только по кнопке (правило браузера)
  useEffect(() => {
    if (autoStarted.current) return;
    if ((kind === 'simulator' || kind === 'replay') && phase === 'idle') {
      autoStarted.current = true;
      void controller.connect();
    }
  }, [kind, phase, controller]);

  const needed = required.length ? required : s.sensors.map((x) => x.placement);
  const onlineNeeded = needed.filter((p) => s.sensors.find((x) => x.placement === p)?.online).length;
  const missing = required.filter((p) => !s.sensors.find((x) => x.placement === p)?.online);

  // Пункты подключения: поиск → датчики на связи → поток данных
  const order = ['searching', 'connecting', 'streaming'];
  const cur = phase === 'connected' ? 2 : phase === 'streaming' ? 3 : order.indexOf(phase === 'requesting' ? 'searching' : phase);
  const ring = (i: number): RingState => (phase === 'error' && cur <= i ? 'error' : cur > i ? 'done' : cur === i ? 'active' : 'todo');
  const steps: { label: string; progress: number }[] = [
    { label: t('run.searching'), progress: 0.5 },
    { label: `${t('run.sensorsUp')}${needed.length ? ` · ${onlineNeeded}/${needed.length}` : ''}`, progress: needed.length ? Math.max(0.12, onlineNeeded / needed.length) : 0.3 },
    { label: t('run.dataFlow'), progress: 0.5 },
  ];
  const ready = controller.ready;

  return (
    <div className="connect">
      <section data-guide="sensors" className="connect__map" aria-label={t('run.stages.connect')}>
        <BodyMap sensors={s.sensors} required={required} phase={phase} size={440} />
      </section>

      <section className="card connect__side">
        {/* Этап виден в шапке («Датчики → Калибровка → Тест → Итог»): здесь одна строка — что сделать */}
        <h2 className="stage__title">{t('run.connectTitle')}</h2>

        <ol className="checklist">
          {steps.map((st, i) => (
            <li key={i} className={`checklist__item is-${ring(i)}`}>
              <StatusRing state={ring(i)} progress={st.progress} size={18} />
              <span>{st.label}</span>
            </li>
          ))}
        </ol>

        {phase === 'error' && s.error && (
          <div className="callout callout--critical" role="alert">
            <CircleAlert aria-hidden />
            <div style={{ flex: 1 }}>
              <div className="callout__title">{t('device.phase.error')}</div>
              <div>{t(`device.errors.${s.error.code}`)}</div>
            </div>
            <Button size="sm" icon={<RefreshCw />} onClick={() => void controller.reconnect()}>
              {t('common.retry')}
            </Button>
          </div>
        )}

        {(kind === 'usb' || kind === 'ble') && (phase === 'idle' || phase === 'error') && (
          <Button variant="secondary" icon={<PlugZap />} onClick={() => void controller.connect()}>
            {t('device.connect')}
          </Button>
        )}

        {/* Статус уже в пунктах выше; отдельная строка — только когда есть что делать: какой датчик не на связи */}
        {!ready && phase === 'streaming' && missing.length > 0 && (
          <div className="connect__status" role="status">
            <StatusRing state="wait" size={16} />
            <span>{t('run.missingSensors', { list: missing.map((p) => t(`device.placement.${p}`)).join(', ') })}</span>
          </div>
        )}

        <Button variant="primary" size="lg" block disabled={!ready} onClick={() => controller.beginTest()} data-guide="begin">
          {t('run.startCalibration')}
        </Button>

        {/* Заряд, связь и проверка сигнала каждого датчика — в подробностях */}
        {s.sensors.length > 0 && (
          <Details hint={t('details.connectHint')}>
            <div className="table-wrap">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th>{t('run.sensorsUp')}</th>
                    <th className="num">{t('device.battery')}</th>
                    <th className="num">{t('device.link')}</th>
                    <th>{t('device.signalCheck')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.sensors.map((x) => {
                    const need = required.includes(x.placement);
                    const tilt = tilts[x.placement];
                    return (
                      <tr key={x.placement} style={{ opacity: need ? 1 : 0.6 }}>
                        <td>
                          <span className="row" style={{ gap: 6 }}>
                            <span className={`dot ${x.online ? 'dot--good' : ''}`} aria-hidden />
                            {t(`device.placementLong.${x.placement}`)}
                          </span>
                        </td>
                        <td className="num">
                          <span className={x.lowBattery ? 'quality-low' : ''}>{x.battery === null ? '–' : `${x.battery}%`}</span>
                        </td>
                        <td className="num">{x.online ? `${Math.round(x.link * 100)}%` : '–'}</td>
                        <td>
                          <div className="signal-bar" aria-label={tilt !== undefined ? `${Math.round(tilt)}°` : undefined}>
                            <div className="signal-bar__fill" style={{ width: `${Math.min(100, ((tilt ?? 0) / 90) * 100)}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {phase === 'streaming' && <p className="field__hint">{t('device.signalCheckText')}</p>}
            {details && <p className="field__hint">{t('device.mountHint')}</p>}
          </Details>
        )}
      </section>
    </div>
  );
}
