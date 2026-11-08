// ICF-CY badges and picker. Codes are shown with their official English short title as a tooltip and
// accessible name; "suggested" marks codes that the professional has not confirmed yet.

import { ICF_CATALOG, icfCategory, type IcfComponent } from '../../rehab/icf';
import { useXT } from './common';

const COMPONENT_KEY: Record<IcfComponent, string> = { b: 'Body functions', s: 'Body structures', d: 'Activities and participation', e: 'Environmental factors' };

export function IcfBadges({ codes, confirmed }: { codes: readonly string[]; confirmed: boolean }) {
  const { xt } = useXT();
  if (!codes.length) return null;
  return (
    <span className="rh-icf">
      {codes.map((c) => {
        const cat = icfCategory(c);
        const label = cat ? `ICF ${c} — ${cat.title} (${xt(COMPONENT_KEY[cat.component])})` : `ICF ${c}`;
        return (
          <span key={c} className={`rh-icf__code rh-icf__code--${cat?.component ?? 'd'}${confirmed ? '' : ' is-suggested'}`} title={label} aria-label={label}>
            {c}
          </span>
        );
      })}
      {!confirmed && <span className="muted small">{xt('suggested')}</span>}
    </span>
  );
}

export function IcfComponentBadge({ component }: { component: IcfComponent }) {
  const { xt } = useXT();
  return (
    <span className={`rh-icf__code rh-icf__code--${component}`} title={xt(COMPONENT_KEY[component])}>
      ICF {component}
    </span>
  );
}

export function IcfPicker({ value, confirmed, onChange }: { value: readonly string[]; confirmed: boolean; onChange: (codes: string[]) => void }) {
  const { xt } = useXT();
  return (
    <fieldset className="chips">
      <legend className="field__label">
        {xt('ICF-CY categories')} {!confirmed && <span className="muted small">· {xt('suggested from the category — select to confirm')}</span>}
      </legend>
      {ICF_CATALOG.map((c) => {
        const on = value.includes(c.code);
        return (
          <label key={c.code} className={`chip rh-chip${on ? ' is-on' : ''}${on && !confirmed ? ' is-suggested' : ''}`} title={xt(COMPONENT_KEY[c.component])}>
            <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? [...value.filter((x) => x !== c.code), c.code] : value.filter((x) => x !== c.code))} />
            <span className="num">{c.code}</span> {c.title}
          </label>
        );
      })}
    </fieldset>
  );
}
