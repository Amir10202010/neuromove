// 3. Датчики — сцена как «Witness your fitness» на странице Apple Watch: фото датчика закреплено
// на экране и раскрывается прокруткой из скруглённой карточки во весь экран, картинка при этом
// чуть отъезжает назад; на втором отрезке прокрутки поверх фото поднимается заголовок.
// Прогресс сцены --p (0…1) ставит motion.ts по data-progress; ниже сцены — фраза и три числа,
// они появляются, как текст у Apple. Сцена занимает экран и ещё ~1,3 экрана прокрутки —
// по замеру apple.com, сцены там длиной 1,1–1,5 экрана.
//
// Фото — концепт корпуса из версии страницы от 27 сентября; подпись на нём говорит прямо:
// прототип собирает команда, в демо датчики симулированы.

import sensorLarge from '../../../assets/sensor-concept-1536.webp';
import sensorSmall from '../../../assets/sensor-concept-768.webp';
import { useI18n } from '../../../i18n';
import { vars } from '../Words';

const FACTS = ['count', 'rate', 'time'] as const;

export function Kit() {
  const { t } = useI18n();
  return (
    <section id="lp-kit" className="lp-kit lp-white" data-nav="white" aria-labelledby="lp-kit-title">
      <div className="lp-kit__scene" data-progress="0 1">
        <div className="lp-kit__stage">
          <figure className="lp-kit__photo">
            <img src={sensorLarge} srcSet={`${sensorSmall} 768w, ${sensorLarge} 1536w`} sizes="100vw" width={1536} height={1024} alt={t('landing.kit.alt')} loading="lazy" decoding="async" />
            <figcaption>{t('landing.kit.caption')}</figcaption>
          </figure>
          <div className="lp-kit__title">
            <p className="lp-label">{t('landing.kit.label')}</p>
            <h2 id="lp-kit-title" className="lp-d1">
              {t('landing.kit.title')}
            </h2>
          </div>
        </div>
      </div>

      <div className="lp-wrap lp-kit__copy">
        <p className="lp-lead" data-reveal>
          {t('landing.kit.text')}
        </p>
        <dl className="lp-facts">
          {FACTS.map((k, i) => (
            <div key={k} data-reveal style={vars({ '--d': `${i * 120}ms` })}>
              <dt>{t(`landing.kit.facts.${k}.value`)}</dt>
              <dd>{t(`landing.kit.facts.${k}.text`)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
