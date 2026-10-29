import type { ReactNode } from 'react';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/** Переключатель из нескольких вариантов. Стрелки ← → двигают выбор. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  block,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  block?: boolean;
}) {
  const move = (dir: number) => {
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      className={`segmented${block ? ' segmented--block' : ''}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
