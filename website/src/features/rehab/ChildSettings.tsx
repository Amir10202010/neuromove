// How the child interface is presented for this child — chosen by the professional with the family.
// No automatic choice from age or diagnosis: children differ in cognitive, sensory and motor abilities.

import { AGE_BANDS, CHILD_THEMES, type ChildPresentation } from '../../rehab/model';
import { Field } from '../../ui/Field';
import { useXT } from './common';

export function ChildSettings({ value, onChange }: { value: ChildPresentation; onChange: (v: ChildPresentation) => void }) {
  const { xt } = useXT();
  const set = <K extends keyof ChildPresentation>(k: K, v: ChildPresentation[K]) => onChange({ ...value, [k]: v });
  const bands: Record<(typeof AGE_BANDS)[number], string> = { early: xt('Early (pictures, very few words)'), middle: xt('Middle (pictures and short words)'), teen: xt('Teen (plain, respectful, more text)') };
  const themes: Record<(typeof CHILD_THEMES)[number], string> = { garden: xt('Garden'), space: xt('Space'), ocean: xt('Ocean'), plain: xt('Plain') };
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">{xt('Child mode presentation')}</h2>
        <span className="muted small">{xt('Saved with the profile. Rewards are for taking part, never for performance; no comparisons between children.')}</span>
      </div>
      <div className="card__body stack">
        <Field label={xt('Presentation')}>
          <select className="select" value={value.ageBand} onChange={(e) => set('ageBand', e.target.value as ChildPresentation['ageBand'])}>
            {AGE_BANDS.map((b) => (
              <option key={b} value={b}>
                {bands[b]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={xt('Theme')}>
          <select className="select" value={value.theme} onChange={(e) => set('theme', e.target.value as ChildPresentation['theme'])}>
            {CHILD_THEMES.map((th) => (
              <option key={th} value={th}>
                {themes[th]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={xt('Text size')}>
          <select className="select" value={value.textSize} onChange={(e) => set('textSize', e.target.value as ChildPresentation['textSize'])}>
            <option value="normal">{xt('Normal')}</option>
            <option value="large">{xt('Large')}</option>
            <option value="xlarge">{xt('Extra large')}</option>
          </select>
        </Field>
        {(
          [
            ['story', xt('Story path that grows with participation')],
            ['reduceMotion', xt('Reduce motion')],
            ['sound', xt('Sounds')],
            ['showMeasurements', xt('Show the last real measurement next to the individual target')],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="checkbox">
            <input type="checkbox" checked={value[k]} onChange={(e) => set(k, e.target.checked)} />
            {label}
          </label>
        ))}
      </div>
    </section>
  );
}
