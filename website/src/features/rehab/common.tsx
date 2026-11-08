// Shared pieces of the Functional Progression screens: translation hook, acting person, labels,
// source badges (instrument / IMU / reported / professional), observation wording.

import { useMemo, type ReactNode } from 'react';
import { EXERCISES, type ExerciseId } from '../../core/exercises';
import type { Locale } from '../../data/models';
import { useI18n } from '../../i18n';
import type { InformationSource } from '../../rehab/model';
import type { Observation } from '../../rehab/progress';
import type { Actor } from '../../rehab/policy';
import { useAppStore } from '../../state/appStore';
import { useSyncStore } from '../../sync/engine';
import { useRehabStore } from '../../rehab/store';
import { EN, KK, RU } from './i18n';
import { LABELS, type Labels } from './labels';

export type XT = (key: string, params?: Record<string, string | number>) => string;

function interpolate(s: string, params?: Record<string, string | number>): string {
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** English text is the key. Russian is complete (test-enforced); Kazakh is complete for family and child screens, otherwise falls back to Russian. */
export function translateX(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const s = locale === 'en' ? (EN[key] ?? key) : locale === 'kk' ? (KK[key] ?? RU[key] ?? EN[key] ?? key) : (RU[key] ?? EN[key] ?? key);
  return interpolate(s, params);
}

export function useXT(): { xt: XT; L: Labels; locale: Locale } {
  const locale = useAppStore((s) => s.settings.locale);
  return useMemo(() => ({ xt: (k, p) => translateX(locale, k, p), L: LABELS[locale], locale }), [locale]);
}

/**
 * Who is acting on this screen. With a team account the server role decides (caregiver accounts are
 * linked to children by the server). Without one, this device's owner acts as a professional, and the
 * family view acts as a caregiver for that one child — a UI boundary on a shared tablet, not a security
 * boundary; real access control comes from caregiver accounts (docs: architecture §8).
 */
export function useActor(mode: 'professional' | 'family', participantId?: string): Actor {
  const account = useSyncStore((s) => s.account);
  const enabled = useSyncStore((s) => s.config.enabled);
  const profile = useAppStore((s) => s.profile);
  const ws = useAppStore((s) => s.settings.workspace);
  const locale = useAppStore((s) => s.settings.locale);
  return useMemo(() => {
    if (enabled && account && ws === 'clinic') {
      if (account.role === 'caregiver') return { role: 'caregiver', name: account.displayName, participantIds: account.participantIds ?? [] };
      if (mode === 'family') return { role: 'caregiver', name: translateX(locale, 'Family'), participantIds: participantId ? [participantId] : [] };
      return { role: account.role, name: account.displayName, participantIds: [] };
    }
    if (mode === 'family') return { role: 'caregiver', name: translateX(locale, 'Family'), participantIds: participantId ? [participantId] : [] };
    const name = ws === 'demo' ? translateX(locale, 'Demo clinician') : profile?.name || translateX(locale, 'Professional');
    return { role: 'admin', name, participantIds: [] };
  }, [account, enabled, profile, ws, locale, mode, participantId]);
}

/** A caregiver account on this device: professional screens are not available. */
export function useIsCaregiverAccount(): boolean {
  const account = useSyncStore((s) => s.account);
  const enabled = useSyncStore((s) => s.config.enabled);
  return enabled && account?.role === 'caregiver';
}

const SOURCE_CLASS: Record<InformationSource, string> = { instrument: 'src-badge--instrument', imu: 'src-badge--imu', reported: 'src-badge--reported', professional: 'src-badge--professional' };

export function SourceBadge({ source, children }: { source: InformationSource; children?: ReactNode }) {
  const { L } = useXT();
  return <span className={`src-badge ${SOURCE_CLASS[source]}`}>{children ?? L.source[source]}</span>;
}

export function exerciseLabel(t: ReturnType<typeof useI18n>['t'], ex: ExerciseId): string {
  return EXERCISES[ex] ? t(`exercise.${ex}.name` as never) : ex;
}

export function useDates() {
  const { f } = useI18n();
  return f;
}

/** Neutral, localised wording of an engine observation. Templates per rule; params from the engine. */
export function useObservationText(): (o: Observation) => { title: string; detail: string } {
  const { xt, L } = useXT();
  const { t } = useI18n();
  return (o) => {
    const p = o.params;
    const ex = typeof p.exercise === 'string' ? `${exerciseLabel(t, p.exercise as ExerciseId)}${p.side ? ` (${p.side === 'left' ? xt('left') : xt('right')})` : ''}` : '';
    switch (o.ruleId) {
      case 'safety_unreviewed':
        return { title: xt('Safety reports waiting for professional review: {n}', { n: p.count ?? 0 }), detail: xt('Pain, discomfort, unusual responses or stopped sessions reported by the family or recorded in the clinic.') };
      case 'data_quality_latest':
        return { title: xt('Sensor quality is insufficient to compare the latest session reliably'), detail: xt('Issues: {issues}. Signal completeness {signal} %.', { issues: String(p.issues ?? ''), signal: p.signal ?? '—' }) };
      case 'assigned_not_completed':
        return {
          title: xt('Several assigned home sessions were not reported as completed'),
          detail: xt('Last {days} days: planned {planned}, completed {completed}, partly {partial}, not done or stopped {notCompleted}, no report {unreported}. Missing reports do not prove that practice did not happen.', p),
        };
      case 'reported_fatigue_discomfort':
        return { title: xt('Fatigue, discomfort or stopped sessions were reported {n} times', { n: p.count ?? 0 }), detail: xt('Reported by the family or child (last {days} days). Not a measurement.', p) };
      case 'repeated_barrier':
        return { title: xt('Barrier reported repeatedly: {b}', { b: L.barrier[p.barrier as keyof Labels['barrier']] ?? String(p.barrier) }), detail: xt('{n} times in the last {days} days.', { n: p.count ?? 0, days: p.days ?? 14 }) };
      case 'consistency_trend':
        return {
          title: p.direction === 'more_consistent' ? xt('Measurements are becoming more consistent across recent sessions: {ex}', { ex }) : xt('Measurements are becoming less consistent across recent sessions: {ex}', { ex }),
          detail: xt('Coefficient of variation of the measured range: {from} % → {to} % over {n} sessions. Consistency of an IMU angle, not of function.', { from: p.from ?? '', to: p.to ?? '', n: p.sessions ?? '' }),
        };
      case 'range_vs_baseline':
        return {
          title: p.direction === 'higher' ? xt('Measured range is higher than the baseline: {ex}', { ex }) : xt('Measured range is lower than the baseline: {ex}', { ex }),
          detail: xt('Baseline {b}°, latest {l}° (difference {d}°, noise check ±{noise}°). {prov}A measured angle difference does not imply a change in daily function.', {
            b: p.baseline ?? '',
            l: p.latest ?? '',
            d: p.delta ?? '',
            noise: p.noise ?? '',
            prov: p.designated === 'no' ? xt('Provisional baseline (first usable session). ') : '',
          }),
        };
      case 'unusual_repetitions':
        return { title: xt('Some repetitions show unusually high variability: {ex}', { ex }), detail: xt('Repetitions {reps} of {total} are far from the session median. Check the trace: effort, attention, a sensor slip or a different movement.', p) };
      case 'baseline_not_designated':
        return { title: xt('No baseline session designated'), detail: xt('Comparisons use the first usable session provisionally. Choose a baseline on the Movement tab.') };
      case 'goal_reassessment':
        return { title: xt('Goal has not been reassessed recently'), detail: `${String(p.goal ?? '')} — ${p.reason === 'review_date_passed' ? xt('review date passed') : p.reason === 'needs_review' ? xt('marked "needs review"') : xt('no entry for 8 weeks')}` };
      case 'imu_goal_without_measurement':
        return { title: xt('No sensor measurement yet for a goal followed with the IMU'), detail: String(p.goal ?? '') };
      case 'review_due':
        return { title: xt('A professional review may be appropriate'), detail: p.reason === 'date_passed' ? xt('Review date or checkpoint passed ({date}).', p) : xt('No progress review for 8 weeks.') };
      case 'assessment_interval':
        return { title: xt('No recent instrument-based assessment'), detail: p.last ? xt('Last assessment {last}. The professional decides whether and which instrument is appropriate.', p) : xt('None recorded. The professional decides whether and which instrument is appropriate.') };
      default:
        return { title: o.ruleId, detail: '' };
    }
  };
}

/** Save through the rehab store; refusals and failures become a visible message, never a silent "saved". */
export function useSave(): (records: readonly import('../../rehab/model').RehabRecord[], actor: Actor) => Promise<boolean> {
  const save = useRehabStore((s) => s.save);
  const toast = useAppStore((s) => s.toast);
  const { xt } = useXT();
  return async (records, actor) => {
    const r = await save(records, actor);
    if (r.ok) {
      toast('good', xt('Saved on this device'));
      return true;
    }
    toast('critical', xt('Not saved'), `${SAVE_ERRORS[r.error] ? xt(SAVE_ERRORS[r.error]!) : r.error}${r.detail ? ` (${r.detail})` : ''}`);
    return false;
  };
}

const SAVE_ERRORS: Record<string, string> = {
  invalid_record: 'Some fields are missing or invalid.',
  read_only_role: 'This account is read-only.',
  not_linked: 'This account is not linked to this child.',
  professional_only: 'Only a rehabilitation professional can do this.',
  caregiver_scope: 'Families can add reports and notes, but cannot change this.',
  author_role_mismatch: 'A professional cannot write a record as a family member.',
  immutable: 'This record cannot be changed. Create a new version instead.',
  history_rewritten: 'History entries cannot be changed or removed.',
  incident_changed: 'An incident can be reviewed once and then not changed.',
  consent_changed: 'Consent can only be withdrawn.',
  identity_changed: 'The owner of a record cannot change.',
  storage_not_ready: 'Storage is not ready yet.',
  write_failed: 'The browser could not save the record.',
};
