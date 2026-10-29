import type { CSSProperties, ReactNode } from 'react';

/**
 * Пустое состояние: что здесь появится и что для этого сделать. art — рисунок из системы
 * рисунков (figures/EmptyArt) вместо иконки: пустой экран объясняет, а не просто молчит.
 */
export function EmptyState({ icon, art, title, text, action, compact }: { icon?: ReactNode; art?: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty${compact ? ' empty--compact' : ''}`}>
      {art ? <div className="empty__art">{art}</div> : icon && <div className="empty__icon">{icon}</div>}
      <div className="empty__title">{title}</div>
      {text && <div className="empty__text">{text}</div>}
      {action}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', style }: { height?: number | string; width?: number | string; style?: CSSProperties }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden />;
}
