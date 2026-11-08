// Program Studio for one participant: current version, version history with what changed and why,
// and the editor. Every save is a new immutable version; nothing here is computed from data.

import { Copy, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { navigate } from '../../app/router';
import { useI18n } from '../../i18n';
import { MODULE_TYPES, MOVEMENT_DOMAINS, PROGRAM_STATUSES, type ActivityVersion, type ProgramDef, type ProgramVersion } from '../../rehab/model';
import { checkProgram, diffPrograms, emptyProgram, historyOf, instantiate, newAssignment, newModule, newProgramVersion, type ProgramProblem } from '../../rehab/programs';
import { newId } from '../../lib/ids';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { useActor, useSave, useXT } from './common';
import type { Labels } from './labels';
import { activityByKey, useLibrary, type ParticipantData } from './data';

const PROBLEMS: Record<ProgramProblem, string> = {
  name_required: 'A program name is required.',
  responsible_required: 'A responsible professional is required.',
  unknown_activity: 'An assignment points to an activity that does not exist.',
  draft_activity: 'Draft activities cannot be assigned. Approve the activity or mark it experimental first.',
  home_unsuitable_activity: 'An activity not marked suitable for home is assigned to home practice.',
  unknown_goal: 'An assignment refers to a goal of another participant.',
  review_before_start: 'The review date is before the start date.',
  reason_required: 'Describe why this new version is needed.',
  duplicate_ids: 'Duplicate module or assignment ids.',
};

export function moduleTitles(L: Labels): Record<(typeof MODULE_TYPES)[number], string> {
  return { assessment: `A — ${L.module.assessment}`, supervised: `B — ${L.module.supervised}`, home: `C — ${L.module.home}`, review: `D — ${L.module.review}`, reassessment: `E — ${L.module.reassessment}` };
}

export function ProgramTab({ data, reviewId }: { data: ParticipantData; reviewId: string | null }) {
  const { xt, L } = useXT();
  const { f } = useI18n();
  const actor = useActor('professional');
  const { templates } = useLibrary();
  const [editing, setEditing] = useState<{ seriesId?: string; def: ProgramDef; reason: string; template: boolean } | null>(() =>
    reviewId && data.program ? { seriesId: data.program.seriesId, def: structuredClone(data.program.def), reason: '', template: false } : null,
  );
  const cur = data.program;
  const history = cur ? historyOf(data.programs, cur.seriesId) : [];
  const otherSeries = [...new Set(data.programs.map((p) => p.seriesId))].filter((s) => s !== cur?.seriesId);

  if (editing)
    return (
      <ProgramEditor
        data={data}
        initial={editing}
        reviewId={reviewId}
        onDone={() => {
          setEditing(null);
          if (reviewId) navigate({ name: 'rehabParticipant', id: data.patient!.id, tab: 'program', review: null }, { replace: true });
        }}
      />
    );

  return (
    <div className="stack">
      {!cur ? (
        <section className="card">
          <EmptyState
            title={xt('No program yet')}
            text={xt('Build an individual program from the modular pathway (A–E) or from a template. The professional decides duration, frequency, intensity and activities.')}
            action={
              <div className="row row--wrap">
                <Button variant="primary" icon={<Plus />} onClick={() => setEditing({ def: { ...emptyProgram(data.profile?.assignedProfessional || actor.name, moduleTitles(L)), goalIds: data.goals.map((g) => g.id) }, reason: '', template: false })}>
                  {xt('New program')}
                </Button>
                {templates.length > 0 && (
                  <select className="select" aria-label={xt('Start from a template')} value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setEditing({ def: instantiate(t.def, actor.name), reason: '', template: false }); }}>
                    <option value="">{xt('Start from a template…')}</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.def.name} v{t.version}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            }
          />
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">
                {cur.def.name} <span className="muted">v{cur.version}</span> <span className={`badge ${cur.def.status === 'active' ? 'badge--good' : 'badge--outline'}`}>{L.programStatus[cur.def.status]}</span>
              </h2>
              <div className="row row--wrap">
                <Button variant="primary" size="sm" onClick={() => setEditing({ seriesId: cur.seriesId, def: structuredClone(cur.def), reason: '', template: false })}>
                  {xt('Edit → new version')}
                </Button>
                <Button size="sm" icon={<Copy />} onClick={() => setEditing({ def: { ...instantiate(cur.def, cur.def.responsible), goalIds: [] }, reason: '', template: true })}>
                  {xt('Save as template')}
                </Button>
              </div>
            </div>
            <ProgramView def={cur.def} activities={data.activities} goals={data.goals} />
          </section>
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">{xt('Version history')}</h2>
              <span className="muted small">{xt('Versions are never edited. Practice reports keep the version they followed.')}</span>
            </div>
            <ol className="rh-versions">
              {history.map((v) => {
                const prev = history.find((h) => h.id === v.previousKey);
                const changes = prev ? diffPrograms(prev.def, v.def) : [];
                return (
                  <li key={v.id}>
                    <strong>v{v.version}</strong> · {f.dateTime(v.createdAt)} · {v.createdBy}
                    {v.basedOnReviewId && <span className="badge badge--info">{xt('from a professional review')}</span>}
                    {v.changeReason && <div className="rh-versions__reason">{v.changeReason}</div>}
                    {changes.length > 0 && (
                      <ul className="rh-versions__changes">
                        {changes.map((c, i) => (
                          <li key={i}>
                            {xt(c.kind)}: {c.kind === 'field' ? xt(c.key) : (activityByKey(data.activities, c.key)?.def.name ?? c.key)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
            {otherSeries.length > 0 && <p className="card__body muted small">{xt('Earlier programs of this participant: {n}', { n: otherSeries.length })}</p>}
          </section>
        </>
      )}
    </div>
  );
}

function ProgramView({ def, activities, goals }: { def: ProgramDef; activities: readonly ActivityVersion[]; goals: ParticipantData['goals'] }) {
  const { xt, L } = useXT();
  const { f } = useI18n();
  return (
    <div className="card__body stack">
      {def.description && <p>{def.description}</p>}
      <dl className="kv rh-kv--compact">
        <dt>{xt('Responsible')}</dt>
        <dd>{def.responsible}</dd>
        <dt>{xt('Start / review')}</dt>
        <dd>
          {def.startDate ? f.date(def.startDate) : '—'} / {def.reviewDate ? f.date(def.reviewDate) : '—'}
        </dd>
        <dt>{xt('Planned')}</dt>
        <dd>
          {def.plannedWeeks ?? '—'} {xt('weeks')} · {def.plannedSessions ?? '—'} {xt('sessions')}
        </dd>
        <dt>{xt('Session structure')}</dt>
        <dd>{def.sessionStructure || '—'}</dd>
        <dt>{xt('Measurement requirements')}</dt>
        <dd>{def.measurementRequirements || '—'}</dd>
        <dt>{xt('Target goals')}</dt>
        <dd>{def.goalIds.map((id) => goals.find((g) => g.id === id)?.description).filter(Boolean).join('; ') || '—'}</dd>
      </dl>
      {def.modules.map((m) => (
        <div key={m.id} className="rh-module">
          <h3 className="rh-module__title">{m.title}</h3>
          {m.notes && <p className="muted small">{m.notes}</p>}
          {m.assignments.length === 0 ? (
            <p className="muted small">{xt('No activities assigned.')}</p>
          ) : (
            <ul className="rh-assign-list">
              {m.assignments.map((a) => {
                const act = activityByKey(activities, a.activityKey);
                return (
                  <li key={a.id}>
                    <strong>{act?.def.name ?? a.activityKey}</strong> <span className="muted">v{act?.version}</span> {act && act.status !== 'clinician_approved' && <span className="badge badge--warn">{L.activityStatus[act.status]}</span>} · {L.setting[a.setting]}
                    {a.frequencyPerWeek !== null && ` · ${a.frequencyPerWeek}× ${xt('per week')}`}
                    {a.durationMin !== null && ` · ${a.durationMin} ${xt('min')}`}
                    {a.feedbackTargetDeg !== null && ` · ${xt('child feedback target')} ${a.feedbackTargetDeg}°`}
                    {a.dosageNote && <div className="muted small">{a.dosageNote}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      {def.checkpoints.length > 0 && (
        <div>
          <div className="field__label">{xt('Review checkpoints')}</div>
          <ul className="rh-plain-list">
            {def.checkpoints.map((c) => (
              <li key={c.id}>
                {f.date(c.date)} — {c.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {def.notes && <p className="muted">{def.notes}</p>}
    </div>
  );
}

function ProgramEditor({ data, initial, reviewId, onDone }: { data: ParticipantData; initial: { seriesId?: string; def: ProgramDef; reason: string; template: boolean }; reviewId: string | null; onDone: () => void }) {
  const { xt, L } = useXT();
  const actor = useActor('professional');
  const save = useSave();
  const [def, setDef] = useState<ProgramDef>(initial.def);
  const [reason, setReason] = useState(initial.reason || (reviewId ? data.reviews.find((r) => r.id === reviewId)?.reasoning ?? '' : ''));
  const [newType, setNewType] = useState<(typeof MODULE_TYPES)[number]>('home');
  const existingVersions: ProgramVersion[] = initial.seriesId ? data.programs.filter((p) => p.seriesId === initial.seriesId) : [];
  const nextVersion = existingVersions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  const assignable = data.activities.filter((a) => a.status !== 'draft');
  const latestAssignable = [...new Map(assignable.sort((a, b) => a.version - b.version).map((a) => [a.seriesId, a])).values()];
  const problems = checkProgram(def, data.activities, initial.template ? null : data.goals.map((g) => g.id), { version: nextVersion, changeReason: reason });
  const set = <K extends keyof ProgramDef>(k: K, v: ProgramDef[K]) => setDef({ ...def, [k]: v });
  const setModule = (i: number, m: ProgramDef['modules'][number]) => set('modules', def.modules.map((x, j) => (j === i ? m : x)));

  const submit = async () => {
    const v = newProgramVersion(existingVersions, { seriesId: initial.seriesId, def, participantId: initial.template ? null : data.patient!.id, template: initial.template, changeReason: reason, basedOnReviewId: reviewId, workspace: data.patient!.workspace, author: actor.name });
    if (!v) return onDone();
    if (await save([v], actor)) onDone();
  };

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">{initial.template ? xt('New program template') : initial.seriesId ? xt('New version {v}', { v: nextVersion }) : xt('New program')}</h2>
        {reviewId && <span className="badge badge--info">{xt('from a professional review')}</span>}
      </div>
      <div className="card__body stack">
        <div className="callout callout--info">{xt('You decide every number below. NeuroMove does not suggest doses, frequencies or difficulty.')}</div>
        <div className="grid grid--2">
          <Field label={xt('Program name')}>
            <input className="input" value={def.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={xt('Responsible professional')}>
            <input className="input" value={def.responsible} onChange={(e) => set('responsible', e.target.value)} />
          </Field>
        </div>
        <Field label={xt('Description')}>
          <textarea className="textarea" rows={2} value={def.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        {!initial.template && (
          <fieldset className="chips">
            <legend className="field__label">{xt('Target goals')}</legend>
            {data.goals.map((g) => (
              <label key={g.id} className={`chip rh-chip${def.goalIds.includes(g.id) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={def.goalIds.includes(g.id)} onChange={(e) => set('goalIds', e.target.checked ? [...def.goalIds, g.id] : def.goalIds.filter((x) => x !== g.id))} />
                {g.description}
              </label>
            ))}
          </fieldset>
        )}
        <div className="grid grid--3">
          <Field label={xt('Movement domain')}>
            <select className="select" value={def.domain} onChange={(e) => set('domain', e.target.value as ProgramDef['domain'])}>
              {MOVEMENT_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {L.domain[d]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={xt('Start date')}>
            <input className="input" type="date" value={def.startDate?.slice(0, 10) ?? ''} onChange={(e) => set('startDate', e.target.value || null)} />
          </Field>
          <Field label={xt('Review date')}>
            <input className="input" type="date" value={def.reviewDate?.slice(0, 10) ?? ''} onChange={(e) => set('reviewDate', e.target.value || null)} />
          </Field>
          <Field label={xt('Planned duration, weeks')}>
            <input className="input" type="number" min={0} value={def.plannedWeeks ?? ''} onChange={(e) => set('plannedWeeks', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <Field label={xt('Number of sessions')}>
            <input className="input" type="number" min={0} value={def.plannedSessions ?? ''} onChange={(e) => set('plannedSessions', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <Field label={xt('Status')}>
            <select className="select" value={def.status} onChange={(e) => set('status', e.target.value as ProgramDef['status'])}>
              {PROGRAM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {L.programStatus[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={xt('Session structure')}>
          <textarea className="textarea" rows={2} value={def.sessionStructure} onChange={(e) => set('sessionStructure', e.target.value)} />
        </Field>
        <Field label={xt('Measurement requirements')}>
          <textarea className="textarea" rows={2} value={def.measurementRequirements} onChange={(e) => set('measurementRequirements', e.target.value)} />
        </Field>

        {def.modules.map((m, i) => (
          <fieldset key={m.id} className="rh-module rh-module--edit">
            <legend className="sr-only">{m.title}</legend>
            <div className="row row--between">
              <input className="input rh-module__title-input" aria-label={xt('Module title')} value={m.title} onChange={(e) => setModule(i, { ...m, title: e.target.value })} />
              <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={xt('Remove module')} onClick={() => set('modules', def.modules.filter((_, j) => j !== i))} />
            </div>
            <textarea className="textarea" rows={1} aria-label={xt('Module notes')} placeholder={xt('Module notes')} value={m.notes} onChange={(e) => setModule(i, { ...m, notes: e.target.value })} />
            {m.assignments.map((a, k) => {
              const setA = (patch: Partial<typeof a>) => setModule(i, { ...m, assignments: m.assignments.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
              const act = activityByKey(data.activities, a.activityKey);
              return (
                <div key={a.id} className="rh-assign-edit">
                  <div className="grid grid--3">
                    <Field label={xt('Activity')}>
                      <select className="select" value={a.activityKey} onChange={(e) => setA({ activityKey: e.target.value })}>
                        {act && act.status === 'draft' && <option value={act.id}>{act.def.name} ({L.activityStatus.draft})</option>}
                        {!latestAssignable.some((x) => x.id === a.activityKey) && act && act.status !== 'draft' && (
                          <option value={act.id}>
                            {act.def.name} v{act.version}
                          </option>
                        )}
                        {latestAssignable.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.def.name} v{x.version}
                            {x.status === 'experimental' ? ` (${L.activityStatus.experimental})` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={xt('Setting')}>
                      <select className="select" value={a.setting} onChange={(e) => setA({ setting: e.target.value as 'home' | 'clinic' })}>
                        <option value="clinic">{L.setting.clinic}</option>
                        <option value="home">{L.setting.home}</option>
                      </select>
                    </Field>
                    <Field label={xt('Times per week')}>
                      <input className="input" type="number" min={0} value={a.frequencyPerWeek ?? ''} onChange={(e) => setA({ frequencyPerWeek: e.target.value === '' ? null : Number(e.target.value) })} />
                    </Field>
                    <Field label={xt('Minutes')}>
                      <input className="input" type="number" min={0} value={a.durationMin ?? ''} onChange={(e) => setA({ durationMin: e.target.value === '' ? null : Number(e.target.value) })} />
                    </Field>
                    <Field label={xt('Child feedback target, °')} hint={xt('Optional; shown next to the last real measurement.')}>
                      <input className="input" type="number" value={a.feedbackTargetDeg ?? ''} onChange={(e) => setA({ feedbackTargetDeg: e.target.value === '' ? null : Number(e.target.value) })} />
                    </Field>
                    <Field label={xt('Goals')}>
                      <select className="select" multiple value={a.goalIds} onChange={(e) => setA({ goalIds: [...e.target.selectedOptions].map((o) => o.value) })}>
                        {data.goals.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.description}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid--2">
                    <Field label={xt('Dosage note (professional)')}>
                      <input className="input" value={a.dosageNote} onChange={(e) => setA({ dosageNote: e.target.value })} />
                    </Field>
                    <Field label={xt('Note for the family')}>
                      <input className="input" value={a.caregiverNote} onChange={(e) => setA({ caregiverNote: e.target.value })} />
                    </Field>
                  </div>
                  <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setModule(i, { ...m, assignments: m.assignments.filter((_, j) => j !== k) })}>
                    {xt('Remove activity')}
                  </Button>
                </div>
              );
            })}
            <Button size="sm" icon={<Plus />} disabled={!latestAssignable.length} onClick={() => setModule(i, { ...m, assignments: [...m.assignments, newAssignment(latestAssignable[0]!.id, m.type === 'home' ? 'home' : 'clinic')] })}>
              {xt('Assign activity')}
            </Button>
            {!latestAssignable.length && <span className="muted small"> {xt('Approve an activity in the library first.')}</span>}
          </fieldset>
        ))}
        <div className="row row--wrap">
          <select className="select" aria-label={xt('Module type')} value={newType} onChange={(e) => setNewType(e.target.value as typeof newType)}>
            {MODULE_TYPES.map((t) => (
              <option key={t} value={t}>
                {L.module[t]}
              </option>
            ))}
          </select>
          <Button size="sm" icon={<Plus />} onClick={() => set('modules', [...def.modules, newModule(newType, L.module[newType])])}>
            {xt('Add module')}
          </Button>
          <Button size="sm" icon={<Plus />} onClick={() => set('checkpoints', [...def.checkpoints, { id: newId('cp'), date: new Date().toISOString().slice(0, 10), label: xt('Checkpoint') }])}>
            {xt('Add checkpoint')}
          </Button>
        </div>
        {def.checkpoints.map((c, i) => (
          <div key={c.id} className="row row--wrap">
            <input className="input rh-input--short" type="date" aria-label={xt('Checkpoint date')} value={c.date.slice(0, 10)} onChange={(e) => set('checkpoints', def.checkpoints.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
            <input className="input" aria-label={xt('Checkpoint label')} value={c.label} onChange={(e) => set('checkpoints', def.checkpoints.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={xt('Remove')} onClick={() => set('checkpoints', def.checkpoints.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Field label={xt('Notes')}>
          <textarea className="textarea" rows={2} value={def.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {nextVersion > 1 && (
          <Field label={xt('Reason for this version (required)')}>
            <textarea className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {problems.length > 0 && (
          <ul className="callout callout--warn rh-problems" role="alert">
            {problems.map((p) => (
              <li key={p}>{xt(PROBLEMS[p])}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="card__footer">
        <Button onClick={onDone}>{xt('Cancel')}</Button>
        <Button variant="primary" icon={<Save />} disabled={problems.length > 0} onClick={() => void submit()}>
          {initial.template ? xt('Save template') : initial.seriesId ? xt('Save version {v}', { v: nextVersion }) : xt('Create program')}
        </Button>
      </div>
    </section>
  );
}
