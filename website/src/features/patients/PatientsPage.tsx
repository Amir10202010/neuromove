import { Search, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { navigate } from '../../website/router';
import { Sparkline } from '../../charts/Sparkline';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { useAppStore, useWorkspaceData } from '../../state/appStore';
import { focusSide, metricSeries, patientSessions } from '../../session/compare';
import { Button } from '../../ui/Button';
import { Delta } from '../../ui/Delta';
import { EmptyState } from '../../ui/EmptyState';
import { EmptyArt } from '../../figures/EmptyArt';
import { PatientAvatar } from '../../ui/PatientAvatar';
import { Segmented } from '../../ui/Segmented';
import { Details } from '../common/Details';
import { ageOf, roman } from '../common/text';
import { PatientFormModal } from './PatientFormModal';

export function PatientsPage() {
  const { t, f } = useI18n();
  const { ws, patients, sessions } = useWorkspaceData();
  // Простой вид: кто, как поднимается рука, когда был и когда придёт. Форма ДЦП, GMFCS и MACS,
  // число сеансов и фильтр по статусу — в подробностях (тот же переключатель, что в карточке)
  const details = useAppStore((s) => s.settings.details);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'active' | 'all'>('all');
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return patients
      .filter((p) => (filter === 'active' ? p.status === 'active' : true))
      .filter((p) => !q || p.code.toUpperCase().includes(q))
      .map((p) => {
        const list = patientSessions(sessions, p.id);
        const series = metricSeries(sessions, p, 'shoulder_flexion', focusSide(p.affectedSide), 'rom');
        return { p, list, series, last: list[list.length - 1] ?? null };
      })
      .sort((a, b) => a.p.code.localeCompare(b.p.code));
  }, [patients, sessions, query, filter]);

  const open = (id: string) => navigate({ name: 'patient', id, tab: 'overview' });

  return (
    <div className="page">
      <PageHeader
        title={t('patients.title')}
        lead={t('common.patientsCount', { count: patients.length })}
        actions={
          <Button variant="primary" icon={<UserPlus />} onClick={() => setAdding(true)}>
            {t('patients.add')}
          </Button>
        }
      />

      {patients.length === 0 ? (
        <div className="card">
          <EmptyState
            art={<EmptyArt kind="patients" size={96} />}
            title={t('patients.empty')}
            text={t('patients.emptyText')}
            action={
              <Button variant="primary" icon={<UserPlus />} onClick={() => setAdding(true)}>
                {t('patients.add')}
              </Button>
            }
          />
        </div>
      ) : (
        <section className="card">
          <div className="card__body toolbar">
            <label className="input-group toolbar__search">
              <Search aria-hidden />
              <span className="sr-only">{t('common.search')}</span>
              <input className="input" placeholder={t('patients.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} type="search" />
            </label>
            {details && (
              <Segmented<'active' | 'all'>
                label={t('common.status')}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: t('patients.filterAll') },
                  { value: 'active', label: t('patients.filterActive') },
                ]}
              />
            )}
          </div>
          {rows.length === 0 ? (
            <EmptyState compact icon={<Search />} title={t('patients.notFound')} text={t('patients.notFoundText')} />
          ) : (
            <div className="table-wrap">
              <table className="table patients-table">
                <thead>
                  <tr>
                    <th>{t('patients.col.patient')}</th>
                    {details && <th className="hide-md">{t('patients.col.form')}</th>}
                    {details && <th className="hide-sm">{t('patients.col.levels')}</th>}
                    {details && <th className="num">{t('patients.col.sessions')}</th>}
                    <th className="hide-sm">{t('patients.col.last')}</th>
                    <th>{t('patients.col.trend')}</th>
                    <th className="hide-md">{t('patients.col.next')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ p, list, series, last }) => {
                    const first = series[0]?.value;
                    const cur = series[series.length - 1]?.value;
                    return (
                      <tr key={p.id} className="is-clickable" tabIndex={0} onClick={() => open(p.id)} onKeyDown={(e) => e.key === 'Enter' && open(p.id)} aria-label={p.code}>
                        <td>
                          <div className="row" style={{ gap: 10 }}>
                            <PatientAvatar name={p.code} demo={ws === 'demo'} />
                            <div>
                              <div style={{ fontWeight: 650 }}>{p.code}</div>
                              <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                                {t('common.yearsOld', { count: ageOf(p.birthYear) })}
                                {p.status !== 'active' && ` · ${t(`patients.status.${p.status}`)}`}
                              </div>
                            </div>
                          </div>
                        </td>
                        {details && (
                          <td className="hide-md">
                            <div>{t(`cpForm.${p.cpForm}`)}</div>
                            <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                              {t('side.affectedSide')}: {t(`side.${p.affectedSide}`).toLowerCase()}
                            </div>
                          </td>
                        )}
                        {details && (
                          <td className="hide-sm num" style={{ textAlign: 'left' }}>
                            {roman(p.gmfcs)} / {roman(p.macs)}
                          </td>
                        )}
                        {details && <td className="num">{list.length}</td>}
                        <td className="hide-sm">{last ? <span title={f.dateTime(last.startedAt)}>{f.relative(last.startedAt)}</span> : <span className="muted">{t('patients.noSessions')}</span>}</td>
                        <td>
                          {series.length ? (
                            <div className="row" style={{ gap: 10 }}>
                              <Sparkline values={series.map((s) => s.value)} width={72} color={focusSide(p.affectedSide) === 'left' ? 'var(--left)' : 'var(--right)'} />
                              <span className="num" style={{ fontWeight: 600 }}>{f.deg(cur)}</span>
                              {series.length > 1 && first !== undefined && cur !== undefined && <Delta value={cur - first} threshold={3} />}
                            </div>
                          ) : (
                            <span className="muted">–</span>
                          )}
                        </td>
                        <td className="hide-md">{p.nextVisit ? f.dateTime(p.nextVisit) : <span className="muted">–</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {patients.length > 0 && <Details hint={t('details.patientsHint')}>{null}</Details>}
      <PatientFormModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
