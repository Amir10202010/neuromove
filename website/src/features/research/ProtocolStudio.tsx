// Protocol Studio: reusable validation procedures without code changes. Saving an edit creates a NEW
// version; sessions keep the frozen definition they were measured with.

import { Archive, Copy, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { href } from '../../app/router';
import { EXERCISES, type ExerciseId } from '../../core/exercises';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { VALIDATION_EXERCISES, capabilityOf } from '../../research/capabilities';
import type { BodyRegion, CaptureMode, MeasurementPointKind, ProtocolDefinition, ProtocolVersion } from '../../research/model';
import { TEMPLATES, checkDefinition, latestVersions, newPoint, type DefinitionProblem } from '../../research/protocols';
import { useResearchStore } from '../../research/store';
import { currentClinician, useAppStore } from '../../state/appStore';
import { Button, LinkButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { useRT } from './i18n';

const PROBLEMS: Record<DefinitionProblem, string> = {
  name_required: 'Name is required.',
  unsupported_exercise: 'This movement is not computed by the current sensor configuration.',
  points_required: 'Add at least one measurement point.',
  duplicate_point_ids: 'Measurement point ids must be unique.',
  repetitions_range: 'Repetitions: 1–200.',
  sets_range: 'Sets: 1–20.',
  window_range: 'Capture window: 0.2–5 s.',
};

export function ProtocolStudio() {
  const rt = useRT();
  const { f } = useI18n();
  const ws = useAppStore((s) => s.settings.workspace);
  const loaded = useResearchStore((s) => s.loaded);
  const load = useResearchStore((s) => s.load);
  const all = useResearchStore((s) => s.protocols);
  const save = useResearchStore((s) => s.saveProtocol);
  const archive = useResearchStore((s) => s.archiveProtocol);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  const latest = useMemo(() => latestVersions(all.filter((v) => v.workspace === ws)), [all, ws]);
  const [editing, setEditing] = useState<{ protocolId?: string; def: ProtocolDefinition } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const problems = editing ? checkDefinition(editing.def) : [];
  const history = (id: string) => all.filter((v) => v.protocolId === id).sort((a, b) => b.version - a.version);

  const doSave = async () => {
    if (!editing || problems.length) return;
    const v = await save(editing.def, ws, currentClinician() || 'operator', editing.protocolId);
    setMsg(v ? rt('Saved as version {v}.', { v: v.version }) : rt('No changes — no new version created.'));
    if (v) setEditing({ protocolId: v.protocolId, def: structuredClone(v.definition) });
  };

  return (
    <div className="page">
      <PageHeader back={{ href: href({ name: 'research' }), label: rt('Research') }} title={rt('Protocols')} lead={rt('Each save creates a new immutable version. Past sessions keep the version they ran under.')} />
      <div className="grid grid--side-main">
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{rt('Your protocols')}</h2>
          </div>
          {latest.length === 0 ? (
            <EmptyState compact title={rt('No protocols yet')} text={rt('Start from a template on the right.')} />
          ) : (
            <ul className="vplist">
              {latest.map((v) => (
                <li key={v.key}>
                  <button type="button" className={`vplist__item${editing?.protocolId === v.protocolId ? ' is-active' : ''}`} onClick={() => setEditing({ protocolId: v.protocolId, def: structuredClone(v.definition) })}>
                    <strong>{v.definition.name}</strong>
                    <span className="muted small">
                      v{v.version} · {f.dateCompact(v.createdAt)} · {v.definition.repetitions}× {v.definition.measurementPoints.length} {rt('points')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="card__body stack">
            <span className="stat__label">{rt('Templates')}</span>
            {TEMPLATES.map((t) => (
              <Button key={t.id} size="sm" variant="ghost" icon={<Copy />} onClick={() => setEditing({ def: structuredClone(t.definition) })}>
                {t.definition.name}
              </Button>
            ))}
          </div>
        </section>

        <section className="card">
          {!editing ? (
            <EmptyState title={rt('Select a protocol or a template')} />
          ) : (
            <div className="card__body stack">
              <Editor def={editing.def} onChange={(def) => setEditing({ ...editing, def })} />
              {problems.length > 0 && (
                <div className="callout callout--warn">
                  <ul className="vlist">
                    {problems.map((p) => (
                      <li key={p}>{rt(PROBLEMS[p] as never)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {msg && <div className="callout callout--good">{msg}</div>}
              <div className="row row--wrap">
                <Button variant="primary" icon={<Save />} disabled={problems.length > 0} onClick={() => void doSave()}>
                  {editing.protocolId ? rt('Save as new version') : rt('Create protocol')}
                </Button>
                {editing.protocolId && (
                  <LinkButton href={href({ name: 'researchNew', protocolKey: latest.find((v) => v.protocolId === editing.protocolId)?.key ?? null })}>{rt('Start a session with this protocol')}</LinkButton>
                )}
                {editing.protocolId && (
                  <Button
                    variant="ghost"
                    icon={<Archive />}
                    onClick={() => {
                      const v = latest.find((x) => x.protocolId === editing.protocolId);
                      if (v) void archive(v).then(() => setEditing(null));
                    }}
                  >
                    {rt('Archive')}
                  </Button>
                )}
              </div>
              {editing.protocolId && <VersionHistory versions={history(editing.protocolId)} />}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function VersionHistory({ versions }: { versions: ProtocolVersion[] }) {
  const rt = useRT();
  const { f } = useI18n();
  return (
    <details>
      <summary>
        {rt('Version history')} ({versions.length})
      </summary>
      <ul className="vlist">
        {versions.map((v) => (
          <li key={v.key}>
            v{v.version} · {f.dateTime(v.createdAt)} · {v.createdBy} · {v.definition.repetitions}× · {v.definition.measurementPoints.map((p) => p.label).join(' / ')}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Editor({ def, onChange }: { def: ProtocolDefinition; onChange: (d: ProtocolDefinition) => void }) {
  const rt = useRT();
  const set = <K extends keyof ProtocolDefinition>(k: K, v: ProtocolDefinition[K]) => onChange({ ...def, [k]: v });
  const num = (v: string) => (v === '' ? NaN : Number(v));
  const cap = capabilityOf(def.exercise);
  return (
    <div className="vform">
      <label className="field vform__wide">
        <span className="field__label">{rt('Name')}</span>
        <input className="input" value={def.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      <label className="field vform__wide">
        <span className="field__label">{rt('Description')}</span>
        <input className="input" value={def.description} onChange={(e) => set('description', e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{rt('Body region')}</span>
        <select className="select" value={def.bodyRegion} onChange={(e) => set('bodyRegion', e.target.value as BodyRegion)}>
          {(['upper_limb', 'lower_limb', 'trunk', 'multi_segment', 'custom'] as BodyRegion[]).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">{rt('Joint')}</span>
        <input className="input" value={def.joint} onChange={(e) => set('joint', e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{rt('IMU angle definition')}</span>
        <select className="select" value={def.exercise} onChange={(e) => set('exercise', e.target.value as ExerciseId)}>
          {VALIDATION_EXERCISES.map((x) => (
            <option key={x} value={x}>
              {x} ({EXERCISES[x].angle})
            </option>
          ))}
        </select>
        <span className="field__hint">
          {rt(cap.status === 'operational' ? 'Operational' : 'Experimental')} — {cap.limitation}
        </span>
      </label>
      <label className="field">
        <span className="field__label">{rt('Side')}</span>
        <select className="select" value={def.side} onChange={(e) => set('side', e.target.value as 'left' | 'right')}>
          <option value="right">{rt('Right')}</option>
          <option value="left">{rt('Left')}</option>
        </select>
      </label>
      <label className="field">
        <span className="field__label">{rt('Movement type')}</span>
        <input className="input" value={def.movementType} onChange={(e) => set('movementType', e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{rt('Repetitions')}</span>
        <input className="input" type="number" min={1} max={200} value={Number.isFinite(def.repetitions) ? def.repetitions : ''} onChange={(e) => set('repetitions', num(e.target.value))} />
      </label>
      <label className="field">
        <span className="field__label">{rt('Sets')}</span>
        <input className="input" type="number" min={1} max={20} value={Number.isFinite(def.sets) ? def.sets : ''} onChange={(e) => set('sets', num(e.target.value))} />
      </label>
      <label className="field">
        <span className="field__label">{rt('Rest between sets, s')}</span>
        <input className="input" type="number" min={0} value={def.restSec} onChange={(e) => set('restSec', Math.max(0, num(e.target.value) || 0))} />
      </label>
      <label className="field">
        <span className="field__label">{rt('Capture')}</span>
        <select className="select" value={def.captureMode} onChange={(e) => set('captureMode', e.target.value as CaptureMode)}>
          <option value="hold">{rt('Hold — median of a window (recommended)')}</option>
          <option value="rep_peak">{rt('Repetition peak — automatic (experimental)')}</option>
        </select>
      </label>
      <label className="field">
        <span className="field__label">{rt('Capture window, s')}</span>
        <input className="input" type="number" step={0.1} min={0.2} max={5} value={Number.isFinite(def.holdWindowSec) ? def.holdWindowSec : ''} onChange={(e) => set('holdWindowSec', num(e.target.value))} />
      </label>
      <label className="field">
        <span className="field__label">{rt('Max window SD, °')}</span>
        <input className="input" type="number" step={0.1} min={0} value={def.quality.maxWindowSdDeg} onChange={(e) => set('quality', { ...def.quality, maxWindowSdDeg: num(e.target.value) || 0 })} />
      </label>
      <label className="field">
        <span className="field__label">{rt('Review threshold |error|, °')}</span>
        <input className="input" type="number" step={0.5} min={0} value={def.quality.reviewAbsErrorDeg} onChange={(e) => set('quality', { ...def.quality, reviewAbsErrorDeg: num(e.target.value) || 0 })} />
      </label>
      <label className="checkbox vform__wide">
        <input type="checkbox" checked={def.goniometerRequired} onChange={(e) => set('goniometerRequired', e.target.checked)} />
        {rt('Goniometer reading required after every repetition')}
      </label>

      <fieldset className="vform__wide vpoints">
        <legend className="field__label">{rt('Measurement points (per repetition)')}</legend>
        {def.measurementPoints.map((p, i) => (
          <div key={i} className="row">
            <input className="input" style={{ width: 70 }} aria-label="id" value={p.id} onChange={(e) => set('measurementPoints', def.measurementPoints.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))} />
            <select className="select" style={{ width: 170 }} aria-label={rt('Kind')} value={p.kind} onChange={(e) => set('measurementPoints', def.measurementPoints.map((x, j) => (j === i ? { ...x, kind: e.target.value as MeasurementPointKind } : x)))}>
              {(['max_flexion', 'max_extension', 'neutral', 'custom'] as MeasurementPointKind[]).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input className="input" aria-label={rt('Label')} value={p.label} onChange={(e) => set('measurementPoints', def.measurementPoints.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" iconOnly aria-label={rt('Remove')} icon={<Trash2 />} onClick={() => set('measurementPoints', def.measurementPoints.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button size="sm" icon={<Plus />} onClick={() => set('measurementPoints', [...def.measurementPoints, newPoint(def.measurementPoints)])}>
          {rt('Add point')}
        </Button>
      </fieldset>

      <label className="field vform__wide">
        <span className="field__label">{rt('Operator notes')}</span>
        <textarea className="input" rows={3} value={def.operatorNotes} onChange={(e) => set('operatorNotes', e.target.value)} />
      </label>
      <fieldset className="vform__wide vpoints">
        <legend className="field__label">{rt('Custom fields')}</legend>
        {Object.entries(def.customFields).map(([k, v]) => (
          <div key={k} className="row">
            <input className="input" style={{ width: 180 }} value={k} readOnly aria-label={rt('Field')} />
            <input className="input" value={v} aria-label={k} onChange={(e) => set('customFields', { ...def.customFields, [k]: e.target.value })} />
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              aria-label={rt('Remove')}
              icon={<Trash2 />}
              onClick={() => {
                const next = { ...def.customFields };
                delete next[k];
                set('customFields', next);
              }}
            />
          </div>
        ))}
        <Button
          size="sm"
          icon={<Plus />}
          onClick={() => {
            const name = window.prompt(rt('Field name'));
            if (name && name.trim()) set('customFields', { ...def.customFields, [name.trim()]: '' });
          }}
        >
          {rt('Add field')}
        </Button>
      </fieldset>
    </div>
  );
}
