// Лаборатория рисунков — только для разработки (#/lab). Все фигуры во всех состояниях
// рядом и в разных размерах: так видно, что они — одна система, и где геометрия ломается.

import { useEffect, useState, type ReactNode } from 'react';
import './lab.css';
import { BodyMap } from '../../charts/BodyMap';
import { ArmsCompare, MoveIcon, RaiseProgress, TrunkLean } from '../../charts/MoveFigures';
import { StickFigure } from '../../charts/StickFigure';
import type { ExerciseId } from '../../core/exercises';
import type { ConnectionPhase, Placement, SensorState } from '../../devices/types';
import type { LiveValues } from '../../session/types';
import { CalibrationFigure } from '../../figures/CalibrationFigure';
import { StatusRing, type RingState } from '../../figures/StatusRing';

const EX: ExerciseId[] = ['shoulder_flexion', 'shoulder_abduction', 'elbow_flexion', 'forearm_rotation'];

function Plate({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`lab-plate${wide ? ' lab-plate--wide' : ''}`}>
      <h2 className="lab-plate__title">{title}</h2>
      <div className="lab-plate__body">{children}</div>
    </section>
  );
}

function Cell({ label, children, h }: { label: string; children: ReactNode; h?: number }) {
  return (
    <figure className="lab-cell">
      <div className="lab-cell__pic" style={h ? { height: h } : undefined}>
        {children}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Синтетическое движение для живых фигурок: подъём и опускание, наклон корпуса на пике. */
function useFakeLive(exercise: ExerciseId, period = 3.2): LiveValues {
  // Один изменяемый объект на всё время жизни ячейки — как engine.live у движка
  const [live] = useState<LiveValues>(() => ({ t: 0, angle: 0, trunk: 0, check: null, repPeak: null, inRep: false, upperElevation: 0, foreElevation: 0 }));
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const k = (1 - Math.cos((2 * Math.PI * t) / period)) / 2;
      const v = live;
      if (exercise === 'elbow_flexion') {
        v.upperElevation = 4;
        v.foreElevation = 4 + 128 * k;
        v.angle = 124 * k;
        v.trunk = 2;
      } else if (exercise === 'forearm_rotation') {
        v.angle = -70 + 150 * k;
        v.upperElevation = 4;
        v.foreElevation = 90;
        v.trunk = 0;
      } else {
        v.upperElevation = 150 * k;
        v.foreElevation = 152 * k;
        v.angle = 150 * k;
        v.trunk = 16 * k * k;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [exercise, period, live]);
  return live;
}

function LiveCell({ exercise, side }: { exercise: ExerciseId; side: 'left' | 'right' }) {
  const live = useFakeLive(exercise);
  return (
    <Cell label={`${exercise} · ${side}`} h={260}>
      <StickFigure live={live} exercise={exercise} side={side} color={side === 'left' ? 'var(--left)' : 'var(--right)'} ariaLabel="" />
    </Cell>
  );
}

const PL: Placement[] = ['trunk', 'upper_l', 'upper_r', 'fore_l', 'fore_r'];
const sensorsOf = (online: Placement[], low: Placement[] = []): SensorState[] =>
  PL.map((p) => ({ placement: p, online: online.includes(p), battery: online.includes(p) ? (low.includes(p) ? 12 : 86) : null, lowBattery: low.includes(p), link: 1 }));

export default function LabPage() {
  return (
    <div className="lab">
      <header className="lab__head">
        <h1>NeuroMove · рисунки</h1>
        <p>Одна геометрия тела, одна толщина контура. Только в режиме разработки.</p>
      </header>

      <Plate title="Крупно — проверка геометрии суставов, шеи, кистей" wide>
        <Cell label="подъём 144 · 420 px" h={420}>
          <RaiseProgress was={127} now={144} goal={150} side="right" labels={{ was: 'было', goal: 'цель' }} ariaLabel="" />
        </Cell>
        <Cell label="схема датчиков · 520 px" h={420}>
          <BodyMap sensors={sensorsOf(PL)} required={[]} phase="streaming" size={520} />
        </Cell>
        <Cell label="калибровка · 420 px" h={420}>
          <CalibrationFigure progress={0.7} moved={false} size={420} />
        </Cell>
      </Plate>

      <Plate title="Подъём руки за курс — RaiseProgress" wide>
        {[
          [127, 144, 150],
          [117, 129, 140],
          [130, 122, 150],
          [60, 95, null],
          [150, 172, 175],
        ].map(([was, now, goal], i) => (
          <Cell key={i} label={`было ${was}° → ${now}°${goal ? `, цель ${goal}°` : ''}`} h={150}>
            <RaiseProgress was={was as number} now={now as number} goal={goal} side={i % 2 ? 'left' : 'right'} labels={{ was: 'было', goal: 'цель' }} ariaLabel="" />
          </Cell>
        ))}
      </Plate>

      <Plate title="Обе руки — ArmsCompare (крупно, с подписями)" wide>
        <Cell label="подъём вперёд 144 / 162" h={150}>
          <ArmsCompare exercise="shoulder_flexion" main={{ side: 'right', value: 144 }} other={{ side: 'left', value: 162 }} labels={{ main: 'правая 144°', other: 'левая 162°' }} ariaLabel="" />
        </Cell>
        <Cell label="подъём вперёд 150 / 156" h={150}>
          <ArmsCompare exercise="shoulder_flexion" main={{ side: 'left', value: 150 }} other={{ side: 'right', value: 156 }} labels={{ main: 'левая 150°', other: 'правая 156°' }} ariaLabel="" />
        </Cell>
        <Cell label="помощь корпусом 8°" h={150}>
          <TrunkLean now={8} side="right" label="8°" ariaLabel="" />
        </Cell>
        <Cell label="помощь корпусом 22°" h={150}>
          <TrunkLean now={22} side="left" label="22°" ariaLabel="" />
        </Cell>
        <Cell label="помощь корпусом 0°" h={150}>
          <TrunkLean now={0} side="right" label="0°" ariaLabel="" />
        </Cell>
      </Plate>

      <Plate title="Строка отчёта — ArmsCompare без подписей, 60×66" wide>
        {EX.map((ex) => (
          <Cell key={ex} label={ex} h={66}>
            <ArmsCompare
              exercise={ex}
              main={{ side: 'right', value: ex === 'forearm_rotation' ? 129 : ex === 'elbow_flexion' ? 119 : ex === 'shoulder_abduction' ? 135 : 144, sup: 70, pro: 59 }}
              other={{ side: 'left', value: ex === 'forearm_rotation' ? 153 : ex === 'elbow_flexion' ? 139 : ex === 'shoulder_abduction' ? 160 : 162, sup: 80, pro: 73 }}
              ariaLabel=""
            />
          </Cell>
        ))}
        {EX.map((ex) => (
          <Cell key={`big-${ex}`} label={`${ex} · 150`} h={150}>
            <ArmsCompare
              exercise={ex}
              main={{ side: 'right', value: ex === 'forearm_rotation' ? 129 : ex === 'elbow_flexion' ? 119 : ex === 'shoulder_abduction' ? 135 : 144, sup: 70, pro: 59 }}
              other={{ side: 'left', value: ex === 'forearm_rotation' ? 153 : ex === 'elbow_flexion' ? 139 : ex === 'shoulder_abduction' ? 160 : 162, sup: 80, pro: 73 }}
              ariaLabel=""
            />
          </Cell>
        ))}
      </Plate>

      <Plate title="Живая фигурка — StickFigure (синтетическое движение)" wide>
        <LiveCell exercise="shoulder_flexion" side="right" />
        <LiveCell exercise="elbow_flexion" side="left" />
        <LiveCell exercise="shoulder_abduction" side="right" />
        <LiveCell exercise="shoulder_abduction" side="left" />
        <LiveCell exercise="forearm_rotation" side="right" />
      </Plate>

      <Plate title="Схема датчиков — BodyMap: состояния" wide>
        {(
          [
            ['нет устройства', [], [], undefined, []],
            ['поиск', [], [], 'searching', []],
            ['выходят на связь 3/5', ['trunk', 'upper_r', 'fore_r'], [], 'connecting', []],
            ['все на связи', PL, [], 'streaming', []],
            ['мало заряда', PL, ['fore_l'], 'streaming', []],
            ['обрыв связи', [], [], 'reconnecting', []],
            ['нужны только правые', PL, [], 'streaming', ['trunk', 'upper_r', 'fore_r']],
          ] as [string, Placement[], Placement[], ConnectionPhase | undefined, Placement[]][]
        ).map(([label, online, low, phase, req]) => (
          <Cell key={label} label={label} h={200}>
            <BodyMap sensors={sensorsOf(online, low)} required={req} phase={phase} size={250} />
          </Cell>
        ))}
        <Cell label="без подписей · 110" h={110}>
          <BodyMap sensors={sensorsOf(PL)} required={[]} phase="streaming" size={80} showLabels={false} />
        </Cell>
      </Plate>

      <Plate title="Калибровка — CalibrationFigure" wide>
        <Cell label="0%" h={240}>
          <CalibrationFigure progress={0} moved={false} />
        </Cell>
        <Cell label="55%" h={240}>
          <CalibrationFigure progress={0.55} moved={false} />
        </Cell>
        <Cell label="пошевелился" h={240}>
          <CalibrationFigure progress={0.3} moved attempt={2} />
        </Cell>
        <Cell label="готово" h={240}>
          <CalibrationFigure progress={1} moved={false} />
        </Cell>
      </Plate>

      <Plate title="Статус-кольца — StatusRing: 14, 16, 20 px" wide>
        {[14, 16, 20].map((sz) =>
          (['todo', 'wait', 'active', 'paused', 'done', 'skipped', 'error'] as RingState[]).map((st) => (
            <Cell key={`${sz}-${st}`} label={`${st} ${sz}`} h={sz}>
              <StatusRing state={st} progress={0.62} size={sz} />
            </Cell>
          )),
        )}
      </Plate>

      <Plate title="Значки движений — MoveIcon: 32, 44, 64 px" wide>
        {[32, 44, 64].map((sz) =>
          EX.map((ex) => (
            <Cell key={`${sz}-${ex}`} label={`${ex} · ${sz}`} h={sz}>
              <MoveIcon exercise={ex} side={ex === 'elbow_flexion' ? 'left' : 'right'} size={sz} ariaLabel="" />
            </Cell>
          )),
        )}
      </Plate>
    </div>
  );
}
