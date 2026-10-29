// Тест вживую. Экран теста — крупно, в планшете, который при прокрутке поднимается
// и выпрямляется. Под ним — тур из трёх пунктов: выбранный пункт подсвечивает свою часть экрана
// (угломер, отметки «прошлый раз» и «цель», фигурку), остальное приглушено. Пока экран виден,
// тур идёт сам, раз в 4,2 с; наведение мышью или фокус — пауза, нажатие — тур дальше не идёт сам.
// При «уменьшить движение» тур стоит на первом пункте.
//
// Имя, прошлый сеанс, цель и другая рука — те же, что у первого ребёнка демо в приложении.
// До 18 октября под планшетом стояли три колонки текста с чёрными кружками-номерами, такие же
// номера были на самом экране — выглядело как инструкция, а не как продукт.

import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '../../../i18n';
import { prefersReducedMotion, useInView } from '../motion';
import { ProductScreen, type ScreenSpot } from '../ProductScreen';
import type { PatientStory } from '../story';

const TOUR: readonly ScreenSpot[] = ['angle', 'marks', 'figure'];
const STEP_MS = 4200;

export function Product({ story }: { story: PatientStory | null }) {
  const { t } = useI18n();
  const [stage, inView] = useInView<HTMLDivElement>();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(() => !prefersReducedMotion());
  const [hold, setHold] = useState(false);
  const running = auto && inView && !hold;

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => setActive((i) => (i + 1) % TOUR.length), STEP_MS);
    return () => window.clearTimeout(id);
  }, [running, active]);

  return (
    <section id="lp-product" className="lp-product lp-white" data-nav="white" aria-labelledby="lp-product-title">
      <div className="lp-wrap lp-center">
        <p className="lp-label" data-reveal>
          {t('landing.product.label')}
        </p>
        <h2 id="lp-product-title" className="lp-d2" data-reveal>
          {t('landing.product.title')}
        </h2>
        <p className="lp-lead lp-product__lead" data-reveal>
          {t('landing.product.text')}
        </p>
      </div>

      <div ref={stage} className="lp-stage" data-progress="1 0.22" data-progress-edge="top" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
        <div className="lp-tab">
          <ProductScreen
            active={inView}
            spot={TOUR[active]}
            previous={story?.last ?? null}
            goal={story?.goal?.target ?? null}
            name={story?.code ?? t('seedNames.P01')}
            other={story?.pairNow?.other ?? null}
          />
        </div>
      </div>

      <div className="lp-wrap">
        <div className="lp-tour" onFocus={() => setHold(true)} onBlur={() => setHold(false)} onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
          {TOUR.map((k, i) => (
            <button
              key={k}
              type="button"
              className="lp-tour__item"
              aria-pressed={i === active}
              data-running={running && i === active ? '' : undefined}
              style={{ '--step': `${STEP_MS}ms` } as CSSProperties}
              onClick={() => {
                setAuto(false);
                setActive(i);
              }}
            >
              {/* Полоса заполняется, пока пункт показан; новый ключ — новая анимация */}
              <span className="lp-tour__bar" aria-hidden>
                <i key={`${active}-${running}`} />
              </span>
              <b>{t(`landing.product.tour.${k}.title`)}</b>
              <span>{t(`landing.product.tour.${k}.text`)}</span>
            </button>
          ))}
        </div>
        <p className="lp-product__note">{t('landing.product.caption')}</p>
      </div>
    </section>
  );
}
