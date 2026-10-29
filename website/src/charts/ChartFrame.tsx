import { ChartLine, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';

export interface LegendItem {
  label: ReactNode;
  color: string;
  kind?: 'line' | 'dashed' | 'dot' | 'bar';
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend">
      {items.map((it, i) => (
        <span key={i} className="legend__item">
          <span className={`legend__key legend__key--${it.kind ?? 'line'}`} style={{ background: it.kind === 'dashed' ? undefined : it.color, borderColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Карточка графика: заголовок, легенда, переключатель «график / таблица».
 * Таблица — равноценная замена графику: значения читаются без наведения и без цвета.
 */
export function ChartFrame({
  title,
  subtitle,
  legend,
  actions,
  table,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  actions?: ReactNode;
  table?: () => ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card chart-card ${className ?? ''}`}>
      <div className="card__header chart-card__header">
        <div>
          <h3 className="card__title">{title}</h3>
          {subtitle && <div className="card__subtitle">{subtitle}</div>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {actions}
          {table && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setAsTable((v) => !v)}
              aria-pressed={asTable}
              title={asTable ? t('common.showChart') : t('common.showTable')}
            >
              {asTable ? <ChartLine aria-hidden /> : <Table2 aria-hidden />}
              <span className="hide-sm">{asTable ? t('common.showChart') : t('common.showTable')}</span>
            </button>
          )}
        </div>
      </div>
      <div className="card__body">
        {legend && legend.length > 1 && !asTable && <Legend items={legend} />}
        {asTable && table ? <div className="table-wrap">{table()}</div> : children}
      </div>
    </section>
  );
}
