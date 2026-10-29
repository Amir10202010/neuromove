import { Building2, ChevronsUpDown, FlaskConical } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { navigate } from '../website/router';
import type { Workspace } from '../data/models';
import { useI18n } from '../i18n';
import { initials } from '../lib/initials';
import { useAppStore } from '../state/appStore';


/**
 * Кто работает и в каком пространстве — одна строка внизу боковой панели: демо ↔ клиника.
 * Как «тестовый режим» в платёжных системах: переключается в меню по нажатию.
 */
export function WorkspaceSwitch({ name }: { name: string }) {
  const { t } = useI18n();
  const ws = useAppStore((s) => s.settings.workspace);
  const profile = useAppStore((s) => s.profile);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const toast = useAppStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, above: false });

  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    // Кнопка внизу панели — меню открывается над ней; в меню телефона кнопка сверху — под ней
    if (r) {
      const above = r.top > window.innerHeight / 2;
      setPos({ top: above ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 292)), above });
    }
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const choose = (w: Workspace) => {
    setOpen(false);
    if (w === ws) return;
    if (w === 'clinic' && !profile) {
      navigate({ name: 'onboarding' });
      return;
    }
    setWorkspace(w);
    toast('info', w === 'demo' ? t('workspace.switchedDemo') : t('workspace.switchedClinic'));
    navigate({ name: 'overview' });
  };

  return (
    <>
      <button ref={btn} type="button" className="ws-switch" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={t('workspace.switchTitle')}>
        <span className="ws-switch__avatar" aria-hidden>
          {initials(name)}
        </span>
        <span className="ws-switch__text">
          <span className="ws-switch__name">{name}</span>
          {/* В демо пространство не подписываем: об этом говорит тёмная полоса сверху */}
          {ws === 'clinic' && (
            <span className="ws-switch__value">
              <Building2 aria-hidden />
              {t('workspace.clinic')}
            </span>
          )}
        </span>
        <ChevronsUpDown className="ws-switch__chevron" aria-hidden />
      </button>
      {open && (
        <div ref={menu} className="ws-menu" role="menu" style={{ position: 'fixed', top: pos.top, left: pos.left, transform: pos.above ? 'translateY(-100%)' : undefined }}>
          <div className="ws-menu__title">{t('workspace.switchTitle')}</div>
          {(['demo', 'clinic'] as Workspace[]).map((w) => (
            <button key={w} type="button" role="menuitemradio" aria-checked={ws === w} className="ws-menu__item" onClick={() => choose(w)}>
              {w === 'demo' ? <FlaskConical size={18} color="var(--demo)" aria-hidden /> : <Building2 size={18} color="var(--text-2)" aria-hidden />}
              <span>
                <strong style={{ display: 'block', fontSize: 'var(--fs-sm)' }}>{w === 'demo' ? t('workspace.demo') : t('workspace.clinic')}</strong>
                <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                  {w === 'demo' ? t('workspace.demoHint') : t('workspace.clinicHint')}
                </span>
              </span>
            </button>
          ))}
          <div className="ws-menu__note">{t('workspace.separated')}</div>
        </div>
      )}
    </>
  );
}
