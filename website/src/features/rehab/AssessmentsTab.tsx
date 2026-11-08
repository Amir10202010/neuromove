// Instrument-based outcome assessments, entered by the examiner. Results only: no proprietary form,
// item text or scoring manual is reproduced. Corrections create a new record that supersedes the old one.

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { copmMeans, gasTScore } from '../../rehab/goals';
import { INSTRUMENTS, TIMEPOINTS, type InstrumentId, type OutcomeAssessment, type Timepoint } from '../../rehab/model';
import { newAssessment } from '../../rehab/workflows';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { SourceBadge, useActor, useSave, useXT } from './common';
import { INSTRUMENT_ICF } from '../../rehab/icf';
import { IcfComponentBadge } from './Icf';
import type { ParticipantData } from './data';

type Item = OutcomeAssessment['items'][number];

export function AssessmentsTab({ data }: { data: ParticipantData }) {
  const { xt, L } = useXT();
  const { f } = useI18n();
  const actor = useActor('professional');
  const save = useSave();
  const [form, setForm] = useState<null | { instrument: InstrumentId; name: string; version: string; scoring: string; examiner: string; date: string; timepoint: Timepoint; items: Item[]; total: string; notes: string; supersedes: string | null }>(null);
  const superseded = new Set(data.assessments.map((a) => a.supersedes).filter(Boolean));

  const start = (instrument: InstrumentId, from?: OutcomeAssessment) => {
    const items: Item[] = from?.items ?? (instrument === 'gas' ? data.goals.filter((g) => g.measurement.kind === 'gas').map((g) => ({ key: g.id, label: g.description, value: null, value2: null, weight: null })) : instrument === 'copm' ? [{ key: 'problem1', label: '', value: null, value2: null, weight: null }] : []);
    setForm({
      instrument,
      name: from?.instrumentName ?? (instrument === 'other' ? '' : L.instrument[instrument]),
      version: from?.instrumentVersion ?? '',
      scoring: from?.scoringMethod ?? (instrument === 'gas' ? 'Kiresuk & Sherman 1968, ρ = 0.3, equal weights' : ''),
      examiner: from?.examiner ?? actor.name,
      date: (from?.date ?? new Date().toISOString()).slice(0, 10),
      timepoint: from?.timepoint ?? 'baseline',
      items,
      total: from?.totals[0] ? String(from.totals[0].value) : '',
      notes: '',
      supersedes: from?.id ?? null,
    });
  };

  const submit = async () => {
    if (!form) return;
    const total = form.total.trim() === '' ? null : Number(form.total.replace(',', '.'));
    const rec = newAssessment(
      {
        participantId: data.patient!.id,
        instrument: form.instrument,
        instrumentName: form.name.trim(),
        instrumentVersion: form.version.trim(),
        scoringMethod: form.scoring.trim(),
        examiner: form.examiner.trim(),
        date: new Date(form.date).toISOString(),
        timepoint: form.timepoint,
        studyId: null,
        items: form.items,
        totals: total !== null && Number.isFinite(total) ? [{ key: 'total', value: total }] : [],
        notes: form.notes,
        supersedes: form.supersedes,
      },
      data.patient!.workspace,
      actor.name,
    );
    if (await save([rec], actor)) setForm(null);
  };
  const setItem = (i: number, patch: Partial<Item>) => form && setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">
          {xt('Outcome assessments')} <SourceBadge source="instrument" />
        </h2>
        <div className="row row--wrap">
          {INSTRUMENTS.map((i) => (
            <Button key={i} size="sm" icon={<Plus />} onClick={() => start(i)}>
              {i === 'other' ? xt('Other') : i.toUpperCase().replace('GMFM', 'GMFM-')}
            </Button>
          ))}
        </div>
      </div>
      <p className="card__body muted small">{xt('The professional selects instruments appropriate for this child. Enter results produced with the licensed instrument; NeuroMove does not reproduce proprietary forms or scoring. Kept separate from IMU measurements and family reports, never combined into one score.')}</p>
      {data.assessments.length === 0 ? (
        <EmptyState compact title={xt('No assessments recorded')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{xt('Date')}</th>
                <th>{xt('Instrument')}</th>
                <th>{xt('Timepoint')}</th>
                <th>ICF</th>
                <th>{xt('Result')}</th>
                <th>{xt('Examiner')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.assessments.map((a) => (
                <tr key={a.id} className={superseded.has(a.id) ? 'is-superseded' : ''}>
                  <td className="num">{f.dateCompact(a.date)}</td>
                  <td>
                    {a.instrumentName} {a.instrumentVersion && <span className="muted small">{a.instrumentVersion}</span>}
                  </td>
                  <td>{L.timepoint[a.timepoint]}</td>
                  <td>{INSTRUMENT_ICF[a.instrument] === 'goal' ? <span className="small muted">{xt('per goal')}</span> : INSTRUMENT_ICF[a.instrument] ? <IcfComponentBadge component={INSTRUMENT_ICF[a.instrument] as 'b' | 'd'} /> : '—'}</td>
                  <td className="num">
                    {a.instrument === 'gas' && `T = ${gasTScore(a.items)?.toFixed(1) ?? '—'} (${a.items.map((i) => (i.value === null ? '·' : i.value > 0 ? `+${i.value}` : i.value)).join(' ')})`}
                    {a.instrument === 'copm' && (() => { const m = copmMeans(a.items); return `P ${m.performance?.toFixed(1) ?? '—'} · S ${m.satisfaction?.toFixed(1) ?? '—'} (n=${m.n})`; })()}
                    {a.instrument !== 'gas' && a.instrument !== 'copm' && (a.totals.map((t) => `${t.value}`).join(', ') || '—')}
                    {superseded.has(a.id) && <span className="badge badge--outline">{xt('corrected')}</span>}
                  </td>
                  <td>{a.examiner}</td>
                  <td>
                    {!superseded.has(a.id) && (
                      <Button size="sm" variant="ghost" onClick={() => start(a.instrument, a)}>
                        {xt('Correct')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} wide title={form?.supersedes ? xt('Correct assessment (new record)') : xt('Record assessment')} footer={<><Button onClick={() => setForm(null)}>{xt('Cancel')}</Button><Button variant="primary" disabled={!form?.name.trim() || !form?.examiner.trim()} onClick={() => void submit()}>{xt('Save')}</Button></>}>
        {form && (
          <div className="stack">
            <div className="grid grid--3">
              <Field label={xt('Instrument')}>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={xt('Version')}>
                <input className="input" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
              </Field>
              <Field label={xt('Timepoint')}>
                <select className="select" value={form.timepoint} onChange={(e) => setForm({ ...form, timepoint: e.target.value as Timepoint })}>
                  {TIMEPOINTS.map((t) => (
                    <option key={t} value={t}>
                      {L.timepoint[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={xt('Examiner')}>
                <input className="input" value={form.examiner} onChange={(e) => setForm({ ...form, examiner: e.target.value })} />
              </Field>
              <Field label={xt('Date')}>
                <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
              <Field label={xt('Scoring method')}>
                <input className="input" value={form.scoring} onChange={(e) => setForm({ ...form, scoring: e.target.value })} />
              </Field>
            </div>
            {form.instrument === 'gas' && (
              <div className="stack">
                <div className="field__label">{xt('GAS level per goal (−2…+2)')}</div>
                {form.items.length === 0 && <p className="muted small">{xt('No goal uses GAS as its measurement method.')}</p>}
                {form.items.map((it, i) => (
                  <div key={it.key} className="row row--wrap">
                    <span className="rh-grow">{it.label}</span>
                    <select className="select rh-input--short" aria-label={it.label} value={it.value ?? ''} onChange={(e) => setItem(i, { value: num(e.target.value) })}>
                      <option value="">—</option>
                      {[-2, -1, 0, 1, 2].map((v) => (
                        <option key={v} value={v}>
                          {v > 0 ? `+${v}` : v}
                        </option>
                      ))}
                    </select>
                    <input className="input rh-input--short" type="number" min={0} step={0.5} aria-label={xt('Weight')} placeholder={xt('Weight')} value={it.weight ?? ''} onChange={(e) => setItem(i, { weight: num(e.target.value) })} />
                  </div>
                ))}
                <p className="muted small">{xt('Summary T-score = 50 + 10·Σwx / √((1−ρ)Σw² + ρ(Σw)²), ρ = 0.3. Descriptive only.')} T = {gasTScore(form.items)?.toFixed(1) ?? '—'}</p>
              </div>
            )}
            {form.instrument === 'copm' && (
              <div className="stack">
                <div className="field__label">{xt('Problems identified with the family: performance and satisfaction (1–10)')}</div>
                {form.items.map((it, i) => (
                  <div key={it.key} className="row row--wrap">
                    <input className="input rh-grow" aria-label={xt('Problem')} placeholder={xt('Problem, in the family’s words')} value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} />
                    <input className="input rh-input--short" type="number" min={1} max={10} aria-label={xt('Performance')} placeholder="P" value={it.value ?? ''} onChange={(e) => setItem(i, { value: num(e.target.value) })} />
                    <input className="input rh-input--short" type="number" min={1} max={10} aria-label={xt('Satisfaction')} placeholder="S" value={it.value2 ?? ''} onChange={(e) => setItem(i, { value2: num(e.target.value) })} />
                  </div>
                ))}
                {form.items.length < 5 && (
                  <Button size="sm" icon={<Plus />} onClick={() => setForm({ ...form, items: [...form.items, { key: `problem${form.items.length + 1}`, label: '', value: null, value2: null, weight: null }] })}>
                    {xt('Add problem')}
                  </Button>
                )}
              </div>
            )}
            {form.instrument !== 'gas' && form.instrument !== 'copm' && (
              <Field label={xt('Total score as produced by the instrument')}>
                <input className="input rh-input--short" inputMode="decimal" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
              </Field>
            )}
            <Field label={xt('Notes')}>
              <textarea className="textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </section>
  );
}
