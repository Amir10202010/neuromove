// Study Designer — motor-learning study protocols: research question, hypothesis, tasks and their roles,
// trial structure, practice and feedback, schedule with retention checkpoints, required measurements and a
// pre-specified analysis plan. Versions are content-hashed; a frozen version never changes.

import { Archive, Calculator, Lock, Plus, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { href } from '../../app/router';
import { EXERCISE_IDS, type ExerciseId } from '../../core/exercises';
import { PageHeader } from '../../layout/PageHeader';
import { buildParticipantSeries, LEARNING_METRICS, type LearningMetric } from '../../lab/dataset';
import { compareModels } from '../../lab/fit';
import { modelData } from '../../lab/dataset';
import { DOSE_MODES, MODEL_IDS, type ModelId } from '../../lab/models';
import { emptyProtocol, FEEDBACK_KINDS, planPower, PRACTICE_STRUCTURES, protocolIntact, TASK_ROLES, TASK_SIDES, validateProtocol, type LearningProtocolDef, type LearningProtocolVersion, type PowerPlan, type ProtocolProblem } from '../../lab/protocol';
import { useAppStore } from '../../state/appStore';
import { Button } from '../../ui/Button';
import { fmt, METRIC_LABEL, MODEL_LABEL, useLabData, useNames } from './common';
import { useLT, type LKey } from './i18n';
import { useLabRecords, useLabStore } from './store';

const PROBLEM: Record<ProtocolProblem, LKey> = {
  title_required: 'A title is required.',
  question_required: 'A research question is required.',
  hypothesis_required: 'A hypothesis is required (it may be "no change").',
  task_required: 'Add at least one task.',
  duplicate_task: 'The same task appears twice.',
  primary_metric_invalid: 'Choose a primary metric.',
  repetitions_invalid: 'Repetitions per assessment: 1–50.',
  sessions_invalid: 'Acquisition sessions: 2–200.',
  interval_invalid: 'Interval: 1–365 days.',
  retention_delay_not_longer_than_interval: 'The retention delay must be longer than the usual interval, otherwise it is not a delay.',
  no_candidate_model: 'Choose at least one candidate model.',
  stationary_model_required: '"No change" must stay a candidate model.',
  transfer_needs_trained_task: 'A transfer task needs at least one trained task.',
  feedback_frequency_invalid: 'Feedback frequency: 0–100 %.',
  dose_mode_invalid: 'Unknown dose mode.',
};

export function StudyDesignerPage() {
  const lt = useLT();
  const names = useNames();
  const { ws, patients, sessions, practice, includeSimulated } = useLabData();
  const { protocols } = useLabRecords(ws);
  const saveProtocol = useLabStore((s) => s.saveProtocol);
  const setStatus = useLabStore((s) => s.setProtocolStatus);
  const profile = useAppStore((s) => s.profile);
  const [base, setBase] = useState<LearningProtocolVersion | null>(null);
  const [def, setDef] = useState<LearningProtocolDef>(emptyProtocol());
  const [plan, setPlan] = useState<PowerPlan | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const problems = validateProtocol(def);
  const set = <K extends keyof LearningProtocolDef>(k: K, v: LearningProtocolDef[K]) => setDef({ ...def, [k]: v });
  const latest = useMemo(() => {
    const by = new Map<string, LearningProtocolVersion>();
    for (const p of protocols) if (!by.has(p.protocolId) || by.get(p.protocolId)!.version < p.version) by.set(p.protocolId, p);
    return [...by.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [protocols]);
  // Noise for the power check: pooled from this workspace's series of the primary metric (σε, σs of the stationary fit)
  const noise = useMemo(() => {
    const se: number[] = [];
    const ss: number[] = [];
    for (const p of patients) {
      for (const s of buildParticipantSeries(p.id, sessions, { includeSimulated, practice })) {
        if (s.metric !== def.primaryMetric || s.sessions.filter((x) => x.included).length < 4) continue;
        const c = compareModels(modelData(s), { doseMode: 'per_visit', models: ['stationary'] });
        const f = c.rows[0]!.fit;
        if (f.status !== 'ok') continue;
        se.push(Math.sqrt(c.prepared.sigmaE2));
        ss.push(f.params[1] as number);
      }
    }
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
    return se.length >= 3 ? { sigmaE: med(se), sigmaS: med(ss), source: 'workspace_estimate' as const, n: se.length } : { sigmaE: 4, sigmaS: 2.5, source: 'assumed' as const, n: 0 };
  }, [patients, sessions, includeSimulated, practice, def.primaryMetric]);
  const save = async () => {
    const v = await saveProtocol(def, ws, profile?.name ?? '', base);
    if (v) {
      setBase(v);
      setMsg(`${lt('Saved as version')} ${v.version}`);
    }
  };
  const open = (v: LearningProtocolVersion) => {
    setBase(v);
    setDef(structuredClone(v.def));
    setPlan(null);
    setMsg(null);
  };
  const frozen = base?.status === 'frozen' || base?.status === 'archived';
  return (
    <div className="page">
      <PageHeader back={{ href: href({ name: 'labOverview' }), label: lt('Motor learning lab') }} title={lt('Study Designer')} lead={lt('Design a motor-learning study before collecting data: what is asked, what is measured, how practice is structured and how the data will be analysed.')} />
      <section className="mlsection">
        <h2 className="section-title">{lt('Protocols')}</h2>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable">
            <thead><tr><th>{lt('Title')}</th><th className="num">{lt('Version')}</th><th>{lt('Status')}</th><th>{lt('Definition hash')}</th><th /></tr></thead>
            <tbody>
              {latest.map((v) => (
                <tr key={v.id} className={base?.protocolId === v.protocolId ? 'is-selected' : ''}>
                  <td>{v.def.title}</td>
                  <td className="num">{v.version}</td>
                  <td>{lt(v.status === 'draft' ? 'draft' : v.status === 'frozen' ? 'frozen' : 'archived')} {!protocolIntact(v) && <span className="badge badge--critical">{lt('hash mismatch')}</span>}</td>
                  <td className="mlmono">{v.defHash.slice(0, 16)}…</td>
                  <td className="mlrow">
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => open(v)}>{lt('Open')}</button>
                    {v.status === 'draft' && <button type="button" className="btn btn--ghost btn--sm" onClick={() => void setStatus(v, 'frozen')}><Lock aria-hidden /> {lt('Freeze')}</button>}
                    {v.status !== 'archived' && <button type="button" className="btn btn--ghost btn--sm" onClick={() => void setStatus(v, 'archived')}><Archive aria-hidden /> {lt('Archive')}</button>}
                  </td>
                </tr>
              ))}
              {!latest.length && <tr><td colSpan={5} className="mlmuted">{lt('No protocols yet.')}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mlrow">
          <Button icon={<Plus />} onClick={() => { setBase(null); setDef(emptyProtocol()); setPlan(null); setMsg(null); }}>{lt('New protocol')}</Button>
          <span className="mlmuted">{lt('Protocols are stored on this device (not yet part of team sync).')}</span>
        </div>
      </section>

      <section className="card card__body mlform" aria-label={lt('Protocol definition')}>
        {frozen && <div className="callout callout--info">{lt('This version is frozen. Saving creates a new version; the frozen definition never changes.')}</div>}
        <h2 className="card__title">{base ? `${base.def.title} · v${base.version}` : lt('New protocol')}</h2>
        <Text label={lt('Title')} v={def.title} on={(v) => set('title', v)} />
        <Text label={lt('Research question')} v={def.researchQuestion} on={(v) => set('researchQuestion', v)} area />
        <Text label={lt('Hypothesis')} v={def.hypothesis} on={(v) => set('hypothesis', v)} area />
        <div className="mlgrid mlgrid--2">
          <Text label={lt('Eligibility')} v={def.eligibility} on={(v) => set('eligibility', v)} area />
          <Text label={lt('Exclusion criteria')} v={def.exclusionCriteria} on={(v) => set('exclusionCriteria', v)} area />
        </div>
        <fieldset className="mlform">
          <legend className="field__label">{lt('Tasks')}</legend>
          {def.tasks.map((t, i) => (
            <div key={i} className="mlfilters">
              <select className="select" aria-label={lt('Movement')} value={t.exercise} onChange={(e) => set('tasks', def.tasks.map((x, j) => (j === i ? { ...x, exercise: e.target.value as ExerciseId } : x)))}>
                {EXERCISE_IDS.map((e) => <option key={e} value={e}>{names.exercise(e)}</option>)}
              </select>
              <select className="select" aria-label={lt('Side')} value={t.side} onChange={(e) => set('tasks', def.tasks.map((x, j) => (j === i ? { ...x, side: e.target.value as typeof t.side } : x)))}>
                {TASK_SIDES.map((s) => <option key={s} value={s}>{lt(s === 'left' ? 'left' : s === 'right' ? 'right' : s === 'affected' ? 'more affected side' : 'less affected side')}</option>)}
              </select>
              <select className="select" aria-label={lt('Role')} value={t.role} onChange={(e) => set('tasks', def.tasks.map((x, j) => (j === i ? { ...x, role: e.target.value as typeof t.role } : x)))}>
                {TASK_ROLES.map((r) => <option key={r} value={r}>{lt(r === 'trained' ? 'trained' : r === 'transfer' ? 'transfer (not practised)' : 'assessment only')}</option>)}
              </select>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => set('tasks', def.tasks.filter((_, j) => j !== i))}>{lt('Remove')}</button>
            </div>
          ))}
          <div><button type="button" className="btn btn--ghost btn--sm" onClick={() => set('tasks', [...def.tasks, { exercise: 'shoulder_flexion', side: 'less_affected', role: 'transfer' }])}>{lt('Add task')}</button></div>
        </fieldset>
        <div className="mlfilters">
          <label className="field"><span className="field__label">{lt('Primary metric')}</span>
            <select className="select" value={def.primaryMetric} onChange={(e) => set('primaryMetric', e.target.value as LearningMetric)}>{LEARNING_METRICS.map((m) => <option key={m} value={m}>{lt(METRIC_LABEL[m])}</option>)}</select>
          </label>
          <Num label={lt('Repetitions per assessment')} v={def.trial.repetitionsPerAssessment} on={(v) => set('trial', { ...def.trial, repetitionsPerAssessment: v })} />
          <Num label={lt('Practice blocks per session')} v={def.trial.practiceBlocksPerSession} on={(v) => set('trial', { ...def.trial, practiceBlocksPerSession: v })} />
          <Num label={lt('Repetitions per block')} v={def.trial.repetitionsPerBlock} on={(v) => set('trial', { ...def.trial, repetitionsPerBlock: v })} />
        </div>
        <div className="mlfilters">
          <label className="field"><span className="field__label">{lt('Feedback')}</span>
            <select className="select" value={def.practice.feedback} onChange={(e) => set('practice', { ...def.practice, feedback: e.target.value as typeof def.practice.feedback })}>
              {FEEDBACK_KINDS.map((f) => <option key={f} value={f}>{lt(f === 'none' ? 'none' : f === 'knowledge_of_results' ? 'knowledge of results' : f === 'knowledge_of_performance' ? 'knowledge of performance' : 'live sensor feedback')}</option>)}
            </select>
          </label>
          <Num label={lt('Feedback frequency, %')} v={def.practice.feedbackFrequencyPercent} on={(v) => set('practice', { ...def.practice, feedbackFrequencyPercent: v })} />
          <label className="field"><span className="field__label">{lt('Practice structure')}</span>
            <select className="select" value={def.practice.structure} onChange={(e) => set('practice', { ...def.practice, structure: e.target.value as typeof def.practice.structure })}>
              {PRACTICE_STRUCTURES.map((p) => <option key={p} value={p}>{lt(p === 'constant' ? 'constant' : p === 'blocked' ? 'blocked' : 'random (contextual interference)')}</option>)}
            </select>
          </label>
        </div>
        <div className="mlfilters">
          <Num label={lt('Acquisition sessions')} v={def.schedule.acquisitionSessions} on={(v) => set('schedule', { ...def.schedule, acquisitionSessions: v })} />
          <Num label={lt('Interval, days')} v={def.schedule.intervalDays} on={(v) => set('schedule', { ...def.schedule, intervalDays: v })} />
          <Num label={lt('Retention delay, days')} v={def.schedule.retentionDelayDays} on={(v) => set('schedule', { ...def.schedule, retentionDelayDays: v })} />
          <Num label={lt('Retention tests')} v={def.schedule.retentionTests} on={(v) => set('schedule', { ...def.schedule, retentionTests: v })} />
        </div>
        <Text label={lt('Transfer conditions')} v={def.transferConditions} on={(v) => set('transferConditions', v)} area />
        <Text label={lt('Sensor configuration')} v={def.sensorConfiguration} on={(v) => set('sensorConfiguration', v)} />
        <div className="mlrow">
          <label className="checkbox"><input type="checkbox" checked={def.calibration.standStill} onChange={(e) => set('calibration', { ...def.calibration, standStill: e.target.checked })} /> {lt('Stand-still calibration')}</label>
          <label className="checkbox"><input type="checkbox" checked={def.calibration.sixPoseAccelerometer} onChange={(e) => set('calibration', { ...def.calibration, sixPoseAccelerometer: e.target.checked })} /> {lt('Six-position accelerometer calibration')}</label>
          <label className="checkbox"><input type="checkbox" checked={def.requiredMeasurements.raw100Hz} onChange={(e) => set('requiredMeasurements', { ...def.requiredMeasurements, raw100Hz: e.target.checked })} /> {lt('Keep raw 100 Hz frames')}</label>
          <label className="checkbox"><input type="checkbox" checked={def.requiredMeasurements.practiceLog} onChange={(e) => set('requiredMeasurements', { ...def.requiredMeasurements, practiceLog: e.target.checked })} /> {lt('Practice log (dose)')}</label>
          <label className="checkbox"><input type="checkbox" checked={def.requiredMeasurements.goniometerReference} onChange={(e) => set('requiredMeasurements', { ...def.requiredMeasurements, goniometerReference: e.target.checked })} /> {lt('Goniometer reference')}</label>
        </div>
        <fieldset className="mlform">
          <legend className="field__label">{lt('Analysis plan (pre-specified)')}</legend>
          <div className="mlrow">
            {MODEL_IDS.map((m: ModelId) => (
              <label key={m} className="checkbox">
                <input type="checkbox" checked={def.analysisPlan.candidateModels.includes(m)} onChange={(e) => set('analysisPlan', { ...def.analysisPlan, candidateModels: e.target.checked ? [...def.analysisPlan.candidateModels, m] : def.analysisPlan.candidateModels.filter((x) => x !== m) })} /> {lt(MODEL_LABEL[m])}
              </label>
            ))}
          </div>
          <div className="mlfilters">
            <label className="field"><span className="field__label">{lt('Dose')}</span>
              <select className="select" value={def.analysisPlan.doseMode} onChange={(e) => set('analysisPlan', { ...def.analysisPlan, doseMode: e.target.value as typeof def.analysisPlan.doseMode })}>
                <option value="auto">{lt('automatic (practice log if present)')}</option>
                {DOSE_MODES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <NumOpt label={lt('Smallest change of interest per week')} v={def.analysisPlan.smallestEffectPerWeek} on={(v) => set('analysisPlan', { ...def.analysisPlan, smallestEffectPerWeek: v })} />
            <NumOpt label={lt('External MDC (reliability study)')} v={def.analysisPlan.externalMdc} on={(v) => set('analysisPlan', { ...def.analysisPlan, externalMdc: v })} />
          </div>
        </fieldset>
        {problems.length > 0 && <ul className="mlwarnings">{problems.map((p) => <li key={p}>{lt(PROBLEM[p])}</li>)}</ul>}
        <div className="mlrow">
          <Button variant="primary" icon={<Save />} onClick={() => void save()} disabled={problems.length > 0}>{base ? lt('Save as new version') : lt('Save')}</Button>
          <Button icon={<Calculator />} disabled={def.analysisPlan.smallestEffectPerWeek === null} onClick={() => setPlan(planPower(def, noise, 60))}>{lt('Check power of this schedule')}</Button>
          {msg && <span className="badge badge--good">{msg}</span>}
        </div>
        {plan && (
          <div className="callout callout--info">
            <div>
              <div className="callout__title">{lt('Simulation-based power')} ({plan.seeds} {lt('simulated studies')})</div>
              {lt('With {sessions} sessions every {interval} days and {reps} repetitions, a true change of {effect} per week is detected in {power} % of simulated studies; with no change, a change is wrongly selected in {fp} %.', { sessions: String(plan.sessions), interval: String(plan.intervalDays), reps: String(plan.repetitions), effect: fmt(plan.effectPerWeek, 1), power: fmt(plan.power * 100, 0), fp: fmt(plan.falseChange * 100, 0) })}{' '}
              {plan.noiseSource === 'workspace_estimate' ? lt('Noise (σε {se}, σs {ss}) estimated from {n} series in this workspace.', { se: fmt(plan.sigmaE, 1), ss: fmt(plan.sigmaS, 1), n: String(noise.n) }) : lt('Noise (σε {se}, σs {ss}) ASSUMED — fewer than 3 series in this workspace to estimate it.', { se: fmt(plan.sigmaE, 1), ss: fmt(plan.sigmaS, 1) })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Text({ label, v, on, area }: { label: string; v: string; on: (v: string) => void; area?: boolean }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {area ? <textarea className="input" value={v} onChange={(e) => on(e.target.value)} /> : <input className="input" value={v} onChange={(e) => on(e.target.value)} />}
    </label>
  );
}
function Num({ label, v, on }: { label: string; v: number; on: (v: number) => void }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="input" type="number" value={v} onChange={(e) => on(Number(e.target.value))} />
    </label>
  );
}
function NumOpt({ label, v, on }: { label: string; v: number | null; on: (v: number | null) => void }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="input" type="number" step="0.1" value={v ?? ''} onChange={(e) => on(e.target.value === '' ? null : Number(e.target.value))} />
    </label>
  );
}
