// /api/sync: push (idempotent upserts with conflict detection) and pull (ordered change feed).
//
// One op = one transaction:  idempotency check → authorization → validation → lock current row →
// conflict check → typed upsert → change feed row → audit event → idempotency ledger. All or nothing.
// After COMMIT (never before) Redis gets the new cursor and a notification.

import { checkStoredRecords } from '../src/data/backup';
import type { WorkspaceData } from '../src/data/models';
import { ALGORITHM_VERSION } from '../src/core/version';
import { validProtocolVersion, validTrial, validValidationSession } from '../src/research/validate';
import { errorSummary, agreement } from '../src/research/stats';
import type { ProtocolVersion, Trial, ValidationSession } from '../src/research/model';
import { validPairs } from '../src/research/workflow';
import { SYNC_ENTITIES, type PullChange, type PushResult, type SyncEntity } from '../src/sync/types';
import { canWrite, linkedParticipants, sha256, type Principal } from './auth';
import { IMMUTABLE_KINDS, type RehabRecord } from '../src/rehab/model';
import { caregiverMayRead, canWriteRehab } from '../src/rehab/policy';
import { checkTransition, validRehabRecord } from '../src/rehab/validate';
import { labRecordProblem, labRecordSimulated, labTransitionProblem } from '../src/lab/integrity';
import { sqlCode, type Db } from './db';
import { CURSOR_TTL_S, type Redis } from './redis';

export interface IncomingOp {
  opId: string;
  entity: SyncEntity;
  entityId: string;
  baseRev: number | null;
  payload: unknown;
  deleted: boolean;
}

/** Canonical JSON (sorted keys) for "is this the same record" comparisons. */
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object')
    return `{${Object.keys(x as object)
      .sort()
      .filter((k) => (x as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(x);
}

interface Ctx {
  t: Db;
  p: Principal;
}

interface Handler {
  table: string;
  key: string;
  /** Validate the payload for this team. Returns an error code or null. */
  check(payload: unknown, entityId: string): string | null;
  write(ctx: Ctx, payload: Record<string, unknown> | null, rev: number, deleted: boolean, entityId: string, current: unknown): Promise<void>;
}

const BASE: Record<string, keyof WorkspaceData> = { participant: 'patients', rehab_session: 'sessions', note: 'notes', alert: 'alerts' };

function checkBase(entity: string) {
  return (payload: unknown, entityId: string): string | null => {
    const c = BASE[entity] as keyof WorkspaceData;
    const one = { patients: [], sessions: [], notes: [], alerts: [], [c]: [payload] } as unknown as WorkspaceData;
    const r = checkStoredRecords(one);
    // checkStoredRecords also rejects simulated sessions in the clinic workspace
    if (r.rejected) return 'invalid_payload';
    const v = payload as { id: string; workspace: string };
    if (v.id !== entityId) return 'id_mismatch';
    if (v.workspace !== 'clinic') return 'demo_data_not_accepted';
    return null;
  };
}

const softDelete = (table: string, key: string) => async ({ t, p }: Ctx, rev: number, id: string) => {
  await t.query(`update ${table} set rev = $1, deleted_at = now(), updated_at = now(), updated_by = $2 where ${key} = $3 and team_id = $4`, [rev, p.userId, id, p.teamId]);
};

/** The participant/session referenced by a child must belong to the caller's team. */
async function sameTeam(t: Db, table: string, id: string, teamId: string): Promise<boolean> {
  const r = await t.query<{ team_id: string }>(`select team_id from ${table} where id = $1`, [id]);
  return !r[0] || r[0].team_id === teamId; // missing → the FK decides (→ retry)
}

class Rejected extends Error {}

/** Typed columns of a rehab record (the payload keeps everything). */
function rehabColumns(r: RehabRecord): { series: string | null; version: number | null; status: string | null; occurred: string | null } {
  switch (r.kind) {
    case 'activity':
      return { series: r.seriesId, version: r.version, status: r.status, occurred: r.createdAt };
    case 'program':
      return { series: r.seriesId, version: r.version, status: r.def.status, occurred: r.createdAt };
    case 'goal':
      return { series: null, version: null, status: r.status, occurred: r.createdAt };
    case 'practice':
      return { series: null, version: null, status: r.completion, occurred: r.date };
    case 'review':
      return { series: null, version: null, status: r.decision, occurred: r.createdAt };
    case 'assessment':
      return { series: null, version: null, status: r.timepoint, occurred: r.date };
    case 'study':
      return { series: null, version: null, status: r.status, occurred: r.createdAt };
    case 'consent':
      return { series: null, version: null, status: r.status, occurred: r.createdAt };
    case 'incident':
      return { series: null, version: null, status: r.review ? 'reviewed' : 'open', occurred: r.occurredAt };
    case 'profile':
      return { series: null, version: null, status: null, occurred: r.createdAt };
  }
}

const HANDLERS: Record<SyncEntity, Handler> = {
  participant: {
    table: 'nm_participants',
    key: 'id',
    check: checkBase('participant'),
    async write(ctx, v, rev, deleted, id) {
      if (deleted || !v) return softDelete('nm_participants', 'id')(ctx, rev, id);
      await ctx.t.query(
        `insert into nm_participants (id, team_id, code, birth_year, status, rev, payload, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         on conflict (id) do update set code = $3, birth_year = $4, status = $5, rev = $6, payload = $7, updated_at = now(), updated_by = $8, deleted_at = null`,
        [id, ctx.p.teamId, v.code, v.birthYear, v.status, rev, v, ctx.p.userId],
      );
    },
  },
  rehab_session: {
    table: 'nm_rehab_sessions',
    key: 'id',
    check: checkBase('rehab_session'),
    async write(ctx, v, rev, deleted, id) {
      if (deleted || !v) return softDelete('nm_rehab_sessions', 'id')(ctx, rev, id);
      if (!(await sameTeam(ctx.t, 'nm_participants', String(v.patientId), ctx.p.teamId))) throw new Rejected('forbidden');
      const dev = v.device as { kind: string };
      await ctx.t.query(
        `insert into nm_rehab_sessions (id, team_id, participant_id, protocol_id, started_at, status, algorithm_version, device_kind, rev, payload, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         on conflict (id) do update set participant_id = $3, protocol_id = $4, started_at = $5, status = $6, algorithm_version = $7, device_kind = $8, rev = $9, payload = $10, updated_at = now(), updated_by = $11, deleted_at = null`,
        [id, ctx.p.teamId, v.patientId, v.protocolId, v.startedAt, v.status, v.algorithmVersion, dev.kind, rev, v, ctx.p.userId],
      );
    },
  },
  note: {
    table: 'nm_notes',
    key: 'id',
    check: checkBase('note'),
    async write(ctx, v, rev, deleted, id) {
      if (deleted || !v) return softDelete('nm_notes', 'id')(ctx, rev, id);
      if (!(await sameTeam(ctx.t, 'nm_participants', String(v.patientId), ctx.p.teamId))) throw new Rejected('forbidden');
      await ctx.t.query(
        `insert into nm_notes (id, team_id, participant_id, session_id, rev, payload, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $7)
         on conflict (id) do update set participant_id = $3, session_id = $4, rev = $5, payload = $6, updated_at = now(), updated_by = $7, deleted_at = null`,
        [id, ctx.p.teamId, v.patientId, v.sessionId, rev, v, ctx.p.userId],
      );
    },
  },
  alert: {
    table: 'nm_alerts',
    key: 'id',
    check: checkBase('alert'),
    async write(ctx, v, rev, deleted, id) {
      if (deleted || !v) return softDelete('nm_alerts', 'id')(ctx, rev, id);
      if (!(await sameTeam(ctx.t, 'nm_participants', String(v.patientId), ctx.p.teamId))) throw new Rejected('forbidden');
      await ctx.t.query(
        `insert into nm_alerts (id, team_id, participant_id, session_id, kind, rev, payload, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         on conflict (id) do update set participant_id = $3, session_id = $4, kind = $5, rev = $6, payload = $7, updated_at = now(), updated_by = $8, deleted_at = null`,
        [id, ctx.p.teamId, v.patientId, v.sessionId, v.kind, rev, v, ctx.p.userId],
      );
    },
  },
  protocol_version: {
    table: 'nm_protocol_versions',
    key: 'key',
    check(payload, entityId) {
      if (!validProtocolVersion(payload)) return 'invalid_payload';
      if (payload.key !== entityId) return 'id_mismatch';
      if (payload.workspace !== 'clinic') return 'demo_data_not_accepted';
      return null;
    },
    async write(ctx, v, rev, deleted, id) {
      if (deleted || !v) throw new Rejected('protocol_versions_are_never_deleted');
      const pv = v as unknown as ProtocolVersion;
      const owner = await ctx.t.query<{ team_id: string }>('select team_id from nm_protocols where id = $1', [pv.protocolId]);
      if (owner[0] && owner[0].team_id !== ctx.p.teamId) throw new Rejected('forbidden');
      await ctx.t.query('insert into nm_protocols (id, team_id) values ($1, $2) on conflict (id) do nothing', [pv.protocolId, ctx.p.teamId]);
      // definition/version are immutable (trigger); only `archived` and the payload envelope may change
      await ctx.t.query(
        `insert into nm_protocol_versions (key, team_id, protocol_id, version, definition, archived, rev, payload, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         on conflict (key) do update set definition = $5, archived = $6, rev = $7, payload = $8, updated_at = now(), updated_by = $9`,
        [id, ctx.p.teamId, pv.protocolId, pv.version, pv.definition, pv.archived, rev, v, ctx.p.userId],
      );
    },
  },
  validation_session: {
    table: 'nm_validation_sessions',
    key: 'id',
    check(payload, entityId) {
      if (!validValidationSession(payload)) return 'invalid_payload';
      if (payload.id !== entityId) return 'id_mismatch';
      if (payload.workspace !== 'clinic') return 'demo_data_not_accepted';
      if (payload.device.simulated || payload.device.kind === 'simulator') return 'simulated_data_not_accepted';
      return null;
    },
    async write(ctx, v, rev, deleted, id) {
      if (deleted || !v) throw new Rejected('validation_sessions_are_never_deleted');
      const s = v as unknown as ValidationSession;
      const { t, p } = ctx;
      if (!(await sameTeam(t, 'nm_participants', s.participantId, p.teamId))) throw new Rejected('forbidden');
      const pv = await t.query<{ team_id: string; definition: unknown }>('select team_id, definition from nm_protocol_versions where key = $1', [s.protocolKey]);
      if (pv[0] && pv[0].team_id !== p.teamId) throw new Rejected('forbidden');
      // The session's protocol snapshot must be exactly the stored version (traceability)
      if (pv[0] && canonical(pv[0].definition) !== canonical(s.protocol)) throw new Rejected('protocol_snapshot_mismatch');
      // Device registry, sensors, immutable content-addressed configuration
      const deviceId = `${p.teamId}:${s.device.kind}:${s.device.name}`;
      await t.query(
        `insert into nm_devices (id, team_id, kind, name, last_firmware) values ($1, $2, $3, $4, $5)
         on conflict (id) do update set last_firmware = $5, last_seen_at = now()`,
        [deviceId, p.teamId, s.device.kind, s.device.name, s.device.firmware],
      );
      for (const sensor of s.device.sensors)
        if (sensor.moduleId)
          await t.query(
            `insert into nm_sensors (team_id, module_id, last_placement) values ($1, $2, $3)
             on conflict (team_id, module_id) do update set last_placement = $3, last_seen_at = now()`,
            [p.teamId, sensor.moduleId, sensor.placement],
          );
      const config = { device: deviceId, firmware: s.device.firmware, format: s.device.format, rateHz: s.device.rateHz, sensors: s.device.sensors, accCal: s.device.accCal ?? null };
      const hash = sha256(canonical(config));
      await t.query('insert into nm_sensor_configurations (team_id, device_id, config_hash, config) values ($1, $2, $3, $4) on conflict (team_id, config_hash) do nothing', [p.teamId, deviceId, hash, config]);
      const cfg = await t.query<{ id: string }>('select id from nm_sensor_configurations where team_id = $1 and config_hash = $2', [p.teamId, hash]);
      await t.query(
        `insert into nm_validation_sessions (id, team_id, participant_id, protocol_key, sensor_configuration_id, operator, status, started_at, ended_at, algorithm_version, app_version, simulated, rev, payload, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
         on conflict (id) do update set sensor_configuration_id = $5, operator = $6, status = $7, ended_at = $9, rev = $13, payload = $14, updated_at = now(), updated_by = $15`,
        [id, p.teamId, s.participantId, s.protocolKey, cfg[0]?.id ?? null, s.operator, s.status, s.startedAt, s.endedAt, s.algorithmVersion, s.appVersion, s.device.simulated, rev, v, p.userId],
      );
      if (s.calibration) {
        const params = { attempts: s.calibration.attempts, poseDeg: s.calibration.poseDeg };
        await t.query(
          `insert into nm_calibration_records (team_id, session_id, kind, parameters, recorded_at, params_hash) values ($1, $2, 'stand_still', $3, $4, $5) on conflict (session_id, kind, params_hash) do nothing`,
          [p.teamId, id, params, s.calibration.at, sha256(canonical(params))],
        );
      }
      if (s.device.accCal && Object.keys(s.device.accCal).length) {
        await t.query(
          `insert into nm_calibration_records (team_id, session_id, kind, parameters, recorded_at, params_hash) values ($1, $2, 'acc_six_position', $3, $4, $5) on conflict (session_id, kind, params_hash) do nothing`,
          [p.teamId, id, s.device.accCal, s.startedAt, sha256(canonical(s.device.accCal))],
        );
      }
      if (s.status === 'completed') await recomputeMetrics(t, p.teamId, id);
    },
  },
  rehab_record: {
    table: 'nm_rehab_records',
    key: 'id',
    check(payload, entityId) {
      if (!validRehabRecord(payload)) return 'invalid_payload';
      if (payload.id !== entityId) return 'id_mismatch';
      if (payload.workspace !== 'clinic') return 'demo_data_not_accepted';
      return null;
    },
    async write(ctx, v, rev, deleted, id, current) {
      const { t, p } = ctx;
      const prev = (current ?? null) as RehabRecord | null;
      // Rehab history is never deleted
      if (deleted || !v) throw new Rejected('rehab_records_are_never_deleted');
      const r = v as unknown as RehabRecord;
      // Authorisation from the SERVER view of the account (role, linked children), never the client view
      const linked = await linkedParticipants(t, p);
      const denial = canWriteRehab({ role: p.role, participantIds: linked }, r, prev);
      if (denial) throw new Rejected(denial);
      if (prev) {
        if ((IMMUTABLE_KINDS as readonly string[]).includes(prev.kind)) throw new Rejected('immutable');
        const problem = checkTransition(prev, r);
        if (problem) throw new Rejected(problem);
      }
      if (r.participantId && !(await sameTeam(t, 'nm_participants', r.participantId, p.teamId))) throw new Rejected('forbidden');
      const c = rehabColumns(r);
      await t.query(
        `insert into nm_rehab_records (id, team_id, kind, participant_id, series_id, version, status, occurred_at, author_role, rev, payload, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
         on conflict (id) do update set status = $7, occurred_at = $8, rev = $10, payload = $11, updated_at = now(), updated_by = $12`,
        [id, p.teamId, r.kind, r.participantId, c.series, c.version, c.status, c.occurred, r.createdByRole, rev, v, p.userId],
      );
    },
  },
  lab_record: {
    table: 'nm_lab_records',
    key: 'id',
    check(payload, entityId) {
      // Same shape AND hash rules as the browser (src/lab/integrity.ts): an edited protocol definition or an
      // altered snapshot/configuration/result of a frozen run is refused here.
      const problem = labRecordProblem(payload);
      if (problem) return problem === 'unknown_kind' || problem === 'not_an_object' || problem === 'bad_shape' ? 'invalid_payload' : problem;
      const v = payload as Record<string, unknown>;
      if (v.id !== entityId) return 'id_mismatch';
      if (v.workspace !== 'clinic' || labRecordSimulated(v)) return 'demo_data_not_accepted';
      return null;
    },
    async write(ctx, v, rev, deleted, id, current) {
      const { t, p } = ctx;
      // Lab history (protocol versions, frozen runs, practice trials, recording decisions) is never deleted
      if (deleted || !v) throw new Rejected('lab_records_are_never_deleted');
      if (current) {
        const problem = labTransitionProblem(current as Record<string, unknown>, v);
        if (problem) throw new Rejected(problem);
      }
      const participant = typeof v.participantId === 'string' ? v.participantId : null;
      if (participant && !(await sameTeam(t, 'nm_participants', participant, p.teamId))) throw new Rejected('forbidden');
      // A caregiver account may only add practice-trial sets of a child it is linked to (server view of links)
      if (p.role === 'caregiver') {
        const linked = await linkedParticipants(t, p);
        if (v.kind !== 'practice_trials' || !participant || !linked.includes(participant)) throw new Rejected('forbidden');
      }
      const contentHash = (v.defHash ?? v.resultHash ?? v.contentHash ?? null) as string | null;
      await t.query(
        `insert into nm_lab_records (id, team_id, kind, participant_id, protocol_id, version, status, content_hash, rev, payload, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         on conflict (id) do update set status = $7, rev = $9, payload = $10, updated_at = now(), updated_by = $11`,
        [id, p.teamId, v.kind, participant, (v.protocolId as string | undefined) ?? null, (v.version as number | undefined) ?? null, (v.status as string | undefined) ?? null, contentHash, rev, v, p.userId],
      );
    },
  },
  trial: {
    table: 'nm_trials',
    key: 'id',
    check(payload, entityId) {
      if (!validTrial(payload)) return 'invalid_payload';
      if (payload.id !== entityId) return 'id_mismatch';
      if (payload.workspace !== 'clinic') return 'demo_data_not_accepted';
      return null;
    },
    async write(ctx, v, rev, deleted, id) {
      if (deleted || !v) throw new Rejected('trials_are_never_deleted');
      const tr = v as unknown as Trial;
      const { t, p } = ctx;
      const s = await t.query<{ team_id: string; participant_id: string; status: string }>('select team_id, participant_id, status from nm_validation_sessions where id = $1', [tr.sessionId]);
      if (s[0] && s[0].team_id !== p.teamId) throw new Rejected('forbidden');
      if (s[0] && s[0].participant_id !== tr.participantId) throw new Rejected('participant_mismatch');
      await t.query(
        `insert into nm_trials (id, team_id, session_id, participant_id, set_no, repetition, point_id, attempt, status, imu_angle_deg, reference_deg, capture_method, window_sd_deg, captured_at, reference_at, operator, rev, payload, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19)
         on conflict (id) do update set status = $9, imu_angle_deg = $10, reference_deg = $11, capture_method = $12, window_sd_deg = $13, captured_at = $14, reference_at = $15, operator = $16, rev = $17, payload = $18, updated_at = now(), updated_by = $19`,
        [id, p.teamId, tr.sessionId, tr.participantId, tr.set, tr.repetition, tr.pointId, tr.attempt, tr.status, tr.imu?.angleDeg ?? null, tr.referenceDeg, tr.imu?.method ?? null, tr.imu?.windowSdDeg ?? null, tr.imu?.capturedAt ?? null, tr.referenceAt, tr.operator, rev, v, p.userId],
      );
      if (s[0]?.status === 'completed') await recomputeMetrics(t, p.teamId, tr.sessionId);
    },
  },
};

/** Session-level derived metrics, computed by the same analytics code as the browser. */
export async function recomputeMetrics(t: Db, teamId: string, sessionId: string): Promise<void> {
  const rows = await t.query<{ payload: Trial }>('select payload from nm_trials where session_id = $1 and team_id = $2', [sessionId, teamId]);
  const pairs = validPairs(rows.map((r) => r.payload));
  const e = errorSummary(pairs);
  const ba = agreement(pairs);
  const metrics: [string, number | null, string][] = [
    ['n_valid_pairs', e.n, 'count'],
    ['bias_deg', e.bias, 'deg'],
    ['sd_deg', e.sd, 'deg'],
    ['mae_deg', e.mae, 'deg'],
    ['rmse_deg', e.rmse, 'deg'],
    ['median_abs_error_deg', e.medianAbs, 'deg'],
    ['max_abs_error_deg', e.maxAbs, 'deg'],
    ['loa_lower_deg', ba?.loa[0] ?? null, 'deg'],
    ['loa_upper_deg', ba?.loa[1] ?? null, 'deg'],
  ];
  for (const [metric, value, unit] of metrics)
    await t.query(
      `insert into nm_derived_metrics (team_id, entity, entity_id, metric, value, unit, algorithm_version) values ($1, 'validation_session', $2, $3, $4, $5, $6)
       on conflict (entity, entity_id, metric, algorithm_version) do update set value = $4, computed_at = now()`,
      [teamId, sessionId, metric, value, unit, `stats-1/${ALGORITHM_VERSION}`],
    );
}

export async function applyOp(db: Db, p: Principal, deviceId: string, op: IncomingOp): Promise<PushResult & { seq?: number }> {
  if (!SYNC_ENTITIES.includes(op.entity)) return { opId: op.opId, status: 'rejected', error: 'unknown_entity' };
  if (!canWrite(p.role, op.entity)) return { opId: op.opId, status: 'rejected', error: 'forbidden_role' };
  const h = HANDLERS[op.entity];
  if (!op.deleted) {
    const problem = h.check(op.payload, op.entityId);
    if (problem) return { opId: op.opId, status: 'rejected', error: problem };
  }
  try {
    return await db.tx(async (t) => {
      const dup = await t.query<{ rev: number }>('select rev from nm_idempotency where team_id = $1 and op_id = $2', [p.teamId, op.opId]);
      if (dup[0]) return { opId: op.opId, status: 'duplicate', rev: dup[0].rev };
      const cur = (await t.query<{ team_id: string; rev: number; payload: unknown; deleted_at: string | null }>(`select team_id, rev, payload, deleted_at from ${h.table} where ${h.key} = $1 for update`, [op.entityId]))[0];
      // An id that exists in another team is never overwritten (and its existence is not revealed)
      if (cur && cur.team_id !== p.teamId) return { opId: op.opId, status: 'rejected', error: 'forbidden' };
      if (cur) {
        const same = !!cur.deleted_at === op.deleted && (op.deleted || canonical(cur.payload) === canonical(op.payload));
        if (same) {
          await t.query('insert into nm_idempotency (team_id, op_id, entity, entity_id, rev) values ($1, $2, $3, $4, $5)', [p.teamId, op.opId, op.entity, op.entityId, cur.rev]);
          return { opId: op.opId, status: 'duplicate', rev: cur.rev };
        }
        if (op.baseRev !== cur.rev) return { opId: op.opId, status: 'conflict', rev: cur.rev, server: cur.deleted_at ? null : cur.payload };
      } else if (op.deleted) {
        await t.query('insert into nm_idempotency (team_id, op_id, entity, entity_id, rev) values ($1, $2, $3, $4, 0)', [p.teamId, op.opId, op.entity, op.entityId]);
        return { opId: op.opId, status: 'applied', rev: 0 };
      }
      const rev = (cur?.rev ?? 0) + 1;
      await h.write({ t, p }, op.deleted ? null : (op.payload as Record<string, unknown>), rev, op.deleted, op.entityId, cur && !cur.deleted_at ? cur.payload : null);
      const ch = await t.query<{ seq: string }>('insert into nm_changes (team_id, entity, entity_id, rev, deleted) values ($1, $2, $3, $4, $5) returning seq', [p.teamId, op.entity, op.entityId, rev, op.deleted]);
      await t.query('insert into nm_audit_events (team_id, user_id, device_id, action, entity, entity_id, rev, op_id, details) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
        p.teamId,
        p.userId,
        deviceId,
        op.deleted ? 'delete' : cur ? 'update' : 'create',
        op.entity,
        op.entityId,
        rev,
        op.opId,
        { baseRev: op.baseRev, previousRev: cur?.rev ?? null },
      ]);
      await t.query('insert into nm_idempotency (team_id, op_id, entity, entity_id, rev) values ($1, $2, $3, $4, $5)', [p.teamId, op.opId, op.entity, op.entityId, rev]);
      return { opId: op.opId, status: 'applied', rev, seq: Number(ch[0]?.seq) };
    });
  } catch (e) {
    if (e instanceof Rejected) return { opId: op.opId, status: 'rejected', error: e.message };
    const code = sqlCode(e);
    if (code === '23503') return { opId: op.opId, status: 'retry', error: 'parent_not_synced_yet' };
    if (code === 'P0001') return { opId: op.opId, status: 'rejected', error: 'immutable' };
    if (code === '23505') return { opId: op.opId, status: 'rejected', error: 'unique_violation' };
    if (code === '23514' || code === '22P02' || code === '22007' || code === '22008') return { opId: op.opId, status: 'rejected', error: 'invalid_value' };
    throw e;
  }
}

export async function push(db: Db, redis: Redis, p: Principal, deviceId: string, ops: IncomingOp[]): Promise<{ results: PushResult[]; cursor: number }> {
  const results: PushResult[] = [];
  let maxSeq = 0;
  for (const op of ops) {
    const r = await applyOp(db, p, deviceId, op);
    if (r.seq) maxSeq = Math.max(maxSeq, r.seq);
    const { seq: _seq, ...rest } = r;
    results.push(rest);
  }
  if (maxSeq) {
    // After commit only. Failure here never affects the stored data.
    await redis.set(`nm:team:${p.teamId}:cursor`, String(maxSeq), CURSOR_TTL_S);
    await redis.publish(`nm:team:${p.teamId}`, JSON.stringify({ type: 'changes', cursor: maxSeq }));
  }
  return { results, cursor: maxSeq };
}

const PULL_LIMIT = 500;

export async function pull(db: Db, redis: Redis, p: Principal, since: number): Promise<{ changes: PullChange[]; cursor: number; more: boolean }> {
  const cached = await redis.get(`nm:team:${p.teamId}:cursor`);
  if (cached !== null && since >= Number(cached)) return { changes: [], cursor: since, more: false };
  const rows = await db.query<{ seq: string; entity: SyncEntity; entity_id: string }>('select seq, entity, entity_id from nm_changes where team_id = $1 and seq > $2 order by seq limit $3', [p.teamId, since, PULL_LIMIT]);
  const latest = new Map<string, { seq: number; entity: SyncEntity; id: string }>();
  for (const r of rows) latest.set(`${r.entity}:${r.entity_id}`, { seq: Number(r.seq), entity: r.entity, id: r.entity_id });
  const changes: PullChange[] = [];
  const byEntity = new Map<SyncEntity, string[]>();
  for (const v of latest.values()) byEntity.set(v.entity, [...(byEntity.get(v.entity) ?? []), v.id]);
  for (const [entity, ids] of byEntity) {
    const h = HANDLERS[entity];
    const recs = await db.query<{ k: string; rev: number; payload: unknown; deleted_at: string | null }>(`select ${h.key} as k, rev, payload, deleted_at from ${h.table} where ${h.key} = any($1) and team_id = $2`, [ids, p.teamId]);
    for (const r of recs) {
      const seq = latest.get(`${entity}:${r.k}`)?.seq ?? 0;
      changes.push({ seq, entity, entityId: r.k, rev: r.rev, payload: r.deleted_at ? null : r.payload, deleted: !!r.deleted_at });
    }
  }
  changes.sort((a, b) => a.seq - b.seq);
  const visible = p.role === 'caregiver' ? await caregiverFilter(db, p, changes) : changes;
  const cursor = rows.length ? Number(rows[rows.length - 1]?.seq) : since;
  return { changes: visible, cursor, more: rows.length === PULL_LIMIT };
}

/**
 * Caregivers receive only: their linked children's participant records, rehab records a caregiver may read
 * (policy.caregiverMayRead) and approved family summaries (notes of kind 'summary'). Everything else
 * (other children, sensor sessions, clinical notes, assessments, reviews, research data) is withheld.
 * The cursor still advances past withheld changes.
 */
async function caregiverFilter(db: Db, p: Principal, changes: PullChange[]): Promise<PullChange[]> {
  const linked = await linkedParticipants(db, p);
  return changes.filter((ch) => {
    if (ch.deleted || ch.payload === null) return ch.entity === 'participant' && linked.includes(ch.entityId);
    const v = ch.payload as Record<string, unknown>;
    if (ch.entity === 'participant') return linked.includes(ch.entityId);
    if (ch.entity === 'note') return v.kind === 'summary' && linked.includes(String(v.patientId));
    if (ch.entity === 'rehab_record') return caregiverMayRead(v as unknown as RehabRecord, linked);
    // The family tablet needs to know whether trials are recorded for its child — nothing else from the lab
    if (ch.entity === 'lab_record') return (v.kind === 'trial_recording' || v.kind === 'practice_trials') && linked.includes(String(v.participantId));
    return false;
  });
}
