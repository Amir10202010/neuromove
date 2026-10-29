import { Check, CircleAlert, Flag, Info, TriangleAlert } from 'lucide-react';
import { href } from '../../app/router';
import type { Alert, Patient } from '../../data/models';
import { useI18n } from '../../i18n';
import { useAppStore } from '../../state/appStore';
import { Button } from '../../ui/Button';
import { alertText } from './text';

const ICON = {
  info: Info,
  attention: Flag,
  warning: TriangleAlert,
};

/** Одно наблюдение: иконка и подпись уровня (не только цвет), текст, пациент, время. */
export function AlertRow({ alert, patient, showPatient = true }: { alert: Alert; patient?: Patient; showPatient?: boolean }) {
  const { t, f } = useI18n();
  const ack = useAppStore((s) => s.ackAlert);
  const Icon = alert.kind === 'goal_reached' ? Check : ICON[alert.severity] ?? CircleAlert;
  const tone = alert.kind === 'goal_reached' ? 'good' : alert.severity === 'warning' ? 'warn' : alert.severity === 'attention' ? 'attention' : 'info';
  const link = alert.sessionId ? href({ name: 'session', id: alert.sessionId, complete: false }) : href({ name: 'patient', id: alert.patientId, tab: 'overview' });
  return (
    <div className={`alert-row alert-row--${tone}${alert.acknowledged ? ' alert-row--acked' : ''}`}>
      <span className="alert-row__icon" aria-hidden>
        <Icon />
      </span>
      <div className="alert-row__body">
        <div className="alert-row__meta">
          <span className="alert-row__sev">{alert.kind === 'goal_reached' ? t('alert.severity.info') : t(`alert.severity.${alert.severity}`)}</span>
          {showPatient && patient && (
            <a className="alert-row__patient" href={href({ name: 'patient', id: patient.id, tab: 'overview' })}>
              {patient.code}
            </a>
          )}
          <span className="muted">{f.relative(alert.createdAt)}</span>
        </div>
        <a className="alert-row__text" href={link}>
          {alertText(t, alert)}
        </a>
      </div>
      {!alert.acknowledged ? (
        <Button variant="ghost" size="sm" iconOnly icon={<Check />} onClick={() => ack(alert.id)} aria-label={t('alert.ack')} title={t('alert.ack')} />
      ) : (
        <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{t('alert.acked')}</span>
      )}
    </div>
  );
}
