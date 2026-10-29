// 1. Первый экран. Одна мысль крупно, одна кнопка и фото руки с датчиками — поверх него
// шкала угла на локте: то, что делает продукт, видно сразу. На компьютере экран закреплён:
// следующая секция наезжает на него, а сам он тихо гаснет (--p от обёртки в WelcomePage).
// Фото — концепт из версии страницы от 27 сентября; прежний рисунок-скелет убран.

import { useEffect, useState, type FocusEvent } from 'react';
import { useI18n } from '../../../i18n';
import { DemoButton, SignInLink, type LandingActions } from '../actions';
import { HeroPhoto } from '../HeroPhoto';

/**
 * Только если элемент с фокусом действительно закрыт — после того как браузер сам прокрутил к нему.
 * На телефоне экран не закреплён: браузер прокручивает вниз к кнопке, и трогать прокрутку нельзя.
 */
function revealOnFocus(e: FocusEvent<HTMLElement>) {
  const el = e.target;
  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top || top === el || el.contains(top) || top.contains(el)) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
}

export function Hero({ actions }: { actions: LandingActions }) {
  const { t } = useI18n();
  // Шкала на фото «доезжает» до угла чуть позже заголовка — когда глаз уже на странице
  const [run, setRun] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setRun(true), 700);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <section className="lp-hero lp-white" data-nav="white" aria-labelledby="lp-hero-title">
      <div className="lp-hero__media">
        <HeroPhoto
          run={run}
          labels={{
            alt: t('landing.hero.figure'),
            angle: t('landing.hero.angle'),
            upper: t('landing.hero.sensorUpper'),
            fore: t('landing.hero.sensorFore'),
            rate: t('landing.hero.rate'),
          }}
        />
      </div>

      {/* Экран закреплён, и следующая секция наезжает на него: браузер считает кнопки видимыми
          и не прокручивает к ним, а их уже закрыла секция «Сегодня». Фокус с клавиатуры на первом
          экране возвращает страницу наверх — кнопки снова видны (WCAG 2.2, 2.4.11) */}
      <div className="lp-hero__content" data-reveal onFocus={revealOnFocus}>
        <h1 id="lp-hero-title" className="lp-hero__title lp-d1">
          {t('landing.hero.title')}
        </h1>
        <p className="lp-hero__lead lp-lead">{t('landing.hero.lead')}</p>
        <div className="lp-hero__cta">
          <DemoButton actions={actions} label={t('landing.hero.cta')} />
          <SignInLink actions={actions} />
        </div>
        <p className="lp-hero__note">{t('landing.hero.note')}</p>
      </div>
    </section>
  );
}
