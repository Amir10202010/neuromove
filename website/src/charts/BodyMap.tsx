// Где стоят датчики и что с ними: ребёнок спереди, пять датчиков на ремешках, у каждого —
// выноска с названием места. Правая сторона пациента — слева от зрителя, как на врачебных схемах.
//
// Состояние датчика видно без подписи: на связи — светлый корпус на тёмном ремешке и зелёный
// светодиод; ищем — пунктир и импульс; мало заряда — жёлтый светодиод; связь пропала во время
// теста — красный. Когда датчик выходит на связь, светодиод вспыхивает один раз (figures.css):
// «подключили → загорелся» — причина и следствие на глазах.

import type { ConnectionPhase, Placement, SensorState } from '../devices/types';
import { frontParts, type FrontPodKey } from '../figures/body';
import { Callout, type PodState } from '../figures/Ink';
import { FrontFigure } from '../figures/scenes';
import { useI18n } from '../i18n';

const ALL: Placement[] = ['trunk', 'upper_r', 'upper_l', 'fore_r', 'fore_l'];

/** Состояние датчика на рисунке по состоянию устройства. */
export function podState(s: SensorState | undefined, need: boolean, phase: ConnectionPhase | undefined): PodState {
  if (s?.online) return s.lowBattery ? 'low' : 'on';
  if (phase === 'reconnecting') return need ? 'lost' : 'idle';
  if (phase === 'searching' || phase === 'connecting' || phase === 'requesting') return need ? 'wait' : 'idle';
  return need ? 'off' : 'idle';
}

// Куда уходят выноски: правая сторона пациента — влево, левая — вправо; от груди — вверх
// через плечо и вправо, чтобы не пересечь датчик левого плеча на той же высоте
const CALL: Record<Placement, { x: number; y?: number; dy?: number; via?: { x: number; y: number }; anchor: 'start' | 'end' }> = {
  upper_r: { x: 66, dy: 0, anchor: 'end' },
  fore_r: { x: 66, dy: 8, anchor: 'end' },
  trunk: { x: 198, y: 76, via: { x: 168, y: 76 }, anchor: 'start' },
  upper_l: { x: 198, dy: 0, anchor: 'start' },
  fore_l: { x: 198, dy: 8, anchor: 'start' },
};

export function BodyMap({
  sensors,
  required,
  size = 200,
  showLabels = true,
  phase,
}: {
  sensors: SensorState[];
  required: Placement[];
  size?: number;
  showLabels?: boolean;
  /** Фаза подключения: ищем — пунктир с импульсом, переподключаемся — красный светодиод. */
  phase?: ConnectionPhase;
}) {
  const { t } = useI18n();
  const state = (p: Placement) => sensors.find((s) => s.placement === p);
  // Не задан список нужных — нужны все (схема комплекта на «Датчиках» и в карточке устройства)
  const need = (p: Placement) => required.length === 0 || required.includes(p);
  const parts = frontParts({ x: 132, y: 172 }, { right: { upper: 16, fore: 20 }, left: { upper: 16, fore: 20 } }, { legs: true });
  const vb = showLabels ? [-12, 30, 288, 226] : [64, 30, 136, 226];
  const label = ALL.map((p) => `${t(`device.placement.${p}`)}: ${state(p)?.online ? t('device.connected') : t('device.notConnected')}`).join(', ');
  return (
    <svg viewBox={vb.join(' ')} width={size} height={Math.round((size * vb[3]!) / vb[2]!)} role="img" aria-label={label} className="bodymap">
      <FrontFigure
        p={parts}
        pods={Object.fromEntries(ALL.map((p) => [p, podState(state(p), need(p), phase)]))}
        ledR={1.5}
        pulseR={13}
        podTitle={(p) => {
          const s = state(p);
          return `${t(`device.placementLong.${p}`)}: ${s?.online ? `${t('device.connected')}${s.battery !== null ? `, ${s.battery}%` : ''}` : t('device.notConnected')}`;
        }}
      />
      {showLabels &&
        ALL.map((p) => {
          const q = parts.pods[p as FrontPodKey];
          const c = CALL[p];
          const s = state(p);
          const sub = s?.online && s.battery !== null ? `${s.battery}%` : undefined;
          return (
            <Callout
              key={p}
              // Выноска начинается у края корпуса, а не в центре: светодиод состояния остаётся виден
              from={p === 'trunk' ? { x: q.c.x + 4.6, y: q.c.y - 5.6 } : { x: q.c.x + (c.anchor === 'start' ? 4.4 : -4.4), y: q.c.y }}
              dot={1.1}
              via={c.via}
              to={{ x: c.x, y: c.y ?? q.c.y + (c.dy ?? 0) }}
              text={t(`device.placement.${p}`)}
              anchor={c.anchor}
              sub={sub}
              className={need(p) ? undefined : 'is-idle'}
            />
          );
        })}
    </svg>
  );
}
