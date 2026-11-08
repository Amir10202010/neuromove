// Learning dataset: stored sensor sessions → one series per (participant, task, metric) with the
// REPETITION-level observations kept, quality exclusions recorded (never silently dropped) and the
// practice dose between sessions attached when practice records exist.
//
// Built on the existing measurement layer (rehab/movement.ts → core/metrics.ts). Nothing is recomputed
// from raw data here: the values are exactly the per-repetition metrics stored in each Session by the
// algorithm version written in that Session.
//
// Provenance class of every value in a series: 'derived' (calculated from measured IMU signals by a
// documented algorithm). Model outputs built on top are 'estimated' / 'predicted' (see provenance.ts).

import { EXERCISES, type ExerciseId } from '../core/exercises';
import type { Session } from '../data/models';
import type { Side } from '../devices/types';
import type { PracticeRecord } from '../rehab/model';
import { METRICS, measureSession, type MetricId, type QualityIssue } from '../rehab/movement';
import { meanOf, varianceOf } from './numeric';

/** Metrics with per-repetition values — the only ones a repetition-level measurement model can use. */
export const LEARNING_METRICS = ['rom', 'peak_velocity', 'rep_duration', 'sparc', 'trunk', 'excursion', 'time_to_peak'] as const satisfies readonly MetricId[];
export type LearningMetric = (typeof LEARNING_METRICS)[number];

export const DAY_MS = 86_400_000;

export interface SessionObservation {
  sessionId: string;
  /** ISO start time of the sensor session. */
  date: string;
  /** Days since the first session of the series (fractional). */
  day: number;
  /** Per-repetition values in recording order (derived from measured IMU signals). */
  reps: number[];
  n: number;
  mean: number;
  /** Sample SD of repetitions; null with fewer than 2. */
  sd: number | null;
  /** Usable for model fitting: passed every quality rule AND not excluded by the analysis configuration. */
  included: boolean;
  /** Why it is not used (quality issue codes, or 'excluded_by_analyst: …'). Empty when included. */
  exclusions: string[];
  simulated: boolean;
  /**
   * Practice dose between the previous session of the series and this one (minutes from practice records),
   * null when the participant has no practice records at all (dose unknown, NOT zero).
   */
  doseBefore: number | null;
  /** Number of practice records counted in doseBefore. */
  practiceCountBefore: number | null;
  signalPercent: number;
  algorithmVersion: string;
  appVersion: string;
}

export interface LearningSeries {
  key: string;
  participantId: string;
  exercise: ExerciseId;
  side: Side;
  metric: LearningMetric;
  unit: string;
  /** Sessions in time order, including excluded ones (kept for display and audit). */
  sessions: SessionObservation[];
  /** Whether a practice dose could be attached (participant has practice records). */
  doseSource: 'practice_records' | 'unknown';
}

export const seriesKey = (participantId: string, exercise: ExerciseId, side: Side, metric: string): string => `${participantId}|${exercise}|${side}|${metric}`;

export interface DatasetOptions {
  /** Demo workspace: simulated sessions are the data (and are labelled so everywhere). Clinic: never. */
  includeSimulated: boolean;
  /** Session ids the analyst excluded, with a reason (part of the analysis configuration, so reproducible). */
  excluded?: Readonly<Record<string, string>>;
  /** Practice records of the participant(s); dose is attached only when present. */
  practice?: readonly PracticeRecord[];
}

/** Quality issues that make a step unusable as a learning observation (same rules as rehab/movement.ts). */
function blocking(issues: readonly QualityIssue[], includeSimulated: boolean): string[] {
  return issues.filter((i) => !(includeSimulated && i === 'simulated'));
}

/** Practice minutes in (from, to] for one participant; superseded records are skipped. */
export function practiceDose(practice: readonly PracticeRecord[], participantId: string, fromIso: string | null, toIso: string): { minutes: number; count: number } {
  const superseded = new Set(practice.map((p) => p.supersedes).filter((x): x is string => !!x));
  let minutes = 0;
  let count = 0;
  for (const p of practice) {
    if (p.participantId !== participantId || superseded.has(p.id)) continue;
    // 'stopped' = started and interrupted: it is practice, and its reported minutes say how much.
    if (p.completion === 'not_completed' || p.completion === null) continue;
    // Practice dates are calendar days; a practice on the day of an assessment counts BEFORE the next one only.
    const d = p.date.slice(0, 10);
    if (fromIso !== null && d < fromIso.slice(0, 10)) continue;
    if (fromIso !== null && d === fromIso.slice(0, 10)) continue;
    if (d >= toIso.slice(0, 10)) continue;
    minutes += p.durationMin ?? 0;
    count += 1;
  }
  return { minutes, count };
}

/**
 * Build every learning series of one participant. One series per (exercise, side, metric) that occurs in
 * the participant's sessions. A step repeated within a session: the last one counts (as movementSeries).
 */
export function buildParticipantSeries(participantId: string, sessions: readonly Session[], o: DatasetOptions): LearningSeries[] {
  const mine = sessions
    .filter((s) => s.patientId === participantId)
    .filter((s) => o.includeSimulated || !(s.demo || s.device.simulated || s.device.kind === 'simulator'))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const practice = (o.practice ?? []).filter((p) => p.participantId === participantId);
  const hasPractice = practice.length > 0;
  const by = new Map<string, LearningSeries>();
  for (const s of mine) {
    const perStep = new Map<string, ReturnType<typeof measureSession>[number]>();
    for (const m of measureSession(s)) perStep.set(`${m.exercise}:${m.side}`, m);
    for (const m of perStep.values()) {
      for (const metric of LEARNING_METRICS) {
        if (metric === 'trunk' && !EXERCISES[m.exercise].trunk) continue;
        const reps = (m.reps[metric] ?? []).filter((v) => Number.isFinite(v));
        const key = seriesKey(participantId, m.exercise, m.side, metric);
        let series = by.get(key);
        if (!series) {
          series = { key, participantId, exercise: m.exercise, side: m.side, metric, unit: METRICS[metric].unit, sessions: [], doseSource: hasPractice ? 'practice_records' : 'unknown' };
          by.set(key, series);
        }
        const exclusions = blocking(m.issues, o.includeSimulated);
        if (reps.length === 0) exclusions.push('no_values');
        const analyst = o.excluded?.[s.id];
        if (analyst !== undefined) exclusions.push(`excluded_by_analyst: ${analyst}`);
        series.sessions.push({
          sessionId: s.id,
          date: s.startedAt,
          day: 0,
          reps,
          n: reps.length,
          mean: reps.length ? meanOf(reps) : NaN,
          sd: reps.length >= 2 ? Math.sqrt(varianceOf(reps)) : null,
          included: exclusions.length === 0,
          exclusions,
          simulated: m.simulated,
          doseBefore: null,
          practiceCountBefore: null,
          signalPercent: m.signalPercent,
          algorithmVersion: s.algorithmVersion,
          appVersion: s.appVersion,
        });
      }
    }
  }
  for (const series of by.values()) {
    const t0 = Date.parse(series.sessions[0]?.date ?? '');
    let prevIncluded: string | null = null;
    for (const obs of series.sessions) {
      obs.day = (Date.parse(obs.date) - t0) / DAY_MS;
      if (hasPractice) {
        // Dose accumulates from the previous INCLUDED session (the model's previous state), so excluded
        // sessions do not swallow the practice that happened before them.
        const d = practiceDose(practice, participantId, prevIncluded, obs.date);
        obs.doseBefore = prevIncluded === null ? 0 : d.minutes;
        obs.practiceCountBefore = prevIncluded === null ? 0 : d.count;
      }
      if (obs.included) prevIncluded = obs.date;
    }
  }
  return [...by.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The included observations of a series, as model input. */
export interface ModelData {
  /** Days since the first INCLUDED session. */
  t: number[];
  /** Session means. */
  y: number[];
  /** Repetitions per session. */
  n: number[];
  /** Dose before each session (first = 0); null when unknown. */
  dose: (number | null)[];
  /** Within-session sums of squares and their degrees of freedom (for the measurement-noise estimate). */
  ss: number[];
  sessionIds: string[];
}

export function modelData(series: LearningSeries): ModelData {
  const inc = series.sessions.filter((s) => s.included);
  const t0 = inc[0]?.day ?? 0;
  return {
    t: inc.map((s) => s.day - t0),
    y: inc.map((s) => s.mean),
    n: inc.map((s) => s.n),
    dose: inc.map((s, i) => (i === 0 ? 0 : s.doseBefore)),
    ss: inc.map((s) => {
      const m = s.mean;
      return s.reps.reduce((a, v) => a + (v - m) * (v - m), 0);
    }),
    sessionIds: inc.map((s) => s.sessionId),
  };
}
