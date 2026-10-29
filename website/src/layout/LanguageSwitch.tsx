import type { Locale } from '../data/models';
import { useI18n } from '../i18n';
import { useAppStore } from '../state/appStore';

const LOCALES: { id: Locale; short: string }[] = [
  { id: 'ru', short: 'RU' },
  { id: 'kk', short: 'KZ' },
  { id: 'en', short: 'EN' },
];

export function LanguageSwitch({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const setLocale = useAppStore((s) => s.setLocale);
  return (
    <div className={`lang-switch ${className ?? ''}`} role="group" aria-label={t('settings.language')}>
      {LOCALES.map((l) => (
        <button key={l.id} type="button" aria-pressed={locale === l.id} onClick={() => setLocale(l.id)} title={t(`lang.${l.id}`)} lang={l.id}>
          {l.short}
        </button>
      ))}
    </div>
  );
}
