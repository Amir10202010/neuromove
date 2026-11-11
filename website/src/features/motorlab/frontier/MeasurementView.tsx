// Measurement & observability: what the three inertial sensors can and cannot observe, what each derived quantity
// rests on, what is lost with fewer sensors, and how sensitive the numbers are to putting the sensors on again.
// Everything here is read from the registry and the benchmark constants — the page computes nothing new.

import { useMemo, useState } from 'react';
import { REATTACHMENT_SENSITIVITY, STRAP_TILT_ALLOWANCE_DEG, PLACEMENT_RULE } from '../../../lab/measure/placement';
import { MEASUREMENT_STATUSES, REGISTRY, observableWith, type MeasurementStatus, type RegistryEntry, type RegistryLayer, type SensorRole } from '../../../lab/measure/registry';
import { MPU6050_UNCERTAINTY, PROPAGATION_VALIDITY } from '../../../lab/measure/uncertainty';
import { fmt } from '../common';
import type { FT } from './i18n';
import { CanonicalNote, Chip, Kpi, code, featureName, type Tone } from './shared';

const LAYERS: RegistryLayer[] = ['signal', 'channel', 'repetition_metric', 'movement_feature', 'coordination', 'model', 'prediction', 'external', 'unobservable'];
const ROLES: SensorRole[] = ['trunk', 'upper', 'fore'];

const statusTone = (s: MeasurementStatus): Tone => (s === 'not_observable' ? 'refused' : s === 'predicted' || s === 'model_estimated' ? 'caution' : 'plain');

function roleName(ft: FT, r: SensorRole): string {
  switch (r) {
    case 'trunk':
      return ft('Trunk (sternum)');
    case 'upper':
      return ft('Upper arm');
    case 'fore':
      return ft('Forearm');
  }
}

export function MeasurementView({ ft }: { ft: FT }) {
  const [status, setStatus] = useState<MeasurementStatus | 'all'>('all');
  const [layer, setLayer] = useState<RegistryLayer | 'all'>('all');
  const [roles, setRoles] = useState<SensorRole[]>(ROLES);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => REGISTRY.filter((e) => (status === 'all' || e.status === status) && (layer === 'all' || e.layer === layer)), [status, layer]);
  const cfg = useMemo(() => observableWith(roles), [roles]);
  const toggle = (r: SensorRole) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const validity = Object.entries(PROPAGATION_VALIDITY);
  return (
    <>
      <section className="mlkpis" aria-label={ft('Registry by status')}>
        {MEASUREMENT_STATUSES.map((s) => (
          <Kpi key={s} label={code(ft, s)} value={String(REGISTRY.filter((e) => e.status === s).length)} />
        ))}
      </section>

      <section className="mlsection">
        <h2 className="section-title">{ft('What a sensor configuration can observe')}</h2>
        <div className="card card__body">
          <div className="mlrow" role="group" aria-label={ft('Sensors worn')}>
            {ROLES.map((r) => (
              <label key={r} className="fr-check">
                <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} /> {roleName(ft, r)}
              </label>
            ))}
          </div>
          <p>
            {ft('Quantities available')}: <strong className="num">{cfg.available.length}</strong> · {ft('lost with this configuration')}: <strong className="num">{cfg.lost.length}</strong>
          </p>
          {cfg.lost.length > 0 && (
            <ul className="fr-list">
              {cfg.lost.map((e) => (
                <li key={e.id}>
                  {e.name} <span className="mlmuted">({e.sensors.map((r) => roleName(ft, r)).join(' + ')})</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mlmuted">{ft('A quantity is lost when any sensor it needs is not worn. Nothing is estimated in its place: a missing sensor produces a missing value, never a guess.')}</p>
        </div>
      </section>

      <section className="mlsection">
        <h2 className="section-title">{ft('Observability registry')}</h2>
        <div className="card card__body mlfilters">
          <label className="field">
            <span className="field__label">{ft('Status')}</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as MeasurementStatus | 'all')}>
              <option value="all">{ft('all')}</option>
              {MEASUREMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {code(ft, s)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{ft('Layer')}</span>
            <select className="select" value={layer} onChange={(e) => setLayer(e.target.value as RegistryLayer | 'all')}>
              <option value="all">{ft('all')}</option>
              {LAYERS.map((l) => (
                <option key={l} value={l}>
                  {code(ft, l)}
                </option>
              ))}
            </select>
          </label>
          <span className="mlmuted">
            {ft('Entries shown')}: {rows.length} / {REGISTRY.length}
          </span>
        </div>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable fr-wrap">
            <thead>
              <tr>
                <th>{ft('Quantity')}</th>
                <th>{ft('Unit')}</th>
                <th>{ft('Status')}</th>
                <th>{ft('Sensors')}</th>
                <th>{ft('Sensitivity to re-attachment')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <RegistryRow key={e.id} e={e} ft={ft} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />
              ))}
            </tbody>
          </table>
        </div>
        <CanonicalNote ft={ft} />
      </section>

      <section className="mlsection">
        <h2 className="section-title">{ft('Sensitivity to putting the sensors on again')}</h2>
        <div className="mlgrid mlgrid--2">
          <div className="card card__body">
            <dl className="fr-dl">
              <dt>{ft('Angle error per degree of calibration-posture error')}</dt>
              <dd className="num">{fmt(REATTACHMENT_SENSITIVITY.anglePerPostureDeg, 1)}°</dd>
              <dt>{ft('Strap tilt that the recording cannot reveal (allowance)')}</dt>
              <dd className="num">{STRAP_TILT_ALLOWANCE_DEG}°</dd>
              <dt>{ft('Placement confidence: high / medium up to')}</dt>
              <dd className="num">
                {fmt(PLACEMENT_RULE.highDeg, 1)}° / {fmt(PLACEMENT_RULE.mediumDeg, 1)}°
              </dd>
            </dl>
            <p className="mlmuted">{ft('Angles are referenced to the calibration posture, so they do not depend on how a sensor is rotated on the limb; they do depend on the posture held during calibration, which a recording cannot show. A difference between two recordings must exceed this bound before it is attributed to the movement.')}</p>
          </div>
          <div className="card mlscroll" tabIndex={0}>
            <table className="table table--compact mltable fr-wrap">
              <caption className="mlmuted">{ft('Elbow angle: 95th-percentile error after rotating the forearm sensor about the limb')}</caption>
              <thead>
                <tr>
                  <th className="num">{ft('Rotation, °')}</th>
                  <th className="num">{ft('Error (p95), °')}</th>
                </tr>
              </thead>
              <tbody>
                {REATTACHMENT_SENSITIVITY.elbowP95ErrorByAxialDeg.map(([deg, err]) => (
                  <tr key={deg}>
                    <td className="num">{deg}</td>
                    <td className="num">{fmt(err, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mlmuted">{ft('From simulation benchmarks M2–M4 with the sensor model of this hardware. Provisional: the values have not been measured on physical sensors.')}</p>
      </section>

      <section className="mlsection">
        <h2 className="section-title">{ft('Sensor uncertainty that is propagated')}</h2>
        <div className="mlgrid mlgrid--2">
          <div className="card card__body">
            <dl className="fr-dl">
              <dt>{ft('Accelerometer noise (per sample)')}</dt>
              <dd className="num">{MPU6050_UNCERTAINTY.accNoiseG} g</dd>
              <dt>{ft('Accelerometer zero offset')}</dt>
              <dd className="num">{MPU6050_UNCERTAINTY.accOffsetG} g</dd>
              <dt>{ft('Gyroscope noise (per sample)')}</dt>
              <dd className="num">{MPU6050_UNCERTAINTY.gyroNoiseDps} °/s</dd>
              <dt>{ft('Gyroscope residual bias')}</dt>
              <dd className="num">{MPU6050_UNCERTAINTY.gyroBiasDps} °/s</dd>
            </dl>
            <p className="mlmuted">{ft('Assumed input uncertainties of the MPU-6050 (datasheet order of magnitude), propagated to every feature by Monte Carlo. Random noise averages out over repetitions; a zero offset does not and limits how well a session mean is known.')}</p>
          </div>
          <div className="card mlscroll" tabIndex={0}>
            <table className="table table--compact mltable fr-wrap">
              <caption className="mlmuted">{ft('How far the propagated uncertainty of each feature can be trusted')}</caption>
              <thead>
                <tr>
                  <th>{ft('Feature')}</th>
                  <th>{ft('Validation of the budget')}</th>
                </tr>
              </thead>
              <tbody>
                {validity.map(([id, v]) => (
                  <tr key={id}>
                    <td>{featureName(ft, id)}</td>
                    <td>
                      <Chip tone={v === 'validated' ? 'met' : v === 'unstable' || v === 'underestimates' ? 'caution' : 'plain'}>{code(ft, v)}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

function RegistryRow({ e, ft, open, onToggle }: { e: RegistryEntry; ft: FT; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr>
        <td>
          <button type="button" className="fr-rowbtn" aria-expanded={open} onClick={onToggle}>
            {e.name}
          </button>
          <span className="fr-sub">{e.id}</span>
        </td>
        <td>{e.unit || '—'}</td>
        <td>
          <Chip tone={statusTone(e.status)}>{code(ft, e.status)}</Chip>
        </td>
        <td>{e.sensors.length ? e.sensors.map((r) => roleName(ft, r)).join(', ') : '—'}</td>
        <td>{code(ft, e.reattachment)}</td>
      </tr>
      {open && (
        <tr className="fr-detail">
          <td colSpan={5}>
            <dl className="fr-dl">
              <dt>{ft('Physical meaning')}</dt>
              <dd>{e.physicalMeaning}</dd>
              <dt>{ft('Method')}</dt>
              <dd>{e.method}</dd>
              <dt>{ft('Coordinate frame')}</dt>
              <dd>{e.coordinateFrame}</dd>
              <dt>{ft('Assumptions')}</dt>
              <dd>{e.assumptions.join('; ') || '—'}</dd>
              <dt>{ft('Error model')}</dt>
              <dd>{e.errorModel}</dd>
              <dt>{ft('Fails when')}</dt>
              <dd>{e.failure.join('; ') || '—'}</dd>
              <dt>{ft('Limits of interpretation')}</dt>
              <dd>{e.interpretationLimits.join('; ') || '—'}</dd>
              <dt>{ft('Defined in')}</dt>
              <dd className="fr-mono">{e.source}</dd>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
