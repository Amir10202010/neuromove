// Summary for professional review.
//  - Built-in summary: numbered facts from the records, grouped, each with its information source. No AI,
//    works offline.
//  - Optional AI draft (team server with AI enabled, staff only): the same pseudonymous facts are sent;
//    every sentence comes back with the facts it cites; uncited, unknown-fact or diagnosing/prescribing
//    sentences are flagged. Nothing is saved unless the professional edits and saves it as a clinical note.

import { ClipboardCopy, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { buildFacts, SUMMARY_SECTIONS, type CheckedDraft, type Fact, type SummarySection } from '../../rehab/summary';
import { useAppStore } from '../../state/appStore';
import { fetchTransport, useSyncStore } from '../../sync/engine';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { exerciseLabel, useActor, useXT, type XT } from './common';
import type { ExerciseId } from '../../core/exercises';
import type { ParticipantData } from './data';
import type { Labels } from './labels';

const SECTION_TITLE: Record<SummarySection, string> = {
  goals: 'Goals',
  program: 'Program',
  practice: 'Home practice (reported)',
  safety: 'Safety',
  measurements: 'Sensor measurements (IMU)',
  assessments: 'Assessments (instruments)',
  review: 'Review and open observations',
};

const SOURCE_CLASS: Record<Fact['source'], string> = { instrument: 'src-badge--instrument', imu: 'src-badge--imu', reported: 'src-badge--reported', professional: 'src-badge--professional', analysis: 'src-badge--professional' };

/** Localise a fact: the template is the translation key; identifier parameters get their labels. */
export function factText(f: Fact, xt: XT, L: Labels, exercise: (id: ExerciseId) => string = (id) => id): string {
  const p: Record<string, string | number> = { ...f.params };
  const mv = typeof p.movement === 'string' ? /^(\w+) (left|right)$/.exec(p.movement) : null;
  if (mv) p.movement = `${exercise(mv[1] as ExerciseId)} (${xt(mv[2] as string)})`;
  const map = (k: string, m: Record<string, string>) => {
    if (typeof p[k] === 'string' && (p[k] as string) in m) p[k] = m[p[k] as string] as string;
  };
  map('category', L.goalCategory);
  if (f.section === 'goals') map('status', L.goalStatus);
  if (f.section === 'program') map('status', L.programStatus);
  map('decision', L.decision);
  if (typeof p.list === 'string') p.list = p.list.replace(/(\w+) ×/g, (_m, b: string) => `${(L.barrier as Record<string, string>)[b] ?? b} ×`);
  if (typeof p.types === 'string') p.types = p.types.split(', ').map((x) => (L.incidentType as Record<string, string>)[x] ?? x).join(', ');
  map('timepoint', L.timepoint);
  if (typeof p.review === 'string' && p.review) p.review = xt(p.review);
  if (typeof p.exceeds === 'string') p.exceeds = xt(p.exceeds);
  if (typeof p.direction === 'string') p.direction = xt(p.direction);
  if (typeof p.prov === 'string' && p.prov) p.prov = xt(p.prov);
  if (typeof p.sim === 'string' && p.sim) p.sim = xt(p.sim);
  if (p.planned === 'not specified') p.planned = xt('not specified');
  if (typeof p.severity === 'string') p.severity = p.severity === 'review' ? xt('for review') : xt('information');
  return xt(f.key, p);
}

export function SummaryPanel({ data }: { data: ParticipantData }) {
  const { xt, L, locale } = useXT();
  const { f, t } = useI18n();
  const ex = (id: ExerciseId) => exerciseLabel(t, id);
  const actor = useActor('professional');
  const addNote = useAppStore((s) => s.addNote);
  const toast = useAppStore((s) => s.toast);
  const account = useSyncStore((s) => s.account);
  const syncOn = useSyncStore((s) => s.config.enabled);
  const [includeGoalText, setIncludeGoalText] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [draft, setDraft] = useState<CheckedDraft | null>(null);
  const [draftFacts, setDraftFacts] = useState<Fact[]>([]);
  const [aiMeta, setAiMeta] = useState<{ model: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const staff = account?.role === 'admin' || account?.role === 'session_operator';
  const canAi = syncOn && staff && data.patient?.workspace === 'clinic';

  // Built-in facts always include goal wording (they never leave the device)
  const facts = useMemo(
    () => buildFacts({ now: new Date(), demo: data.demo, profile: data.profile, goals: data.goals, program: data.program, practice: data.practice, incidents: data.incidents, reviews: data.reviews, assessments: data.assessments, sessions: data.sessions, observations: data.observations, includeGoalText: true }),
    [data],
  );

  useEffect(() => {
    if (!canAi) return;
    void fetchTransport('/api/health')
      .then((r) => setAiAvailable((r.json as { aiSummaries?: string } | null)?.aiSummaries === 'enabled'))
      .catch(() => setAiAvailable(false));
  }, [canAi]);

  const requestDraft = async () => {
    setBusy(true);
    setError(null);
    const sent = buildFacts({ now: new Date(), demo: data.demo, profile: data.profile, goals: data.goals, program: data.program, practice: data.practice, incidents: data.incidents, reviews: data.reviews, assessments: data.assessments, sessions: data.sessions, observations: data.observations, includeGoalText });
    try {
      const r = await fetchTransport('/api/ai/summary', { method: 'POST', body: { facts: sent.map(({ id, section, source, text }) => ({ id, section, source, text })), language: locale } });
      if (r.status !== 200) {
        setError((r.json as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
        return;
      }
      const j = r.json as { draft: CheckedDraft; model: string };
      setDraft(j.draft);
      setDraftFacts(sent);
      setAiMeta({ model: j.model });
    } catch {
      setError('network');
    } finally {
      setBusy(false);
    }
  };

  const builtInText = () =>
    SUMMARY_SECTIONS.flatMap((s) => {
      const fs = facts.filter((x) => x.section === s);
      return fs.length ? [`${xt(SECTION_TITLE[s])}:`, ...fs.map((x) => `- ${factText(x, xt, L, ex)}`), ''] : [];
    }).join('\n');
  const draftText = () =>
    draft
      ? [
          `${xt('AI draft, reviewed by {name}', { name: actor.name })} (${aiMeta?.model ?? ''})`,
          ...draft.sections.flatMap((s) => {
            const ok = s.sentences.filter((x) => !x.flags.length);
            return ok.length ? [`${xt(SECTION_TITLE[s.section])}: ${ok.map((x) => x.text).join(' ')}`] : [];
          }),
        ].join('\n')
      : '';

  const byId = new Map(draftFacts.map((x) => [x.id, x]));
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">{xt('Summary for review')}</h2>
        <div className="row row--wrap">
          <Button size="sm" icon={<ClipboardCopy />} onClick={() => setNote(builtInText())}>
            {xt('Use as clinical note…')}
          </Button>
          {canAi && aiAvailable && (
            <Button size="sm" icon={<Sparkles />} loading={busy} onClick={() => void requestDraft()}>
              {xt('Draft with AI')}
            </Button>
          )}
        </div>
      </div>
      <div className="card__body stack">
        <p className="muted small">{xt('Built from the records on this device, no AI. Each line names its source; nothing here is a diagnosis or a recommendation.')}</p>
        {facts.length === 0 ? (
          <p className="muted">{xt('Nothing recorded yet.')}</p>
        ) : (
          SUMMARY_SECTIONS.map((s) => {
            const fs = facts.filter((x) => x.section === s);
            if (!fs.length) return null;
            return (
              <div key={s}>
                <h3 className="rh-sum__h">{xt(SECTION_TITLE[s])}</h3>
                <ul className="rh-sum">
                  {fs.map((x) => (
                    <li key={x.id}>
                      <span className={`src-badge ${SOURCE_CLASS[x.source]}`}>{x.source === 'analysis' ? xt('analysis') : L.source[x.source]}</span> {factText(x, xt, L, ex)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}

        {canAi && aiAvailable && (
          <label className="checkbox">
            <input type="checkbox" checked={includeGoalText} onChange={(e) => setIncludeGoalText(e.target.checked)} />
            {xt('Include goal wording in the AI request (check that it contains no names)')}
          </label>
        )}
        {canAi && !aiAvailable && <p className="muted small">{xt('AI drafts are off. The team server operator can enable them; the summary above works without them.')}</p>}
        {error && (
          <div className="callout callout--warn" role="alert">
            {xt('The AI draft could not be produced')}: {error}
          </div>
        )}
        {draft && (
          <div className="rh-ai">
            <div className="callout callout--info">
              <Sparkles aria-hidden />
              <div>
                <div className="callout__title">{xt('AI draft — for professional review')}</div>
                {xt('Generated by {model} from {n} pseudonymous facts. Each sentence shows the facts it cites. Flagged sentences are excluded when you copy the draft.', { model: aiMeta?.model ?? '', n: draftFacts.length })}
              </div>
            </div>
            {draft.sections.map((s) => (
              <div key={s.section}>
                <h3 className="rh-sum__h">{xt(SECTION_TITLE[s.section])}</h3>
                {s.sentences.map((x, i) => (
                  <p key={i} className={`rh-ai__s${x.flags.length ? ' is-flagged' : ''}`}>
                    {x.text}{' '}
                    {x.facts.map((id) => (
                      <span key={id} className="rh-ai__cite" title={byId.get(id)?.text ?? id}>
                        {id}
                      </span>
                    ))}
                    {x.flags.map((fl) => (
                      <span key={fl} className="badge badge--warn">
                        {xt(`flag.${fl}`)}
                      </span>
                    ))}
                  </p>
                ))}
              </div>
            ))}
            <div className="row row--wrap">
              <Button size="sm" onClick={() => setNote(draftText())}>
                {xt('Edit and save as clinical note…')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                {xt('Discard draft')}
              </Button>
            </div>
            <p className="muted small">{xt('Generated {date}. The draft is not stored anywhere until you save it.', { date: f.dateTime(new Date().toISOString()) })}</p>
          </div>
        )}
      </div>

      <Modal
        open={note !== null}
        onClose={() => setNote(null)}
        wide
        title={xt('Clinical note')}
        footer={
          <>
            <Button onClick={() => setNote(null)}>{xt('Cancel')}</Button>
            <Button
              variant="primary"
              disabled={!note?.trim()}
              onClick={() => {
                addNote({ patientId: data.patient!.id, sessionId: null, author: actor.name, text: note!.trim(), kind: 'clinical' });
                toast('good', xt('Saved on this device'));
                setNote(null);
              }}
            >
              {xt('Save note')}
            </Button>
          </>
        }
      >
        <Field label={xt('Edit before saving. The note is yours, not the system’s.')}>
          <textarea className="textarea" rows={14} value={note ?? ''} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>
    </section>
  );
}
