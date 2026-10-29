import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useI18n } from '../i18n';

const ICONS = { good: CircleCheck, info: Info, warn: TriangleAlert, critical: CircleAlert };

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  const { t } = useI18n();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => {
        const Icon = ICONS[x.kind];
        return (
          <div key={x.id} className={`toast toast--${x.kind}`}>
            <Icon aria-hidden />
            <div className="toast__body">
              <div className="toast__title">{x.title}</div>
              {x.desc && <div className="toast__desc">{x.desc}</div>}
            </div>
            <button className="toast__close" onClick={() => dismiss(x.id)} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
