// Research home: validation sessions (resume / report), protocols, datasets, what the hardware can measure.

import { Database, FlaskConical, ListChecks, Plus } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { href, navigate } from '../../app/router';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { CAPABILITIES } from '../../research/capabilities';
import { errorSummary } from '../../research/stats';
import { useResearchStore } from '../../research/store';
import { counts, validPairs } from '../../research/workflow';
import { useWorkspaceData } from '../../state/appStore';
import { LinkButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { useRT, fmtDeg } from './i18n';
import { SaveStatus } from './SaveStatus';
import { LabEntry } from '../motorlab/LabEntry';

export function ResearchPage() {
  const rt = useRT();
  const { f } = useI18n();
  const { ws, patients } = useWorkspaceData();
  const loaded = useResearchStore((s) => s.loaded);
  const load = useResearchStore((s) => s.load);
  const sessions = useResearchStore((s) => s.sessions);
  const trials = useResearchStore((s) => s.trials);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  const rows = useMemo(
    () =>
      sessions
        .filter((s) => s.workspace === ws)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map((s) => {
          const ts = trials.filter((t) => t.sessionId === s.id);
          return { s, n: counts(s.protocol, ts), e: errorSummary(validPairs(ts)) };
        }),
    [sessions, trials, ws],
  );
  const active = rows.filter((r) => r.s.status === 'active');
  return (
    <div className="page">
      <PageHeader
        title={rt('Research')}
        lead={rt('Measurement validation against a goniometer, protocols and research datasets.')}
        actions={
          <>
            <SaveStatus compact />
            <LinkButton href={href({ name: 'researchProtocols' })} icon={<ListChecks />}>
              {rt('Protocols')}
            </LinkButton>
            <LinkButton href={href({ name: 'researchDatasets' })} icon={<Database />}>
              {rt('Datasets')}
            </LinkButton>
            <LinkButton variant="primary" href={href({ name: 'researchNew', protocolKey: null })} icon={<Plus />}>
              {rt('New validation session')}
            </LinkButton>
          </>
        }
      />
      <LabEntry />
      {ws === 'demo' && <div className="callout callout--demo">{rt('Demo workspace: validation sessions here use the simulator and are not measurements.')}</div>}
      {active.length > 0 && (
        <div className="callout callout--info">
          <FlaskConical aria-hidden />
          <div>
            <div className="callout__title">{rt('Unfinished sessions')}</div>
            {active.map((r) => (
              <div key={r.s.id}>
                <a href={href({ name: 'researchSession', id: r.s.id })}>
                  {patients.find((p) => p.id === r.s.participantId)?.code} · {r.s.protocol.name} · {r.n.valid + r.n.invalid + r.n.skipped}/{r.n.slots} — {rt('resume')}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{rt('Validation sessions')}</h2>
        </div>
        {!loaded ? (
          <div className="card__body muted">{rt('Loading…')}</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={rt('No validation sessions yet')}
            text={rt('A validation session pairs every IMU repetition with a goniometer reading and reports bias, MAE, RMSE and limits of agreement.')}
            action={
              <LinkButton variant="primary" href={href({ name: 'researchNew', protocolKey: null })}>
                {rt('New validation session')}
              </LinkButton>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{rt('Date')}</th>
                  <th>{rt('Participant')}</th>
                  <th>{rt('Protocol')}</th>
                  <th>{rt('Status')}</th>
                  <th className="num">{rt('Valid')}</th>
                  <th className="num">{rt('Invalid / skipped / missing')}</th>
                  <th className="num">{rt('Bias')}</th>
                  <th className="num">MAE</th>
                  <th className="num">RMSE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, n, e }) => (
                  <tr key={s.id} className="is-clickable" tabIndex={0} onClick={() => navigate({ name: 'researchSession', id: s.id })} onKeyDown={(ev) => ev.key === 'Enter' && navigate({ name: 'researchSession', id: s.id })}>
                    <td className="num">{f.dateCompact(s.startedAt)}</td>
                    <td>{patients.find((p) => p.id === s.participantId)?.code ?? '—'}</td>
                    <td>
                      {s.protocol.name} <span className="muted">v{s.protocolVersion}</span>
                    </td>
                    <td>
                      <span className={`badge ${s.status === 'active' ? 'badge--info' : s.status === 'completed' ? 'badge--good' : 'badge--outline'}`}>{rt(s.status === 'active' ? 'In progress' : s.status === 'completed' ? 'Completed' : 'Abandoned')}</span>
                      {s.device.simulated && <span className="badge badge--demo">{rt('simulated')}</span>}
                    </td>
                    <td className="num">{n.valid}</td>
                    <td className="num">
                      {n.invalid} / {n.skipped} / {n.missing}
                    </td>
                    <td className="num">{fmtDeg(e.bias, 2, true)}</td>
                    <td className="num">{fmtDeg(e.mae, 2)}</td>
                    <td className="num">{fmtDeg(e.rmse, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{rt('What the current sensor setup can measure')}</h2>
          <span className="muted small">{rt('ESP32 + 3 × MPU-6050 (accelerometer + gyroscope, no magnetometer). Hardware is frozen; this list is software capability.')}</span>
        </div>
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>{rt('Joint')}</th>
                <th>{rt('Movement')}</th>
                <th>{rt('Status')}</th>
                <th>{rt('Limitation')}</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <tr key={c.id}>
                  <td>{c.joint}</td>
                  <td>{c.movement}</td>
                  <td>
                    <span className={`badge ${c.status === 'operational' ? 'badge--good' : c.status === 'experimental' ? 'badge--warn' : 'badge--outline'}`}>{rt(c.status === 'operational' ? 'Operational' : c.status === 'experimental' ? 'Experimental' : 'Future')}</span>
                  </td>
                  <td className="small">{c.limitation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
