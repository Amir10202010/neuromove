// Strategy atlas of one participant and movement: a profile of how each raw recording was organised (outcome, trunk
// involvement, timing, quality, sensor placement), each later recording compared with the first, the kinds of
// variation behind the differences, and how trunk variation relates to the outcome. Built in a worker from raw
// frames (lab/frontierJobs.ts); nothing here computes a number.

import { FlaskConical, Lock, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isSimulatedSession } from '../../../data/models';
import type { Side } from '../../../devices/types';
import type { ExerciseId } from '../../../core/exercises';
import { SUPPORTED_EXERCISES, type McseRecordingInput } from '../../../lab/coord/engine';
import { practiceInput, sessionHasExercise, sessionInput } from '../../../lab/coord/inputs';
import type { MotorStrategyProfile, ProfileDifference } from '../../../lab/coord/profile';
import { sealEvidence } from '../../../lab/discovery/evidenceRecord';
import { ATLAS_EQUIVALENCE_MARGIN_DEG, type AtlasResult } from '../../../lab/frontierJobs';
import { contextOfPractice, contextOfSession, type TaskContext } from '../../../lab/tasks/library';
import { FRONTIER_VERSIONS } from '../../../lab/version';
import { newId } from '../../../lib/ids';
import { useAppStore } from '../../../state/appStore';
import { fmt, useDates, useLabData, useNames } from '../common';
import { useLabRecords, useLabStore } from '../store';
import type { FT } from './i18n';
import { CanonicalNote, Chip, JobStatus, code, featureName, pct, type Tone } from './shared';
import { useFrontierJob } from './useFrontierJob';

const DRAWS = 12;
const verdictTone = (v: ProfileDifference['verdict']): Tone => (v === 'beyond_noise' ? 'signal' : v === 'within_placement' ? 'caution' : v === 'not_assessable' ? 'refused' : 'plain');
const digits = (unit: string) => (unit === '°' || unit === 'ms' || unit === '°/s' ? 1 : 2);
const val = (v: number | null | undefined, unit: string, extra = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${fmt(v, digits(unit) + extra)}${unit === '°' ? '°' : unit ? ` ${unit}` : ''}`);

export function StrategyView({ ft, participant }: { ft: FT; participant: string | null }) {
  const dates = useDates();
  const names = useNames();
  const { ws, sessions } = useLabData();
  const { trialSets } = useLabRecords(ws);
  const getRaw = useAppStore((s) => s.getRaw);
  const author = useAppStore((s) => s.profile?.name ?? '');
  const saveEvidence = useLabStore((s) => s.saveEvidence);
  const [exercise, setExercise] = useState<string>('shoulder_flexion');
  const [side, setSide] = useState<Side>('right');
  const [budget, setBudget] = useState(false);
  const [reading, setReading] = useState(false);
  const [noRaw, setNoRaw] = useState(false);
  const [sealed, setSealed] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const { job, run } = useFrontierJob('atlas');
  const mine = useMemo(() => sessions.filter((s) => s.patientId === participant && sessionHasExercise(s, exercise, side) && s.hasRaw).sort((a, b) => a.startedAt.localeCompare(b.startedAt)), [sessions, participant, exercise, side]);
  const practice = useMemo(() => trialSets.filter((t) => t.participantId === participant && t.exercise === exercise && t.side === side && t.rawManifest), [trialSets, participant, exercise, side]);
  const available = mine.length + practice.length;

  const build = async () => {
    setReading(true);
    setNoRaw(false);
    setSealed(null);
    const inputs: McseRecordingInput[] = [];
    const tasks: TaskContext[] = [];
    for (const s of mine) {
      const frames = await getRaw(s.id);
      if (!frames?.length) continue;
      inputs.push(sessionInput(s, frames, side));
      tasks.push(contextOfSession(s, exercise as ExerciseId, side));
    }
    for (const t of practice) {
      const frames = await getRaw(t.id);
      const inp = frames?.length ? practiceInput(t, frames) : null;
      if (!inp) continue;
      inputs.push(inp);
      tasks.push(contextOfPractice(t));
    }
    setReading(false);
    if (!inputs.length) return setNoRaw(true);
    run({ kind: 'atlas', inputs, options: { exercise, tasks, uncertaintyDraws: budget ? DRAWS : 0 } });
  };
  const demo = () => {
    setNoRaw(false);
    setSealed(null);
    run({ kind: 'atlas_synthetic', seed: 4100, uncertaintyDraws: budget ? DRAWS : 0 });
  };
  const atlas = job.state === 'done' ? job.result.atlas : null;
  const seal = async () => {
    if (!atlas) return;
    const simulated = atlas.synthetic || atlas.profiles.some((p) => p.provenance.simulated);
    const rec = sealEvidence({
      id: newId('ev'),
      workspace: simulated ? 'demo' : ws,
      participantId: atlas.profiles[0]?.participantId ?? null,
      type: 'strategy_profile',
      title: `${ft('Strategy atlas')} · ${atlas.exercise}`,
      createdAt: new Date().toISOString(),
      createdBy: author || 'unknown',
      versions: { strategy: FRONTIER_VERSIONS.strategy, measure: FRONTIER_VERSIONS.measure },
      derivedFrom: atlas.profiles.map((p) => ({ kind: 'raw_stream', id: p.recordingId, hash: p.provenance.featureHash })),
      body: atlas,
      simulated,
    });
    if (await saveEvidence(rec)) setSealed(rec.contentHash);
  };

  return (
    <>
      <section className="card card__body mlfilters">
        <label className="field">
          <span className="field__label">{ft('Movement')}</span>
          <select className="select" value={exercise} onChange={(e) => setExercise(e.target.value)}>
            {SUPPORTED_EXERCISES.map((x) => (
              <option key={x} value={x}>
                {names.exercise(x as ExerciseId)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{ft('Arm')}</span>
          <select className="select" value={side} onChange={(e) => setSide(e.target.value as Side)}>
            <option value="right">{names.side('right')}</option>
            <option value="left">{names.side('left')}</option>
          </select>
        </label>
        <label className="fr-check">
          <input type="checkbox" checked={budget} onChange={(e) => setBudget(e.target.checked)} /> {ft('Propagate sensor uncertainty (slower)')}
        </label>
        <button type="button" className="btn btn--primary" disabled={job.state === 'running' || reading || !available} onClick={() => void build()}>
          <Play aria-hidden /> {ft('Build profiles from raw recordings')}
        </button>
        <button type="button" className="btn btn--secondary" disabled={job.state === 'running' || reading} onClick={demo}>
          <FlaskConical aria-hidden /> {ft('Synthetic demonstration')}
        </button>
      </section>
      <p className="mlmuted">
        {ft('Raw recordings of this movement')}: {mine.length} · {ft('practice sittings with raw frames')}: {practice.length}
        {mine.some(isSimulatedSession) ? ` · ${ft('simulated sessions are labelled')}` : ''}. {ft('A profile needs the raw 100 Hz frames of all three sensors; sessions stored as repetition metrics only cannot be profiled.')}
      </p>
      {reading && <p className="mlmuted" role="status">{ft('Reading raw frames…')}</p>}
      {noRaw && <div className="callout callout--warn">{ft('No raw frames could be read for this participant and movement.')}</div>}
      <JobStatus job={job} ft={ft} />
      {atlas && <Atlas atlas={atlas} ft={ft} date={(iso) => dates.dateTime(iso)} pick={pick} setPick={setPick} />}
      {atlas && (
        <section className="mlsection">
          <div className="mlrow">
            <button type="button" className="btn btn--secondary" onClick={() => void seal()} disabled={sealed !== null}>
              <Lock aria-hidden /> {ft('Seal as an evidence record')}
            </button>
            {sealed && (
              <span className="mlmuted">
                {ft('Sealed on this device')} · SHA-256 <span className="fr-mono">{sealed.slice(0, 16)}…</span>
              </span>
            )}
          </div>
          <p className="mlmuted">{ft('An evidence record is a sealed copy kept on this device only. It is never uploaded: a colleague reproduces it from the same recordings and engine version.')}</p>
        </section>
      )}
    </>
  );
}

const feat = (p: MotorStrategyProfile, id: string) => p.features.find((f) => f.id === id) ?? null;
const meanSd = (p: MotorStrategyProfile, id: string) => {
  const f = feat(p, id);
  return f ? `${val(f.mean, f.unit)}${f.sd !== null ? ` ± ${fmt(f.sd, digits(f.unit))}` : ''}` : '—';
};

function Atlas({ atlas, ft, date, pick, setPick }: { atlas: AtlasResult; ft: FT; date: (iso: string) => string; pick: string | null; setPick: (id: string) => void }) {
  const cmp = atlas.comparisons.find((c) => c.b === pick) ?? atlas.comparisons[atlas.comparisons.length - 1] ?? null;
  const label = (id: string) => {
    const i = atlas.profiles.findIndex((p) => p.recordingId === id);
    const p = atlas.profiles[i];
    return p ? `${i + 1} · ${date(p.startedAt)}` : id;
  };
  const withBudget = atlas.profiles.filter((p) => p.uncertainty);
  const lastBudget = withBudget[withBudget.length - 1]?.uncertainty ?? null;
  return (
    <>
      {atlas.synthetic && (
        <div className="callout callout--demo" role="note">
          <FlaskConical aria-hidden />
          <div>
            <div className="callout__title">{ft('Synthetic recordings with a known answer')}</div>
            {atlas.truth ?? ft('These recordings were generated by the simulator.')}
          </div>
        </div>
      )}
      <section className="mlsection">
        <h2 className="section-title">{ft('Profiles')}</h2>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable fr-wrap">
            <thead>
              <tr>
                <th>{ft('Recording')}</th>
                <th className="num">{ft('Repetitions')}</th>
                <th className="num">{ft('Outcome (peak angle)')}</th>
                <th className="num">{ft('Trunk forward–back excursion')}</th>
                <th className="num">{ft('Trunk share of the excursion')}</th>
                <th className="num">{ft('Trunk onset relative to the arm')}</th>
                <th>{ft('Placement confidence vs recording 1')}</th>
                <th>{ft('Signal confidence')}</th>
                <th>{ft('Flags')}</th>
              </tr>
            </thead>
            <tbody>
              {atlas.profiles.map((p) => (
                <tr key={p.recordingId}>
                  <td className="fr-nowrap">{label(p.recordingId)}</td>
                  <td className="num">
                    {p.repetitions}
                    {p.excludedRepetitions.length ? ` (−${p.excludedRepetitions.length})` : ''}
                  </td>
                  <td className="num">{meanSd(p, 'outcome')}</td>
                  <td className="num">{meanSd(p, 'exc_trunk_pitch')}</td>
                  <td className="num">{meanSd(p, 'trunk_contribution')}</td>
                  <td className="num">{meanSd(p, 'onset_lag_trunk_ms')}</td>
                  <td>{p.placement ? <Chip tone={p.placement.level === 'high' ? 'met' : p.placement.level === 'unknown' ? 'refused' : 'caution'}>{code(ft, p.placement.level)}</Chip> : ft('reference')}</td>
                  <td>{code(ft, p.quality.signal)}</td>
                  <td>{p.quality.flags.map((f) => code(ft, f)).join('; ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mlmuted">{ft('Mean ± SD over the repetitions of a recording. Trunk share and timing describe how the movement was organised; they are not graded: more trunk movement is not called worse, and less is not called better.')}</p>
      </section>

      {cmp && (
        <section className="mlsection">
          <h2 className="section-title">{ft('Compared with the first recording')}</h2>
          <div className="card card__body mlfilters">
            <label className="field">
              <span className="field__label">{ft('Recording')}</span>
              <select className="select" value={cmp.b} onChange={(e) => setPick(e.target.value)}>
                {atlas.comparisons.map((c) => (
                  <option key={c.b} value={c.b}>
                    {label(c.b)}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {ft('Outcome')}:{' '}
              <Chip tone={cmp.outcomeEquivalent ? 'met' : 'plain'}>
                {cmp.outcomeEquivalent === null ? code(ft, 'not_assessable') : cmp.outcomeEquivalent ? ft('equivalent within the margin') : ft('equivalence not shown')}
              </Chip>{' '}
              <span className="mlmuted">(±{ATLAS_EQUIVALENCE_MARGIN_DEG}°)</span>
            </span>
          </div>
          <div className="card mlscroll" tabIndex={0}>
            <table className="table table--compact mltable fr-wrap">
              <thead>
                <tr>
                  <th>{ft('Feature')}</th>
                  <th className="num">{ft('Difference')}</th>
                  <th className="num">{ft('90 % interval')}</th>
                  <th className="num">{ft('Sensor uncertainty')}</th>
                  <th className="num">{ft('Placement bound')}</th>
                  <th>{ft('Verdict')}</th>
                </tr>
              </thead>
              <tbody>
                {cmp.differences.map((d) => (
                  <tr key={d.id}>
                    <td>{featureName(ft, d.id)}</td>
                    <td className="num">{val(d.delta, d.unit)}</td>
                    <td className="num">{d.ci90 ? `${fmt(d.ci90[0], digits(d.unit))} … ${fmt(d.ci90[1], digits(d.unit))}` : '—'}</td>
                    <td className="num">{val(d.uMeasurement, d.unit, 1)}</td>
                    <td className="num">{val(d.placementBound, d.unit)}</td>
                    <td>
                      <Chip tone={verdictTone(d.verdict)}>{code(ft, d.verdict)}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mlmuted">{ft('"Beyond noise" = larger than repetition variability and sensor error (two-sided 5 % Welch test) and, for angles across recordings, larger than what a different sensor placement or calibration posture could produce. "Within placement" = real in the numbers, but re-attachment could explain it. "Not significantly different" is not "the same": equivalence is tested separately.')}</p>
        </section>
      )}

      <section className="mlsection">
        <h2 className="section-title">{ft('Kinds of variation')}</h2>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable fr-wrap">
            <thead>
              <tr>
                <th>{ft('Feature')}</th>
                <th className="num">{ft('Within recording, repetition to repetition')}</th>
                <th className="num">{ft('Within recording, trend')}</th>
                <th className="num">{ft('Between recordings')}</th>
                <th className="num">{ft('Expected from repetitions and sensors')}</th>
                <th>{ft('Reading')}</th>
              </tr>
            </thead>
            <tbody>
              {atlas.partitions.map(({ feature, unit, partition: v }) => (
                <tr key={feature}>
                  <td>{featureName(ft, feature)}</td>
                  <td className="num">{val(v.withinResidual, unit)}</td>
                  <td className="num">{val(v.withinTrend, unit)}</td>
                  <td className="num">{val(v.betweenSession, unit)}</td>
                  <td className="num">{val(v.betweenExpected, unit)}</td>
                  <td>{v.verdicts.map((x) => code(ft, x)).join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mlmuted">{ft('Standard deviations. Variation between recordings is read as a difference of the movement only when it exceeds what repetitions, sensor error, sensor placement and a different task set-up can produce.')}</p>
      </section>

      <section className="mlsection">
        <h2 className="section-title">{ft('Trunk variation and the outcome')}</h2>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable fr-wrap">
            <thead>
              <tr>
                <th>{ft('Recording')}</th>
                <th className="num">{ft('Repetitions')}</th>
                <th className="num">{ft('Pass-through [95 % CI]')}</th>
                <th className="num">{ft('Reliability of the trunk measure')}</th>
                <th>{ft('Reading')}</th>
              </tr>
            </thead>
            <tbody>
              {atlas.tradeoffs.map(({ recordingId, result: t }) => (
                <tr key={recordingId}>
                  <td className="fr-nowrap">{label(recordingId)}</td>
                  <td className="num">{t.n}</td>
                  <td className="num">{t.passThrough === null ? '—' : `${fmt(t.passThrough, 2)}${t.ci95 ? ` [${fmt(t.ci95[0], 2)}; ${fmt(t.ci95[1], 2)}]` : ''}`}</td>
                  <td className="num">{fmt(t.reliability, 2)}</td>
                  <td>
                    <Chip tone={t.verdict === 'not_feasible' || t.verdict === 'insufficient_data' ? 'refused' : 'plain'}>{code(ft, t.verdict)}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mlmuted">{ft('Pass-through: how much of a repetition-to-repetition change of trunk inclination appears in the outcome (1 = all of it, 0 = the arm makes up for it). Corrected for the measurement error of the trunk angle. It describes covariation within one recording, not cause.')}</p>
      </section>

      {lastBudget && (
        <section className="mlsection">
          <h2 className="section-title">{ft('Sensor uncertainty budget of the latest recording')}</h2>
          <div className="card mlscroll" tabIndex={0}>
            <table className="table table--compact mltable fr-wrap">
              <thead>
                <tr>
                  <th>{ft('Feature')}</th>
                  <th className="num">{ft('Random, per repetition')}</th>
                  <th className="num">{ft('Systematic, per recording')}</th>
                  <th className="num">{ft('Of the session mean')}</th>
                  <th className="num">{ft('Share of repetition variance')}</th>
                  <th>{ft('Validation of the budget')}</th>
                </tr>
              </thead>
              <tbody>
                {lastBudget.features.map((u) => (
                  <tr key={u.feature}>
                    <td>{featureName(ft, u.feature)}</td>
                    <td className="num">{val(u.uRandom, u.unit, 1)}</td>
                    <td className="num">{val(u.uSystematic, u.unit, 1)}</td>
                    <td className="num">{val(u.uSessionMean, u.unit, 1)}</td>
                    <td className="num">{pct(u.measurementShare, 1)}</td>
                    <td>{code(ft, u.validation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mlmuted">
            {ft('Standard uncertainties from')} {lastBudget.draws.random} + {lastBudget.draws.systematic} {ft('Monte Carlo draws of the sensor model. They cover sensor noise, bias and zero offset — not sensor placement, soft-tissue movement or how the task was performed.')}
          </p>
        </section>
      )}
      <CanonicalNote ft={ft} />
    </>
  );
}
