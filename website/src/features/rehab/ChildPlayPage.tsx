// Child mode: the professionally assigned home activities, made understandable and friendly.
//  - Visual steps, large controls, a break button and a stop button on every screen.
//  - Rewards count TAKING PART (done, partly done, stopped after trying) — never range, speed or
//    repetitions, never a comparison with other children, never a lost streak.
//  - Measured feedback appears only when a REAL sensor measurement of this movement exists, labelled
//    with where and when it was measured. Nothing is invented and nothing is live in this phase.
//  - An adult closes the activity: how it went, and whether it hurt (pain → safety report).
//  - Leaving child mode needs a press-and-hold (so a child does not leave by accident).

import { Activity, Pause, Square, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { href, navigate } from '../../app/router';
import { useI18n } from '../../i18n';
import type { Assignment } from '../../rehab/model';
import { movementSeries, usable } from '../../rehab/movement';
import { allAssignments } from '../../rehab/programs';
import { reportPractice, DEFAULT_CHILD } from '../../rehab/workflows';
import { useActor, useIsCaregiverAccount, useSave, useXT } from './common';
import { activityByKey, useParticipant, useRehabLoaded, type ParticipantData } from './data';
import { LivePractice, practiceSide } from './LivePractice';
import { useEnsureDemo } from './demo';
import { StepIconView } from './icons';

type Phase = { kind: 'choose' } | { kind: 'doing'; a: Assignment; step: number } | { kind: 'break'; a: Assignment; step: number } | { kind: 'finish'; a: Assignment; stopped: boolean } | { kind: 'thanks' };

export function ChildPlayPage({ id }: { id: string }) {
  const { xt } = useXT();
  useRehabLoaded();
  useEnsureDemo();
  const data = useParticipant(id);
  const actor = useActor('family', id);
  const caregiverAccount = useIsCaregiverAccount();
  const save = useSave();
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [live, setLive] = useState(false);
  // Leaving the activity also stops the sensors
  const go = (p: Phase) => {
    if (p.kind !== 'doing') setLive(false);
    setPhase(p);
  };
  const { patient, program } = data;
  if (!patient || (caregiverAccount && !actor.participantIds.includes(id))) return <main className="child-shell">{xt('This page is not available.')}</main>;
  const pres = data.profile?.child ?? DEFAULT_CHILD;
  const home = program ? allAssignments(program.def).filter((a) => a.setting === 'home' && activityByKey(data.activities, a.activityKey)) : [];
  const taken = data.practice.filter((p) => p.completion === 'completed' || p.completion === 'partial' || p.completion === 'stopped').length;
  const cls = `child-shell child-theme--${pres.theme} child-text--${pres.textSize} child-age--${pres.ageBand}${pres.reduceMotion ? ' child-calm' : ''}`;

  const finish = async (a: Assignment, completion: 'completed' | 'partial' | 'stopped', pain: boolean, breakRequested: boolean) => {
    const { practice, incidents } = reportPractice(
      { participantId: id, programKey: program!.id, assignmentId: a.id, activityKey: a.activityKey, setting: 'home', source: 'child_mode', completion, difficulty: false, breakRequested, fatigue: null, discomfort: pain ? 'pain' : null, barriers: [], durationMin: null, observation: '' },
      patient.workspace,
      actor.name,
      'caregiver',
    );
    if (await save([practice, ...incidents], actor)) go({ kind: 'thanks' });
  };

  return (
    <main className={cls} tabIndex={-1}>
      <header className="child-top">
        <HoldToExit label={xt('Grown-up: hold to exit')} onExit={() => navigate({ name: 'familyHome', id })} />
        <div className="child-stars" aria-label={xt('Times you took part: {n}', { n: taken })}>
          <Star aria-hidden /> <span className="num">{taken}</span>
        </div>
      </header>
      {patient.workspace === 'demo' && <div className="child-demo">{xt('Demo')}</div>}

      {phase.kind === 'choose' && (
        <section className="child-stage">
          <h1 className="child-h1">{pres.ageBand === 'teen' ? xt('Your activities') : xt('What shall we do?')}</h1>
          {pres.story && <StoryPath count={taken} theme={pres.theme} />}
          {home.length === 0 ? (
            <p className="child-msg">{xt('Your therapist has not added activities yet.')}</p>
          ) : (
            <ul className="child-cards">
              {home.map((a) => {
                const act = activityByKey(data.activities, a.activityKey)!;
                return (
                  <li key={a.id}>
                    <button type="button" className="child-card" onClick={() => go({ kind: 'doing', a, step: 0 })}>
                      <StepIconView icon={act.def.steps[0]?.icon ?? 'star'} size={72} />
                      <span>{act.def.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {phase.kind === 'doing' && (() => {
        const act = activityByKey(data.activities, phase.a.activityKey)!;
        const steps = act.def.steps.length ? act.def.steps : [{ icon: 'star' as const, text: act.def.name }];
        const s = steps[phase.step]!;
        const last = phase.step >= steps.length - 1;
        return (
          <section className="child-stage">
            <div className="child-progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={phase.step + 1} aria-label={xt('Step {n} of {m}', { n: phase.step + 1, m: steps.length })}>
              {steps.map((_, i) => (
                <span key={i} className={i <= phase.step ? 'is-on' : ''} />
              ))}
            </div>
            <div className="child-step">
              <StepIconView icon={s.icon} size={160} />
              <p className="child-step__text">{s.text}</p>
            </div>
            {pres.showMeasurements && !live && <MeasuredFeedback data={data} a={phase.a} />}
            {act.def.measurement.kind === 'imu_session' && act.def.measurement.exercise && pres.showMeasurements && (
              <>
                {!live && (
                  <button type="button" className="child-btn child-btn--break rh-live__open" onClick={() => setLive(true)}>
                    <Activity aria-hidden /> {xt('Sensors (grown-up)')}
                  </button>
                )}
                {live && <LivePractice patient={patient} target={{ exercise: act.def.measurement.exercise, side: practiceSide(patient), targetDeg: phase.a.feedbackTargetDeg }} reduceMotion={pres.reduceMotion} onClose={() => setLive(false)} />}
              </>
            )}
            <div className="child-actions">
              <button type="button" className="child-btn child-btn--go" onClick={() => (last ? go({ kind: 'finish', a: phase.a, stopped: false }) : go({ ...phase, step: phase.step + 1 }))}>
                {last ? xt('I did it!') : xt('Next')}
              </button>
              <button type="button" className="child-btn child-btn--break" onClick={() => go({ kind: 'break', a: phase.a, step: phase.step })}>
                <Pause aria-hidden /> {xt('Break')}
              </button>
              <button type="button" className="child-btn child-btn--stop" onClick={() => go({ kind: 'finish', a: phase.a, stopped: true })}>
                <Square aria-hidden /> {xt('Stop')}
              </button>
            </div>
          </section>
        );
      })()}

      {phase.kind === 'break' && (
        <section className="child-stage child-break">
          <div className="child-breathe" aria-hidden />
          <h1 className="child-h1">{xt('Rest time')}</h1>
          <p className="child-msg">{xt('Breathe in… and out. Rest as long as you like.')}</p>
          <div className="child-actions">
            <button type="button" className="child-btn child-btn--go" onClick={() => go({ kind: 'doing', a: phase.a, step: phase.step })}>
              {xt('I am ready')}
            </button>
            <button type="button" className="child-btn child-btn--stop" onClick={() => go({ kind: 'finish', a: phase.a, stopped: true })}>
              <Square aria-hidden /> {xt('Stop for today')}
            </button>
          </div>
        </section>
      )}

      {phase.kind === 'finish' && <AdultClose stopped={phase.stopped} onDone={(c, pain) => void finish(phase.a, c, pain, phase.stopped)} />}

      {phase.kind === 'thanks' && (
        <section className="child-stage">
          <div className="child-reward" aria-hidden>
            <Star />
          </div>
          <h1 className="child-h1">{pres.ageBand === 'teen' ? xt('Done. Thanks for your effort.') : xt('Thank you for trying!')}</h1>
          <p className="child-msg">{xt('Every time you take part counts.')}</p>
          <div className="child-actions">
            <button type="button" className="child-btn child-btn--go" onClick={() => go({ kind: 'choose' })}>
              {xt('Back')}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

/** The adult answers two questions; the child never has to rate themselves. */
function AdultClose({ stopped, onDone }: { stopped: boolean; onDone: (c: 'completed' | 'partial' | 'stopped', pain: boolean) => void }) {
  const { xt } = useXT();
  const [c, setC] = useState<'completed' | 'partial' | 'stopped' | null>(stopped ? 'stopped' : null);
  const [pain, setPain] = useState<boolean | null>(null);
  return (
    <section className="child-stage child-adult">
      <h1 className="child-h2">{stopped ? xt('That is OK. We stop here.') : xt('Great work!')}</h1>
      <p className="child-msg">{xt('For the grown-up:')}</p>
      <fieldset className="rh-big-choice">
        <legend>{xt('How did it go?')}</legend>
        {(['completed', 'partial', 'stopped'] as const).map((v) => (
          <button key={v} type="button" className={`rh-big-choice__opt${c === v ? ' is-on' : ''}`} aria-pressed={c === v} onClick={() => setC(v)}>
            {v === 'completed' ? xt('Done') : v === 'partial' ? xt('Partly done') : xt('Stopped')}
          </button>
        ))}
      </fieldset>
      <fieldset className="rh-big-choice">
        <legend>{xt('Did it hurt?')}</legend>
        <button type="button" className={`rh-big-choice__opt${pain === false ? ' is-on' : ''}`} aria-pressed={pain === false} onClick={() => setPain(false)}>
          {xt('No')}
        </button>
        <button type="button" className={`rh-big-choice__opt rh-big-choice__opt--pain${pain === true ? ' is-on' : ''}`} aria-pressed={pain === true} onClick={() => setPain(true)}>
          {xt('Yes')}
        </button>
      </fieldset>
      {pain && <p className="callout callout--critical">{xt('Please stop the activity. Your therapist will see this report and get in touch. If the pain is strong or does not pass, contact a doctor.')}</p>}
      <div className="child-actions">
        <button type="button" className="child-btn child-btn--go" disabled={c === null || pain === null} onClick={() => c && pain !== null && onDone(c, pain)}>
          {xt('Save')}
        </button>
      </div>
    </section>
  );
}

/** Last REAL measurement of this activity's movement vs the professional's individual target. */
function MeasuredFeedback({ data, a }: { data: ParticipantData; a: Assignment }) {
  const { xt } = useXT();
  const { f } = useI18n();
  const act = activityByKey(data.activities, a.activityKey);
  const ex = act?.def.measurement.kind === 'imu_session' ? act.def.measurement.exercise : null;
  if (!ex) return null;
  const s = movementSeries(data.sessions, { includeSimulated: data.demo }).filter((x) => x.exercise === ex);
  const pts = s.flatMap((x) => x.points).filter((p) => usable(p, data.demo) && p.values.rom !== undefined).sort((p, q) => p.date.localeCompare(q.date));
  const last = pts.at(-1);
  if (!last) return null;
  const v = last.values.rom as number;
  const target = a.feedbackTargetDeg;
  const max = Math.max(180, target ?? 0, v);
  return (
    <figure className="child-measure" aria-label={xt('Measured movement')}>
      <div className="child-measure__bar">
        <span className="child-measure__fill" style={{ width: `${(v / max) * 100}%` }} />
        {target !== null && <span className="child-measure__target" style={{ left: `${(target / max) * 100}%` }} title={xt('Your target')} />}
      </div>
      <figcaption>
        {xt('Measured with the sensors at the clinic on {date}: {v}°', { date: f.date(last.date), v: Math.round(v) })}
        {target !== null && ` · ${xt('your target {t}°', { t: target })}`}
        {last.simulated && ` · ${xt('simulated')}`}
      </figcaption>
    </figure>
  );
}

function StoryPath({ count, theme }: { count: number; theme: string }) {
  const { xt } = useXT();
  const shown = Math.min(count, 12);
  const label = theme === 'space' ? xt('Stars in your sky: {n}', { n: count }) : theme === 'ocean' ? xt('Fish in your sea: {n}', { n: count }) : xt('Flowers in your garden: {n}', { n: count });
  return (
    <div className="rh-story" aria-label={label}>
      <div className="rh-story__path" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={`rh-story__spot${i < shown ? ' is-grown' : ''}`} />
        ))}
      </div>
      <p className="rh-story__label">{label}</p>
    </div>
  );
}

function HoldToExit({ label, onExit }: { label: string; onExit: () => void }) {
  const [p, setP] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setP(0);
  };
  const start = () => {
    stop();
    const t0 = Date.now();
    timer.current = setInterval(() => {
      const x = (Date.now() - t0) / 1500;
      setP(Math.min(1, x));
      if (x >= 1) {
        stop();
        onExit();
      }
    }, 50);
  };
  useEffect(() => stop, []);
  return (
    <button type="button" className="child-exit" onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onKeyDown={(e) => e.key === 'Enter' && onExit()} aria-label={label} title={label} style={{ ['--hold' as string]: p }}>
      <span className="child-exit__ring" aria-hidden />
      {label}
    </button>
  );
}

export const childHref = (id: string) => href({ name: 'childPlay', id });
