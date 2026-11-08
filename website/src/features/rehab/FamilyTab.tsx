// Professional side of home-to-clinic continuity: family reports and observations, safety incidents
// with their review, approved summaries for the family, and clinic practice entries (optionally linked
// to a real sensor session).

import { CheckCheck, MessageSquarePlus, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { isSimulatedSession } from '../../data/models';
import { INCIDENT_TYPES, type IncidentRecord, type PracticeRecord } from '../../rehab/model';
import { unreviewed } from '../../rehab/progress';
import { acknowledge, newIncident, reportPractice, reviewIncident } from '../../rehab/workflows';
import { useAppStore } from '../../state/appStore';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { SourceBadge, useActor, useSave, useXT } from './common';
import { activityByKey, type ParticipantData } from './data';
import { allAssignments } from '../../rehab/programs';

export function FamilyTab({ data }: { data: ParticipantData }) {
  const { xt, L } = useXT();
  const { f } = useI18n();
  const actor = useActor('professional');
  const save = useSave();
  const addNote = useAppStore((s) => s.addNote);
  const toast = useAppStore((s) => s.toast);
  const open = new Set(unreviewed(data.practice, data.reviews).map((p) => p.id));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<{ inc: IncidentRecord; outcome: string; followUp: string } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [clinic, setClinic] = useState<null | { assignmentId: string; completion: NonNullable<PracticeRecord['completion']>; sessionId: string; note: string }>(null);
  const [deviation, setDeviation] = useState<null | { category: 'deviation' | 'technical' | 'safety'; type: IncidentRecord['type']; description: string }>(null);
  const ws = data.patient!.workspace;
  const summaries = data.notes.filter((n) => n.kind === 'summary').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const assignments = data.program ? allAssignments(data.program.def) : [];
  const realSessions = data.sessions.filter((s) => data.demo || !isSimulatedSession(s)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const ack = async (ids: string[]) => {
    if (!ids.length) return;
    if (await save([acknowledge(data.patient!.id, ids, ws, actor.name)], actor)) setSel(new Set());
  };

  return (
    <div className="stack">
      {data.incidents.some((i) => i.review === null) && (
        <section className="card rh-card--alert">
          <div className="card__header">
            <h2 className="card__title">
              <ShieldAlert aria-hidden className="rh-inline-icon" /> {xt('Incidents waiting for review')}
            </h2>
          </div>
          <ul className="rh-report-list">
            {data.incidents
              .filter((i) => i.review === null)
              .map((i) => (
                <li key={i.id} className="rh-report rh-report--incident">
                  <div className="rh-report__head">
                    <span className="badge badge--critical">{L.incidentType[i.type]}</span> <span className="num muted">{f.dateTime(i.occurredAt)}</span> <SourceBadge source={i.createdByRole === 'caregiver' ? 'reported' : 'professional'} />
                  </div>
                  {i.description && <p>{i.description}</p>}
                  {i.actionTaken && <p className="muted small">{xt('Action taken')}: {i.actionTaken}</p>}
                  <Button size="sm" variant="primary" onClick={() => setReviewing({ inc: i, outcome: '', followUp: '' })}>
                    {xt('Review incident')}
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">
            {xt('Family reports and observations')} <SourceBadge source="reported" />
          </h2>
          <div className="row row--wrap">
            <Button size="sm" icon={<CheckCheck />} disabled={!sel.size} onClick={() => void ack([...sel])}>
              {xt('Mark selected as reviewed')}
            </Button>
            <Button size="sm" disabled={!open.size} onClick={() => void ack([...open])}>
              {xt('Mark all as reviewed')}
            </Button>
          </div>
        </div>
        <p className="card__body muted small">{xt('What families report is context, not a measurement. "Not done" is a normal answer and is never penalised.')}</p>
        {data.practice.length === 0 ? (
          <EmptyState compact title={xt('No reports yet')} />
        ) : (
          <ul className="rh-report-list">
            {data.practice.map((p) => {
              const act = p.activityKey ? activityByKey(data.activities, p.activityKey) : undefined;
              return (
                <li key={p.id} className={`rh-report${open.has(p.id) ? ' is-new' : ''}`}>
                  <label className="report__select">
                    <input type="checkbox" checked={sel.has(p.id)} disabled={!open.has(p.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.id); else n.delete(p.id); setSel(n); }} />
                    <span className="sr-only">{xt('Select')}</span>
                  </label>
                  <div>
                    <div className="rh-report__head">
                      <span className="num muted">{f.dateTime(p.date)}</span> · {L.setting[p.setting]} · {act?.def.name ?? (p.completion === null ? xt('Observation') : '—')}
                      {p.completion && <span className={`badge ${p.completion === 'completed' ? 'badge--good' : p.completion === 'stopped' ? 'badge--warn' : 'badge--outline'}`}>{L.completion[p.completion]}</span>}
                      {p.sensorSessionId ? <SourceBadge source="imu">{xt('sensor session linked')}</SourceBadge> : <SourceBadge source={p.source === 'professional_entry' ? 'professional' : 'reported'} />}
                      {p.source === 'child_mode' && <span className="badge badge--outline">{xt('child mode')}</span>}
                      {open.has(p.id) && <span className="badge badge--info">{xt('new')}</span>}
                    </div>
                    <div className="rh-report__facts small">
                      {p.fatigue !== null && <span>{L.fatigue[p.fatigue]}</span>}
                      {p.discomfort && p.discomfort !== 'none' && <span className="rh-text-critical">{L.discomfort[p.discomfort]}</span>}
                      {p.difficulty && <span>{xt('difficulty')}</span>}
                      {p.breakRequested && <span>{xt('asked for a break')}</span>}
                      {p.barriers.map((b) => (
                        <span key={b}>{L.barrier[b]}</span>
                      ))}
                      {p.durationMin !== null && <span>{p.durationMin} {xt('min')}</span>}
                    </div>
                    {p.observation && <p className="rh-report__text">{p.observation}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid grid--2">
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{xt('Summaries visible to the family')}</h2>
            <Button size="sm" icon={<MessageSquarePlus />} onClick={() => setSummary('')}>
              {xt('Write summary')}
            </Button>
          </div>
          <p className="card__body muted small">{xt('Only what you write here is shown to the family as a progress summary. Plain words; no raw measurements without explanation.')}</p>
          <ul className="rh-plain-list card__body">
            {summaries.map((n) => (
              <li key={n.id}>
                <span className="num muted">{f.date(n.createdAt)}</span> — {n.text}
              </li>
            ))}
            {!summaries.length && <li className="muted">{xt('None yet.')}</li>}
          </ul>
        </section>
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{xt('Clinic entries')}</h2>
          </div>
          <div className="card__body stack">
            <Button size="sm" disabled={!assignments.length} onClick={() => setClinic({ assignmentId: assignments[0]?.id ?? '', completion: 'completed', sessionId: '', note: '' })}>
              {xt('Record clinic practice')}
            </Button>
            <Button size="sm" onClick={() => setDeviation({ category: 'deviation', type: 'protocol_deviation', description: '' })}>
              {xt('Record incident, deviation or technical problem')}
            </Button>
            <ul className="rh-plain-list small">
              {data.incidents
                .filter((i) => i.review !== null)
                .slice(0, 8)
                .map((i) => (
                  <li key={i.id}>
                    {f.dateCompact(i.occurredAt)} · {L.incidentCategory[i.category]} · {L.incidentType[i.type]} — <span className="muted">{i.review!.outcome}</span>
                  </li>
                ))}
            </ul>
          </div>
        </section>
      </div>

      <Modal open={!!reviewing} onClose={() => setReviewing(null)} title={xt('Review incident')} footer={<><Button onClick={() => setReviewing(null)}>{xt('Cancel')}</Button><Button variant="primary" disabled={!reviewing?.outcome.trim()} onClick={async () => { if (reviewing && (await save([reviewIncident(reviewing.inc, actor.name, reviewing.outcome.trim(), reviewing.followUp.trim())], actor))) setReviewing(null); }}>{xt('Save review')}</Button></>}>
        {reviewing && (
          <div className="stack">
            <p>
              <strong>{L.incidentType[reviewing.inc.type]}</strong> · {f.dateTime(reviewing.inc.occurredAt)}
            </p>
            {reviewing.inc.description && <p className="muted">{reviewing.inc.description}</p>}
            <Field label={xt('Outcome of the review (required)')}>
              <textarea className="textarea" rows={3} value={reviewing.outcome} onChange={(e) => setReviewing({ ...reviewing, outcome: e.target.value })} />
            </Field>
            <Field label={xt('Follow-up')}>
              <textarea className="textarea" rows={2} value={reviewing.followUp} onChange={(e) => setReviewing({ ...reviewing, followUp: e.target.value })} />
            </Field>
            <p className="muted small">{xt('Report the event according to your institution’s procedure as well. A review is saved once and cannot be edited.')}</p>
          </div>
        )}
      </Modal>

      <Modal open={summary !== null} onClose={() => setSummary(null)} title={xt('Summary for the family')} footer={<><Button onClick={() => setSummary(null)}>{xt('Cancel')}</Button><Button variant="primary" disabled={!summary?.trim()} onClick={() => { addNote({ patientId: data.patient!.id, sessionId: null, author: actor.name, text: summary!.trim(), kind: 'summary' }); toast('good', xt('Published to the family view')); setSummary(null); }}>{xt('Publish to the family')}</Button></>}>
        <Field label={xt('What would you like the family to know?')}>
          <textarea className="textarea" rows={5} value={summary ?? ''} onChange={(e) => setSummary(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={!!clinic} onClose={() => setClinic(null)} title={xt('Record clinic practice')} footer={<><Button onClick={() => setClinic(null)}>{xt('Cancel')}</Button><Button variant="primary" onClick={async () => {
        if (!clinic || !data.program) return;
        const a = assignments.find((x) => x.id === clinic.assignmentId);
        const { practice } = reportPractice({ participantId: data.patient!.id, programKey: data.program.id, assignmentId: a?.id ?? null, activityKey: a?.activityKey ?? null, setting: 'clinic', source: 'professional_entry', completion: clinic.completion, difficulty: false, breakRequested: false, fatigue: null, discomfort: null, barriers: [], durationMin: a?.durationMin ?? null, observation: clinic.note, sensorSessionId: clinic.sessionId || null }, ws, actor.name, 'professional');
        if (await save([practice], actor)) setClinic(null);
      }}>{xt('Save')}</Button></>}>
        {clinic && (
          <div className="stack">
            <Field label={xt('Activity')}>
              <select className="select" value={clinic.assignmentId} onChange={(e) => setClinic({ ...clinic, assignmentId: e.target.value })}>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {activityByKey(data.activities, a.activityKey)?.def.name ?? a.activityKey} · {L.setting[a.setting]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={xt('Completion')}>
              <select className="select" value={clinic.completion} onChange={(e) => setClinic({ ...clinic, completion: e.target.value as NonNullable<PracticeRecord['completion']> })}>
                {(['completed', 'partial', 'not_completed', 'stopped'] as const).map((c) => (
                  <option key={c} value={c}>
                    {L.completion[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={xt('Sensor session (optional)')} hint={xt('Only real sessions of this participant can be linked. A practice entry without a session is not a measurement.')}>
              <select className="select" value={clinic.sessionId} onChange={(e) => setClinic({ ...clinic, sessionId: e.target.value })}>
                <option value="">{xt('No sensor session')}</option>
                {realSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {f.dateTime(s.startedAt)}
                    {isSimulatedSession(s) ? ` (${xt('simulated')})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={xt('Observation')}>
              <textarea className="textarea" rows={2} value={clinic.note} onChange={(e) => setClinic({ ...clinic, note: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!deviation} onClose={() => setDeviation(null)} title={xt('Record incident')} footer={<><Button onClick={() => setDeviation(null)}>{xt('Cancel')}</Button><Button variant="primary" disabled={!deviation?.description.trim()} onClick={async () => {
        if (!deviation) return;
        const inc = newIncident({ participantId: data.patient!.id, category: deviation.category, type: deviation.type, occurredAt: new Date().toISOString(), description: deviation.description.trim(), actionTaken: '', relatedPracticeId: null, relatedSessionId: null, studyId: null }, ws, actor.name, 'professional');
        if (await save([inc], actor)) setDeviation(null);
      }}>{xt('Save')}</Button></>}>
        {deviation && (
          <div className="stack">
            <Field label={xt('Category')}>
              <select className="select" value={deviation.category} onChange={(e) => setDeviation({ ...deviation, category: e.target.value as typeof deviation.category })}>
                {(['safety', 'deviation', 'technical'] as const).map((c) => (
                  <option key={c} value={c}>
                    {L.incidentCategory[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={xt('Type')}>
              <select className="select" value={deviation.type} onChange={(e) => setDeviation({ ...deviation, type: e.target.value as IncidentRecord['type'] })}>
                {INCIDENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {L.incidentType[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={xt('What happened')}>
              <textarea className="textarea" rows={3} value={deviation.description} onChange={(e) => setDeviation({ ...deviation, description: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
