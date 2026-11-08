// Foundation-model readiness: the real inventory of this workspace against evidence-based gates.
// NeuroMove has no movement foundation model; this page states what would have to be true before training one.

import { useMemo, useState } from 'react';
import { href } from '../../app/router';
import { PageHeader } from '../../layout/PageHeader';
import { DEFAULT_GATE_OPTIONS, evaluationParticipants, gates, inventory } from '../../lab/readiness';
import type { ConsentRecord } from '../../rehab/model';
import { useRehabStore } from '../../rehab/store';
import { fmt, SimulatedBanner, useLabData } from './common';
import { useLT, type LKey } from './i18n';

const GATE_TEXT: Record<string, LKey> = {
  evaluation_precision: 'Participants with raw recordings, for a subject-wise evaluation precise to ±h',
  repeated_observations: 'Median sessions per participant (cross-session consistency needs ≥ 2)',
  signal_quality: 'Share of sessions passing signal quality',
  consent: 'Participants with raw data AND active consent covering research use',
  independent_evaluation: 'An independent dataset (other site, device or cohort) held out',
  subject_wise_baseline: 'A supervised baseline evaluated subject-wise on real data',
};

export function ReadinessPage() {
  const lt = useLT();
  const { sessions, includeSimulated, ws } = useLabData();
  const records = useRehabStore((s) => s.records);
  const consents = records.filter((r): r is ConsentRecord => r.kind === 'consent' && r.workspace === ws);
  const [sd, setSd] = useState(DEFAULT_GATE_OPTIONS.betweenSubjectSD);
  const [h, setH] = useState(DEFAULT_GATE_OPTIONS.halfWidth);
  const inv = useMemo(() => inventory(sessions, consents, includeSimulated), [sessions, consents, includeSimulated]);
  const gs = gates(inv, { ...DEFAULT_GATE_OPTIONS, betweenSubjectSD: sd, halfWidth: h });
  return (
    <div className="page">
      <PageHeader back={{ href: href({ name: 'labOverview' }), label: lt('Motor learning lab') }} title={lt('Foundation-model readiness')} lead={lt('NeuroMove does not have a movement foundation model. These gates, computed from the data in this workspace, say what must be true before training one would be meaningful.')} />
      <SimulatedBanner show={includeSimulated} />
      <section className="mlkpis">
        {[
          [lt('Participants'), String(inv.participants)],
          [lt('With raw 100 Hz'), String(inv.participantsWithRaw)],
          [lt('Sessions'), String(inv.sessions)],
          [lt('Raw hours'), fmt(inv.rawHours, 2)],
          [lt('Tasks'), String(inv.tasks)],
          [lt('Largest participant share of raw'), inv.largestParticipantShare === null ? '—' : `${fmt(inv.largestParticipantShare * 100, 0)} %`],
        ].map(([l, v]) => (
          <div key={l} className="card card__body stat"><span className="stat__label">{l}</span><span className="stat__value num">{v}</span></div>
        ))}
      </section>
      <section className="card card__body mlfilters">
        <label className="field"><span className="field__label">{lt('Assumed between-subject SD of held-out performance')}</span><input className="input" type="number" step="0.01" min={0.01} max={0.5} value={sd} onChange={(e) => setSd(Math.max(0.01, Number(e.target.value) || 0.01))} /></label>
        <label className="field"><span className="field__label">{lt('Required 95 % half-width h')}</span><input className="input" type="number" step="0.01" min={0.01} max={0.5} value={h} onChange={(e) => setH(Math.max(0.01, Number(e.target.value) || 0.01))} /></label>
        <span className="mlmuted">N = ⌈(1.96·SD / h)²⌉ = {evaluationParticipants(sd, h)}</span>
      </section>
      <div className="card mlscroll" tabIndex={0}>
        <table className="table table--compact mltable">
          <thead><tr><th>{lt('Gate')}</th><th>{lt('Basis')}</th><th className="num">{lt('Required')}</th><th className="num">{lt('Now')}</th><th>{lt('Met')}</th></tr></thead>
          <tbody>
            {gs.map((g) => (
              <tr key={g.id}>
                <td>{lt(GATE_TEXT[g.id]!)}</td>
                <td>{lt(g.basis === 'statistical' ? 'statistical' : g.basis === 'ethical' ? 'ethical' : 'logical')}</td>
                <td className="num">{typeof g.required === 'boolean' ? lt('yes') : g.id === 'signal_quality' ? `${fmt(g.required * 100, 0)} %` : String(g.required)}</td>
                <td className="num">{g.actual === null ? '—' : typeof g.actual === 'boolean' ? lt(g.actual ? 'yes' : 'no') : g.id === 'signal_quality' ? `${fmt(g.actual * 100, 0)} %` : String(g.actual)}</td>
                <td className={g.met ? 'mlgate is-met' : 'mlgate is-unmet'}>{g.met ? lt('met') : lt('not met')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mlmuted">{lt('Statistical gate after Varoquaux 2018 (cross-validation error bars with small samples). Reference scale: self-supervised wearable models have been trained on hundreds of thousands of person-days (Yuan et al. 2024) — not a threshold, an order of magnitude. Roadmap: research/foundation-model-roadmap.md.')}</p>
    </div>
  );
}
