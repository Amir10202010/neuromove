import { lazy, Suspense, useEffect, useRef } from 'react';
import { WelcomePage } from '../features/welcome/WelcomePage';
import { useI18n, type TFunction } from '../i18n';
import { useAppStore } from '../state/appStore';
import { Button } from '../ui/Button';
import { LogoMark } from '../ui/Logo';
import { CalibrationFigure } from '../figures/CalibrationFigure';
import { Toasts } from '../ui/Toasts';
import { ErrorBoundary } from './ErrorBoundary';
import { useRoute, type Route } from './router';

// Экраны приложения — отдельным куском сборки (Workspace.tsx). Стартовой странице они не нужны:
// без них её скрипт меньше, и фото первого экрана показывается раньше. Кусок подгружается заранее,
// в свободное время после отрисовки страницы, — «Попробовать демо» открывается без задержки.
// В демо одним файлом всё и так внутри страницы.
const loadWorkspace = () => import('./Workspace');
const Workspace = lazy(loadWorkspace);

// Лаборатория рисунков: все фигуры во всех состояниях рядом — для работы над ними.
// Только в режиме разработки: в сборке import.meta.env.DEV — false, и модуль не попадает в код.
const LabPage = import.meta.env.DEV ? lazy(() => import('../features/lab/LabPage')) : null;

/**
 * Заголовок вкладки по экрану (WCAG 2.4.2): по нему ориентируются экранный диктор, история браузера
 * и вкладки. Пациент — только по коду, как на экране.
 */
function routeTitle(route: Route, t: TFunction, codeOf: (id: string) => string | undefined): string {
  const page = (() => {
    switch (route.name) {
      case 'welcome':
        return null;
      case 'onboarding':
        return t('onboarding.title');
      case 'overview':
        return t('nav.overview');
      case 'patients':
        return t('nav.patients');
      case 'patient':
        return codeOf(route.id) ?? t('nav.patients');
      case 'family':
        return [t('profile.familyReport'), codeOf(route.id)].filter(Boolean).join(' · ');
      case 'sessionNew':
        return t('setup.title');
      case 'sessionRun':
        return t('guide.steps.test.title');
      case 'sessions':
        return t('nav.sessions');
      case 'session':
        return t('nav.sessions');
      case 'sessionPrint':
        return t('report.printTitle');
      case 'analytics':
        return t('nav.analytics');
      case 'devices':
        return t('nav.devices');
      case 'settings':
        return t('nav.settings');
      case 'lab':
        return 'Lab';
      case 'notFound':
        return t('errors.notFoundTitle');
    }
  })();
  // Стартовая страница — главная мысль строчными, как в index.html: «NeuroMove — каждый градус на счету»
  return page ? `${page} · NeuroMove` : `NeuroMove · ${t('landing.hero.title').replace(/\.$/, '').toLowerCase()}`;
}

/** Загрузка приложения. Первый раз — ещё и подготовка демо: симуляция сеансов. */
function Boot() {
  const { t } = useI18n();
  const status = useAppStore((s) => s.status);
  const init = useAppStore((s) => s.init);
  const p = useAppStore((s) => s.seedProgress);
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot__card">
        {status !== 'seeding' && <LogoMark size={44} />}
        {status === 'error' ? (
          <>
            <h1 style={{ fontSize: 20 }}>{t('errors.bootTitle')}</h1>
            <p className="secondary">{t('errors.bootText')}</p>
            <Button variant="primary" onClick={() => void init()}>
              {t('common.retry')}
            </Button>
          </>
        ) : status === 'seeding' ? (
          <>
            {/* Демо готовится: риски шкалы заполняются по мере того, как симулируются сеансы */}
            <CalibrationFigure progress={p.total ? p.done / p.total : 0} moved={false} size={168} />
            <h1 style={{ fontSize: 20 }}>{t('demoBanner.preparing')}</h1>
            <p className="secondary">{t('demoBanner.preparingText', { count: p.total })}</p>
            <span className="muted num" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done}>
              {p.done} / {p.total}
            </span>
          </>
        ) : (
          <span className="muted">{t('common.loading')}</span>
        )}
      </div>
    </div>
  );
}

export function App() {
  const status = useAppStore((s) => s.status);
  const init = useAppStore((s) => s.init);
  const locale = useAppStore((s) => s.settings.locale);
  const patients = useAppStore((s) => s.patients);
  const route = useRoute();
  const { t } = useI18n();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    document.title = routeTitle(route, t, (id) => patients.find((p) => p.id === id)?.code);
  }, [route, t, patients]);

  // Стартовая страница отрисована — подгрузить экраны приложения в свободное время
  useEffect(() => {
    if (route.name !== 'welcome') return;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    const id = idle(() => void loadWorkspace());
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(id);
  }, [route.name]);

  // Новый экран — с начала страницы, фокус клавиатуры — в его содержимое (адрес не меняется).
  // При первом открытии фокус не трогаем: первый Tab ведёт к «к содержимому». Экраны приложения
  // загружаются лениво (Workspace.tsx), поэтому <main> ждём несколько кадров, а не один
  const firstRoute = useRef(true);
  useEffect(() => {
    window.scrollTo(0, 0);
    const first = firstRoute.current;
    firstRoute.current = false;
    if (route.name === 'welcome' || first) return;
    let frames = 0;
    let id = 0;
    const focusMain = () => {
      // Окно поверх экрана (вступление демо, «Сеанс был прерван») держит фокус у себя. Раньше фокус
      // уходил из окна на экран под ним, и Tab гулял по странице за окном (найдено 18 октября)
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const main = document.querySelector<HTMLElement>('main');
      if (main) main.focus({ preventScroll: true });
      else if (++frames < 120) id = requestAnimationFrame(focusMain);
    };
    id = requestAnimationFrame(focusMain);
    return () => cancelAnimationFrame(id);
  }, [route.name]);

  // Стартовая страница не ждёт данных: цифры демо-пациента появятся, когда демо будет готово
  if (route.name === 'welcome') {
    return (
      <ErrorBoundary resetKey="welcome">
        <WelcomePage />
        <Toasts />
      </ErrorBoundary>
    );
  }

  if (route.name === 'lab' && LabPage) {
    return (
      <Suspense fallback={null}>
        <LabPage />
      </Suspense>
    );
  }

  if (status !== 'ready') return <Boot />;

  return (
    <ErrorBoundary resetKey={route.name}>
      <Suspense fallback={<Boot />}>
        <Workspace route={route} />
      </Suspense>
      <Toasts />
    </ErrorBoundary>
  );
}
