import { useMemo, useState } from 'react';
import { href, navigate } from '../../website/router';
import type { ProtocolId } from '../../core/protocols';
import { useNow } from '../../hooks/useNow';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { useAppStore, useWorkspaceData } from '../../state/appStore';
import { focusSide, stepOf } from '../../session/compare';
import { EmptyState } from '../../ui/EmptyState';
import { EmptyArt } from '../../figures/EmptyArt';
import { LinkButton } from '../../ui/Button';
import { Segmented } from '../../ui/Segmented';
import { Details } from '../common/Details';

type Period = 7 | 30 | 90 | 0;

export function SessionsPage() {
  const { t, f } = useI18n();
  const { sessions, patients } = useWorkspaceData();
  // Простой вид: когда, кто и как поднялась рука. Протокол, длительность, полнота записи и статус —
  // в подробностях; неполный сеанс отмечен и в простом виде, у имени
  const details = useAppStore((s) => s.settings.details);
  const [period, setPeriod] = useState<Period>(30);
  const [protocol, setProtocol] = useState<ProtocolId | 'all'>('all');

  const now = useNow();
  const rows = useMemo(() => {
    return sessions
      .filter((s) => period === 0 || now - new Date(s.startedAt).getTime() <= period * 86400000)
      .filter((s) => !details || protocol === 'all' || s.protocolId === protocol)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [sessions, period, protocol, now, details]);

  return (
    <div className="page">
      <PageHeader title={t('sessions.title')} lead={t('common.sessionsCount', { count: sessions.length })} />
      {sessions.length === 0 ? (
        <div className="card">
          <EmptyState
            art={<EmptyArt kind="sessions" size={96} />}
            title={t('sessions.empty')}
            text={t('sessions.emptyText')}
            action={
              <LinkButton variant="primary" href={href({ name: 'sessionNew', patientId: null })}>
                {t('nav.newSession')}
              </LinkButton>
            }
          />
        </div>
      ) : (
        <section className="card">
          <div className="card__body toolbar">
            <Segmented<Period>
              label={t('sessions.period')}
              value={period}
              onChange={setPeriod}
              options={[
                { value: 7, label: t('sessions.days7') },
                { value: 30, label: t('sessions.days30') },
                { value: 90, label: t('sessions.days90') },
                { value: 0, label: t('sessions.allTime') },
              ]}
            />
            {details && (
              <>
                <label className="sr-only" htmlFor="ses-proto">
                  {t('report.protocol')}
                </label>
                <select id="ses-proto" className="select" style={{ width: 'auto', minWidth: 200 }} value={protocol} onChange={(e) => setProtocol(e.target.value as ProtocolId | 'all')}>
                  <option value="all">{t('common.all')}</option>
                  {(['upper_standard', 'upper_quick', 'elbow_endurance', 'custom', 'single'] as ProtocolId[]).map((p) => (
                    <option key={p} value={p}>
                      {t(`protocol.${p}`)}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          {rows.length === 0 ? (
            <EmptyState compact title={t('patients.notFound')} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('sessions.col.date')}</th>
                    <th>{t('sessions.col.patient')}</th>
                    {details && <th className="hide-sm">{t('sessions.col.protocol')}</th>}
                    {details && <th className="num hide-sm">{t('sessions.col.duration')}</th>}
                    <th className="num">{t('sessions.col.key')}</th>
                    {details && <th className="num hide-sm">{t('sessions.col.quality')}</th>}
                    {details && <th>{t('sessions.col.status')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const p = patients.find((x) => x.id === s.patientId);
                    const flex = p ? stepOf(s, 'shoulder_flexion', focusSide(p.affectedSide)) : null;
                    const go = () => navigate({ name: 'session', id: s.id, complete: false });
                    return (
                      <tr key={s.id} className="is-clickable" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()}>
                        <td>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{f.dateCompact(s.startedAt)}</div>
                          <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                            {f.time(s.startedAt)}
                          </div>
                        </td>
                        <td>
                          <strong>{p?.code ?? '–'}</strong>
                          {!details && s.status !== 'completed' && (
                            <span className="badge badge--warn" style={{ marginLeft: 8 }}>
                              {t('report.incomplete')}
                            </span>
                          )}
                        </td>
                        {details && <td className="hide-sm">{t(`protocol.${s.protocolId}`)}</td>}
                        {details && <td className="num hide-sm">{f.duration(s.activeSec)}</td>}
                        <td className="num">{flex ? f.deg(flex.rom) : '–'}</td>
                        {details && (
                          <td className="num hide-sm">
                            <span className={s.quality.percent < 95 ? 'quality-low' : ''}>{f.pct(s.quality.percent, 1)}</span>
                          </td>
                        )}
                        {details && (
                          <td>{s.status === 'completed' ? <span className="badge badge--good">{t('report.completed')}</span> : <span className="badge badge--warn">{t('report.incomplete')}</span>}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {sessions.length > 0 && <Details hint={t('details.sessionsHint')}>{null}</Details>}
    </div>
  );
}
