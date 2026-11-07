// Dataset export: choose sessions by filters → CSV (tidy, one row per trial) + data dictionary + JSON.
// Every export gets a new dataset id and a time-stamped file name: a previous dataset is never replaced.

import { FileDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { href } from '../../app/router';
import { downloadText, exportName } from '../../data/export';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { datasetJson, dictionaryCsv, newDatasetId, trialsCsv } from '../../research/export';
import { errorSummary } from '../../research/stats';
import { useResearchStore } from '../../research/store';
import { validPairs } from '../../research/workflow';
import { useWorkspaceData } from '../../state/appStore';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { useRT, fmtDeg } from './i18n';

export function DatasetsPage() {
  const rt = useRT();
  const { f } = useI18n();
  const { ws, patients } = useWorkspaceData();
  const loaded = useResearchStore((s) => s.loaded);
  const load = useResearchStore((s) => s.load);
  const sessions = useResearchStore((s) => s.sessions);
  const trials = useResearchStore((s) => s.trials);
  const protocols = useResearchStore((s) => s.protocols);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  const [protocol, setProtocol] = useState('all');
  const [participant, setParticipant] = useState('all');
  const [operator, setOperator] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<'completed' | 'all'>('completed');
  const [superseded, setSuperseded] = useState(true);
  const [last, setLast] = useState<string | null>(null);
  const mine = sessions.filter((s) => s.workspace === ws);
  const rows = useMemo(
    () =>
      mine
        .filter((s) => protocol === 'all' || s.protocolKey.split('@')[0] === protocol)
        .filter((s) => participant === 'all' || s.participantId === participant)
        .filter((s) => operator === 'all' || s.operator === operator)
        .filter((s) => status === 'all' || s.status === 'completed')
        .filter((s) => !from || s.startedAt >= from)
        .filter((s) => !to || s.startedAt.slice(0, 10) <= to)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [mine, protocol, participant, operator, status, from, to],
  );
  // Mixing protocols in one agreement estimate needs justification — warn, do not block
  const protocolsInSelection = new Set(rows.map((s) => s.protocolKey));
  const demo = ws === 'demo' || rows.some((s) => s.device.simulated);
  const exportNow = (kind: 'csv' | 'json') => {
    const id = newDatasetId();
    const filter = { sessionIds: rows.map((s) => s.id), includeSuperseded: superseded };
    const name = exportName(demo, ['dataset', id], kind);
    if (kind === 'csv') downloadText(name, trialsCsv(id, rows, trials, patients, filter), 'text/csv;charset=utf-8');
    else downloadText(name, datasetJson(id, rows, trials, patients, protocols, filter), 'application/json');
    setLast(id);
  };
  const protocolIds = [...new Set(mine.map((s) => s.protocolKey.split('@')[0] as string))];
  const operators = [...new Set(mine.map((s) => s.operator).filter(Boolean))];
  return (
    <div className="page">
      <PageHeader back={{ href: href({ name: 'research' }), label: rt('Research') }} title={rt('Datasets')} lead={rt('Tidy CSV for pandas / NumPy / SciPy, a data dictionary with units, and a JSON file with full metadata and statistics.')} />
      <section className="card card__body">
        <div className="vfilters">
          <label className="field">
            <span className="field__label">{rt('Protocol')}</span>
            <select className="select" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
              <option value="all">{rt('All')}</option>
              {protocolIds.map((id) => (
                <option key={id} value={id}>
                  {mine.find((s) => s.protocolKey.startsWith(`${id}@`))?.protocol.name ?? id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{rt('Participant')}</span>
            <select className="select" value={participant} onChange={(e) => setParticipant(e.target.value)}>
              <option value="all">{rt('All')}</option>
              {[...new Set(mine.map((s) => s.participantId))].map((id) => (
                <option key={id} value={id}>
                  {patients.find((p) => p.id === id)?.code ?? id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{rt('Operator')}</span>
            <select className="select" value={operator} onChange={(e) => setOperator(e.target.value)}>
              <option value="all">{rt('All')}</option>
              {operators.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{rt('From')}</span>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">{rt('To')}</span>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">{rt('Status')}</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as 'completed' | 'all')}>
              <option value="completed">{rt('Completed only')}</option>
              <option value="all">{rt('All')}</option>
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={superseded} onChange={(e) => setSuperseded(e.target.checked)} />
            {rt('Include superseded attempts (audit trail)')}
          </label>
        </div>
      </section>
      {protocolsInSelection.size > 1 && <div className="callout callout--warn">{rt('The selection mixes {n} protocol versions. Do not pool their agreement statistics without justification; the CSV keeps protocol_key on every row.', { n: protocolsInSelection.size })}</div>}
      <section className="card">
        {rows.length === 0 ? (
          <EmptyState title={rt('No sessions match the filters')} />
        ) : (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>{rt('Date')}</th>
                  <th>{rt('Participant')}</th>
                  <th>{rt('Protocol')}</th>
                  <th>{rt('Operator')}</th>
                  <th className="num">{rt('Valid pairs')}</th>
                  <th className="num">{rt('Bias')}</th>
                  <th className="num">MAE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const e = errorSummary(validPairs(trials.filter((t) => t.sessionId === s.id)));
                  return (
                    <tr key={s.id}>
                      <td className="num">{f.dateCompact(s.startedAt)}</td>
                      <td>{patients.find((p) => p.id === s.participantId)?.code}</td>
                      <td>{s.protocolKey}</td>
                      <td>{s.operator}</td>
                      <td className="num">{e.n}</td>
                      <td className="num">{fmtDeg(e.bias, 2, true)}</td>
                      <td className="num">{fmtDeg(e.mae, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="card__footer row row--wrap">
          <Button variant="primary" icon={<FileDown />} disabled={!rows.length} onClick={() => exportNow('csv')}>
            CSV ({rows.length})
          </Button>
          <Button icon={<FileDown />} disabled={!rows.length} onClick={() => exportNow('json')}>
            JSON
          </Button>
          <Button variant="ghost" onClick={() => downloadText(exportName(false, ['validation-dictionary'], 'csv'), dictionaryCsv(), 'text/csv;charset=utf-8')}>
            {rt('Data dictionary')}
          </Button>
          {last && <span className="muted small">{rt('Last export')}: {last}</span>}
        </div>
      </section>
    </div>
  );
}
