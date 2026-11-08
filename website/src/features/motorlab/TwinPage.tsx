// Computational Motor Twin — the individual, task-specific computational model of one participant, with its scope,
// state estimates, parameters, predictions, diagnostics, a counterfactual sandbox and a grounded assistant.

import { Lock, MessageSquareText, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { href } from '../../app/router';
import { PageHeader } from '../../layout/PageHeader';
import { DEFAULT_ANALYSIS_CONFIG, type SeriesAnalysis } from '../../lab/analysis';
import { answer, QUESTIONS, type Answer, type QuestionId } from '../../lab/copilot';
import type { LearningMetric, LearningSeries } from '../../lab/dataset';
import { bootstrap } from '../../lab/fit';
import { MODELS, reportValue } from '../../lab/models';
import { nextObservationAdvice, regularScenario, runScenario, type ScenarioResult } from '../../lab/sandbox';
import { buildTwin, TWIN_SCOPE } from '../../lab/twin';
import { useAppStore } from '../../state/appStore';
import { Button, LinkButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { TrajectoryChart } from './charts';
import { digitsFor, fmt, Interval, METRIC_LABEL, MODEL_LABEL, PARAM_LABEL, Prov, SimulatedBanner, useLabData, useNames, Warnings, withUnit } from './common';
import { useLT, type LKey, type LT } from './i18n';
import { useLabStore } from './store';

const TWIN_METRICS: LearningMetric[] = ['rom', 'peak_velocity', 'sparc', 'trunk', 'rep_duration'];

const SCOPE_TEXT: Record<string, LKey> = {
  task_performance_state: 'Task-specific performance state for each movement, side and metric',
  session_to_session_variability: 'Session-to-session (day-to-day) variability',
  repetition_variability: 'Repetition-to-repetition variability within a session',
  change_parameters_with_uncertainty: 'Individual change parameters with profile-likelihood uncertainty',
  model_conditional_predictions: 'Predictions conditional on the selected model and the dose assumption',
  neural_activity: 'Brain or neural activity — IMUs measure inertial signals only',
  muscle_activity_and_joint_torques: 'Muscle activity and joint torques',
  rotation_about_vertical: 'Rotation about the vertical (heading) — no magnetometer',
  absolute_position: 'Absolute hand or joint position',
  daily_life_function: 'Function in daily life',
  causes_of_change: 'Causes of change (practice, growth, recovery or measurement conditions)',
};

export function TwinPage({ id }: { id: string }) {
  const lt = useLT();
  const names = useNames();
  const { patients, sessions, practice, includeSimulated, ws } = useLabData();
  const patient = patients.find((p) => p.id === id);
  const [metric, setMetric] = useState<LearningMetric>('rom');
  const twin = useMemo(() => buildTwin(id, sessions, { includeSimulated, practice, metrics: [metric], config: DEFAULT_ANALYSIS_CONFIG }), [id, sessions, includeSimulated, practice, metric]);
  const [taskKey, setTaskKey] = useState<string | null>(null);
  const task = twin.tasks.find((t) => `${t.exercise}:${t.side}` === taskKey) ?? twin.tasks.find((t) => t.analyses[0]?.selected && t.analyses[0].selected !== 'stationary') ?? twin.tasks[0] ?? null;
  const a = task?.analyses[0] ?? null;
  const s = task?.series[0] ?? null;
  const freezeRun = useLabStore((st) => st.freezeRun);
  const profile = useAppStore((st) => st.profile);
  const [frozen, setFrozen] = useState<string | null>(null);
  if (!patient) return <div className="page"><EmptyState title={lt('Participant not found')} text={lt('The participant does not exist in this workspace.')} /></div>;
  const freeze = async () => {
    const run = await freezeRun({ workspace: ws, participantId: id, title: `${lt('Motor twin')} · ${lt(METRIC_LABEL[metric])}`, author: profile?.name ?? '', series: twin.tasks.flatMap((t) => t.series), config: DEFAULT_ANALYSIS_CONFIG, protocol: null });
    if (run) setFrozen(run.id);
  };
  return (
    <div className="page">
      <PageHeader
        back={{ href: href({ name: 'labOverview' }), label: lt('Motor learning lab') }}
        eyebrow={lt('Computational Motor Twin')}
        title={patient.code}
        lead={lt('An individual, task-specific computational model of observed movement performance and its change — not an avatar and not a model of the nervous system.')}
        actions={
          <>
            <LinkButton href={href({ name: 'labLearning', participant: id, task: task ? `${task.exercise}:${task.side}` : null, metric })}>{lt('Open in Explorer')}</LinkButton>
            <Button variant="primary" icon={<Lock />} onClick={() => void freeze()} disabled={!twin.tasks.length}>
              {lt('Freeze twin')}
            </Button>
          </>
        }
      />
      <SimulatedBanner show={includeSimulated || twin.simulated} />
      {frozen && (
        <div className="callout callout--good">
          <a href={href({ name: 'labRun', id: frozen })}>{lt('Frozen — open the report')}</a>
        </div>
      )}
      <section className="card card__body mlscope">
        <div>
          <div className="callout__title">{lt('The twin represents')}</div>
          <ul>{TWIN_SCOPE.represents.map((k) => <li key={k}>{lt(SCOPE_TEXT[k]!)}</li>)}</ul>
        </div>
        <div>
          <div className="callout__title">{lt('It cannot observe')}</div>
          <ul>{TWIN_SCOPE.cannotObserve.map((k) => <li key={k}>{lt(SCOPE_TEXT[k]!)}</li>)}</ul>
        </div>
      </section>
      <section className="card card__body mlfilters">
        <label className="field">
          <span className="field__label">{lt('Metric')}</span>
          <select className="select" value={metric} onChange={(e) => setMetric(e.target.value as LearningMetric)}>
            {TWIN_METRICS.map((m) => <option key={m} value={m}>{lt(METRIC_LABEL[m])}</option>)}
          </select>
        </label>
        <span className="mlmuted">{twin.engine} · {twin.sessions} {lt('sessions')}</span>
      </section>
      {!twin.tasks.length ? (
        <EmptyState title={lt('No sensor sessions')} text={lt('This participant has no stored sensor sessions in this workspace.')} />
      ) : (
        <>
          <section className="mlsection">
            <h2 className="section-title">{lt('Task states')}</h2>
            <div className="card mlscroll" tabIndex={0}>
              <table className="table table--compact mltable">
                <thead>
                  <tr>
                    <th>{lt('Task')}</th>
                    <th className="num">{lt('Sessions')}</th>
                    <th>{lt('Selected model')}</th>
                    <th className="num">{lt('Current state')}</th>
                    <th>{lt('Key parameter')}</th>
                    <th className="num">{lt('Next session (95 %)')}</th>
                    <th className="num">{lt('Warnings')}</th>
                  </tr>
                </thead>
                <tbody>
                  {twin.tasks.map((t) => {
                    const x = t.analyses[0]!;
                    const ser = t.series[0]!;
                    const k = `${t.exercise}:${t.side}`;
                    const cur = x.trajectory.at(-1);
                    const f = x.forecast[0];
                    return (
                      <tr key={k} className={`is-clickable${task && `${task.exercise}:${task.side}` === k ? ' is-selected' : ''}`} tabIndex={0} onClick={() => setTaskKey(k)} onKeyDown={(e) => e.key === 'Enter' && setTaskKey(k)}>
                        <td>{names.task(t.exercise, t.side)}</td>
                        <td className="num">{x.included}</td>
                        <td>{x.selected ? lt(MODEL_LABEL[x.selected]) : lt('none — insufficient data')}</td>
                        <td className="num">{cur ? withUnit(cur.mean, ser.unit) : '—'}</td>
                        <td><KeyParam a={x} lt={lt} unit={ser.unit} /></td>
                        <td className="num">{f ? `${fmt(f.obsLo, digitsFor(ser.unit))} – ${fmt(f.obsHi, digitsFor(ser.unit))}` : '—'}</td>
                        <td className="num">{x.warnings.filter((w) => w !== 'simulated_data' && w !== 'dose_from_practice_records').length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mlmuted"><Prov kind="estimated" /> {lt('Current state = the selected model’s latent performance at the last included session.')} <Prov kind="predicted" /> {lt('Next-session interval includes parameter uncertainty, day-to-day and repetition variability.')}</p>
          </section>
          {a && s && <TaskDetail key={`${s.key}`} a={a} s={s} lt={lt} title={names.task(s.exercise, s.side)} />}
          {a && <Assistant analyses={twin.tasks.map((t) => t.analyses[0]!)} series={twin.tasks.map((t) => t.series[0]!)} focus={a.seriesKey} lt={lt} />}
        </>
      )}
    </div>
  );
}

function KeyParam({ a, lt, unit }: { a: SeriesAnalysis; lt: LT; unit: string }) {
  if (!a.selected || a.selected === 'stationary') return <span className="mlmuted">{a.selected ? lt('no change detected') : '—'}</span>;
  const fit = a.comparison.rows.find((r) => r.model === a.selected)!.fit;
  const spec = MODELS[a.selected];
  const i = spec.params.findIndex((p) => p.interpretable && p.name !== 'asymptote' && p.name !== 'mu') ?? -1;
  const p = spec.params[i];
  const pr = p ? fit.profiles.find((x) => x.param === p.name) : undefined;
  if (!p || !pr) return <span>—</span>;
  const d = p.unit === 'days' ? 0 : digitsFor(unit);
  return (
    <span>
      {lt(PARAM_LABEL[p.name]!)} {fmt(reportValue(a.selected, i, fit.params[i] as number), d)} <Interval lo={reportValue(a.selected, i, pr.lo)} hi={reportValue(a.selected, i, pr.hi)} loOpen={pr.loOpen} hiOpen={pr.hiOpen} digits={d} />
    </span>
  );
}

function TaskDetail({ a, s, lt, title }: { a: SeriesAnalysis; s: LearningSeries; lt: LT; title: string }) {
  const lr = a.comparison.rows.find((r) => r.model === 'learning_retention')?.fit;
  const d = a.comparison.prepared;
  const hl = lr?.status === 'ok' ? lr.profiles.find((p) => p.param === 'retention_half_life_days') : undefined;
  const [count, setCount] = useState(4);
  const [interval, setInterval] = useState(7);
  const [dose, setDose] = useState(a.doseMode === 'practice_minutes' ? 30 : 1);
  const [halfLife, setHalfLife] = useState<number | null>(null);
  const [gain, setGain] = useState(1);
  const [compare, setCompare] = useState(true);
  const lrBoot = useMemo(() => {
    const f = a.comparison.rows.find((r) => r.model === 'learning_retention')?.fit;
    return f && f.status === 'ok' ? bootstrap(f, a.comparison.prepared, 150, DEFAULT_ANALYSIS_CONFIG.seed) : null;
  }, [a]);
  const scen: ScenarioResult[] = useMemo(() => {
    const lr = a.comparison.rows.find((r) => r.model === 'learning_retention')?.fit;
    const d = a.comparison.prepared;
    if (!lr || lr.status !== 'ok') return [];
    const main = runScenario(lr, d, lrBoot, { ...regularScenario(lt('Scenario'), count, interval, dose), halfLifeOverride: halfLife, gainMultiplier: gain });
    const out = [main];
    if (compare) out.push(runScenario(lr, d, lrBoot, { ...regularScenario(lt('No practice'), count, interval, 0), halfLifeOverride: halfLife, gainMultiplier: gain }));
    return out.filter((r) => r.supported);
  }, [a, lrBoot, count, interval, dose, halfLife, gain, compare, lt]);
  const advice = useMemo(() => {
    const f = a.comparison.rows.find((r) => r.model === a.selected)?.fit;
    return f && f.status === 'ok' ? nextObservationAdvice(f, a.comparison.prepared) : null;
  }, [a]);
  const digits = digitsFor(s.unit);
  const points = s.sessions.map((o, i) => ({ x: o.day - a.dayOffset, reps: o.reps, mean: o.mean, lo: a.decomposition.sessions[i]!.lo, hi: a.decomposition.sessions[i]!.hi, included: o.included, label: `${lt('Session')} ${i + 1}`, notes: o.exclusions }));
  // Learning–retention trajectory over the data for the sandbox view
  const lrTraj = lr?.status === 'ok' ? MODELS.learning_retention.trajectory(lr.params, d, Array.from({ length: 61 }, (_, i) => ((d.t[d.t.length - 1] ?? 0) * i) / 60)).map((v, i) => ({ t: ((d.t[d.t.length - 1] ?? 0) * i) / 60, mean: v, lo: v, hi: v })) : [];
  return (
    <section className="mlsection">
      <h2 className="section-title">{title} — {lt(METRIC_LABEL[s.metric])}</h2>
      <Warnings list={a.warnings} />
      <div className="card card__body">
        <TrajectoryChart
          title={lt('State history and selected model')}
          xLabel={lt('Days since the first included session')}
          yLabel={`${lt(METRIC_LABEL[s.metric])}, ${s.unit || lt('unitless')}`}
          points={points}
          model={a.trajectory}
          modelName={a.selected ? lt(MODEL_LABEL[a.selected]) : ''}
          forecast={a.forecast.map((f) => ({ t: f.t, mean: f.mean, lo: f.obsLo, hi: f.obsHi }))}
          forecastName={lt('Prediction for the next sessions (95 %)')}
          legend={{ observed: lt('Session mean ± 95 % CI'), reps: lt('Repetitions'), excluded: lt('Excluded session') }}
          empty={lt('No observations')}
          fmt={(v) => fmt(v, digits)}
        />
      </div>

      <div className="card card__body">
        <h3 className="card__title"><Sparkles aria-hidden /> {lt('Counterfactual sandbox')} <Prov kind="hypothetical" /></h3>
        {!lr || lr.status !== 'ok' ? (
          <p className="mlmuted">{lt('Scenarios need the learning–retention model (the only model with a dose term), fitted on at least 5 included sessions.')} {lr?.reason ?? ''}</p>
        ) : (
          <>
            <div className="callout callout--warn">{lt('Hypothetical: what the learning–retention model would predict under a schedule that did not happen. It depends on the model and on the dose assumption. It is not a recommendation and not evidence that any intervention works.')}</div>
            {a.selected !== 'learning_retention' && <p className="mlmuted">{lt('Note: the selected model is')} {a.selected ? lt(MODEL_LABEL[a.selected]) : '—'}; {lt('the sandbox uses learning–retention anyway because only it has a dose term (ΔAICc')} {fmt(a.comparison.rows.find((r) => r.model === 'learning_retention')!.deltaAicc, 1)}).</p>}
            <div className="mlfilters">
              <label className="field"><span className="field__label">{lt('Future sessions')}</span><input className="input" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
              <label className="field"><span className="field__label">{lt('Interval, days')}</span><input className="input" type="number" min={1} max={120} value={interval} onChange={(e) => setInterval(Math.max(1, Math.min(120, Number(e.target.value) || 1)))} /></label>
              <label className="field"><span className="field__label">{a.doseMode === 'practice_minutes' ? lt('Practice per interval, min') : lt('Dose units per interval (assumed)')}</span><input className="input" type="number" min={0} step={a.doseMode === 'practice_minutes' ? 5 : 0.5} value={dose} onChange={(e) => setDose(Math.max(0, Number(e.target.value) || 0))} /></label>
              <label className="field"><span className="field__label">{lt('Gain multiplier')}</span><input className="input" type="number" min={0} max={3} step={0.1} value={gain} onChange={(e) => setGain(Math.max(0, Number(e.target.value) || 0))} /></label>
              <label className="field">
                <span className="field__label">{lt('Retention half-life, days')}</span>
                <select className="select" value={halfLife ?? ''} onChange={(e) => setHalfLife(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{lt('as fitted')} ({fmt(lr.params[1], 0)})</option>
                  {hl && !hl.loOpen && <option value={hl.lo}>{lt('lower 95 % bound')} ({fmt(hl.lo, 0)})</option>}
                  {hl && !hl.hiOpen && <option value={hl.hi}>{lt('upper 95 % bound')} ({fmt(hl.hi, 0)})</option>}
                  {[7, 30, 90, 365].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="checkbox"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> {lt('Compare with no practice')}</label>
            </div>
            <TrajectoryChart
              title={lt('Hypothetical trajectories (learning–retention model)')}
              xLabel={lt('Days since the first included session')}
              yLabel={`${lt(METRIC_LABEL[s.metric])}, ${s.unit || lt('unitless')}`}
              points={points}
              model={lrTraj}
              modelName={lt(MODEL_LABEL.learning_retention)}
              scenarios={scen.map((r) => ({ name: r.label, t: r.t, mid: r.median, lo: r.lo, hi: r.hi }))}
              legend={{ observed: lt('Session mean ± 95 % CI'), reps: lt('Repetitions'), excluded: lt('Excluded session') }}
              empty={lt('No observations')}
              fmt={(v) => fmt(v, digits)}
            />
            <p className="mlmuted">{lt('Dashed lines: bootstrap median with 95 % band of the model’s latent state. Changing the half-life within its interval shows how sensitive the scenario is to the least certain parameter.')}</p>
          </>
        )}
      </div>

      <div className="card card__body">
        <h3 className="card__title">{lt('Which observation would be most informative next?')}</h3>
        {!advice ? (
          <p className="mlmuted">{lt('Needs a fitted parametric model with a rate parameter (linear, exponential or learning–retention).')}</p>
        ) : (
          <>
            <p className="mlmuted">{lt('Expected Fisher information at the current estimate (asymptotic, model-conditional). Larger reduction = the next session would narrow the focus parameter more.')} {lt('Focus')}: {advice.focus ? lt(PARAM_LABEL[advice.focus]!) : '—'}.</p>
            <div className="mlscroll" tabIndex={0}>
              <table className="table table--compact mltable">
                <thead><tr><th className="num">{lt('Days after last session')}</th><th>{lt('Condition')}</th><th className="num">{lt('SE reduction')}</th></tr></thead>
                <tbody>
                  {advice.options.map((o) => (
                    <tr key={`${o.afterDays}-${o.label}`}>
                      <td className="num">{o.afterDays}</td>
                      <td>{o.label === 'no_practice_probe' ? lt('retention probe (no practice in the delay)') : lt('practice continues')}</td>
                      <td className="num">{o.reduction === null ? '—' : `${fmt(o.reduction * 100, 0)} %`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mlmuted">{lt('A design question for researchers, not a treatment recommendation.')}</p>
          </>
        )}
      </div>
    </section>
  );
}

const QUESTION_TEXT: Record<QuestionId, LKey> = {
  change_summary: 'How did the movement characteristics change across sessions?',
  largest_change: 'Which measurement changed most?',
  change_vs_noise: 'Is the observed change larger than the measurement uncertainty?',
  model_fit: 'Does the selected model fit the observed data?',
  rate_uncertainty: 'How uncertain is the estimated rate parameter?',
  retention_sufficiency: 'Does the dataset contain sufficient retention observations?',
  poor_quality_sessions: 'Which sessions have poor signal quality?',
  next_observation: 'What additional observation would make the model more informative?',
};

function Assistant({ analyses, series, focus, lt }: { analyses: SeriesAnalysis[]; series: LearningSeries[]; focus: string; lt: LT }) {
  const [q, setQ] = useState<QuestionId>('change_vs_noise');
  const ans: Answer = useMemo(() => answer(q, { analyses, series }, focus), [q, analyses, series, focus]);
  return (
    <section className="mlsection">
      <h2 className="section-title"><MessageSquareText aria-hidden /> {lt('Research assistant')}</h2>
      <p className="mlmuted">{lt('Deterministic and grounded: every number comes from the analysis engine and every answer lists its evidence. No language model is used and no data leave this device.')}</p>
      <div className="card card__body mlanswer">
        <label className="field">
          <span className="field__label">{lt('Question')}</span>
          <select className="select" value={q} onChange={(e) => setQ(e.target.value as QuestionId)}>
            {QUESTIONS.map((x) => <option key={x} value={x}>{lt(QUESTION_TEXT[x])}</option>)}
          </select>
        </label>
        <div className="mlanswer__finding">{renderFinding(ans, lt)}</div>
        {ans.evidence.length > 0 && (
          <details>
            <summary>{lt('Evidence')} ({ans.evidence.length})</summary>
            <dl>
              {ans.evidence.map((e, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  <dt>{e.kind} · {e.label}</dt>
                  <dd>{typeof e.value === 'number' ? fmt(e.value, 3) : String(e.value ?? (e.kind === 'reference' ? `doi:${e.ref}` : '—'))}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        {ans.cannotConclude.length > 0 && (
          <div className="mlmuted">
            {lt('These data cannot establish')}: {ans.cannotConclude.map((c) => lt((CANNOT[c] ?? 'see documentation') as LKey)).join('; ')}
          </div>
        )}
      </div>
    </section>
  );
}

const CANNOT: Record<string, LKey> = {
  change_needs_two_included_sessions: 'change (fewer than two included sessions)',
  change_is_not_learning_without_retention: 'that a change is learning (that needs retention)',
  causes_of_change_not_identified: 'why the change happened',
  imu_metrics_not_clinical_function: 'clinical function (these are IMU-derived movement metrics)',
  noise_estimate_is_internal_not_an_mdc: 'a validated minimal detectable change (the noise estimate is internal)',
  no_reference_instrument_agreement: 'agreement with a reference instrument',
  fit_is_not_validity: 'scientific validity (fit is not validity)',
  few_sessions_low_power_diagnostics: 'model adequacy with confidence (few sessions, low power)',
  parameters_are_model_conditional: 'parameters outside this model',
  absence_of_evidence_is_not_evidence_of_absence: 'that nothing changed (absence of evidence is not evidence of absence)',
  retention_needs_designated_test_without_practice: 'retention, unless a designated test follows a delay without practice',
  quality_rules_are_processing_conditions: 'clinical data quality (rules are processing conditions)',
  design_advice_is_model_conditional: 'the value of a design outside this model',
  not_a_treatment_recommendation: 'any treatment recommendation',
};

function renderFinding(a: Answer, lt: LT): string {
  if (!a.finding) return lt('The data cannot answer this question.');
  const v = a.finding.values;
  const n = (k: string, d = 1) => fmt(Number(v[k]), d);
  switch (a.finding.key) {
    case 'needs_two_sessions':
      return lt('Not answerable: fewer than two included sessions.');
    case 'change_summary':
      return lt('{exceeding} of {series} task series changed by more than session-to-session variability.', { exceeding: String(v.exceeding), series: String(v.series) });
    case 'largest_change':
      return lt('Largest standardised change: {series} — Δ {delta} (SE {se}, z = {z}) over {days} days.', { series: String(v.series).split('|').slice(1).join(' · '), delta: n('delta'), se: n('se'), z: n('z', 2), days: n('days', 0) });
    case 'change_exceeds_noise':
      return lt('Yes. The change from the first to the last included session, {delta}, exceeds 1.96 × its SE ({threshold}).', { delta: n('delta'), threshold: n('threshold') });
    case 'change_within_noise':
      return lt('No. The change, {delta}, is within 1.96 × its SE ({threshold}). It cannot be told apart from repetition and day-to-day variability.', { delta: n('delta'), threshold: n('threshold') });
    case 'no_model':
      return lt('No model could be fitted to this series.');
    case 'model_fit':
      return lt('Selected: {model} (Akaike weight {weight}). Residual lag-1 autocorrelation {lag1} (p {pLag1}); leave-future-out MAE {lfoMae} vs {persistenceMae} for "same as last session" ({folds} folds).', { model: String(v.model), weight: n('weight', 2), lag1: n('lag1', 2), pLag1: n('pLag1', 2), lfoMae: n('lfoMae'), persistenceMae: n('persistenceMae'), folds: String(v.folds) });
    case 'no_rate_in_stationary':
      return lt('The selected model is "no change": there is no rate to estimate. That does not prove that nothing changed.');
    case 'rate_identifiable':
      return lt('All rate parameters of {model} have closed 95 % profile intervals (see evidence).', { model: String(v.model) });
    case 'rate_not_identifiable':
      return lt('Not determined by these data: {open} — its profile interval stays open.', { open: String(v.open) });
    case 'retention_tests_present':
      return lt('{tests} designated retention test(s) and {delayed} other delayed observation(s).', { tests: String(v.tests), delayed: String(v.delayed) });
    case 'only_delayed_observations':
      return lt('{delayed} delayed observation(s), but no designated retention test. Practice during the delay is unknown for {unknownPractice}.', { delayed: String(v.delayed), unknownPractice: String(v.unknownPractice) });
    case 'no_retention_observations':
      return lt('No retention observations: no delay of 14 days or more between included sessions.');
    case 'poor_quality_found':
      return lt('{sessions} session(s) failed a quality rule and are excluded from model fitting (see evidence).', { sessions: String(v.sessions) });
    case 'no_poor_quality':
      return lt('No session failed a quality rule.');
    case 'design_needs_parametric_model':
      return lt('Not answerable for this model: design advice needs a parametric model with a rate parameter.');
    case 'most_informative_next':
      return lt('A session {afterDays} days after the last one ({label}) would reduce the SE of {focus} by about {reduction} % (asymptotic, model-conditional).', { afterDays: String(v.afterDays), label: v.label === 'no_practice_probe' ? lt('retention probe (no practice in the delay)') : lt('practice continues'), focus: String(v.focus), reduction: fmt(Number(v.reduction) * 100, 0) });
    default:
      return lt('The data cannot answer this question.');
  }
}
