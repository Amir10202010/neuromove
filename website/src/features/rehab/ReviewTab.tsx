// Clinician-controlled progression:
//   1 the system analyses the data → 2 identifies possibly relevant trends → 3 explains them →
//   4 the professional looks at the underlying records → 5 decides → 6 the decision and reasoning are
//   recorded → 7 if the program changes, a new version is created that cites this review.
// Nothing changes automatically. Saving a review never edits the program.

import { useState } from 'react';
import { href, navigate } from '../../app/router';
import { useI18n } from '../../i18n';
import { GOAL_STATUSES, OBSERVATION_RESPONSES, REVIEW_DECISIONS, type GoalStatus, type ObservationResponse, type ReviewDecision } from '../../rehab/model';
import { lastProgressReview, PROGRESS_ALGORITHM, RULES, unreviewed } from '../../rehab/progress';
import { recordReview } from '../../rehab/workflows';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { useActor, useObservationText, useSave, useXT } from './common';
import type { ParticipantData } from './data';
import { SummaryPanel } from './SummaryPanel';

export function ReviewTab({ data }: { data: ParticipantData }) {
  const { xt, L } = useXT();
  const { f } = useI18n();
  const actor = useActor('professional');
  const save = useSave();
  const text = useObservationText();
  const obs = data.observations;
  const [responses, setResponses] = useState<Record<string, { response: ObservationResponse; note: string }>>({});
  const [decision, setDecision] = useState<ReviewDecision>('continue');
  const [reasoning, setReasoning] = useState('');
  const [goalUpdates, setGoalUpdates] = useState<Record<string, GoalStatus>>({});
  const [showRules, setShowRules] = useState(false);
  const toAck = [...unreviewed(data.practice, data.reviews).map((p) => p.id), ...data.incidents.filter((i) => i.review !== null).map((i) => i.id).filter((id) => !data.reviews.some((r) => r.acknowledged.includes(id)))];
  const last = lastProgressReview(data.reviews);

  const submit = async () => {
    const { review, goals } = recordReview(
      {
        participantId: data.patient!.id,
        programKey: data.program?.id ?? null,
        periodFrom: last?.createdAt ?? data.program?.createdAt ?? null,
        observations: obs,
        responses: Object.entries(responses).map(([observationId, r]) => ({ observationId, ...r })),
        decision,
        reasoning,
        goalUpdates: Object.entries(goalUpdates).map(([goalId, status]) => ({ goalId, status })),
        acknowledged: toAck,
      },
      data.goals,
      data.patient!.workspace,
      actor.name,
    );
    if (!(await save([review, ...goals], actor))) return;
    setResponses({});
    setReasoning('');
    setGoalUpdates({});
    // Step 7: the professional edits the program; the new version will cite this review
    if (decision === 'modify_program' && data.program) navigate({ name: 'rehabParticipant', id: data.patient!.id, tab: 'program', review: review.id });
  };

  return (
    <div className="stack">
      <SummaryPanel data={data} />
      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{xt('Analytical observations')}</h2>
          <span className="muted small">
            {PROGRESS_ALGORITHM} · {xt('Observations describe data. They are not diagnoses or treatment recommendations and never change the program.')}
          </span>
        </div>
        {obs.length === 0 ? (
          <div className="card__body muted">{xt('No observations right now.')}</div>
        ) : (
          <ul className="rh-obs-list rh-obs-list--full">
            {obs.map((o) => {
              const tx = text(o);
              const r = responses[o.id];
              const rule = RULES.find((x) => x.id === o.ruleId);
              return (
                <li key={o.id} className={`rh-obs rh-obs--${o.category}`}>
                  <div className="rh-obs__head">
                    <span className={`badge ${o.severity === 'review' ? 'badge--warn' : 'badge--outline'}`}>{o.severity === 'review' ? xt('for review') : xt('information')}</span>
                    <strong>{tx.title}</strong>
                  </div>
                  <p className="small">{tx.detail}</p>
                  <details className="rh-obs__evidence">
                    <summary>{xt('Underlying data ({n})', { n: o.evidence.length })}</summary>
                    <ul className="small">
                      {o.evidence.map((e, i) => (
                        <li key={i}>
                          {e.ref === 'session' ? (
                            <a href={href({ name: 'session', id: e.id, complete: false })}>{xt('Sensor session')}</a>
                          ) : (
                            <span>{xt(e.ref)}</span>
                          )}{' '}
                          · {e.label} {e.value !== undefined && <span className="num">{typeof e.value === 'string' && /^\d{4}-\d\d-\d\dT/.test(e.value) ? f.dateCompact(e.value) : e.value}</span>} {e.unit}
                        </li>
                      ))}
                    </ul>
                    {rule && (
                      <p className="small muted">
                        {xt('Rule')} {rule.id} v{rule.version}: {rule.logic} <br />
                        {xt('Does not mean')}: {rule.notMeaning}
                      </p>
                    )}
                  </details>
                  <div className="row row--wrap">
                    <select className="select" aria-label={xt('Your assessment of this observation')} value={r?.response ?? ''} onChange={(e) => setResponses({ ...responses, [o.id]: { response: e.target.value as ObservationResponse, note: r?.note ?? '' } })}>
                      <option value="">{xt('Your assessment…')}</option>
                      {OBSERVATION_RESPONSES.map((x) => (
                        <option key={x} value={x}>
                          {L.response[x]}
                        </option>
                      ))}
                    </select>
                    {r && <input className="input rh-grow" aria-label={xt('Note')} placeholder={xt('Note')} value={r.note} onChange={(e) => setResponses({ ...responses, [o.id]: { ...r, note: e.target.value } })} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="card__footer">
          <Button size="sm" variant="ghost" aria-expanded={showRules} onClick={() => setShowRules(!showRules)}>
            {xt('All rules and thresholds')}
          </Button>
        </div>
        {showRules && (
          <div className="table-wrap">
            <table className="table table--compact">
              <tbody>
                {RULES.map((r) => (
                  <tr key={r.id}>
                    <td className="small">
                      <code>{r.id}</code> v{r.version}
                    </td>
                    <td className="small">{r.logic}</td>
                    <td className="small muted">{r.notMeaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{xt('Professional review')}</h2>
          <span className="muted small">{last ? xt('Last review {date}', { date: f.date(last.createdAt) }) : xt('No review yet')}</span>
        </div>
        <div className="card__body stack">
          <Field label={xt('Decision')}>
            <select className="select" value={decision} onChange={(e) => setDecision(e.target.value as ReviewDecision)}>
              {REVIEW_DECISIONS.filter((d) => d !== 'noted').map((d) => (
                <option key={d} value={d} disabled={d === 'modify_program' && !data.program}>
                  {L.decision[d]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={xt('Reasoning (required)')} hint={xt('What you looked at, what you concluded and why. Saved with the observations as they were shown.')}>
            <textarea className="textarea" rows={4} value={reasoning} onChange={(e) => setReasoning(e.target.value)} />
          </Field>
          {data.goals.length > 0 && (
            <div>
              <div className="field__label">{xt('Goal status updates (optional)')}</div>
              {data.goals.map((g) => (
                <div key={g.id} className="row row--wrap">
                  <span className="rh-grow">{g.description}</span>
                  <select className="select" aria-label={g.description} value={goalUpdates[g.id] ?? g.status} onChange={(e) => setGoalUpdates({ ...goalUpdates, [g.id]: e.target.value as GoalStatus })}>
                    {GOAL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {L.goalStatus[s]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
          <p className="muted small">{xt('{n} family reports and reviewed incidents will be marked as read by this review.', { n: toAck.length })}</p>
          {decision === 'modify_program' && <div className="callout callout--info">{xt('After saving, the program editor opens. The new version will cite this review; the current version stays unchanged.')}</div>}
        </div>
        <div className="card__footer">
          <Button variant="primary" disabled={!reasoning.trim()} onClick={() => void submit()}>
            {xt('Record review')}
          </Button>
        </div>
      </section>

      {data.reviews.length > 0 && (
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{xt('Review history')}</h2>
          </div>
          <ol className="rh-versions">
            {data.reviews.map((r) => (
              <li key={r.id}>
                <strong>{f.dateTime(r.createdAt)}</strong> · {r.createdBy} · {L.decision[r.decision]}
                {r.type === 'progress_review' && <span className="muted small"> · {xt('{n} observations', { n: r.observations.length })}</span>}
                {r.reasoning && <div className="rh-versions__reason">{r.reasoning}</div>}
                {data.programs.some((p) => p.basedOnReviewId === r.id) && <div className="small">{xt('→ program version {v}', { v: data.programs.find((p) => p.basedOnReviewId === r.id)!.version })}</div>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
