import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { Button } from './Button';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Нельзя закрыть щелчком мимо окна (например, идёт сохранение). */
  persistent?: boolean;
  /** Надзаголовок — моноширинная подпись раздела над заголовком. */
  eyebrow?: ReactNode;
  className?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Модальное окно: фокус внутри, Esc закрывает, фокус возвращается туда, откуда открыли. */
export function Modal({ open, onClose, title, description, children, footer, wide, persistent, eyebrow, className }: ModalProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const a = items[0] as HTMLElement;
        const b = items[items.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose, persistent]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !persistent) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal${wide ? ' modal--wide' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
      >
        <div className="modal__header">
          <div>
            {eyebrow && <div className="eyebrow modal__eyebrow">{eyebrow}</div>}
            <h2 className="modal__title" id={titleId}>
              {title}
            </h2>
            {description && (
              <p className="modal__desc" id={descId}>
                {description}
              </p>
            )}
          </div>
          {!persistent && <Button variant="ghost" size="sm" iconOnly onClick={onClose} aria-label={t('common.close')} icon={<X />} />}
        </div>
        {children && <div className="modal__body">{children}</div>}
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  text: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={text}
      footer={
        <>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant={danger ? 'danger-solid' : 'primary'} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
