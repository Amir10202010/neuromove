// Report builder: a scientific report generated from a frozen analysis run — fifteen sections, every statement
// tagged as observation, estimate, model-dependent, hypothesis, method or limitation, and every observation or
// estimate linked through the evidence graph down to the sessions and raw streams it came from.

import { Download, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { href } from '../../../app/router';
import { downloadText } from '../../../data/export';
import { grounding } from '../../../lab/discovery/evidence';
import { sealEvidence } from '../../../lab/discovery/evidenceRecord';
import { HYPOTHESES } from '../../../lab/discovery/hypotheses';
import { buildReport, reportExportMarkdown, reportToMarkdown, type StatementKind } from '../../../lab/discovery/report';
import { FRONTIER_VERSIONS } from '../../../lab/version';
import { newId } from '../../../lib/ids';
import { useAppStore } from '../../../state/appStore';
import { EmptyState } from '../../../ui/EmptyState';
import { LinkButton } from '../../../ui/Button';
import { useDates, useLabData } from '../common';
import { useLabRecords, useLabStore } from '../store';
import type { FT } from './i18n';
import { CanonicalNote, Chip, Kpi, code, type Tone } from './shared';

const kindTone = (k: StatementKind): Tone => (k === 'observation' ? 'met' : k === 'estimate' ? 'signal' : k === 'limitation' ? 'refused' : k === 'model_dependent' || k === 'hypothesis' ? 'caution' : 'plain');

export function ReportsView({ ft }: { ft: FT }) {
  const dates = useDates();
  const { ws, sessions } = useLabData();
  const { runs, protocols } = useLabRecords(ws);
  const saveEvidence = useLabStore((s) => s.saveEvidence);
  const author = useAppStore((s) => s.profile?.name ?? '');
  const [runId, setRunId] = useState<string | null>(null);
  const [hyp, setHyp] = useState<string>('');
  const [sealed, setSealed] = useState<string | null>(null);
  const sorted = useMemo(() => [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [runs]);
  const run = sorted.find((r) => r.id === runId) ?? sorted[0] ?? null;
  const report = useMemo(() => {
    if (!run) return null;
    const protocol = run.protocol ? (protocols.find((p) => p.id === run.protocol?.id) ?? null) : null;
    return buildReport({ run, sessions, protocol, hypothesisId: hyp || null });
  }, [run, sessions, protocols, hyp]);
  const g = useMemo(() => (report ? grounding(report.graph, report.analysisNode) : null), [report]);
  if (!run || !report || !g) {
    return <EmptyState title={ft('No frozen analysis run')} text={ft('A report is built from a frozen run, so that its numbers cannot change afterwards. Freeze an analysis in the Explorer or on the Twin page first.')} action={<LinkButton href={href({ name: 'labRuns' })}>{ft('Open research reports')}</LinkButton>} />;
  }
  const md = () => downloadText(`neuromove-${ws === 'demo' ? 'DEMO-' : ''}report-${run.id}.md`, reportExportMarkdown(report, run), 'text/markdown;charset=utf-8');
  const seal = async () => {
    const rec = sealEvidence({
      id: newId('ev'),
      workspace: ws,
      participantId: run.participantId,
      type: 'research_report',
      title: report.title.slice(0, 280),
      createdAt: new Date().toISOString(),
      createdBy: author || 'unknown',
      versions: { discovery: FRONTIER_VERSIONS.discovery, engine: report.manifest.engine },
      derivedFrom: [{ kind: 'analysis_run', id: run.id, hash: run.resultHash }, ...run.inputs.map((i) => ({ kind: 'session', id: i.sessionId, hash: null }))],
      body: { markdown: reportToMarkdown(report), manifest: report.manifest, intent: report.intent },
      simulated: run.simulated,
    });
    if (await saveEvidence(rec)) setSealed(rec.contentHash);
  };

  return (
    <>
      <section className="card card__body mlfilters">
        <label className="field">
          <span className="field__label">{ft('Frozen run')}</span>
          <select
            className="select"
            value={run.id}
            onChange={(e) => {
              setRunId(e.target.value);
              setSealed(null);
            }}
          >
            {sorted.map((r) => (
              <option key={r.id} value={r.id}>
                {dates.dateTime(r.createdAt)} · {r.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{ft('Hypothesis the report addresses')}</span>
          <select
            className="select"
            value={hyp}
            onChange={(e) => {
              setHyp(e.target.value);
              setSealed(null);
            }}
          >
            <option value="">{ft('none')}</option>
            {HYPOTHESES.map((h) => (
              <option key={h.id} value={h.id}>
                {h.id}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn--secondary" onClick={md}>
          <Download aria-hidden /> {ft('Download as Markdown')}
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => void seal()} disabled={sealed !== null}>
          <Lock aria-hidden /> {ft('Seal as an evidence record')}
        </button>
        {sealed && (
          <span className="mlmuted">
            {ft('Sealed on this device')} · <span className="fr-mono">{sealed.slice(0, 16)}…</span>
          </span>
        )}
      </section>

      <section className="mlkpis" aria-label={ft('Summary')}>
        <Kpi label={ft('Analysis intent')} value={code(ft, report.intent)} text meta={report.intentReasons.length ? report.intentReasons.map((r) => code(ft, r)).join('; ') : undefined} />
        <Kpi label={ft('Provenance')} value={code(ft, report.provenance)} text />
        <Kpi label={ft('Evidence chains')} value={String(g.chains)} meta={`${ft('reaching a raw stream')}: ${g.reachingRaw}`} />
        <Kpi label={ft('Reproduction check')} value={code(ft, report.manifest.verification)} text />
      </section>
      {Object.keys(g.stopped).length > 0 && (
        <p className="mlmuted">
          {ft('Chains that end before a raw stream')}: {Object.entries(g.stopped).map(([k, v]) => `${code(ft, k)} ${v}`).join(' · ')}. {ft('A session stored without raw frames can be traced to its stored repetition metrics, not further.')}
        </p>
      )}
      <p className="mlmuted">{ft('"Exploratory" unless a frozen protocol fixed this analysis before the first analysed session was recorded. An exploratory result generates a hypothesis; it does not confirm one.')}</p>

      <section className="mlsection">
        <h2 className="section-title">{report.title}</h2>
        {report.sections.map((sec) => (
          <div key={sec.id} className="card card__body">
            <h3 className="card__title">{sec.title}</h3>
            {sec.statements.length === 0 ? (
              <p className="mlmuted">—</p>
            ) : (
              sec.statements.map((s, i) => (
                <div key={i} className="fr-statement">
                  <Chip tone={kindTone(s.kind)}>{code(ft, s.kind)}</Chip>
                  <p>
                    {s.text}
                    {s.evidence.length > 0 && (
                      <span className="mlmuted">
                        {' '}
                        [{ft('evidence')}: {s.evidence.length}]
                      </span>
                    )}
                  </p>
                </div>
              ))
            )}
          </div>
        ))}
      </section>

      <section className="mlsection">
        <h2 className="section-title">{ft('Reproducibility manifest')}</h2>
        <div className="card card__body">
          <dl className="fr-dl">
            <dt>{ft('Engine now / at freezing')}</dt>
            <dd className="fr-mono">
              {report.manifest.engine} / {report.manifest.runEngine}
            </dd>
            <dt>{ft('Result hash')}</dt>
            <dd className="fr-mono">{report.manifest.resultHash}</dd>
            <dt>{ft('Data snapshot hash')}</dt>
            <dd className="fr-mono">{report.manifest.snapshotHash}</dd>
            <dt>{ft('Configuration hash')}</dt>
            <dd className="fr-mono">{report.manifest.configHash}</dd>
            <dt>{ft('Protocol hash')}</dt>
            <dd className="fr-mono">{report.manifest.protocolHash ?? '—'}</dd>
          </dl>
        </div>
        <CanonicalNote ft={ft} />
      </section>
    </>
  );
}
