// Research dataset export: tidy CSV (one row per trial) + data dictionary + JSON with full metadata.
//
// Made for pandas / NumPy / SciPy:
//   df = pd.read_csv('neuromove-validation-….csv', comment='#')
//   valid = df[(df.status == 'valid') & (df.is_current == 1)]
// Numbers are written at full precision (shortest round-trip representation) — no rounding.
// Errors are derived columns: signed_error_deg = imu_angle_deg − reference_deg.
// Participants appear only by their pseudonymous code and internal id.

import { csvCell } from '../data/export';
import type { Patient } from '../data/models';
import type { ProtocolVersion, Trial, ValidationSession } from './model';
import { agreement, errorSummary, flagPairs, icc, rangeAgreement, sufficiency } from './stats';
import { counts, currentTrials, validPairs } from './workflow';

/** Full-precision CSV cell (numbers unrounded); strings keep the formula-injection guard of csvCell. */
export function cell(v: string | number | boolean | null | undefined): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return csvCell(v);
}

export const DATASET_FORMAT = 'neuromove-validation-dataset';
export const DATASET_SCHEMA_VERSION = 1;

/** Column → [unit, description]. Order = column order in the CSV. */
export const COLUMNS: [string, string, string][] = [
  ['dataset_id', '', 'Unique id of this export; a new export never reuses an id'],
  ['session_id', '', 'Validation session id'],
  ['participant_id', '', 'Internal participant id'],
  ['participant_code', '', 'Pseudonymous participant code (no personal names should be used)'],
  ['protocol_key', '', 'Protocol id @ version the session ran under (immutable)'],
  ['protocol_name', '', 'Protocol name at that version'],
  ['protocol_version', '', 'Protocol version number'],
  ['joint', '', 'Joint label from the protocol'],
  ['exercise', '', 'Software angle definition (core/exercises.ts)'],
  ['side', '', 'left | right'],
  ['set', '', 'Set number (1-based)'],
  ['repetition', '', 'Repetition number within the set (1-based)'],
  ['point_id', '', 'Measurement point id within the protocol'],
  ['point_kind', '', 'max_flexion | max_extension | neutral | custom'],
  ['point_label', '', 'Measurement point label'],
  ['attempt', '', 'Attempt number for this slot; repeats create a new attempt'],
  ['status', '', 'valid | invalid | skipped | superseded | pending_reference'],
  ['is_current', '0/1', '1 = latest non-superseded attempt of the slot (use this for analysis)'],
  ['imu_angle_deg', 'deg', 'Joint angle from the IMU pipeline for this trial'],
  ['reference_deg', 'deg', 'Reference goniometer angle entered by the operator'],
  ['signed_error_deg', 'deg', 'imu_angle_deg − reference_deg'],
  ['abs_error_deg', 'deg', '|imu_angle_deg − reference_deg|'],
  ['capture_method', '', 'hold (median of window) | rep_peak (extreme of repetition)'],
  ['window_from_s', 's', 'Start of the capture window, device time from engine start'],
  ['window_to_s', 's', 'End of the capture window, device time from engine start'],
  ['window_samples', 'count', 'Samples in the capture window'],
  ['window_sd_deg', 'deg', 'SD of the joint angle inside the capture window (stability)'],
  ['window_min_deg', 'deg', 'Minimum joint angle inside the capture window'],
  ['window_max_deg', 'deg', 'Maximum joint angle inside the capture window'],
  ['captured_at', 'ISO 8601', 'Wall-clock time of the IMU capture'],
  ['reference_at', 'ISO 8601', 'Wall-clock time the reference value was saved'],
  ['flags', '', 'Review flags (space-separated): outside_loa robust_outlier above_review_threshold unstable_hold. Nothing is removed'],
  ['reason', '', 'Reason for invalid / skipped / superseded'],
  ['notes', '', 'Operator notes'],
  ['operator', '', 'Operator who recorded the trial'],
  ['device_kind', '', 'usb | ble | replay | simulator'],
  ['device_name', '', 'Device name from the passport'],
  ['firmware', '', 'Firmware version from the passport'],
  ['rate_hz', 'Hz', 'Nominal sample rate from the passport'],
  ['simulated', '0/1', '1 = simulated data (never real measurements)'],
  ['sensor_modules', '', 'placement=module-id pairs from the passport'],
  ['algorithm_version', '', 'Processing algorithm version (core/version.ts)'],
  ['app_version', '', 'Application version'],
];

export interface DatasetFilter {
  sessionIds: string[];
  includeSuperseded: boolean;
}

export function newDatasetId(now = new Date()): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `ds-${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}-${rnd}`;
}

function rowFlags(session: ValidationSession, trials: readonly Trial[]): Map<string, string[]> {
  const pairs = validPairs(trials);
  const out = new Map<string, string[]>();
  const flags = flagPairs(pairs, session.protocol.quality.reviewAbsErrorDeg);
  pairs.forEach((p, i) => out.set(p.trial.id, [...(flags.get(i) ?? [])]));
  for (const t of trials) if (t.imu && t.imu.windowSdDeg > session.protocol.quality.maxWindowSdDeg) out.set(t.id, [...(out.get(t.id) ?? []), 'unstable_hold']);
  return out;
}

export function trialsCsv(datasetId: string, sessions: readonly ValidationSession[], trials: readonly Trial[], participants: readonly Patient[], filter: DatasetFilter): string {
  const code = (id: string) => participants.find((p) => p.id === id)?.code ?? '';
  const lines: string[] = [`# ${DATASET_FORMAT} v${DATASET_SCHEMA_VERSION} · dataset ${datasetId} · units in the data dictionary file`, COLUMNS.map((c) => c[0]).join(',')];
  for (const s of sessions.filter((x) => filter.sessionIds.includes(x.id)).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const ts = trials.filter((t) => t.sessionId === s.id);
    const current = new Set([...currentTrials(ts).values()].map((t) => t.id));
    const flags = rowFlags(s, ts);
    const sorted = [...ts].sort((a, b) => a.set - b.set || a.repetition - b.repetition || a.pointId.localeCompare(b.pointId) || a.attempt - b.attempt);
    for (const t of sorted) {
      if (!filter.includeSuperseded && t.status === 'superseded') continue;
      const point = s.protocol.measurementPoints.find((p) => p.id === t.pointId);
      const err = t.imu && t.referenceDeg !== null ? t.imu.angleDeg - t.referenceDeg : null;
      const row: (string | number | boolean | null)[] = [
        datasetId, s.id, s.participantId, code(s.participantId), s.protocolKey, s.protocol.name, s.protocolVersion, s.protocol.joint,
        s.protocol.exercise, s.protocol.side, t.set, t.repetition, t.pointId, point?.kind ?? '', point?.label ?? '', t.attempt, t.status,
        current.has(t.id), t.imu?.angleDeg ?? null, t.referenceDeg, err, err === null ? null : Math.abs(err), t.imu?.method ?? '',
        t.imu?.tFrom ?? null, t.imu?.tTo ?? null, t.imu?.samples ?? null, t.imu?.windowSdDeg ?? null, t.imu?.windowMinDeg ?? null,
        t.imu?.windowMaxDeg ?? null, t.imu?.capturedAt ?? '', t.referenceAt ?? '', (flags.get(t.id) ?? []).join(' '), t.reason, t.notes,
        t.operator, s.device.kind, s.device.name, s.device.firmware, s.device.rateHz, s.device.simulated,
        s.device.sensors.map((x) => `${x.placement}=${x.moduleId ?? 'unknown'}`).join(' '), s.algorithmVersion, s.appVersion,
      ];
      lines.push(row.map(cell).join(','));
    }
  }
  return '﻿' + lines.join('\n') + '\n';
}

export function dictionaryCsv(): string {
  return '﻿' + ['column,unit,description', ...COLUMNS.map(([c, u, d]) => [c, u, d].map(cell).join(','))].join('\n') + '\n';
}

/** Session-level statistics, computed by the analytics engine (never by hand, never by an LLM). */
export function sessionStatistics(s: ValidationSession, trials: readonly Trial[]) {
  const ts = trials.filter((t) => t.sessionId === s.id);
  const pairs = validPairs(ts);
  const byPoint = s.protocol.measurementPoints.map((p) => {
    const pp = validPairs(ts, p.id);
    return { pointId: p.id, label: p.label, kind: p.kind, summary: errorSummary(pp), agreement: agreement(pp) };
  });
  // IMU vs reference as two "raters" over trials (descriptive: trials of one participant are not independent)
  const iccResult = pairs.length >= 2 ? icc(pairs.map((p) => [p.imu, p.ref])) : null;
  return {
    counts: counts(s.protocol, ts),
    overall: errorSummary(pairs),
    agreement: agreement(pairs),
    byPoint,
    ranges: rangeAgreement(pairs, 30),
    icc: iccResult,
    sufficiency: { summary: sufficiency(pairs.length, 'summary'), blandAltman: sufficiency(pairs.length, 'bland_altman'), icc: sufficiency(pairs.length, 'icc') },
  };
}

export function datasetJson(
  datasetId: string,
  sessions: readonly ValidationSession[],
  trials: readonly Trial[],
  participants: readonly Patient[],
  protocols: readonly ProtocolVersion[],
  filter: DatasetFilter,
  now = new Date(),
): string {
  const chosen = sessions.filter((s) => filter.sessionIds.includes(s.id));
  const ids = new Set(chosen.map((s) => s.id));
  const pIds = new Set(chosen.map((s) => s.participantId));
  return JSON.stringify(
    {
      format: DATASET_FORMAT,
      schemaVersion: DATASET_SCHEMA_VERSION,
      datasetId,
      createdAt: now.toISOString(),
      filter,
      units: { angles: 'degrees', time: 'seconds (device) / ISO 8601 (wall clock)' },
      conventions: {
        signedError: 'IMU − reference',
        sd: 'sample SD (n − 1)',
        limitsOfAgreement: 'bias ± 1.96 SD; repeated-measures method (Bland & Altman 2007) when several participants contribute repeats',
        rounding: 'none — values at full floating-point precision',
      },
      participants: participants.filter((p) => pIds.has(p.id)).map((p) => ({ id: p.id, code: p.code })),
      protocols: protocols.filter((v) => chosen.some((s) => s.protocolKey === v.key)),
      sessions: chosen.map((s) => ({ ...s, statistics: sessionStatistics(s, trials) })),
      trials: trials.filter((t) => ids.has(t.sessionId) && (filter.includeSuperseded || t.status !== 'superseded')),
      columns: COLUMNS.map(([name, unit, description]) => ({ name, unit, description })),
    },
    null,
    1,
  );
}
