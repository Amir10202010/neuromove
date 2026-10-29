// Экраны продукта на стартовой странице — из тех же компонентов, что и в приложении.
//
// ProductScreen — экран теста вживую у специалиста: этапы, шаг, повторы, ход теста, угломер, фигурка.
//                 spot — какую часть экрана подсветить (тур под планшетом на стартовой странице).
//
// Экран рисуется в «родном» размере и масштабируется целиком, как снимок: на телефоне он
// меньше, но раскладка не перестраивается — это тот же экран, что увидит врач.

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Goniometer } from '../../charts/Goniometer';
import { MoveIcon } from '../../charts/MoveFigures';
import { StickFigure } from '../../charts/StickFigure';
import { StatusRing } from '../../figures/StatusRing';
import { useAnimationFrame } from '../../hooks/useAnimationFrame';
import { useWidth } from '../../hooks/useSize';
import { useI18n } from '../../i18n';
import { patientInitials } from '../../lib/initials';
import { armLabel } from '../common/text';
import { useIllustration, type IllustrationLive } from './useIllustration';

const REPS = 3;
// Размеры приборов на экранах. Угломер из приложения рисуется в рамке 278 × 294
const GAUGE_RATIO = 294 / 278;
const GAUGE = 330;
const GAUGE_H = GAUGE * GAUGE_RATIO;
const FIGURE = 200;

/** Сколько повторов из трёх сделано: после третьего — «3 из 3», пока не начался следующий. */
function repsDone(live: IllustrationLive): number {
  const d = live.reps % REPS;
  return d === 0 && live.reps > 0 && !live.inRep ? REPS : d;
}

/**
 * Точки повторов и подпись «2 из 3» — обновляются в кадре, без перерисовки React.
 * Подпись сверяется строкой, а не числом: при смене языка она перепишется сама.
 */
function useRepDots(live: IllustrationLive, active: boolean, format: (done: number) => string) {
  const dots = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const shown = useRef(-1);
  useAnimationFrame(() => {
    const done = repsDone(live);
    if (done !== shown.current) {
      shown.current = done;
      dots.current?.querySelectorAll('span').forEach((el, i) => el.classList.toggle('is-done', i < done));
    }
    const s = format(done);
    if (text.current && text.current.textContent !== s) text.current.textContent = s;
  }, active);
  return { dots, text };
}

/** Что подсвечивает тур под экраном: угломер, отметки «прошлый раз» и «цель», фигурка. */
export type ScreenSpot = 'angle' | 'marks' | 'figure';

/** Положение элемента внутри экрана в «родных» пикселях: offset* не видят масштаб и наклон планшета. */
function within(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/**
 * Отметки «прошлый раз» и «цель» на дуге угломера — в «родных» пикселях экрана. Угломер — SVG
 * по центру колонки, вверху; отметки — фигуры с translate(x, y) в координатах его viewBox.
 */
function marksRect(root: HTMLElement, gauge: HTMLElement) {
  const svg = gauge.querySelector<SVGSVGElement>('svg.goniometer');
  if (!svg) return null;
  const vb = svg.viewBox.baseVal;
  const width = svg.width.baseVal.value;
  const k = width / vb.width;
  const g = within(gauge, root);
  const left = g.x + (gauge.offsetWidth - width) / 2;
  const pts = [...svg.querySelectorAll('path[transform^="translate"]')].flatMap((el) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.getAttribute('transform') ?? '');
    return m ? [{ x: left + (Number(m[1]) - vb.x) * k, y: g.y + (Number(m[2]) - vb.y) * k }] : [];
  });
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const w = Math.max(132, Math.max(...xs) - Math.min(...xs) + 64);
  const h = Math.max(92, Math.max(...ys) - Math.min(...ys) + 64);
  return { x: (Math.min(...xs) + Math.max(...xs) - w) / 2, y: (Math.min(...ys) + Math.max(...ys) - h) / 2, w, h };
}

/** Прямоугольник подсветки: угломер — без строки подписей под ним, отметки на дуге, фигурка. */
function spotRect(root: HTMLElement, spot: ScreenSpot) {
  const gauge = root.querySelector<HTMLElement>('.ps__gauge');
  const legend = root.querySelector<HTMLElement>('.ps__legend');
  const figure = root.querySelector<HTMLElement>('.ps__figure');
  if (spot === 'figure') return figure ? within(figure, root) : null;
  if (!gauge || !legend) return null;
  if (spot === 'marks') return marksRect(root, gauge);
  const g = within(gauge, root);
  const l = within(legend, root);
  // Низ рамки угломера — над строкой подписей, а не поверх неё (рамка шире на 12 px с каждой стороны)
  return { ...g, h: l.y - g.y - 18 };
}

/** Экран в «родном» размере, вписанный по ширине контейнера. */
function Scaled({ width: nativeW, height: nativeH, className, children }: { width: number; height: number; className: string; children: ReactNode }) {
  const [box, width] = useWidth<HTMLDivElement>(nativeW);
  const k = width / nativeW;
  return (
    <div ref={box} className={className} style={{ height: nativeH * k }}>
      <div className="lp-screen" style={{ width: nativeW, height: nativeH, transform: `scale(${k})` }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Экран теста вживую — раскладка простого вида LiveMain (features/session/LivePanel.tsx) и шапки
 * SessionRunPage на компьютере: слева шаг, что делать, повторы и ход теста, справа угломер и фигурка.
 * Классы свои (ps__*), а не приложения: экран масштабируется целиком, и медиазапросы окна
 * перестроили бы его на телефоне. Поменялась раскладка теста в приложении — поменять и здесь
 * (17 октября экран отставал на три дня: имя в квадрате значка, «Симулятор», «Запись»).
 */
export function ProductScreen({
  active,
  previous,
  goal,
  name,
  other,
  spot = null,
}: {
  active: boolean;
  previous: number | null;
  goal: number | null;
  name: string;
  other: number | null;
  spot?: ScreenSpot | null;
}) {
  const { t, f } = useI18n();
  const live = useIllustration('shoulder_flexion', active);
  const { dots, text } = useRepDots(live, active, (done) => t('landing.product.screen.reps', { done, total: REPS }));
  const progress = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const spotBox = useRef<HTMLSpanElement>(null);
  // Подсветка встаёт по настоящим размерам частей экрана; угломер монтируется, только пока
  // экран виден (active), — поэтому пересчёт и при смене active
  useLayoutEffect(() => {
    const root = screen.current;
    const box = spotBox.current;
    if (!root || !box || !spot) return;
    const r = spotRect(root, spot);
    if (!r) return;
    const pad = 12;
    box.style.left = `${r.x - pad}px`;
    box.style.top = `${r.y - pad}px`;
    box.style.width = `${r.w + 2 * pad}px`;
    box.style.height = `${r.h + 2 * pad}px`;
  }, [spot, active]);
  useAnimationFrame(() => {
    if (clock.current) clock.current.textContent = f.duration(live.t + 26);
    const s = `${repsDone(live)}/${REPS}`;
    if (progress.current && progress.current.textContent !== s) progress.current.textContent = s;
  }, active);
  const stages = (['connect', 'calibrate', 'test', 'result'] as const).map((k) => t(`run.stages.${k}`));
  // Быстрая проверка: сначала менее поражённая сторона — левая рука уже пройдена
  const steps = [
    { ex: 'shoulder_flexion', side: 'left', state: 'done' },
    { ex: 'shoulder_flexion', side: 'right', state: 'active' },
    { ex: 'elbow_flexion', side: 'left', state: 'todo' },
    { ex: 'elbow_flexion', side: 'right', state: 'todo' },
  ] as const;

  return (
    <Scaled width={1080} height={640} className="lp-device__screen">
      <div ref={screen} className="ps" data-spot={spot ?? undefined}>
        <header className="ps__head">
          <span className="ps__avatar" aria-hidden>
            {patientInitials(name)}
          </span>
          <b className="ps__name">{name}</b>
          <ol className="ps__stages">
            {stages.map((s, i) => (
              <li key={s} className={i < 2 ? 'is-done' : i === 2 ? 'is-current' : undefined}>
                {/* Те же статус-кольца, что у этапов в приложении */}
                <StatusRing state={i < 2 ? 'done' : i === 2 ? 'active' : 'todo'} progress={0.35} size={16} />
                {s}
              </li>
            ))}
          </ol>
          <b ref={clock} className="ps__timer">
            00:26
          </b>
        </header>
        <section className="ps__card">
          <div className="ps__info">
            <div className="ps__eyebrow-row">
              <span className="ps__eyebrow">{t('run.step', { current: 2, total: 4 })}</span>
              <span className="ps__chip">
                <span className="ps__key" aria-hidden />
                {armLabel(t, 'right')}
              </span>
            </div>
            <div className="ps__title">{t('exercise.shoulder_flexion.name')}</div>
            <div className="ps__text">{t('exercise.shoulder_flexion.instruction')}</div>
            <div className="ps__reps">
              <span ref={dots} className="ps__dots" aria-hidden>
                {Array.from({ length: REPS }, (_, i) => (
                  <span key={i} />
                ))}
              </span>
              <span ref={text} />
            </div>
            <ol className="ps__track">
              {steps.map((st, i) => (
                <li key={i} className={`is-${st.state}`}>
                  <span className="ps__track-icon">
                    <MoveIcon exercise={st.ex} side={st.side} size={30} ariaLabel="" />
                  </span>
                  <span className="ps__track-name">
                    <b>{t(`exercise.${st.ex}.short`)}</b>
                    <small>{armLabel(t, st.side)}</small>
                  </span>
                  <span className="ps__track-state">
                    <StatusRing state={st.state} progress={0.34} size={15} />
                    {st.state === 'done' && other !== null && <span>{f.deg(other)}</span>}
                    {st.state === 'active' && <span ref={progress}>0/3</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="ps__stage">
            <div className="ps__gauge">
              {/* Угломер и фигурка из приложения рисуют каждый кадр, пока смонтированы, —
                  поэтому монтируем их, только пока экран виден; иначе — пустое место того же размера */}
              {active ? (
                <Goniometer
                  live={live}
                  range={[0, 180]}
                  color="var(--right)"
                  softColor="var(--right-soft)"
                  previous={previous}
                  goal={goal}
                  labels={{ current: '', previous: t('run.previous'), goal: t('run.goal'), other: t('run.otherSide') }}
                  size={GAUGE}
                />
              ) : (
                <div style={{ width: GAUGE, height: GAUGE_H }} />
              )}
              <div className="ps__legend">
                {previous !== null && (
                  <span>
                    <svg width="12" height="10" aria-hidden>
                      <path d="M1 1 L11 5 L1 9 Z" fill="var(--text-2)" />
                    </svg>
                    {t('run.previous')} <b>{f.deg(previous)}</b>
                  </span>
                )}
                {goal !== null && (
                  <span>
                    <svg width="12" height="12" aria-hidden>
                      <path d="M6 0 L12 6 L6 12 L0 6 Z" fill="var(--goal)" />
                    </svg>
                    {t('run.goal')} <b>{f.deg(goal)}</b>
                  </span>
                )}
              </div>
            </div>
            <div className="ps__figure">
              {active ? (
                <StickFigure live={live} exercise="shoulder_flexion" side="right" color="var(--right)" size={FIGURE} ariaLabel={t('exercise.shoulder_flexion.joint')} />
              ) : (
                <div style={{ width: FIGURE, height: Math.round((FIGURE * 268) / 164) }} />
              )}
            </div>
          </div>
        </section>
        <span ref={spotBox} className="ps__spot" aria-hidden />
      </div>
    </Scaled>
  );
}
