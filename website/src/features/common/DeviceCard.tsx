import { Cpu } from 'lucide-react';
import { href } from '../../website/router';
import { useI18n } from '../../i18n';
import { useDeviceMonitor } from '../../state/deviceMonitor';
import { useControllerState, useSessionStore } from '../../state/sessionStore';
import { BodyMap } from '../../charts/BodyMap';
import { LinkButton } from '../../ui/Button';

/** Состояние устройства текущего сеанса — на обзоре. */
export function DeviceCard() {
  const { t } = useI18n();
  const controller = useSessionStore((s) => s.controller);
  const st = useControllerState(controller);
  const monitor = useDeviceMonitor((s) => s.status);
  const status = st?.device ?? monitor ?? undefined;
  const phase = status?.phase ?? 'idle';
  const minBattery = status?.sensors.reduce<number | null>((m, s) => (s.battery === null ? m : m === null ? s.battery : Math.min(m, s.battery)), null) ?? null;
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">{t('overview.device')}</h2>
        <span className={`badge ${phase === 'streaming' ? 'badge--good' : phase === 'error' ? 'badge--critical' : phase === 'reconnecting' ? 'badge--warn' : ''}`}>
          <span className={`dot ${phase === 'streaming' ? 'dot--good' : ''}`} aria-hidden />
          {t(`device.phase.${phase}`)}
        </span>
      </div>
      <div className="card__body device-card">
        <BodyMap sensors={status?.sensors ?? []} required={[]} size={110} showLabels={false} />
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <strong>{status?.info?.name ?? t('device.kit')}</strong>
          <span className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>
            {status && status.sensors.length
              ? t('device.sensorsOnline', { online: status.sensors.filter((s) => s.online).length, total: status.sensors.length })
              : t('devicesPage.noDeviceText')}
          </span>
          {minBattery !== null && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('device.batteryMin', { value: minBattery })}</span>}
          <div>
            <LinkButton size="sm" href={controller ? href({ name: 'sessionRun' }) : href({ name: 'devices' })} icon={<Cpu />}>
              {controller ? t('run.stages.test') : t('devicesPage.startCheck')}
            </LinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}
