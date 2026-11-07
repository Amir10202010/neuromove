// Validation protocol templates and versioning (Protocol Studio logic, no UI).

import { newId } from '../lib/ids';
import type { Workspace } from '../data/models';
import { VALIDATION_EXERCISES } from './capabilities';
import type { MeasurementPointDef, ProtocolDefinition, ProtocolVersion } from './model';

const QUALITY = { maxWindowSdDeg: 1.5, minWindowSamples: 30, reviewAbsErrorDeg: 10 };

/** Built-in starting points. Copied into a user protocol (version 1) when chosen — never edited in place. */
export const TEMPLATES: { id: string; definition: ProtocolDefinition }[] = [
  {
    id: 'tpl_elbow_gonio',
    definition: {
      name: 'Elbow flexion — goniometer agreement',
      description: 'Static holds at peak flexion and full extension; goniometer read after every repetition.',
      bodyRegion: 'upper_limb',
      joint: 'elbow',
      exercise: 'elbow_flexion',
      side: 'right',
      movementType: 'flexion / extension',
      measurementPoints: [
        { id: 'p1', kind: 'max_flexion', label: 'Peak flexion' },
        { id: 'p2', kind: 'max_extension', label: 'Full extension' },
      ],
      repetitions: 10,
      sets: 1,
      restSec: 0,
      goniometerRequired: true,
      captureMode: 'hold',
      holdWindowSec: 1,
      quality: QUALITY,
      operatorNotes: 'Goniometer axis on the lateral epicondyle; arms along humerus and radius. Participant holds each position ~3 s.',
      customFields: {},
    },
  },
  {
    id: 'tpl_shoulder_flex',
    definition: {
      name: 'Shoulder flexion — goniometer agreement',
      description: 'Static holds at peak forward elevation.',
      bodyRegion: 'upper_limb',
      joint: 'shoulder',
      exercise: 'shoulder_flexion',
      side: 'right',
      movementType: 'flexion (sagittal elevation)',
      measurementPoints: [{ id: 'p1', kind: 'max_flexion', label: 'Peak flexion' }],
      repetitions: 10,
      sets: 1,
      restSec: 0,
      goniometerRequired: true,
      captureMode: 'hold',
      holdWindowSec: 1,
      quality: QUALITY,
      operatorNotes: 'Goniometer axis at the acromion; stationary arm vertical along the trunk.',
      customFields: {},
    },
  },
  {
    id: 'tpl_elbow_angles',
    definition: {
      name: 'Elbow — fixed angles (bench check)',
      description: 'Operator sets fixed elbow angles across the range (e.g. 0/30/60/90/120°) to check agreement across the range.',
      bodyRegion: 'upper_limb',
      joint: 'elbow',
      exercise: 'elbow_flexion',
      side: 'right',
      movementType: 'static positions',
      measurementPoints: [{ id: 'p1', kind: 'custom', label: 'Set angle' }],
      repetitions: 15,
      sets: 1,
      restSec: 0,
      goniometerRequired: true,
      captureMode: 'hold',
      holdWindowSec: 1,
      quality: QUALITY,
      operatorNotes: 'Cover the full range in random order; record the target angle in the trial note.',
      customFields: {},
    },
  },
];

export type DefinitionProblem =
  | 'name_required'
  | 'unsupported_exercise'
  | 'points_required'
  | 'duplicate_point_ids'
  | 'repetitions_range'
  | 'sets_range'
  | 'window_range';

export function checkDefinition(d: ProtocolDefinition): DefinitionProblem[] {
  const out: DefinitionProblem[] = [];
  if (!d.name.trim()) out.push('name_required');
  if (!VALIDATION_EXERCISES.includes(d.exercise)) out.push('unsupported_exercise');
  if (!d.measurementPoints.length) out.push('points_required');
  if (new Set(d.measurementPoints.map((p) => p.id)).size !== d.measurementPoints.length) out.push('duplicate_point_ids');
  if (!Number.isInteger(d.repetitions) || d.repetitions < 1 || d.repetitions > 200) out.push('repetitions_range');
  if (!Number.isInteger(d.sets) || d.sets < 1 || d.sets > 20) out.push('sets_range');
  if (!(d.holdWindowSec >= 0.2 && d.holdWindowSec <= 5)) out.push('window_range');
  return out;
}

/** Canonical JSON for comparing definitions (key order independent). */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object')
    return `{${Object.keys(x as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(x);
}

export const sameDefinition = (a: ProtocolDefinition, b: ProtocolDefinition) => canonical(a) === canonical(b);

/**
 * Save an edit as a NEW version (never overwrites). Returns null when nothing changed.
 * `existing` = all versions of all protocols (to find the latest version number).
 */
export function newVersion(existing: readonly ProtocolVersion[], definition: ProtocolDefinition, workspace: Workspace, author: string, protocolId?: string, now = new Date()): ProtocolVersion | null {
  const id = protocolId ?? newId('prot');
  const versions = existing.filter((v) => v.protocolId === id);
  const latest = versions.reduce<ProtocolVersion | null>((m, v) => (!m || v.version > m.version ? v : m), null);
  if (latest && sameDefinition(latest.definition, definition)) return null;
  const version = (latest?.version ?? 0) + 1;
  return { key: `${id}@${version}`, protocolId: id, version, workspace, definition: structuredClone(definition), createdAt: now.toISOString(), createdBy: author, archived: false };
}

/** Latest non-archived version per protocol. */
export function latestVersions(all: readonly ProtocolVersion[]): ProtocolVersion[] {
  const by = new Map<string, ProtocolVersion>();
  for (const v of all) {
    const cur = by.get(v.protocolId);
    if (!cur || v.version > cur.version) by.set(v.protocolId, v);
  }
  return [...by.values()].filter((v) => !v.archived).sort((a, b) => a.definition.name.localeCompare(b.definition.name));
}

export function newPoint(existing: readonly MeasurementPointDef[]): MeasurementPointDef {
  let i = existing.length + 1;
  while (existing.some((p) => p.id === `p${i}`)) i++;
  return { id: `p${i}`, kind: 'custom', label: `Point ${i}` };
}
