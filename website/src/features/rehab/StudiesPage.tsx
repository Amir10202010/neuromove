// Research readiness: studies with recorded ethics approval, consent records (guardian permission,
// child assent, withdrawal), pseudonymised exports and a descriptive study report. The software does
// not start experiments: enrolment is blocked until ethics approval and guardian permission are on record.

import { Download, FileText, Plus, UserMinus, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { href } from '../../app/router';
import { downloadText } from '../../data/export';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { EVALUATION_DOMAINS, STUDY_STATUSES, type ConsentRecord, type Study } from '../../rehab/model';
import { ofKind, useRehabStore } from '../../rehab/store';
import { buildStudyDataset, enrolmentProblems, studyReport, studyReportMarkdown, tableCsv, type EnrolmentProblem } from '../../rehab/study';
import { newConsent, newStudy, withdrawConsent } from '../../rehab/workflows';
import { useWorkspaceData } from '../../state/appStore';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { useActor, useSave, useXT } from './common';
import { useLibrary, useRehabLoaded } from './data';

const ENROL: Record<EnrolmentProblem, string> = {
  ethics_not_approved: 'Record the ethics committee approval first.',
  study_not_open: 'The study is not open for enrolment (status must be approved, recruiting or active).',
  guardian_permission_missing: 'Parent/guardian permission with its date is required.',
  child_declined: 'The child declined assent: do not enrol.',
  already_enrolled: 'Already enrolled in this study.',
  pseudonym_taken: 'This study pseudonym is already used.',
};

export function StudiesPage() {
  const { xt, L } = useXT();
  const { f } = useI18n();
  useRehabLoaded();
  const actor = useActor('professional');
  const save = useSave();
  const { ws, patients, sessions } = useWorkspaceData();
  const records = useRehabStore((s) => s.records);
  const { studies, consents } = useLibrary();
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Study | null>(null);
  const [enrol, setEnrol] = useState<null | { participantId: string; pseudonym: string; obtained: boolean; date: string; formVersion: string; assent: ConsentRecord['childAssent']; exportAllowed: boolean }>(null);
  const sel = studies.find((s) => s.id === selId) ?? null;
  const mine = consents.filter((c) => c.studyId === sel?.id);

  const dataset = useMemo(() => {
    if (!sel) return null;
    return buildStudyDataset(
      {
        study: sel,
        consents,
        patients,
        goals: ofKind(records, 'goal', ws),
        programs: ofKind(records, 'program', ws),
        practice: ofKind(records, 'practice', ws),
        sessions,
        assessments: ofKind(records, 'assessment', ws),
        incidents: ofKind(records, 'incident', ws),
        reviews: ofKind(records, 'review', ws),
        now: new Date(),
      },
      `ds-${sel.shortCode}-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`,
    );
  }, [sel, consents, patients, records, ws, sessions]);

  const enrolCheck = sel && enrol ? enrolmentProblems(sel, { participantId: enrol.participantId, pseudonym: enrol.pseudonym, guardianPermission: { obtained: enrol.obtained, date: enrol.date || null, formVersion: enrol.formVersion }, childAssent: enrol.assent }, consents) : [];

  return (
    <div className="page">
      <PageHeader
        back={{ href: href({ name: 'rehab' }), label: xt('Rehabilitation') }}
        title={xt('Studies')}
        lead={xt('Infrastructure for a supervised feasibility study. Requires institutional ethics approval, parent/guardian permission and child assent where applicable. No efficacy is claimed before a study is done.')}
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setDraft(newStudy({ title: '', shortCode: '', ethics: { committee: '', reference: '', approvedOn: null }, protocolSummary: '', domains: [...EVALUATION_DOMAINS], startDate: null, endDate: null, programTemplateKeys: [] }, ws, actor.name))}>
            {xt('New study')}
          </Button>
        }
      />
      {ws === 'demo' && <div className="callout callout--demo">{xt('Demo workspace: studies here are for trying the workflow only.')}</div>}
      <div className="grid grid--side-main">
        <section className="card">
          {studies.length === 0 ? (
            <EmptyState compact title={xt('No studies')} />
          ) : (
            <ul className="vplist">
              {studies.map((s) => (
                <li key={s.id}>
                  <button type="button" className={`vplist__item${s.id === selId ? ' is-active' : ''}`} onClick={() => setSelId(s.id)}>
                    <strong>
                      {s.shortCode} — {s.title}
                    </strong>
                    <span className="muted small">
                      {L.studyStatus[s.status]} · {consents.filter((c) => c.studyId === s.id && c.status === 'active').length} {xt('enrolled')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {!sel ? (
          <section className="card">
            <EmptyState title={xt('Select a study')} />
          </section>
        ) : (
          <div className="stack">
            <section className="card">
              <div className="card__header">
                <h2 className="card__title">
                  {sel.shortCode} — {sel.title}
                </h2>
                <Button size="sm" onClick={() => setDraft(structuredClone(sel))}>
                  {xt('Edit study')}
                </Button>
              </div>
              <dl className="kv card__body">
                <dt>{xt('Status')}</dt>
                <dd>{L.studyStatus[sel.status]}</dd>
                <dt>{xt('Ethics')}</dt>
                <dd>{sel.ethics.approvedOn ? `${sel.ethics.committee} · ${sel.ethics.reference} · ${f.date(sel.ethics.approvedOn)}` : <span className="rh-text-critical">{xt('No approval recorded — enrolment blocked')}</span>}</dd>
                <dt>{xt('Evaluation domains')}</dt>
                <dd>{sel.domains.map((d) => L.evalDomain[d]).join(', ')}</dd>
              </dl>
            </section>
            <section className="card">
              <div className="card__header">
                <h2 className="card__title">{xt('Participants and consent')}</h2>
                <Button size="sm" icon={<UserPlus />} onClick={() => setEnrol({ participantId: patients[0]?.id ?? '', pseudonym: `${sel.shortCode}-${String(mine.length + 1).padStart(3, '0')}`, obtained: false, date: '', formVersion: '', assent: 'not_yet', exportAllowed: true })}>
                  {xt('Enrol participant')}
                </Button>
              </div>
              {mine.length === 0 ? (
                <div className="card__body muted">{xt('No one enrolled.')}</div>
              ) : (
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead>
                      <tr>
                        <th>{xt('Pseudonym')}</th>
                        <th>{xt('Guardian permission')}</th>
                        <th>{xt('Child assent')}</th>
                        <th>{xt('Export')}</th>
                        <th>{xt('Status')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {mine.map((c) => (
                        <tr key={c.id}>
                          <td>{c.pseudonym}</td>
                          <td className="num">{c.guardianPermission.date ? f.dateCompact(c.guardianPermission.date) : '—'} {c.guardianPermission.formVersion}</td>
                          <td>{xt(`assent.${c.childAssent}`)}</td>
                          <td>{c.exportAllowed ? xt('yes') : xt('no')}</td>
                          <td>{c.status === 'active' ? xt('active') : `${xt('withdrawn')} ${c.withdrawnAt ? f.dateCompact(c.withdrawnAt) : ''} (${xt(`scope.${c.withdrawalScope}`)})`}</td>
                          <td>
                            {c.status === 'active' && (
                              <select className="select" aria-label={xt('Withdraw')} value="" onChange={(e) => e.target.value && void save([withdrawConsent(c, e.target.value as 'stop_collection' | 'remove_data')], actor)}>
                                <option value="">{xt('Withdraw…')}</option>
                                <option value="stop_collection">{xt('scope.stop_collection')}</option>
                                <option value="remove_data">{xt('scope.remove_data')}</option>
                              </select>
                            )}
                            {c.status !== 'active' && <UserMinus aria-hidden className="muted" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {dataset && (
              <section className="card">
                <div className="card__header">
                  <h2 className="card__title">{xt('Pseudonymised dataset and report')}</h2>
                </div>
                <div className="card__body stack">
                  <ul className="rh-plain-list small">
                    {dataset.manifest.privacy.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <p className="small">
                    {xt('Participants included: {n}', { n: dataset.manifest.participants })} ·{' '}
                    {Object.entries(dataset.tables)
                      .map(([k, v]) => `${k}: ${v.length}`)
                      .join(' · ')}
                  </p>
                  <div className="row row--wrap">
                    <Button icon={<Download />} disabled={!dataset.manifest.participants} onClick={() => downloadText(`${dataset.manifest.datasetId}.json`, JSON.stringify(dataset, null, 1), 'application/json')}>
                      {xt('Dataset (JSON, all tables + dictionary)')}
                    </Button>
                    {Object.entries(dataset.tables)
                      .filter(([, v]) => v.length)
                      .map(([k, v]) => (
                        <Button key={k} size="sm" onClick={() => downloadText(`${dataset.manifest.datasetId}-${k}.csv`, tableCsv(v), 'text/csv;charset=utf-8')}>
                          {k}.csv
                        </Button>
                      ))}
                    <Button icon={<FileText />} disabled={!dataset.manifest.participants} onClick={() => downloadText(`${dataset.manifest.datasetId}-report.md`, studyReportMarkdown(dataset, studyReport(dataset)), 'text/markdown;charset=utf-8')}>
                      {xt('Study report (Markdown)')}
                    </Button>
                  </div>
                  <p className="muted small">{xt('Exports stay on this device. Store them according to the approved data-management plan.')}</p>
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} wide title={xt('Study')} footer={<><Button onClick={() => setDraft(null)}>{xt('Cancel')}</Button><Button variant="primary" disabled={!draft?.title.trim() || !/^[A-Za-z0-9-]+$/.test(draft?.shortCode ?? '') || (['recruiting', 'active'].includes(draft?.status ?? '') && !draft?.ethics.approvedOn)} onClick={async () => { if (draft && (await save([{ ...draft, updatedAt: new Date().toISOString() }], actor))) { setSelId(draft.id); setDraft(null); } }}>{xt('Save')}</Button></>}>
        {draft && (
          <div className="stack">
            <div className="grid grid--2">
              <Field label={xt('Title')}>
                <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              <Field label={xt('Short code (letters, digits, dash)')}>
                <input className="input" value={draft.shortCode} onChange={(e) => setDraft({ ...draft, shortCode: e.target.value })} />
              </Field>
              <Field label={xt('Ethics committee')}>
                <input className="input" value={draft.ethics.committee} onChange={(e) => setDraft({ ...draft, ethics: { ...draft.ethics, committee: e.target.value } })} />
              </Field>
              <Field label={xt('Approval reference')}>
                <input className="input" value={draft.ethics.reference} onChange={(e) => setDraft({ ...draft, ethics: { ...draft.ethics, reference: e.target.value } })} />
              </Field>
              <Field label={xt('Approval date')}>
                <input className="input" type="date" value={draft.ethics.approvedOn?.slice(0, 10) ?? ''} onChange={(e) => setDraft({ ...draft, ethics: { ...draft.ethics, approvedOn: e.target.value || null } })} />
              </Field>
              <Field label={xt('Status')} hint={xt('Recruiting and active need a recorded approval.')}>
                <select className="select" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Study['status'] })}>
                  {STUDY_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {L.studyStatus[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={xt('Protocol summary')}>
              <textarea className="textarea" rows={3} value={draft.protocolSummary} onChange={(e) => setDraft({ ...draft, protocolSummary: e.target.value })} />
            </Field>
            <fieldset className="chips">
              <legend className="field__label">{xt('Evaluation domains')}</legend>
              {EVALUATION_DOMAINS.map((d) => (
                <label key={d} className={`chip rh-chip${draft.domains.includes(d) ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={draft.domains.includes(d)} onChange={(e) => setDraft({ ...draft, domains: e.target.checked ? [...draft.domains, d] : draft.domains.filter((x) => x !== d) })} />
                  {L.evalDomain[d]}
                </label>
              ))}
            </fieldset>
          </div>
        )}
      </Modal>

      <Modal open={!!enrol} onClose={() => setEnrol(null)} title={xt('Enrol participant')} footer={<><Button onClick={() => setEnrol(null)}>{xt('Cancel')}</Button><Button variant="primary" disabled={enrolCheck.length > 0} onClick={async () => {
        if (!enrol || !sel) return;
        const c = newConsent({ participantId: enrol.participantId, studyId: sel.id, pseudonym: enrol.pseudonym, guardianPermission: { obtained: enrol.obtained, date: enrol.date ? new Date(enrol.date).toISOString() : null, formVersion: enrol.formVersion }, childAssent: enrol.assent, exportAllowed: enrol.exportAllowed }, ws, actor.name);
        if (await save([c], actor)) setEnrol(null);
      }}>{xt('Record consent and enrol')}</Button></>}>
        {enrol && (
          <div className="stack">
            <Field label={xt('Participant')}>
              <select className="select" value={enrol.participantId} onChange={(e) => setEnrol({ ...enrol, participantId: e.target.value })}>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={xt('Study pseudonym')}>
              <input className="input" value={enrol.pseudonym} onChange={(e) => setEnrol({ ...enrol, pseudonym: e.target.value })} />
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={enrol.obtained} onChange={(e) => setEnrol({ ...enrol, obtained: e.target.checked })} />
              {xt('Written parent/guardian permission obtained')}
            </label>
            <div className="grid grid--2">
              <Field label={xt('Permission date')}>
                <input className="input" type="date" value={enrol.date} onChange={(e) => setEnrol({ ...enrol, date: e.target.value })} />
              </Field>
              <Field label={xt('Consent form version')}>
                <input className="input" value={enrol.formVersion} onChange={(e) => setEnrol({ ...enrol, formVersion: e.target.value })} />
              </Field>
            </div>
            <Field label={xt('Child assent')}>
              <select className="select" value={enrol.assent} onChange={(e) => setEnrol({ ...enrol, assent: e.target.value as ConsentRecord['childAssent'] })}>
                {(['obtained', 'not_applicable', 'not_yet', 'declined'] as const).map((a) => (
                  <option key={a} value={a}>
                    {xt(`assent.${a}`)}
                  </option>
                ))}
              </select>
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={enrol.exportAllowed} onChange={(e) => setEnrol({ ...enrol, exportAllowed: e.target.checked })} />
              {xt('Pseudonymised data may be included in research exports')}
            </label>
            {enrolCheck.length > 0 && (
              <ul className="callout callout--warn rh-problems" role="alert">
                {enrolCheck.map((p) => (
                  <li key={p}>{xt(ENROL[p])}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
