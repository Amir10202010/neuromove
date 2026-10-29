// «Показать подробности» — граница между простым видом и подробным.
// Простой вид — главное словами; подробный — таблицы, графики, плавность, каждый повтор.
// Ничего не удалено: всё, что было на экране, — здесь, в один клик. Режим общий для
// карточки пациента и отчёта и запоминается в настройках: врач открывает его один раз.

import { ChevronDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { useAppStore } from '../../state/appStore';

export function Details({ hint, children }: { hint: string; children: ReactNode }) {
  const { t } = useI18n();
  const open = useAppStore((s) => s.settings.details);
  const setDetails = useAppStore((s) => s.setDetails);
  const id = useId();
  return (
    <>
      <button type="button" className={`details-toggle${open ? ' is-open' : ''}`} aria-expanded={open} aria-controls={id} onClick={() => setDetails(!open)}>
        <span className="details-toggle__text">
          <span className="details-toggle__label">{open ? t('details.hide') : t('details.show')}</span>
          {!open && <span className="details-toggle__hint">{hint}</span>}
        </span>
        <ChevronDown className="details-toggle__icon" aria-hidden />
      </button>
      {open && (
        <div id={id} className="stack details-body" style={{ gap: 16 }}>
          {children}
        </div>
      )}
    </>
  );
}
