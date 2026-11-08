// Movement Foundation Model — dataset readiness gates, computed from the data that actually exist in this
// workspace. NeuroMove does NOT have a foundation model; these gates say what must be true before training one
// would be scientifically meaningful (research/foundation-model-roadmap.md).
//
// Gates are either logical preconditions (consent, repeated observation, independent evaluation data) or derived
// from a stated statistical requirement with its assumptions exposed (evaluation precision). No gate is an
// arbitrary round number.

import { isSimulatedSession, type Session } from '../data/models';
import type { ConsentRecord } from '../rehab/model';

export interface Inventory {
  participants: number;
  participantsWithRaw: number;
  sessions: number;
  sessionsWithRaw: number;
  rawHours: number;
  tasks: number;
  medianSessionsPerParticipant: number;
  qcPassFraction: number | null;
  largestParticipantShare: number | null;
  participantsWithActiveConsent: number;
  simulated: boolean;
}

export interface Gate {
  id: 'evaluation_precision' | 'repeated_observations' | 'signal_quality' | 'consent' | 'independent_evaluation' | 'subject_wise_baseline';
  required: number | boolean;
  actual: number | boolean | null;
  met: boolean;
  basis: 'statistical' | 'logical' | 'ethical';
  /** Assumptions behind `required` (statistical gates). */
  assumptions: Record<string, number>;
}

/**
 * Participants needed so that the mean subject-wise (leave-one-subject-out) performance is estimated within ±h
 * (95 %), when per-subject performance varies with SD sB:  N = ⌈(1.96·sB / h)²⌉. With few subjects the error bars
 * of cross-validated performance are wide (Varoquaux 2018, doi:10.1016/j.neuroimage.2017.06.061).
 */
export function evaluationParticipants(sB: number, h: number): number {
  return Math.ceil(((1.959963984540054 * sB) / h) ** 2);
}

export function inventory(sessions: readonly Session[], consents: readonly ConsentRecord[], includeSimulated: boolean): Inventory {
  const use = sessions.filter((s) => includeSimulated || !isSimulatedSession(s));
  const parts = new Map<string, Session[]>();
  for (const s of use) parts.set(s.patientId, [...(parts.get(s.patientId) ?? []), s]);
  const withRaw = use.filter((s) => s.hasRaw);
  const rawParts = new Set(withRaw.map((s) => s.patientId));
  const counts = [...parts.values()].map((x) => x.length).sort((a, b) => a - b);
  const med = counts.length ? (counts.length % 2 ? (counts[(counts.length - 1) / 2] as number) : ((counts[counts.length / 2 - 1] as number) + (counts[counts.length / 2] as number)) / 2) : 0;
  const tasks = new Set(use.flatMap((s) => s.steps.map((st) => `${st.summary.exercise}:${st.summary.side}`)));
  const rawSec = withRaw.reduce((a, s) => a + s.totalSec, 0);
  const shares = [...rawParts].map((p) => withRaw.filter((s) => s.patientId === p).reduce((a, s) => a + s.totalSec, 0) / Math.max(1e-9, rawSec));
  const consented = new Set(consents.filter((c) => c.status === 'active').map((c) => c.participantId));
  return {
    participants: parts.size,
    participantsWithRaw: rawParts.size,
    sessions: use.length,
    sessionsWithRaw: withRaw.length,
    rawHours: rawSec / 3600,
    tasks: tasks.size,
    medianSessionsPerParticipant: med,
    qcPassFraction: use.length ? use.filter((s) => s.quality.percent >= 90).length / use.length : null,
    largestParticipantShare: shares.length ? Math.max(...shares) : null,
    participantsWithActiveConsent: [...rawParts].filter((p) => consented.has(p)).length,
    simulated: use.some((s) => isSimulatedSession(s)),
  };
}

export interface GateOptions {
  /** Assumed between-subject SD of held-out performance (e.g. accuracy); adjustable in the UI. */
  betweenSubjectSD: number;
  /** Required 95 % half-width of the mean held-out performance. */
  halfWidth: number;
  /** An independent dataset (site, device or cohort) is held out for external validation. */
  independentDataset: boolean;
  /** A supervised baseline has been evaluated subject-wise on REAL data (representation.ts provides the harness). */
  subjectWiseBaselineOnRealData: boolean;
}

export const DEFAULT_GATE_OPTIONS: GateOptions = { betweenSubjectSD: 0.1, halfWidth: 0.05, independentDataset: false, subjectWiseBaselineOnRealData: false };

export function gates(inv: Inventory, o: GateOptions = DEFAULT_GATE_OPTIONS): Gate[] {
  const nEval = evaluationParticipants(o.betweenSubjectSD, o.halfWidth);
  return [
    { id: 'evaluation_precision', required: nEval, actual: inv.participantsWithRaw, met: inv.participantsWithRaw >= nEval, basis: 'statistical', assumptions: { between_subject_sd: o.betweenSubjectSD, half_width: o.halfWidth } },
    { id: 'repeated_observations', required: 2, actual: inv.medianSessionsPerParticipant, met: inv.medianSessionsPerParticipant >= 2, basis: 'logical', assumptions: {} },
    { id: 'signal_quality', required: 0.9, actual: inv.qcPassFraction, met: (inv.qcPassFraction ?? 0) >= 0.9, basis: 'logical', assumptions: {} },
    { id: 'consent', required: inv.participantsWithRaw, actual: inv.participantsWithActiveConsent, met: inv.participantsWithRaw > 0 && inv.participantsWithActiveConsent === inv.participantsWithRaw, basis: 'ethical', assumptions: {} },
    { id: 'independent_evaluation', required: true, actual: o.independentDataset, met: o.independentDataset, basis: 'logical', assumptions: {} },
    { id: 'subject_wise_baseline', required: true, actual: o.subjectWiseBaselineOnRealData, met: o.subjectWiseBaselineOnRealData, basis: 'logical', assumptions: {} },
  ];
}
