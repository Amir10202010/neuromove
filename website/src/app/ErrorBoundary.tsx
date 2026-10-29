import { Component, type ErrorInfo, type ReactNode } from 'react';
import { makeT } from '../i18n';
import { useAppStore } from '../state/appStore';

interface State {
  error: Error | null;
}

/** Если экран упал — показываем понятное сообщение, а не белую страницу. Данные не теряются. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('NeuroMove: ошибка экрана', error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey?: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const t = makeT(useAppStore.getState().settings.locale);
    return (
      <div className="page page--narrow" style={{ paddingTop: 40 }}>
        <div className="card">
          <div className="card__body stack">
            <h1 style={{ fontSize: 22 }}>{t('errors.title')}</h1>
            <p className="secondary">{t('errors.text')}</p>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              {this.state.error.message}
            </pre>
            <div className="row">
              <button className="btn btn--primary" onClick={() => window.location.reload()}>
                {t('errors.reload')}
              </button>
              <a className="btn btn--secondary" href="#/overview" onClick={() => this.setState({ error: null })} style={{ textDecoration: 'none' }}>
                {t('errors.home')}
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
