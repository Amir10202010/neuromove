// Exports of frozen analysis runs for independent analysis in Python or R.
//
// PSEUDONYMISED BY DEFAULT: the participant is a run-local pseudonym (never the name/code shown in the app, never
// the birth year), dates are replaced by study days relative to the first session, and session ids are replaced
// by run-local pseudonyms (the frozen run inside the app keeps the mapping for traceability). Small samples can
// still be re-identifiable — every export says so in its manifest. Raw data are exported separately (existing raw CSV) under the same rules.

import { cell } from '../research/export';
import type { SeriesAnalysis } from './analysis';
import { canonicalJson, sha256Hex } from './hash';
import { MODELS } from './models';
import type { AnalysisRun } from './runs';

export const LAB_EXPORT_FORMAT = 'neuromove-motor-learning-run';
export const LAB_EXPORT_SCHEMA = 1;

export function pseudonymFor(run: Pick<AnalysisRun, 'id' | 'participantId'>): string {
  return `P-${sha256Hex(`${run.id}|${run.participantId}`).slice(0, 8)}`;
}

/** Session ids can embed other ids (demo ids contain the participant id), so exports use run-local session pseudonyms. */
export function sessionPseudonym(run: Pick<AnalysisRun, 'id'>, sessionId: string): string {
  return `S-${sha256Hex(`${run.id}|${sessionId}`).slice(0, 10)}`;
}

function scrubber(run: AnalysisRun): (text: string) => string {
  const pairs: [string, string][] = run.inputs.map((x) => [x.sessionId, sessionPseudonym(run, x.sessionId)]);
  // longest first, so an id that is a prefix of another is not replaced inside it
  pairs.sort((a, b) => b[0].length - a[0].length);
  pairs.push([run.participantId, pseudonymFor(run)]);
  return (text) => pairs.reduce((t, [from, to]) => t.split(from).join(to), text);
}

/** Days since the earliest session in the run (dates are not exported by default). */
function dayOf(run: AnalysisRun, iso: string): number {
  const t0 = Math.min(...run.inputs.map((x) => Date.parse(x.startedAt)));
  return (Date.parse(iso) - t0) / 86_400_000;
}

export interface ExportOptions {
  includeDates: boolean;
}

export function runJson(run: AnalysisRun, o: ExportOptions = { includeDates: false }): string {
  const pseudo = pseudonymFor(run);
  const sc = scrubber(run);
  const scrub = <T extends object>(x: T): T => JSON.parse(sc(JSON.stringify(x)));
  const inputs = run.inputs.map((x) => ({ sessionId: sessionPseudonym(run, x.sessionId), studyDay: dayOf(run, x.startedAt), ...(o.includeDates ? { startedAt: x.startedAt } : {}), algorithmVersion: x.algorithmVersion, appVersion: x.appVersion }));
  const snapshot = run.snapshot.map((s) => scrub({ ...s, sessions: s.sessions.map((x) => ({ ...x, date: o.includeDates ? x.date : undefined, studyDay: dayOf(run, x.date) })) }));
  const body = {
    format: LAB_EXPORT_FORMAT,
    schema: LAB_EXPORT_SCHEMA,
    manifest: {
      runId: run.id,
      participant: pseudo,
      pseudonymised: true,
      datesIncluded: o.includeDates,
      simulatedData: run.simulated,
      engine: run.engine,
      versions: run.versions,
      protocol: run.protocol,
      configHash: run.configHash,
      snapshotHash: run.snapshotHash,
      resultHash: run.resultHash,
      warning: 'Pseudonymised, not anonymous: small datasets can be re-identifiable. Share only under the study data agreement.',
    },
    config: run.config,
    inputs,
    snapshot,
    results: run.results.map((r) => scrub(r)),
  };
  return sc(canonicalJson(body));
}

export const OBSERVATION_COLUMNS: [string, string, string][] = [
  ['run_id', '', 'Frozen analysis run'],
  ['participant', '', 'Run-local pseudonym'],
  ['exercise', '', 'Movement (task)'],
  ['side', '', 'left | right'],
  ['metric', '', 'IMU-derived metric (rehab/movement.ts METRICS)'],
  ['unit', '', 'Unit of value'],
  ['session_id', '', 'Run-local pseudonym of the source sensor session (the app maps it back inside the run)'],
  ['study_day', 'days', 'Days since the first session of the run'],
  ['session_index', '', '1-based order within the series'],
  ['repetition', '', '1-based repetition within the session'],
  ['value', 'unit', 'Per-repetition value, full precision (derived from measured IMU signals)'],
  ['included', '0/1', 'Used for model fitting'],
  ['exclusions', '', 'Quality issue codes or analyst exclusion, ";"-separated'],
  ['dose_before', 'minutes', 'Practice minutes since the previous included session; empty = unknown (no practice records)'],
  ['practice_count_before', '', 'Practice records since the previous included session'],
  ['simulated', '0/1', 'Simulated data (demo workspace)'],
  ['algorithm_version', '', 'Core algorithm that produced the stored metrics'],
];

export function observationsCsv(run: AnalysisRun): string {
  const pseudo = pseudonymFor(run);
  const rows = [OBSERVATION_COLUMNS.map((c) => c[0]).join(',')];
  for (const s of run.snapshot) {
    s.sessions.forEach((x, k) => {
      const reps = x.reps.length ? x.reps : [NaN];
      reps.forEach((v, r) => {
        rows.push(
          [run.id, pseudo, s.exercise, s.side, s.metric, s.unit, sessionPseudonym(run, x.sessionId), dayOf(run, x.date), k + 1, x.reps.length ? r + 1 : '', v, x.included, x.exclusions.join(';'), x.doseBefore, x.practiceCountBefore, x.simulated, x.algorithmVersion]
            .map((c) => cell(c as never))
            .join(','),
        );
      });
    });
  }
  return rows.join('\n') + '\n';
}

export const MODEL_COLUMNS: [string, string, string][] = [
  ['run_id', '', 'Frozen analysis run'],
  ['participant', '', 'Run-local pseudonym'],
  ['exercise', '', ''],
  ['side', '', ''],
  ['metric', '', ''],
  ['model', '', 'Candidate model id (research/mathematical-models.md)'],
  ['status', '', 'ok | insufficient_data | failed'],
  ['selected', '0/1', 'Chosen by the pre-specified selection rule'],
  ['k', '', 'Free parameters counted by AICc (σε shared, not counted)'],
  ['sessions', '', 'Included sessions'],
  ['log_lik', '', 'Maximised log-likelihood of session means'],
  ['aicc', '', 'Small-sample AIC'],
  ['delta_aicc', '', 'AICc − best AICc'],
  ['akaike_weight', '', ''],
  ['lfo_elpd', '', 'Leave-future-out expected log predictive density (common folds)'],
  ['lfo_mae', 'unit', 'Leave-future-out mean absolute error'],
  ['lfo_coverage95', '', 'Share of left-out sessions inside the 95 % plug-in interval'],
  ['identifiable', '0/1', 'All interpretable parameters have closed 95 % profile intervals'],
  ['parameters', '', 'name=estimate[lo;hi] — profile interval; "open" side = not bounded by the data'],
  ['sigma_e', 'unit', 'Pooled within-session SD (shared by all models)'],
  ['dose_mode', '', 'How dose was obtained (assumption unless practice_*)'],
];

export function modelsCsv(run: AnalysisRun): string {
  const pseudo = pseudonymFor(run);
  const rows = [MODEL_COLUMNS.map((c) => c[0]).join(',')];
  run.results.forEach((a: SeriesAnalysis, i) => {
    const s = run.snapshot[i]!;
    for (const r of a.comparison.rows) {
      const f = r.fit;
      const params = f.status === 'ok'
        ? MODELS[r.model].params
            .map((p, j) => {
              const pr = f.profiles.find((x) => x.param === p.name);
              const est = f.params[j] as number;
              return pr ? `${p.name}=${est}[${pr.loOpen ? 'open' : pr.lo};${pr.hiOpen ? 'open' : pr.hi}]` : `${p.name}=${est}`;
            })
            .join(' ')
        : '';
      rows.push(
        [run.id, pseudo, s.exercise, s.side, s.metric, r.model, f.status, a.selected === r.model, f.k, a.included, f.logLik, f.aicc, r.deltaAicc, r.weight, r.lfo?.elpd ?? null, r.lfo?.mae ?? null, r.lfo?.coverage95 ?? null, f.identifiable, params, Math.sqrt(a.comparison.prepared.sigmaE2), a.doseMode]
          .map((c) => cell(c as never))
          .join(','),
      );
    }
  });
  return rows.join('\n') + '\n';
}

export function dictionaryCsv(): string {
  const all = [...OBSERVATION_COLUMNS.map((c) => ['observations', ...c]), ...MODEL_COLUMNS.map((c) => ['models', ...c])];
  return ['file,column,unit,description', ...all.map((r) => r.map((c) => cell(c)).join(','))].join('\n') + '\n';
}

/** A short analysis script for independent re-analysis (shown in the report and included in the export). */
export const PYTHON_SNIPPET = `import pandas as pd
obs = pd.read_csv("observations.csv")
use = obs[obs.included == 1]
means = use.groupby(["exercise", "side", "metric", "session_index", "study_day"]).value.agg(["mean", "count", "std"]).reset_index()
models = pd.read_csv("models.csv")
print(models[models.selected == 1][["exercise", "side", "metric", "model", "aicc", "identifiable", "parameters"]])`;
