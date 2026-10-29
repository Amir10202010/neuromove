// Живой тест. Простой вид (LiveMain) — что делать сейчас, повторы, крупный угломер и фигурка;
// подробный (LiveExtras и список шагов) — живые кривые, каждый повтор, связь и заряд датчиков.

import { Battery, BatteryLow, Check, Circle, CircleDot, Hand, Info, Minus, Pause, Radio, TriangleAlert } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Goniometer } from '../../charts/Goniometer';
import { LiveTrace } from '../../charts/LiveTrace';
import { MoveIcon } from '../../charts/MoveFigures';
import { StickFigure } from '../../charts/StickFigure';
import { StatusRing, type RingState } from '../../figures/StatusRing';
import { EXERCISES } from '../../core/exercises';
import { median } from '../../lib/stats';
import type { Patient, Session } from '../../data/models';
import type { DeviceStatus } from '../../devices/types';
import { useI18n } from '../../i18n';
import { stepOf } from '../../session/compare';
import type { SessionEngine } from '../../session/SessionEngine';
import type { EngineSnapshot, StepLive } from '../../session/types';
import { Button } from '../../ui/Button';
import { MetricInfo } from '../../ui/MetricInfo';
import { armLabel } from '../common/text';

export interface LiveMarkers {
  previous: number | null;
  goal: number | null;
  other: number | null;
}

export function useMarkers(snap: EngineSnapshot, patient: Patient, history: readonly Session[]): LiveMarkers {
  const step = snap.steps[snap.stepIndex];
  return useMemo(() => {
    if (!step) return { previous: null, goal: null, other: null };
    const sorted = [...history].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    let previous: number | null = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const st = stepOf(sorted[i] as Session, step.exercise, step.side);
      if (st) {
        previous = step.exercise === 'forearm_rotation' ? st.supination : st.rom;
        break;
      }
    }
    const g = patient.goals.find((x) => x.exercise === step.exercise && x.side === step.side && step.exercise !== 'forearm_rotation');
    const otherStep = snap.steps.find((s) => s.exercise === step.exercise && s.side !== step.side && s.reps.length > 0);
    const other = otherStep ? median(otherStep.reps.map((r) => (step.exercise === 'forearm_rotation' ? (r.supination ?? r.rom) : r.rom))) : null;
    return { previous, goal: g?.targetRom ?? null, other };
  }, [step, history, patient, snap.steps]);
}

function StepIcon({ s, active }: { s: StepLive; active: boolean }) {
  if (s.status === 'done') return <Check className="steps__icon is-done" aria-hidden />;
  if (s.status === 'skipped') return <Minus className="steps__icon is-skipped" aria-hidden />;
  if (active) return <CircleDot className="steps__icon is-active" aria-hidden />;
  return <Circle className="steps__icon" aria-hidden />;
}

export function StepsList({ snap }: { snap: EngineSnapshot }) {
  const { t, f } = useI18n();
  return (
    <section className="card steps-card">
      <div className="card__header">
        <h2 className="card__title">{t('run.stepsList')}</h2>
        <span className="muted num" style={{ fontSize: 'var(--fs-sm)' }}>
          {snap.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length}/{snap.steps.length}
        </span>
      </div>
      <ol className="steps">
        {snap.steps.map((s, i) => {
          const active = i === snap.stepIndex && snap.phase !== 'finished';
          const med = s.reps.length ? median(s.reps.map((r) => r.rom)) : null;
          return (
            <li key={i} className={`steps__item${active ? ' is-active' : ''}`} aria-current={active ? 'step' : undefined}>
              <StepIcon s={s} active={active} />
              <span className="steps__text">
                <span className="steps__name">{t(`exercise.${s.exercise}.short`)}</span>
                <span className="steps__side">
                  <span className={`side-key side-key--${s.side}`} aria-hidden /> {armLabel(t, s.side)}
                </span>
              </span>
              <span className="steps__value num">
                {s.status === 'done' && med !== null ? f.deg(med) : s.status === 'skipped' ? t('run.stepSkipped') : active ? `${s.reps.length}/${s.targetReps || '∞'}` : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Ход теста — дорожка шагов под угломером: значок движения, рука, статус-кольцо
 * (пусто — впереди, сектор — идёт и сколько повторов набрано, галочка — готово) и итог шага.
 * Видно, где мы и сколько осталось, без подсчёта в уме.
 */
function StepTrack({ snap }: { snap: EngineSnapshot }) {
  const { t, f } = useI18n();
  return (
    <ol className="track" aria-label={t('run.stepTrack')}>
      {snap.steps.map((s, i) => {
        const active = i === snap.stepIndex && snap.phase !== 'finished';
        const state: RingState = s.status === 'done' ? 'done' : s.status === 'skipped' ? 'skipped' : active ? (snap.phase === 'paused' ? 'paused' : 'active') : 'todo';
        const done = s.reps.length;
        const progress = s.targetReps ? done / s.targetReps : Math.min(1, s.elapsed / (s.durationSec || 30));
        const med = done ? median(s.reps.map((r) => (s.exercise === 'forearm_rotation' ? (r.supination ?? r.rom) : r.rom))) : null;
        return (
          <li key={i} className={`track__item is-${state}`} aria-current={active ? 'step' : undefined}>
            <span className="track__icon" aria-hidden>
              <MoveIcon exercise={s.exercise} side={s.side} size={30} ariaLabel="" />
            </span>
            <span className="track__text">
              <span className="track__name">{t(`exercise.${s.exercise}.short`)}</span>
              <span className="track__side">{armLabel(t, s.side)}</span>
            </span>
            <span className="track__state">
              <StatusRing state={state} progress={progress} size={16} />
              <span className="num">
                {s.status === 'done' && med !== null ? f.deg(med) : s.status === 'skipped' ? t('run.stepSkipped') : active && s.targetReps ? `${done}/${s.targetReps}` : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Простой вид теста — одна карточка: что делать сейчас, повторы, крупный угломер и фигурка.
 * Здесь же всё, что требует действия: шаг готов, подсказка, разряжается датчик.
 * details — подробный режим: у угломера все четыре метки, а не только прошлый раз и цель.
 */
export function LiveMain({
  engine,
  snap,
  device,
  markers,
  onNext,
  manualNext,
  details,
}: {
  engine: SessionEngine;
  snap: EngineSnapshot;
  device: DeviceStatus;
  markers: LiveMarkers;
  onNext: () => void;
  /** Шаги переключает специалист, а не приложение само: тогда после шага нужна кнопка «Следующий шаг». */
  manualNext: boolean;
  details: boolean;
}) {
  const { t, f } = useI18n();
  const step = snap.steps[snap.stepIndex];
  if (!step) return null;
  const def = EXERCISES[step.exercise];
  const color = step.side === 'left' ? 'var(--left)' : 'var(--right)';
  const soft = step.side === 'left' ? 'var(--left-soft)' : 'var(--right-soft)';
  const range: [number, number] = [def.gauge.min, def.gauge.max];
  const rotation = def.reps === 'bidirectional';
  const done = step.reps.length;
  const target = step.targetReps;
  const positioning = snap.phase === 'positioning';
  const stepDone = snap.phase === 'step_done';
  const lowBattery = device.sensors.find((s) => s.lowBattery);
  const left = step.durationSec ? Math.max(0, Math.ceil(step.durationSec - step.elapsed)) : null;

  // Метки угломера: в простом виде — только те, что есть, и только прошлый раз и цель
  const legend: { key: string; icon: ReactNode; label: string; value: string }[] = [];
  const prevIcon = (
    <svg width="12" height="10" aria-hidden>
      <path d="M1 1 L11 5 L1 9 Z" fill="var(--text-2)" />
    </svg>
  );
  const goalIcon = (
    <svg width="12" height="12" aria-hidden>
      <path d="M6 0 L12 6 L6 12 L0 6 Z" fill="var(--goal)" />
    </svg>
  );
  if (details || markers.previous !== null) legend.push({ key: 'prev', icon: prevIcon, label: t('run.previous'), value: f.deg(markers.previous) });
  if (details || markers.goal !== null) legend.push({ key: 'goal', icon: goalIcon, label: t('run.goal'), value: f.deg(markers.goal) });
  if (details) {
    legend.push({
      key: 'other',
      icon: (
        <svg width="14" height="4" aria-hidden>
          <line x1="0" y1="2" x2="14" y2="2" stroke="var(--text-3)" strokeWidth="2" strokeDasharray="2 3" />
        </svg>
      ),
      label: t('run.otherSide'),
      value: f.deg(markers.other),
    });
    legend.push({ key: 'peak', icon: <span className="legend__key legend__key--bar" style={{ background: soft }} aria-hidden />, label: t('run.repPeak'), value: done ? f.deg(step.reps[done - 1]?.rom) : '–' });
  }

  return (
    <section data-guide="live" className="card live-main">
      <div className="live-main__info">
      <div className="instruction__head">
        <span className="eyebrow">{t('run.step', { current: snap.stepIndex + 1, total: snap.steps.length })}</span>
        <span className={`side-chip side-chip--${step.side}`}>
          <span className={`side-key side-key--${step.side}`} aria-hidden />
          {armLabel(t, step.side)}
        </span>
        <span className="spacer" />
        {/* Метка — только когда тест не идёт как обычно: пауза, подготовка, обрыв связи.
            «Запись» и «Шаг завершён» не пишем: идёт тест — видно по стрелке, шаг закрылся — по точкам */}
        {(snap.phase === 'paused' || positioning || snap.phase === 'interrupted') && (
          <span className="badge">
            {snap.phase === 'paused' ? (
              <>
                <Pause size={12} aria-hidden />
                {t('run.paused')}
              </>
            ) : positioning ? (
              t('run.positioningTitle')
            ) : (
              t('device.phase.reconnecting')
            )}
          </span>
        )}
      </div>
      <h2 className="live-main__title">{t(`exercise.${step.exercise}.name`)}</h2>
      <p className="live-main__text">{positioning ? t('run.positioningText') : t(`exercise.${step.exercise}.instruction`)}</p>
      <div className="instruction__reps">
        {target > 0 ? (
          <>
            <div className="rep-dots" aria-label={`${t('run.repsDone')}: ${done} / ${target}`}>
              {Array.from({ length: target }, (_, i) => (
                <span key={i} className={i < done ? 'is-done' : i === done && snap.phase === 'recording' ? 'is-current' : ''} style={i < done ? { background: color, borderColor: color } : undefined} />
              ))}
            </div>
            <span className="num">{t('run.repsOf', { done, target })}</span>
          </>
        ) : (
          <span className="num">
            {t('common.repsCount', { count: done })}
            {left !== null && ` · ${t('run.timeLeft', { seconds: left })}`}
          </span>
        )}
      </div>
      {positioning && (
        <div className="progress" style={{ marginTop: 12 }}>
          <div className="progress__bar" style={{ width: `${snap.positioning.progress * 100}%` }} />
        </div>
      )}
      {/* Шаги переключает специалист: шаг закончен — одна кнопка, без пояснений */}
      {stepDone && manualNext && !engine.getSnapshot().steps.every((s) => s.status !== 'pending') && (
        <div className="step-done">
          <Button size="sm" variant="primary" icon={<Check />} onClick={onNext}>
            {t('run.controls.next')}
          </Button>
        </div>
      )}
      {snap.hint && (
        <div className="callout callout--warn" role="status" style={{ marginTop: 12 }}>
          {snap.hint === 'no_reps' ? <Info aria-hidden /> : <Hand aria-hidden />}
          <span>
            {t(`run.hints.${snap.hint}`, {
              places: snap.missing.map((p) => t(`device.placementLong.${p}`)).join(', '),
              place: snap.flipped ? t(`device.placementLong.${snap.flipped}`) : '',
            })}
          </span>
        </div>
      )}
      {lowBattery && (
        <div className="callout callout--warn" style={{ marginTop: 12 }}>
          <TriangleAlert aria-hidden />
          <span>{t('device.lowBattery', { place: t(`device.placementLong.${lowBattery.placement}`), value: lowBattery.battery ?? 0 })}</span>
        </div>
      )}

      <StepTrack snap={snap} />
      </div>

      <div className="live-main__stage">
        <div className="live-main__gauge">
          <Goniometer
            live={engine.live}
            range={range}
            color={color}
            softColor={soft}
            previous={markers.previous}
            goal={markers.goal}
            other={details ? markers.other : null}
            labels={{ current: t('run.currentAngle'), previous: t('run.previous'), goal: t('run.goal'), other: t('run.otherSide'), minLabel: t('metric.pronation'), maxLabel: t('metric.supination') }}
            size={rotation ? 360 : 330}
          />
          {legend.length > 0 && (
            <dl className="live-main__legend">
              {legend.map((l) => (
                <div key={l.key}>
                  <dt>
                    {l.icon}
                    {l.label}
                  </dt>
                  <dd className="num">{l.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="live-main__figure">
          <StickFigure live={engine.live} exercise={step.exercise} side={step.side} color={color} size={rotation ? 260 : step.exercise === 'shoulder_abduction' ? 300 : 190} ariaLabel={t(`exercise.${step.exercise}.joint`)} />
          {/* Что именно меряем («подъём плеча от положения рука вдоль тела») — для подробного вида */}
          {details && <span className="muted">{t(`exercise.${step.exercise}.measure`)}</span>}
        </div>
      </div>
    </section>
  );
}

/** Подробный режим: живые кривые угла и корпуса, каждый повтор с плавностью, связь и заряд. */
export function LiveExtras({ engine, snap, device }: { engine: SessionEngine; snap: EngineSnapshot; device: DeviceStatus }) {
  const { t, f } = useI18n();
  const step = snap.steps[snap.stepIndex];
  if (!step) return null;
  const def = EXERCISES[step.exercise];
  const color = step.side === 'left' ? 'var(--left)' : 'var(--right)';
  const range: [number, number] = [def.gauge.min, def.gauge.max];
  const rotation = def.reps === 'bidirectional';
  const done = step.reps.length;
  const minBattery = device.sensors.reduce<number | null>((m, s) => (s.battery === null ? m : m === null ? s.battery : Math.min(m, s.battery)), null);
  const lowBattery = device.sensors.find((s) => s.lowBattery);
  const linkAvg = device.sensors.length ? device.sensors.reduce((a, s) => a + s.link, 0) / device.sensors.length : 0;
  const med = done ? median(step.reps.map((r) => r.rom)) : null;

  return (
    <div className="live-extras">
      <section className="card">
        <div className="card__header">
          <h3 className="card__title">{t('run.liveChart')}</h3>
        </div>
        <div className="card__body">
          <LiveTrace
            series={engine.series}
            channel="angle"
            range={rotation ? [-90, 90] : [range[0], range[1]]}
            color={color}
            height={170}
            gridStep={rotation ? 45 : 30}
            secLabel={t('common.sec')}
            ariaLabel={t('run.liveChart')}
          />
        </div>
      </section>

      {def.trunk && (
        <section className="card">
          <div className="card__header">
            <h3 className="card__title row" style={{ gap: 6 }}>
              {t('run.trunkChart')}
              <MetricInfo metric="trunk" />
            </h3>
          </div>
          <div className="card__body">
            <LiveTrace series={engine.series} channel="trunk" range={[0, 25]} color="var(--text-2)" height={110} gridStep={10} threshold={12} secLabel={t('common.sec')} ariaLabel={t('run.trunkChart')} />
          </div>
        </section>
      )}

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">{t('run.repsDone')}</h3>
          {med !== null && <span className="muted num" style={{ fontSize: 'var(--fs-sm)' }}>{t('metric.median')} {f.deg(med)}</span>}
        </div>
        <div className="card__body" style={{ paddingTop: 8 }}>
          {done === 0 ? (
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>–</p>
          ) : (
            <table className="table table--compact reps-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="num">{rotation ? `${t('metric.supination')} / ${t('metric.pronation')}` : t('metric.romShort')}</th>
                  <th className="num">{t('metric.sparcShort')}</th>
                  {def.trunk && <th className="num">{t('metric.trunkShort')}</th>}
                </tr>
              </thead>
              <tbody>
                {step.reps.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="num">{rotation ? `${f.deg(r.supination)} / ${f.deg(r.pronation)}` : f.deg(r.rom)}</td>
                    <td className="num">{f.num(r.sparc, 2)}</td>
                    {def.trunk && <td className="num">{f.deg(r.trunk)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">{t('run.signal')}</h3>
          <span className={`badge ${device.phase === 'streaming' ? 'badge--good' : 'badge--warn'}`}>
            <Radio size={12} aria-hidden />
            {t(`device.phase.${device.phase}`)}
          </span>
        </div>
        <div className="card__body">
          <dl className="kv">
            <dt className="row" style={{ gap: 4 }}>
              {t('run.quality')}
              <MetricInfo metric="quality" />
            </dt>
            <dd className={snap.quality.percent < 95 ? 'quality-low' : ''}>{f.pct(snap.quality.percent, 1)}</dd>
            <dt>{t('device.lost')}</dt>
            <dd>{snap.quality.lost}</dd>
            <dt>{t('device.link')}</dt>
            <dd>{device.sensors.length ? f.pct(linkAvg * 100) : '–'}</dd>
            <dt>{t('device.battery')}</dt>
            <dd className={lowBattery ? 'quality-low' : ''}>
              <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                {lowBattery ? <BatteryLow size={14} aria-hidden /> : <Battery size={14} aria-hidden />}
                {minBattery === null ? '–' : `${minBattery}%`}
              </span>
            </dd>
          </dl>
        </div>
      </section>
    </div>
  );
}
