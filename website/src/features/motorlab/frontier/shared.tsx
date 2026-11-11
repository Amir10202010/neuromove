// Shared pieces of the research-frontier workspaces: verdict chips, engine-code labels, small layout helpers.
// (The worker hook lives in useFrontierJob.ts so that views which compute nothing do not load the engine.)

import type { ReactNode } from 'react';
import type { FT } from './i18n';
import type { Job } from './useFrontierJob';

/** An engine code (verdict, status, reason): translated when the dictionary has it, otherwise shown readable. */
export function code(ft: FT, x: string | null | undefined): string {
  if (!x) return '—';
  const t = ft(x);
  return t === x ? x.replace(/_/g, ' ') : t;
}

export type Tone = 'plain' | 'signal' | 'caution' | 'refused' | 'met';

export function Chip({ tone = 'plain', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`fr-chip${tone === 'plain' ? '' : ` fr-chip--${tone}`}`}>{children}</span>;
}

export function Kpi({ label, value, meta, text }: { label: string; value: string; meta?: ReactNode; text?: boolean }) {
  return (
    <div className="card card__body stat">
      <span className="stat__label">{label}</span>
      <span className={text ? 'mlkpi__text' : 'stat__value num'}>{value}</span>
      {meta && <span className="stat__meta">{meta}</span>}
    </div>
  );
}

/** Engine prose (registry entries, explanations, report statements) is kept in its canonical English wording. */
export function CanonicalNote({ ft }: { ft: FT }) {
  return <p className="fr-canonical">{ft('Registry entries and engine explanations are shown in their canonical English wording, so that a record reads the same for every reader.')}</p>;
}

export function JobStatus<T>({ job, ft }: { job: Job<T>; ft: FT }) {
  if (job.state === 'running') return <p className="mlmuted" role="status">{ft('Computing…')}</p>;
  if (job.state === 'error') return <div className="callout callout--critical" role="alert">{job.message}</div>;
  return null;
}

export const pct = (v: number | null | undefined, digits = 0): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(100 * v).toFixed(digits)} %`);

/** Name of a repetition feature (lab/measure/repFeatures.ts) in the interface language. */
export function featureName(ft: FT, id: string): string {
  switch (id) {
    case 'outcome':
      return ft('Outcome (peak angle)');
    case 'exc_trunk_pitch':
      return ft('Trunk forward–back excursion');
    case 'exc_trunk_roll':
      return ft('Trunk sideways excursion');
    case 'exc_upper_elev':
      return ft('Upper-arm elevation excursion');
    case 'exc_fore_elev':
      return ft('Forearm elevation excursion');
    case 'exc_elbow_flex':
      return ft('Elbow flexion excursion');
    case 'exc_humerothoracic':
      return ft('Arm relative to trunk excursion');
    case 'trunk_contribution':
      return ft('Trunk share of the excursion');
    case 'dur_outbound':
      return ft('Outbound duration');
    case 'dur_return':
      return ft('Return duration');
    case 'peak_rate':
      return ft('Peak angular rate');
    case 'time_to_peak_fraction':
      return ft('Time to peak rate (share of outbound)');
    case 'sparc_outbound':
      return ft('Smoothness (SPARC), outbound');
    case 'onset_lag_trunk_ms':
      return ft('Trunk onset relative to the arm');
    case 'onset_lag_fore_ms':
      return ft('Forearm onset relative to the upper arm');
    default:
      return id;
  }
}
