// Hypothesis registry: the formal research hypotheses NeuroMove could test, each with its null, its test, what
// would falsify it and what evidence exists — judged against the data that are actually in this workspace.
// A hypothesis is never shown as supported here: the registry holds questions, not answers.

import { useMemo, useState } from 'react';
import { isSimulatedSession } from '../../../data/models';
import { HYPOTHESES, hypothesisStatus, unobservableMeasurements, type DataInventory, type Hypothesis } from '../../../lab/discovery/hypotheses';
import { useRehabStore } from '../../../rehab/store';
import { useLabData } from '../common';
import { useLabRecords } from '../store';
import type { FT } from './i18n';
import { CanonicalNote, Chip, Kpi, code, type Tone } from './shared';

const statusTone = (s: string): Tone => (s === 'testable' || s === 'under_test' ? 'signal' : s === 'not_testable_with_current_data' ? 'refused' : 'plain');

export function HypothesesView({ ft }: { ft: FT }) {
  const { ws, sessions, practice } = useLabData();
  const { trialSets, protocols } = useLabRecords(ws);
  const rehab = useRehabStore((s) => s.records);
  const [open, setOpen] = useState<string | null>(null);
  const inv = useMemo<DataInventory>(() => {
    const real = sessions.filter((s) => !isSimulatedSession(s));
    const per = new Map<string, number>();
    for (const s of real) per.set(s.patientId, (per.get(s.patientId) ?? 0) + 1);
    const targets = new Map<string, Set<number | null>>();
    for (const t of trialSets) if (!t.simulated) (targets.get(`${t.participantId}|${t.exercise}|${t.side}`) ?? targets.set(`${t.participantId}|${t.exercise}|${t.side}`, new Set()).get(`${t.participantId}|${t.exercise}|${t.side}`)!).add(t.targetDeg);
    return {
      realParticipants: per.size,
      maxSessions: Math.max(0, ...per.values()),
      rawSessions: real.filter((s) => s.hasRaw).length,
      maxRepetitionsInARecording: Math.max(0, ...trialSets.filter((t) => !t.simulated).map((t) => t.trials.filter((x) => x.valid).length)),
      // the demo workspace holds generated records only: nothing in it counts as real evidence
      externalAssessments: ws === 'clinic' ? rehab.filter((r) => r.kind === 'assessment' && r.workspace === ws).length : 0,
      practiceLog: ws === 'clinic' && practice.length > 0,
      // a design counts only once it is frozen: a draft can still be changed after seeing data
      designatesRetention: protocols.some((p) => p.status === 'frozen' && p.def.schedule.retentionTests > 0),
      designatesTransfer: protocols.some((p) => p.status === 'frozen' && p.def.tasks.some((t) => t.role === 'transfer')),
      variesTaskCondition: [...targets.values()].some((s) => s.size >= 2),
    };
  }, [sessions, practice, trialSets, protocols, rehab, ws]);

  return (
    <>
      <section className="mlkpis" aria-label={ft('Real data in this workspace')}>
        <Kpi label={ft('Real participants with sessions')} value={String(inv.realParticipants)} />
        <Kpi label={ft('Most sessions of one participant')} value={String(inv.maxSessions)} />
        <Kpi label={ft('Real sessions with raw frames')} value={String(inv.rawSessions)} />
        <Kpi label={ft('External assessments')} value={String(inv.externalAssessments)} />
        <Kpi label={ft('Practice log')} value={inv.practiceLog ? ft('yes') : ft('no')} text />
      </section>
      <p className="mlmuted">{ft('Simulated sessions are not counted: a hypothesis about people cannot be tested on generated data. "Simulation only" means the method was checked on synthetic data with known truth — nothing has been learned about people.')}</p>

      <section className="mlsection">
        <h2 className="section-title">{ft('Registered hypotheses')}</h2>
        {HYPOTHESES.map((h) => (
          <Entry key={h.id} h={h} inv={inv} ft={ft} open={open === h.id} onToggle={() => setOpen(open === h.id ? null : h.id)} />
        ))}
        <CanonicalNote ft={ft} />
      </section>
    </>
  );
}

function Entry({ h, inv, ft, open, onToggle }: { h: Hypothesis; inv: DataInventory; ft: FT; open: boolean; onToggle: () => void }) {
  const st = hypothesisStatus(h, inv);
  const unobservable = unobservableMeasurements(h);
  return (
    <div className="card card__body">
      <div className="mlrow">
        <span className="fr-mono">{h.id}</span>
        <Chip tone={statusTone(st.status)}>{code(ft, st.status)}</Chip>
        <Chip>
          {ft('evidence')}: {code(ft, h.evidence)}
        </Chip>
        <Chip>{code(ft, h.intent)}</Chip>
      </div>
      <p>
        <button type="button" className="fr-rowbtn" aria-expanded={open} onClick={onToggle}>
          {h.question}
        </button>
      </p>
      {st.missing.length > 0 && (
        <ul className="fr-list">
          {st.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {open && (
        <dl className="fr-dl">
          <dt>{ft('Rationale')}</dt>
          <dd>{h.rationale}</dd>
          <dt>{ft('Null hypothesis')}</dt>
          <dd>{h.null}</dd>
          <dt>{ft('Alternative')}</dt>
          <dd>{h.alternative}</dd>
          <dt>{ft('Test')}</dt>
          <dd>{h.test}</dd>
          <dt>{ft('Falsified by')}</dt>
          <dd>{h.falsifiedBy}</dd>
          <dt>{ft('Measured by NeuroMove')}</dt>
          <dd className="fr-mono">{h.measurements.join(', ')}</dd>
          <dt>{ft('Needed from outside')}</dt>
          <dd>{h.external.join('; ') || '—'}</dd>
          <dt>{ft('Population and task')}</dt>
          <dd>
            {h.population} · {h.taskContext}
          </dd>
          <dt>{ft('Confounders')}</dt>
          <dd>{h.confounders.join('; ')}</dd>
          <dt>{ft('Assumptions')}</dt>
          <dd>{h.assumptions.join('; ')}</dd>
          <dt>{ft('Sample size')}</dt>
          <dd>{h.sampleSize}</dd>
          <dt>{ft('Method benchmarks')}</dt>
          <dd className="fr-mono">{h.benchmarks.join(', ') || '—'}</dd>
          <dt>{ft('What blocks it now')}</dt>
          <dd>{h.blocker}</dd>
          {unobservable.length > 0 && (
            <>
              <dt>{ft('Not observable with these sensors')}</dt>
              <dd className="fr-mono">{unobservable.join(', ')}</dd>
            </>
          )}
          <dt>{ft('References')}</dt>
          <dd className="fr-mono">{h.references.join(', ')}</dd>
        </dl>
      )}
    </div>
  );
}
