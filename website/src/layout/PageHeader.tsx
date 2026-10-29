import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  lead,
  back,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  lead?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div style={{ minWidth: 0 }}>
        {back && (
          <nav className="page-header__crumbs" aria-label="breadcrumb">
            <ChevronLeft size={15} aria-hidden />
            <a href={back.href}>{back.label}</a>
          </nav>
        )}
        {eyebrow}
        <h1 className="page-header__title">{title}</h1>
        {lead && <p className="page-header__lead">{lead}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
