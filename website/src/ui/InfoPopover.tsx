import { CircleHelp } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Кнопка «?» рядом с метрикой: как посчитано. Врач первым делом спросит формулу —
 * она всегда в одном нажатии.
 */
export function InfoPopover({ title, children, formula, label }: { title: string; children: ReactNode; formula?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left - w / 2 + r.width / 2, window.innerWidth - w - 12));
    const below = r.bottom + 8;
    const h = pop.current?.offsetHeight ?? 160;
    const top = below + h > window.innerHeight - 12 ? Math.max(12, r.top - h - 8) : below;
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', () => setOpen(false), { once: true, capture: true });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="info-btn"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label ?? title}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleHelp aria-hidden />
      </button>
      {open &&
        createPortal(
          <div ref={pop} id={id} role="dialog" aria-label={title} className="popover" style={{ top: pos.top, left: pos.left }}>
            <div className="popover__title">{title}</div>
            <div>{children}</div>
            {formula && <div className="popover__formula">{formula}</div>}
          </div>,
          document.body,
        )}
    </>
  );
}
