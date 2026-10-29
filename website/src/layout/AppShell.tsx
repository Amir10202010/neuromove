// Каркас приложения: полоса «Демо» сверху, боковая панель на компьютере,
// верхняя и нижняя панели на телефоне. В меню — четыре главных раздела; «Датчики»
// и «Настройки» — ниже, отдельно: нужны не каждый день. Кто работает и в каком
// пространстве (демо или клиника) — одна строка внизу панели.

import { ChartNoAxesCombined, Cpu, History, House, Menu, MonitorPlay, Plus, RotateCcw, Settings, UsersRound, WifiOff } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { href, navigate, useRoute, type Route } from '../website/router';
import { DemoGuide } from '../features/demo/DemoGuide';
import { useI18n, type TKey } from '../i18n';
import { useAppStore, useWorkspaceData } from '../state/appStore';
import { useDeviceMonitor } from '../state/deviceMonitor';
import { useControllerState, useSessionStore } from '../state/sessionStore';
import { ConfirmDialog, Modal } from '../ui/Modal';
import { Logo, LogoMark } from '../ui/Logo';
import { LanguageSwitch } from './LanguageSwitch';
import { WorkspaceSwitch } from './WorkspaceSwitch';

interface NavDef {
  route: Route;
  match: Route['name'][];
  label: TKey;
  icon: ReactNode;
}

const NAV_MAIN: NavDef[] = [
  { route: { name: 'overview' }, match: ['overview'], label: 'nav.overview', icon: <House aria-hidden /> },
  { route: { name: 'patients' }, match: ['patients', 'patient', 'family'], label: 'nav.patients', icon: <UsersRound aria-hidden /> },
  { route: { name: 'sessions' }, match: ['sessions', 'session', 'sessionPrint'], label: 'nav.sessions', icon: <History aria-hidden /> },
  { route: { name: 'analytics' }, match: ['analytics'], label: 'nav.analytics', icon: <ChartNoAxesCombined aria-hidden /> },
];
const NAV_MORE: NavDef[] = [
  { route: { name: 'devices' }, match: ['devices'], label: 'nav.devices', icon: <Cpu aria-hidden /> },
  { route: { name: 'settings' }, match: ['settings'], label: 'nav.settings', icon: <Settings aria-hidden /> },
];

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Кто работает: в демо — роль («Врач-реабилитолог»), в клинике — профиль. */
function useWho() {
  const { t } = useI18n();
  const profile = useAppStore((s) => s.profile);
  const ws = useAppStore((s) => s.settings.workspace);
  return ws === 'demo' ? t('workspace.demoClinician') : profile?.name ?? '';
}

/** Полоса «Демо»: видна на каждом экране демо — данные вымышлены, это симуляция. */
export function DemoBanner() {
  const { t } = useI18n();
  const resetDemo = useAppStore((s) => s.resetDemo);
  const startGuide = useAppStore((s) => s.startGuide);
  const toast = useAppStore((s) => s.toast);
  const guideActive = useAppStore((s) => s.guide.active);
  const clearSession = useSessionStore((s) => s.clear);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="demo-banner" role="note">
      <span className="demo-banner__tag">
        <span className="demo-banner__dot" aria-hidden />
        {t('common.demo')}
      </span>
      <span className="demo-banner__text">{t('demoBanner.textLong')}</span>
      {!guideActive && (
        <button type="button" onClick={() => startGuide()}>
          <MonitorPlay aria-hidden />
          {t('demoBanner.guide')}
        </button>
      )}
      <button type="button" onClick={() => setConfirm(true)}>
        <RotateCcw aria-hidden />
        {t('demoBanner.reset')}
      </button>
      <ConfirmDialog
        open={confirm}
        title={t('demoBanner.resetConfirmTitle')}
        text={t('demoBanner.resetConfirmText')}
        confirmLabel={t('demoBanner.reset')}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          await clearSession();
          await resetDemo();
          toast('good', t('demoBanner.resetDone'));
          navigate({ name: 'overview' });
        }}
      />
    </div>
  );
}

function DeviceMini() {
  const { t } = useI18n();
  const ws = useAppStore((s) => s.settings.workspace);
  const controller = useSessionStore((s) => s.controller);
  const st = useControllerState(controller);
  const monitor = useDeviceMonitor((s) => s.status);
  const device = st?.device ?? monitor;
  const phase = device?.phase ?? 'idle';
  const online = device?.sensors.filter((s) => s.online).length ?? 0;
  const total = device?.sensors.length ?? 0;
  const dot = phase === 'streaming' ? 'dot--good dot--pulse' : phase === 'reconnecting' ? 'dot--warn' : phase === 'error' ? 'dot--critical' : '';
  return (
    <a className="device-mini" href={controller ? href({ name: 'sessionRun' }) : href({ name: 'devices' })} title={t(`device.phase.${phase}`)}>
      <span className={`dot ${dot}`} aria-hidden />
      <span className="device-mini__text">
        {/* В демо — просто «Комплект NeuroMove»: что датчики смоделированы, говорит полоса сверху */}
        <span className="device-mini__name">{ws === 'demo' ? t('device.kit') : device?.info?.name ?? t('device.kit')}</span>
        <span className="device-mini__sub">{phase === 'streaming' ? t('device.sensorsOnline', { online, total }) : t(`device.phase.${phase}`)}</span>
      </span>
    </a>
  );
}

function NavItem({ n, current, count }: { n: NavDef; current: boolean; count?: number }) {
  const { t } = useI18n();
  return (
    <a className="nav__item" href={href(n.route)} aria-current={current ? 'page' : undefined} title={t(n.label)}>
      {n.icon}
      <span className="nav__label">{t(n.label)}</span>
      {count !== undefined && count > 0 && <span className="nav__count">{count}</span>}
    </a>
  );
}

function Sidebar({ alertCount }: { alertCount: number }) {
  const { t } = useI18n();
  const route = useRoute();
  const who = useWho();
  const testing = route.name === 'sessionNew' || route.name === 'sessionRun';
  return (
    <aside className="sidebar" aria-label={t('nav.menu')}>
      <a className="sidebar__logo" href={href({ name: 'welcome' })} title={t('nav.exitToStart')}>
        <Logo subtitle={t('app.prototype')} />
      </a>
      <a className="btn btn--primary btn--new" href={href({ name: 'sessionNew', patientId: null })} aria-current={testing ? 'page' : undefined} style={{ textDecoration: 'none' }}>
        <Plus aria-hidden />
        <span className="btn__label">{t('nav.newSession')}</span>
      </a>
      <nav className="nav" aria-label={t('nav.menu')}>
        {NAV_MAIN.map((n) => (
          <NavItem key={n.label} n={n} current={n.match.includes(route.name)} count={n.route.name === 'overview' ? alertCount : undefined} />
        ))}
        <span className="nav__sep" aria-hidden />
        {NAV_MORE.map((n) => (
          <NavItem key={n.label} n={n} current={n.match.includes(route.name)} />
        ))}
      </nav>
      <div className="sidebar__footer">
        <DeviceMini />
        <WorkspaceSwitch name={who} />
        <LanguageSwitch />
      </div>
    </aside>
  );
}

function MobileNav() {
  const { t } = useI18n();
  const route = useRoute();
  const who = useWho();
  const [more, setMore] = useState(false);
  // Сменился экран — закрываем меню (подстройка состояния во время отрисовки, без эффекта)
  const [lastRoute, setLastRoute] = useState(route);
  if (route !== lastRoute) {
    setLastRoute(route);
    setMore(false);
  }
  const [home, patients, sessions] = NAV_MAIN as [NavDef, NavDef, NavDef, NavDef];
  return (
    <>
      <header className="topbar">
        <a href={href({ name: 'overview' })} aria-label="NeuroMove">
          <LogoMark size={26} />
        </a>
        <strong className="topbar__name">NeuroMove</strong>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost btn--icon" aria-label={t('nav.menu')} onClick={() => setMore(true)}>
          <Menu aria-hidden />
        </button>
      </header>
      <nav className="bottom-nav" aria-label={t('nav.menu')}>
        {[home, patients].map((n) => (
          <a key={n.label} href={href(n.route)} aria-current={n.match.includes(route.name) ? 'page' : undefined}>
            {n.icon}
            {t(n.label)}
          </a>
        ))}
        <a className="bottom-nav__primary" href={href({ name: 'sessionNew', patientId: null })} aria-current={route.name === 'sessionNew' || route.name === 'sessionRun' ? 'page' : undefined} aria-label={t('nav.newSession')}>
          <Plus aria-hidden />
          {t('nav.sessionShort')}
        </a>
        <a href={href(sessions.route)} aria-current={sessions.match.includes(route.name) ? 'page' : undefined}>
          {sessions.icon}
          {t(sessions.label)}
        </a>
        <button type="button" onClick={() => setMore(true)} aria-expanded={more}>
          <Menu aria-hidden />
          {t('common.more')}
        </button>
      </nav>
      {more && (
        <Modal open={more} onClose={() => setMore(false)} title={t('nav.menu')}>
          <div style={{ padding: '0 4px 10px' }}>
            <WorkspaceSwitch name={who} />
          </div>
          <nav className="nav">
            {NAV_MAIN.concat(NAV_MORE).map((n) => (
              <NavItem key={n.label} n={n} current={n.match.includes(route.name)} />
            ))}
            <a className="nav__item" href={href({ name: 'welcome' })}>
              <LogoMark size={18} />
              <span className="nav__label">{t('nav.exitToStart')}</span>
            </a>
          </nav>
          <div style={{ padding: '12px 4px 0' }}>
            <LanguageSwitch />
          </div>
        </Modal>
      )}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const ws = useAppStore((s) => s.settings.workspace);
  const storageKind = useAppStore((s) => s.storageKind);
  const { alerts } = useWorkspaceData();
  const online = useOnline();
  const alertCount = alerts.filter((a) => !a.acknowledged).length;
  return (
    <div className={`app${ws === 'demo' ? ' app--demo' : ''}`}>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        {t('nav.skip')}
      </a>
      {ws === 'demo' && <DemoBanner />}
      <MobileNav />
      <div className="app__body">
        <Sidebar alertCount={alertCount} />
        <main id="main" className="app__main" tabIndex={-1}>
          {(storageKind === 'memory' || !online) && (
            <div className="page" style={{ marginBottom: 16 }}>
              {storageKind === 'memory' && (
                <div className="callout callout--warn" role="status">
                  <WifiOff aria-hidden />
                  <span>{t('errors.storage')}</span>
                </div>
              )}
              {!online && (
                <div className="callout callout--info" role="status">
                  <WifiOff aria-hidden />
                  <span>{t('errors.offline')}</span>
                </div>
              )}
            </div>
          )}
          {/* Гид — над экраном, в потоке страницы: не закрывает то, о чём рассказывает */}
          {ws === 'demo' && <DemoGuide />}
          {children}
        </main>
      </div>
    </div>
  );
}
