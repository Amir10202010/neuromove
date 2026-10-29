import type { ReactNode } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  count?: number;
}

export function Tabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          className="tab"
          aria-selected={it.id === value}
          tabIndex={it.id === value ? 0 : -1}
          onClick={() => onChange(it.id)}
          onKeyDown={(e) => {
            const i = items.findIndex((x) => x.id === value);
            if (e.key === 'ArrowRight') onChange((items[(i + 1) % items.length] as TabItem<T>).id);
            if (e.key === 'ArrowLeft') onChange((items[(i - 1 + items.length) % items.length] as TabItem<T>).id);
          }}
        >
          {it.label}
          {it.count !== undefined && <span className="tab__count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}
