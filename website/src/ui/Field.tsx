import { useId, type ReactElement, type ReactNode, cloneElement } from 'react';

/** Поле формы: подпись, подсказка и ошибка связаны с полем для экранных дикторов. */
export function Field({ label, hint, error, children, optional }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactElement<Record<string, unknown>>; optional?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const described = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {optional && <span className="muted" style={{ fontWeight: 400 }}> · {optional}</span>}
      </label>
      {cloneElement(children, { id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <div className="field__hint" id={hintId}>
          {hint}
        </div>
      )}
      {error && (
        <div className="field__error" id={errId} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
