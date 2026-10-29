// 4. Как это работает — закреплённая сцена: слева четыре шага, справа стоит на месте модель
// датчика и меняется вместе с шагом (надеть → двигаться → измерить → увидеть).
// С 18 октября — как разборные модели на страницах Apple: модель двигает сама прокрутка.
// Слои расходятся и собираются плавно вокруг границы шагов, «камера» приближается к плате
// на шаге «измерить» и отходит на шаге «увидеть»; пока сцена въезжает в экран, модель
// поднимается снизу и увеличивается. Шаг сменяется, когда его текст доходит до линии чтения.
// Модель — разборная схема из версии страницы от 27 сентября; прежний рисунок ребёнка убран.
// На шагах «двигаться» и «измерить» рядом с моделью — живой угол из модели движения
// (та же, что стоит за симулятором), на шаге «увидеть» — краткий отчёт с цифрами P01.

import { useRef, useState } from 'react';
import { useAnimationFrame } from '../../../hooks/useAnimationFrame';
import { useI18n } from '../../../i18n';
import { shownDelta } from '../../../session/story';
import { prefersReducedMotion, useInView, useStepProgress } from '../motion';
import { SensorModel, SignalLines } from '../SensorModel';
import type { PatientStory } from '../story';
import { useIllustration, type IllustrationLive } from '../useIllustration';

const STEPS = ['wear', 'move', 'measure', 'see'] as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Состояние модели по прокрутке: целое — шаг; переход к следующему шагу идёт плавно (smoothstep)
 * в окне от 0,7 текущего шага до 0,3 следующего — модель меняется вокруг границы, а не скачком.
 */
function modelState(s: number): number {
  const t = s - 0.7;
  const k = Math.floor(t);
  const x = clamp01((t - k) / 0.6);
  return Math.min(STEPS.length - 1, Math.max(0, k + x * x * (3 - 2 * x)));
}

/** Угол сейчас и номер повтора — обновляются в кадре, без перерисовки React. */
function LiveReadout({ live, active, label, move, repText }: { live: IllustrationLive; active: boolean; label: string; move: string; repText: (n: number) => string }) {
  const value = useRef<HTMLSpanElement>(null);
  const rep = useRef<HTMLSpanElement>(null);
  useAnimationFrame(() => {
    const v = `${Math.round(live.angle ?? 0)}°`;
    if (value.current && value.current.textContent !== v) value.current.textContent = v;
    const r = repText(live.reps + (live.inRep ? 1 : 0) || 1);
    if (rep.current && rep.current.textContent !== r) rep.current.textContent = r;
  }, active);
  return (
    <div className="lp-how__readout" aria-hidden>
      <small>{label}</small>
      <span ref={value} className="lp-how__readout-value">
        0°
      </span>
      <span className="lp-how__readout-text">
        {move} · <span ref={rep} />
      </span>
    </div>
  );
}

export function HowItWorks({ story }: { story: PatientStory | null }) {
  const { t, f } = useI18n();
  const steps = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [reduced] = useState(prefersReducedMotion);
  const [visual, inView] = useInView<HTMLDivElement>('0px');
  useStepProgress(steps, (s) => {
    setStep(Math.min(STEPS.length - 1, Math.floor(s)));
    // «Уменьшить движение» — модель меняется шагами, без промежуточных кадров
    const m = reduced ? Math.floor(s) : modelState(s);
    const el = art.current;
    if (!el) return;
    el.style.setProperty('--a', clamp01(m).toFixed(4));
    el.style.setProperty('--b', clamp01(m - 1).toFixed(4));
    el.style.setProperty('--c', clamp01(m - 2).toFixed(4));
  });
  // Модель движется только на шагах «двигаться» и «измерить» и только пока сцена видна
  const moving = inView && step >= 1 && step <= 2;
  const live = useIllustration('shoulder_abduction', moving);

  // Изменение симметрии — в процентных пунктах, как на карточке пациента: «+6 п.п.»
  const pp = (v: number) => {
    const r = Math.round(v);
    return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)} ${t('common.pp')}`;
  };

  /** Кнопка шага под моделью: прокрутить к тексту шага — модель встанет сама. */
  const goTo = (i: number) => {
    const el = steps.current?.querySelector<HTMLElement>(`[data-step="${i}"]`);
    el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  };

  return (
    <section id="lp-how" className="lp-how lp-dark" data-nav="dark" data-progress="1 0" data-progress-edge="top" aria-labelledby="lp-how-title">
      <div className="lp-how__grid">
        <div ref={visual} className="lp-how__visual" data-reveal>
          <div ref={art} className="lp-how__art" data-step={step}>
            <SensorModel
              ariaLabel={t('landing.how.visual.aria')}
              labels={{
                enclosure: t('landing.how.visual.enclosure'),
                board: t('landing.how.visual.board'),
                boardSub: t('landing.how.visual.boardSub'),
                strap: t('landing.how.visual.strap'),
              }}
            />
            <div className="lp-how__signal">
              <SignalLines />
            </div>
            <LiveReadout
              live={live}
              active={moving}
              label={t('landing.how.visual.now')}
              move={t('landing.how.visual.move')}
              repText={(n) => t('landing.how.visual.rep', { n })}
            />
            {story && (
              <div className="lp-how__report" aria-hidden={step !== 3}>
                <div className="lp-how__report-title">{t('landing.how.visual.reportTitle', { code: story.code })}</div>
                <dl>
                  <div>
                    <dt>{t('landing.how.visual.raise')}</dt>
                    <dd>{f.deg(story.last)}</dd>
                    <dd className="lp-how__delta">{f.deltaDeg(shownDelta(story.last, story.first))}</dd>
                  </div>
                  {story.symNow !== null && story.symWas !== null && (
                    <div>
                      <dt>{t('landing.how.visual.symmetry')}</dt>
                      <dd>{f.pct(story.symNow)}</dd>
                      <dd className="lp-how__delta">{pp(story.symNow - story.symWas)}</dd>
                    </div>
                  )}
                  {story.trunkNow !== null && story.trunkWas !== null && (
                    <div>
                      <dt>{t('landing.how.visual.trunkLong')}</dt>
                      <dd>{f.deg(story.trunkNow)}</dd>
                      <dd className="lp-how__delta">{f.deltaDeg(story.trunkNow - story.trunkWas)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
          <div className="lp-how__controls" role="group" aria-label={t('landing.how.label')}>
            {STEPS.map((s, i) => (
              <button key={s} type="button" aria-current={i === step ? 'step' : undefined} onClick={() => goTo(i)}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                {t(`landing.how.steps.${s}.title`)}
              </button>
            ))}
          </div>
          <p className="lp-how__caption">{t('landing.how.visual.caption')}</p>
        </div>

        <div ref={steps} className="lp-how__steps">
          <h2 id="lp-how-title" className="lp-label" tabIndex={-1}>
            {t('landing.how.label')}
          </h2>
          {STEPS.map((s, i) => (
            <article key={s} className="lp-how__step" data-step={i} data-active={i === step || undefined}>
              <span className="lp-how__num">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="lp-d2">{t(`landing.how.steps.${s}.title`)}</h3>
              <p className="lp-lead">{t(`landing.how.steps.${s}.text`)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
