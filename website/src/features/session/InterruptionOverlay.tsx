import { Play, PlugZap, Square } from 'lucide-react';
import { BodyMap } from '../../charts/BodyMap';
import { StatusRing } from '../../figures/StatusRing';
import { useI18n } from '../../i18n';
import type { DeviceStatus, Placement } from '../../devices/types';
import type { EngineSnapshot } from '../../session/types';
import { Button } from '../../ui/Button';

/**
 * Обрыв связи во время теста: «Пытаемся переподключиться…» → «Связь восстановлена».
 * Схема датчиков показывает, что случилось: светодиоды мигают красным, пока связи нет,
 * и вспыхивают зелёным, когда датчики вернулись. Продолжение — только по кнопке:
 * прерванный повтор не засчитан, ребёнку нужно снова приготовиться.
 */
export function InterruptionOverlay({
  snap,
  device,
  required,
  onResume,
  onReconnect,
  onStop,
}: {
  snap: EngineSnapshot;
  device: DeviceStatus;
  required: Placement[];
  onResume: () => void;
  onReconnect: () => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const restored = snap.connection === 'restored';
  const failed = device.phase === 'error';
  const attempt = device.reconnect;
  return (
    <div className="interruption" role="alertdialog" aria-modal="false" aria-labelledby="int-title" aria-describedby="int-text">
      <div className={`interruption__card${restored ? ' is-restored' : failed ? ' is-failed' : ''}`}>
        <div className="interruption__map" aria-hidden>
          <BodyMap sensors={device.sensors} required={required} phase={restored ? 'streaming' : device.phase} size={150} showLabels={false} />
        </div>
        <div className="interruption__body">
          <span className="eyebrow">
            <StatusRing state={restored ? 'done' : failed ? 'error' : 'wait'} size={14} className={restored || failed ? undefined : 'guide__spin'} />
            {restored ? t('run.sensorsBack') : t('run.sensorsLost')}
          </span>
          <h2 id="int-title" className="interruption__title">
            {restored ? t('run.restoredTitle') : failed ? t('run.lostGiveUp') : t('run.lostTitle')}
          </h2>
          <p id="int-text" className="secondary">
            {restored ? t('run.restoredText') : failed ? t('run.lostGiveUpText') : t('run.lostText')}
          </p>
          {!restored && !failed && attempt && (
            <p className="interruption__attempt num">
              <span className="interruption__dots" aria-hidden>
                {Array.from({ length: attempt.max }, (_, i) => (
                  <span key={i} className={i < attempt.attempt ? 'is-on' : undefined} />
                ))}
              </span>
              {t('device.reconnectAttempt', { attempt: attempt.attempt, max: attempt.max })}
            </p>
          )}
          <div className="interruption__actions">
            <Button variant="danger" icon={<Square />} onClick={onStop}>
              {t('run.controls.stop')}
            </Button>
            {failed && (
              <Button variant="primary" icon={<PlugZap />} onClick={onReconnect}>
                {t('run.reconnectManually')}
              </Button>
            )}
            {restored && (
              <Button variant="primary" icon={<Play />} onClick={onResume} data-autofocus>
                {t('run.controls.resume')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
