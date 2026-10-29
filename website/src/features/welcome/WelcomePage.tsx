// Стартовая страница NeuroMove — история в семи сценах:
// первый экран → проблема → датчики → как это работает (разборная модель датчика) → тест вживую →
// семьям (отчёт) → финал. Сквозная история — первый ребёнок демо (Алихан), и все его цифры —
// из данных приложения (story.ts), а не вписаны руками.
//
// 19 октября секции «Специалистам» (хронофотография движений) и «Проверка» (карточки проверки
// и данных) убраны по просьбе Амирхана: на их место — видео (сценарий — video/README.md).
// Код секций — в коммите ed6f200.
//
// Каркас — страница 27 сентября; фото руки и датчика, знак и подвал — версия 28 сентября.
// 17 октября: «Честно» разделено на «Проверку» и «Данные». 18 октября по просьбе Амирхана вернулась
// сцена «Как это работает» с разборной моделью датчика (прибор «Из сигнала в градусы» снят, он
// в коммите a15749b), тёмные секции — чисто чёрные, типографика — по замерам neuralink.com.
// Вечером 18 октября страница сокращена с одиннадцати сцен до девяти, рисунки и инфографика
// переделаны (Амирхан: «картинки и анимации ужасно выглядят»).
// Поздно вечером 18 октября светлые секции стали чисто белыми вместо тёплой «бумаги» (просьба Амирхана).
// Разбор — log/2026-10-18-neuromove-как-у-neuralink.md.

import { useEffect, useRef, type RefObject } from 'react';
import { useI18n } from '../../i18n';
import { LanguageSwitch } from '../../layout/LanguageSwitch';
import { LogoMark } from '../../ui/Logo';
import { DemoButton, SignInLink, scrollToId, useLandingActions, type LandingActions } from './actions';
import { prefersReducedMotion, useLandingScroll } from './motion';
import { Families } from './sections/Families';
import { FinalCta } from './sections/FinalCta';
import { Hero } from './sections/Hero';
import { HowItWorks } from './sections/HowItWorks';
import { Kit } from './sections/Kit';
import { Problem } from './sections/Problem';
import { Product } from './sections/Product';
import { usePatientStory } from './story';

/** Строка браузера на телефоне — белая, как шапка над первым экраном. */
const WHITE = '#ffffff';

export function WelcomePage() {
  const page = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const actions = useLandingActions();
  const story = usePatientStory();
  useLandingScroll(page, bar);

  // Строка браузера на телефоне — в цвет шапки страницы. Заголовок вкладки ставит App (routeTitle)
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const was = meta?.content;
    meta?.setAttribute('content', WHITE);
    return () => {
      if (meta && was) meta.content = was;
    };
  }, []);

  return (
    <div ref={page} className="lp">
      <LandingNav bar={bar} actions={actions} />
      <main id="main" tabIndex={-1}>
        {/* Первый экран закреплён внутри обёртки: «Проблема» наезжает на него, --p — насколько */}
        <div className="lp-hero-wrap" data-progress="0 -1" data-progress-edge="top">
          <Hero actions={actions} />
          <Problem story={story} />
        </div>
        <Kit />
        <HowItWorks story={story} />
        <Product story={story} />
        <Families story={story} />
        {/* Здесь будет видео — вместо «Специалистам» и «Проверки» (video/README.md) */}
        <FinalCta actions={actions} story={story} />
      </main>
      <LandingFooter actions={actions} />
    </div>
  );
}

function LandingNav({ bar, actions }: { bar: RefObject<HTMLElement | null>; actions: LandingActions }) {
  const { t } = useI18n();
  return (
    <header ref={bar} className="lp-nav" data-theme="white">
      <button
        type="button"
        className="skip-link"
        onClick={() => {
          document.getElementById('main')?.focus();
        }}
      >
        {t('nav.skip')}
      </button>
      <button
        type="button"
        className="lp-nav__brand"
        aria-label="NeuroMove"
        onClick={() => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })}
      >
        <LogoMark size={34} />
        <span>NeuroMove</span>
      </button>
      {/* Как у neuralink.com: знак слева, разделы и кнопка — справа */}
      <span className="lp-nav__spacer" />
      <nav className="lp-nav__links" aria-label={t('landing.nav.label')}>
        <button type="button" onClick={() => scrollToId('lp-kit')}>
          {t('landing.kit.label')}
        </button>
        <button type="button" onClick={() => scrollToId('lp-how')}>
          {t('landing.nav.how')}
        </button>
        <button type="button" onClick={() => scrollToId('lp-product')}>
          {t('landing.product.label')}
        </button>
        <button type="button" onClick={() => scrollToId('lp-families')}>
          {t('landing.nav.families')}
        </button>
      </nav>
      <LanguageSwitch className="lp-lang" />
      <SignInLink actions={actions} short className="lp-nav__signin" />
      <DemoButton actions={actions} label={t('landing.nav.demo')} small />
    </header>
  );
}

/** Подвал — как в версии от 27 сентября: большая фраза и знак; ниже — оговорки и язык. */
function LandingFooter({ actions }: { actions: LandingActions }) {
  const { t } = useI18n();
  return (
    <footer className="lp-footer lp-white" data-nav="white">
      <div className="lp-wrap">
        <div className="lp-footer__top">
          <div className="lp-footer__brand">
            <span className="lp-footer__logo">
              <LogoMark size={36} />
              <span>NeuroMove</span>
            </span>
            <p>{t('landing.footer.tagline')}</p>
          </div>
          <div className="lp-footer__cols">
            <div>
              <p className="lp-footer__head">{t('landing.footer.colPage')}</p>
              <button type="button" onClick={() => scrollToId('lp-kit')}>
                {t('landing.kit.label')}
              </button>
              <button type="button" onClick={() => scrollToId('lp-how')}>
                {t('landing.nav.how')}
              </button>
              <button type="button" onClick={() => scrollToId('lp-product')}>
                {t('landing.product.label')}
              </button>
              <button type="button" onClick={() => scrollToId('lp-families')}>
                {t('landing.nav.families')}
              </button>
            </div>
            <div>
              <p className="lp-footer__head">{t('landing.footer.colApp')}</p>
              <button type="button" onClick={actions.startDemo}>
                {t('landing.hero.cta')}
              </button>
              <button type="button" onClick={actions.explore}>
                {t('landing.final.explore')}
              </button>
              <SignInLink actions={actions} short className="lp-footer__link" />
            </div>
          </div>
        </div>
        <div className="lp-footer__statement">
          <p>
            {t('landing.footer.statement1')}
            <br />
            <span>{t('landing.footer.statement2')}</span>
          </p>
          <LogoMark size={150} />
        </div>
        <div className="lp-footer__bottom">
          <span>
            © {new Date().getFullYear()} NeuroMove · {t('landing.footer.status')}
          </span>
          <p className="lp-footer__legal">
            {t('landing.footer.scales')} {t('app.disclaimer')} {t('landing.footer.demoNote')}
          </p>
          <LanguageSwitch className="lp-lang" />
        </div>
      </div>
    </footer>
  );
}
