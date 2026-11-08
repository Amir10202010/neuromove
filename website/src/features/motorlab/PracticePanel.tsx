// Practice trials on the Motor Twin page: the professional's recording switch (consent-gated) and the trial-level
// learning models fitted to stored child-mode practice (no learning / single rate / fast + slow).

import { CircleDot, CircleOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ExerciseId } from '../../core/exercises';
import type { Side } from '../../devices/types';
import { fitTargetedPractice, MIN_PRACTICE_TRIALS, type PracticeModel, type TargetedTrial } from '../../lab/dualRate';
import { trialRecordingStatus } from '../../lab/records';
import type { ConsentRecord, RehabRecord } from '../../rehab/model';
import { useRehabStore } from '../../rehab/store';
import { useAppStore } from '../../state/appStore';
import { Button } from '../../ui/Button';
import { fmt, Prov, useDates, useNames } from './common';
import { SignalChart } from './charts';
import type { LKey, LT } from './i18n';
import { useLabRecords, useLabStore } from './store';

const MODEL: Record<PracticeModel, LKey> = { no_learning: 'No learning', single_rate: 'Single-rate learning', dual_rate: 'Fast + slow learning' };

export function PracticePanel({ participantId, workspace, lt }: { participantId: string; workspace: 'demo' | 'clinic'; lt: LT }) {
  const names = useNames();
  const dates = useDates();
  const records = useLabStore((s) => s.records);
  const setRecording = useLabStore((s) => s.setTrialRecording);
  const rehab = useRehabStore((s) => s.records);
  const profile = useAppStore((s) => s.profile);
  const { trialSets } = useLabRecords(workspace);
  const consents = useMemo(() => rehab.filter((r: RehabRecord): r is ConsentRecord => r.kind === 'consent' && r.workspace === workspace && r.participantId === participantId), [rehab, workspace, participantId]);
  const active = consents.find((c) => c.status === 'active') ?? null;
  const status = trialRecordingStatus(participantId, workspace, records, consents);
  const mine = trialSets.filter((s) => s.participantId === participantId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const tasks = [...new Set(mine.map((s) => `${s.exercise}:${s.side}`))];
  const [task, setTask] = useState<string | null>(null);
  const tk = task && tasks.includes(task) ? task : tasks[0] ?? null;
  const sets = mine.filter((s) => `${s.exercise}:${s.side}` === tk);
  // Memoised by the React Compiler (no manual useMemo: the inputs come from the store)
  const trials: TargetedTrial[] = trialSets
        .filter((s) => s.participantId === participantId && `${s.exercise}:${s.side}` === tk && s.targetDeg !== null)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .flatMap((s) => s.trials.map((t) => ({ target: s.targetDeg as number, y: t.valid ? t.peakDeg : null })));
  const result = trials.length ? fitTargetedPractice(trials) : null;
  const canEnable = workspace === 'demo' || active !== null;
  return (
    <section className="mlsection">
      <h2 className="section-title">{lt('Practice trials')}</h2>
      <div className="card card__body mlrow">
        {status.enabled ? <CircleDot aria-hidden /> : <CircleOff aria-hidden />}
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <strong>{status.enabled ? lt('Recording is on') : lt('Recording is off')}</strong>
          <p className="mlmuted">
            {lt('When on, every repetition of child-mode practice with live feedback is stored with its target: a research record, not a clinical measurement. The adult on the device sees that recording is on.')}{' '}
            {workspace === 'clinic' && !active ? lt('Needs an active study consent for this participant (Rehabilitation → Studies).') : ''}
            {status.reason === 'no_active_consent' ? ` ${lt('The consent is no longer active: nothing is recorded.')}` : ''}
          </p>
        </div>
        <Button
          variant={status.enabled ? 'secondary' : 'primary'}
          disabled={!status.enabled && !canEnable}
          onClick={() => void setRecording({ workspace, participantId, enabled: !status.enabled, consentId: active?.id ?? null, author: profile?.name ?? '' })}
        >
          {status.enabled ? lt('Stop recording') : lt('Record practice trials')}
        </Button>
      </div>
      {!mine.length ? (
        <p className="mlmuted">{lt('No practice trials stored for this participant.')}</p>
      ) : (
        <div className="card card__body mlform">
          <label className="field">
            <span className="field__label">{lt('Task')}</span>
            <select className="select" value={tk ?? ''} onChange={(e) => setTask(e.target.value)}>
              {tasks.map((k) => {
                const [e, s] = k.split(':') as [ExerciseId, Side];
                return <option key={k} value={k}>{names.task(e, s)}</option>;
              })}
            </select>
          </label>
          <p className="mlmuted">
            {sets.length} {lt('sittings')} · {trials.length} {lt('trials with a target')} · {trials.filter((t) => t.y !== null).length} {lt('valid')} · {sets[0] ? `${dates.date(sets[0].startedAt)} – ${dates.date(sets[sets.length - 1]!.startedAt)}` : ''}
          </p>
          {trials.length > 1 && (
            <SignalChart
              title={lt('Peak angle per practice trial')}
              yLabel="°"
              xLabel={lt('Trial')}
              t={trials.map((_, i) => i + 1)}
              y={trials.map((t) => t.y ?? NaN)}
              threshold={trials[trials.length - 1]?.target}
              spans={[]}
              window={[1, trials.length]}
              fmt={(v) => fmt(v, 0)}
            />
          )}
          {result && (
            <>
              <table className="table table--compact mltable">
                <thead>
                  <tr><th>{lt('Model')}</th><th className="num">k</th><th className="num">AICc</th><th>{lt('Rate parameters (95 % profile)')}</th><th>{lt('Identifiable')}</th></tr>
                </thead>
                <tbody>
                  {result.fits.map((f) => (
                    <tr key={f.model} className={f.model === result.selected ? 'is-selected' : ''}>
                      <td>{lt(MODEL[f.model])} {f.model === result.selected && <span className="badge badge--info">{lt('selected')}</span>}</td>
                      <td className="num">{f.k}</td>
                      <td className="num">{Number.isFinite(f.aicc) ? fmt(f.aicc, 1) : lt('undefined')}</td>
                      <td className="mlmono">{Object.entries(f.profiles).map(([k, p]) => `${k} ${fmt(f.params[k], 3)} [${p.open ? lt('open') : `${fmt(p.lo, 2)}; ${fmt(p.hi, 2)}`}]`).join(' · ') || '—'}</td>
                      <td>{f.model === 'no_learning' ? '—' : f.identifiable ? lt('yes') : lt('no')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mlmuted">
                <Prov kind="estimated" /> {lt('Sittings are concatenated in time order; forgetting between sittings is not modelled. Adaptation models applied to range of motion are exploratory: range is limited by impairment, not only by error correction.')}{' '}
                {result.notes.includes('too_few_trials') ? lt('Fewer than {n} valid trials: only "no learning" is fitted.', { n: MIN_PRACTICE_TRIALS }) : ''}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
