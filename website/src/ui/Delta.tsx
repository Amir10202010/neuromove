import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useI18n } from '../i18n';

/**
 * Изменение со стрелкой. Цвет — не главный носитель смысла: знак и стрелка есть всегда.
 * better: 'up' — рост хорош (объём), 'down' — снижение хорошо (наклон туловища).
 */
export function Delta({
  value,
  unit = '°',
  better = 'up',
  threshold = 1,
  digits = 0,
  suffix,
}: {
  value: number | null | undefined;
  unit?: '°' | '%' | 'pp' | '';
  better?: 'up' | 'down' | 'none';
  threshold?: number;
  digits?: number;
  suffix?: string;
}) {
  const { f, t } = useI18n();
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="delta delta--flat">–</span>;
  const flat = Math.abs(value) < threshold;
  const good = better === 'none' ? null : better === 'up' ? value > 0 : value < 0;
  const cls = flat || good === null ? 'delta--flat' : good ? 'delta--up' : 'delta--down';
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const n = f.num(Math.abs(value), digits);
  const sign = flat ? '±' : value > 0 ? '+' : '−';
  return (
    <span className={`delta ${cls}`}>
      <Icon aria-hidden />
      {sign}
      {n}
      {unit === 'pp' ? ` ${t('common.pp')}` : unit}
      {suffix && <span className="muted" style={{ fontWeight: 400, marginLeft: 4 }}>{suffix}</span>}
    </span>
  );
}
