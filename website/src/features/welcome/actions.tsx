// Действия стартовой страницы:
//  • «Попробовать демо» — демо для клиники с гидом: сброс демо, пациент P01, гид из 7 шагов;
//  • «Открыть платформу» — демо-пространство без гида;
//  • «Войти» — пространство клиники (без профиля — сначала знакомство, onboarding).

import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { href, navigate } from '../../website/router';
import { useI18n } from '../../i18n';
import { useAppStore } from '../../state/appStore';
import { startClinicDemo } from '../demo/clinicDemo';
import { prefersReducedMotion } from './motion';

export interface LandingActions {
  /** Демо готовится: кнопки показывают загрузку и не нажимаются второй раз. */
  starting: boolean;
  profileName: string | null;
  startDemo(): void;
  explore(): void;
  signIn(): void;
}

/**
 * Стартовая страница открывается, не дожидаясь данных, — а переходы в приложение ждут их:
 * в первый раз демо ещё симулируется, а выбор пространства до загрузки настроек потерялся бы.
 */
function whenReady(): Promise<void> {
  return useAppStore.getState().init();
}

export function useLandingActions(): LandingActions {
  const profile = useAppStore((s) => s.profile);
  const [starting, setStarting] = useState(false);
  return {
    starting,
    profileName: profile?.name ?? null,
    startDemo() {
      if (starting) return;
      setStarting(true);
      // Если подготовка упала — кнопка снова доступна, а не «грузится» вечно
      whenReady()
        .then(() => startClinicDemo())
        .catch(() => setStarting(false));
    },
    explore() {
      void whenReady().then(() => {
        useAppStore.getState().setWorkspace('demo');
        navigate({ name: 'overview' });
      });
    },
    signIn() {
      void whenReady().then(() => {
        const app = useAppStore.getState();
        if (!app.profile) {
          navigate({ name: 'onboarding' });
          return;
        }
        app.setWorkspace('clinic');
        navigate({ name: 'overview' });
      });
    },
  };
}

/** Главная кнопка страницы — демо для клиники. */
export function DemoButton({ actions, label, small }: { actions: LandingActions; label: string; small?: boolean }) {
  return (
    <button type="button" className={`lp-btn${small ? ' lp-btn--sm' : ''}`} onClick={actions.startDemo} disabled={actions.starting} aria-busy={actions.starting || undefined}>
      {actions.starting && <LoaderCircle className="spinner" aria-hidden />}
      {label}
      {!small && <ArrowRight aria-hidden />}
    </button>
  );
}

/** Вход в пространство клиники: с профилем — «Продолжить как …». */
export function SignInLink({ actions, className, short }: { actions: LandingActions; className?: string; short?: boolean }) {
  const { t } = useI18n();
  const label = short ? t('landing.nav.signIn') : actions.profileName ? t('landing.final.continueAs', { name: actions.profileName }) : t('landing.final.signIn');
  return (
    <a
      className={className ?? 'lp-link'}
      href={href({ name: 'onboarding' })}
      onClick={(e) => {
        e.preventDefault();
        actions.signIn();
      }}
    >
      {label}
      {!short && <ArrowRight aria-hidden />}
    </a>
  );
}

/**
 * Прокрутка к секции страницы. Обычные якоря (#families) здесь нельзя: решётку в адресе
 * занимает маршрутизатор приложения (#/patients/…). Фокус — на заголовок секции,
 * чтобы экранный диктор и клавиатура продолжили с нужного места.
 */
export function scrollToId(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  el.querySelector<HTMLElement>('[tabindex="-1"]')?.focus({ preventScroll: true });
}
