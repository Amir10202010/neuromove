// Этап 2 — калибровка: «Сидим прямо, руки вдоль тела, не двигаемся 3 секунды».
// Ребёнок — внутри шкалы из 60 рисок: риски заполняются за три секунды, крупная цифра
// считает назад. Пошевелился — риски желтеют, фигура вздрагивает, отсчёт начинается заново,
// и это сказано словами: причина и следствие видны без объяснений.

import { TriangleAlert } from 'lucide-react';
import { podState } from '../../charts/BodyMap';
import { CalibrationFigure } from '../../figures/CalibrationFigure';
import type { FrontPodKey } from '../../figures/body';
import type { PodState } from '../../figures/Ink';
import type { DeviceStatus } from '../../devices/types';
import { useI18n } from '../../i18n';
import { useAppStore } from '../../state/appStore';
import type { SessionEngine } from '../../session/SessionEngine';
import type { EngineSnapshot } from '../../session/types';

export function CalibrationPanel({ snap, device }: { engine: SessionEngine; snap: EngineSnapshot; device: DeviceStatus }) {
  const { t } = useI18n();
  const details = useAppStore((s) => s.settings.details);
  const p = snap.calibration.progress;
  const sec = Math.max(0, Math.ceil(3 - p * 3));
  const pods: Partial<Record<FrontPodKey, PodState>> = {};
  for (const s of device.sensors) pods[s.placement] = podState(s, true, device.phase);
  return (
    <section data-guide="calibration" className={`card calib-stage${snap.calibration.moved ? ' is-moved' : ''}`}>
      <div
        className="calib-stage__pic"
        role="progressbar"
        aria-valuenow={Math.round(p * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('run.calibrateTitle')}
      >
        <CalibrationFigure progress={p} moved={snap.calibration.moved} attempt={snap.calibration.attempt} pods={pods} size={300} />
      </div>
      <div className="calib-stage__text">
        <span className="eyebrow">
          {t('run.stageOf', { current: 2, total: 4 })} · {t('run.stages.calibrate')}
        </span>
        <h2 className="stage__title">{t('run.calibrateTitle')}</h2>
        <p className="stage__lead">{t('run.calibrateText')}</p>
        <div className="calib-stage__count" aria-live="polite">
          <span className="calib-stage__sec num">{p >= 1 ? '✓' : sec}</span>
          <span className="calib-stage__unit">{p >= 1 ? t('run.calibrateDone') : t('run.calibrateSec')}</span>
        </div>
        {/* Зачем калибровка (ноль углов, смещение гироскопа) — в подробном режиме */}
        {details && <p className="secondary">{t('run.calibrateWhy')}</p>}
        {snap.calibration.moved && (
          <div className="callout callout--warn" role="status">
            <TriangleAlert aria-hidden />
            <span>{t('run.calibrationMoved', { attempt: snap.calibration.attempt })}</span>
          </div>
        )}
      </div>
    </section>
  );
}
