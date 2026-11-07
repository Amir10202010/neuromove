// PostgreSQL schema, as ordered additive migrations. Rules:
//   - never DROP, never TRUNCATE, never rewrite a released migration; add a new one instead
//   - every statement is idempotent (IF NOT EXISTS), so a half-applied run can be re-run
//   - each migration runs in one transaction under an advisory lock (server/migrate.ts)
//
// Model (docs/research/DATA_MODEL.md):
//   teams ─< memberships >─ users ─< auth_sessions
//   teams ─< participants ─< rehab_sessions, notes, alerts
//   teams ─< protocols ─< protocol_versions (definition immutable)
//   teams ─< devices, sensors, sensor_configurations (immutable, content-addressed)
//   participants + protocol_versions + sensor_configurations ─< validation_sessions ─< trials
//   validation_sessions ─< calibration_records, derived_metrics, reports
//   raw_chunks (raw sensor data, separate from derived data), datasets (export manifests)
//   changes (ordered change feed for pull), idempotency (op ledger), audit_events (who/what/when)
// Every synced row keeps the exact client payload (jsonb) next to typed, indexed columns.

export interface Migration {
  id: string;
  sql: string;
}

const RECORD_COLUMNS = `
  rev integer not null default 1,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references nm_users(id),
  updated_by uuid references nm_users(id),
  deleted_at timestamptz`;

export const MIGRATIONS: Migration[] = [
  {
    id: '0001_core',
    sql: `
create table if not exists nm_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now()
);

create table if not exists nm_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and length(email) <= 320),
  display_name text not null check (length(display_name) <= 200),
  password_hash text not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table if not exists nm_memberships (
  team_id uuid not null references nm_teams(id),
  user_id uuid not null references nm_users(id),
  role text not null check (role in ('admin', 'session_operator', 'measurement_operator', 'observer')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists nm_auth_sessions (
  token_hash text primary key,
  user_id uuid not null references nm_users(id),
  team_id uuid not null references nm_teams(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists nm_auth_sessions_user on nm_auth_sessions(user_id);

-- Participants: pseudonymous code only. No names, no national ids, no contact data.
create table if not exists nm_participants (
  id text primary key,
  team_id uuid not null references nm_teams(id),
  code text not null,
  birth_year integer,
  status text,${RECORD_COLUMNS}
);
create index if not exists nm_participants_team on nm_participants(team_id);

create table if not exists nm_rehab_sessions (
  id text primary key,
  team_id uuid not null references nm_teams(id),
  participant_id text not null references nm_participants(id),
  protocol_id text not null,
  started_at timestamptz not null,
  status text not null,
  algorithm_version text not null,
  device_kind text not null,${RECORD_COLUMNS}
);
create index if not exists nm_rehab_sessions_team on nm_rehab_sessions(team_id, started_at);
create index if not exists nm_rehab_sessions_participant on nm_rehab_sessions(participant_id);

create table if not exists nm_notes (
  id text primary key,
  team_id uuid not null references nm_teams(id),
  participant_id text not null references nm_participants(id),
  session_id text,${RECORD_COLUMNS}
);
create index if not exists nm_notes_team on nm_notes(team_id);

create table if not exists nm_alerts (
  id text primary key,
  team_id uuid not null references nm_teams(id),
  participant_id text not null references nm_participants(id),
  session_id text,
  kind text not null,${RECORD_COLUMNS}
);
create index if not exists nm_alerts_team on nm_alerts(team_id);

create table if not exists nm_protocols (
  id text primary key,
  team_id uuid not null references nm_teams(id),
  created_at timestamptz not null default now()
);

-- One row per protocol version. The definition never changes after insert (trigger below).
create table if not exists nm_protocol_versions (
  key text primary key,
  team_id uuid not null references nm_teams(id),
  protocol_id text not null references nm_protocols(id),
  version integer not null check (version >= 1),
  definition jsonb not null,
  archived boolean not null default false,${RECORD_COLUMNS},
  unique (protocol_id, version)
);
create index if not exists nm_protocol_versions_team on nm_protocol_versions(team_id);

create or replace function nm_protocol_definition_immutable() returns trigger as $$
begin
  if new.definition is distinct from old.definition or new.version <> old.version or new.protocol_id <> old.protocol_id then
    raise exception 'protocol version % is immutable', old.key using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql;
create or replace trigger nm_protocol_versions_immutable before update on nm_protocol_versions
  for each row execute function nm_protocol_definition_immutable();

create table if not exists nm_devices (
  id text primary key, -- team_id || ':' || kind || ':' || name
  team_id uuid not null references nm_teams(id),
  kind text not null,
  name text not null,
  last_firmware text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists nm_sensors (
  team_id uuid not null references nm_teams(id),
  module_id text not null, -- MPU-6050 self-test fingerprint from the passport
  last_placement text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (team_id, module_id)
);

-- Content-addressed and immutable: the same configuration always maps to the same row.
create table if not exists nm_sensor_configurations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nm_teams(id),
  device_id text not null references nm_devices(id),
  config_hash text not null,
  config jsonb not null,
  created_at timestamptz not null default now(),
  unique (team_id, config_hash)
);

create table if not exists nm_validation_sessions (
  id text primary key,
  team_id uuid not null references nm_teams(id),
  participant_id text not null references nm_participants(id),
  protocol_key text not null references nm_protocol_versions(key),
  sensor_configuration_id uuid references nm_sensor_configurations(id),
  operator text not null,
  status text not null check (status in ('active', 'completed', 'abandoned')),
  started_at timestamptz not null,
  ended_at timestamptz,
  algorithm_version text not null,
  app_version text not null,
  simulated boolean not null,${RECORD_COLUMNS}
);
create index if not exists nm_validation_sessions_team on nm_validation_sessions(team_id, started_at);
create index if not exists nm_validation_sessions_participant on nm_validation_sessions(participant_id);

-- Trials: observed values only. Errors are generated from them — never typed in, never inconsistent.
create table if not exists nm_trials (
  id text primary key,
  team_id uuid not null references nm_teams(id),
  session_id text not null references nm_validation_sessions(id),
  participant_id text not null references nm_participants(id),
  set_no integer not null check (set_no >= 1),
  repetition integer not null check (repetition >= 1),
  point_id text not null,
  attempt integer not null check (attempt >= 1),
  status text not null check (status in ('pending_reference', 'valid', 'invalid', 'skipped', 'superseded')),
  imu_angle_deg double precision,
  reference_deg double precision,
  signed_error_deg double precision generated always as (imu_angle_deg - reference_deg) stored,
  abs_error_deg double precision generated always as (abs(imu_angle_deg - reference_deg)) stored,
  capture_method text,
  window_sd_deg double precision,
  captured_at timestamptz,
  reference_at timestamptz,
  operator text not null,${RECORD_COLUMNS},
  unique (session_id, set_no, repetition, point_id, attempt)
);
create index if not exists nm_trials_session on nm_trials(session_id);
create index if not exists nm_trials_team on nm_trials(team_id);

create table if not exists nm_calibration_records (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nm_teams(id),
  session_id text not null references nm_validation_sessions(id),
  kind text not null check (kind in ('stand_still', 'acc_six_position')),
  parameters jsonb not null,
  recorded_at timestamptz not null,
  params_hash text not null,
  created_at timestamptz not null default now(),
  unique (session_id, kind, params_hash)
);

-- Derived values, always with the algorithm version that produced them. Recomputed, never edited.
create table if not exists nm_derived_metrics (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nm_teams(id),
  entity text not null,
  entity_id text not null,
  metric text not null,
  value double precision,
  unit text not null,
  algorithm_version text not null,
  computed_at timestamptz not null default now(),
  unique (entity, entity_id, metric, algorithm_version)
);

create table if not exists nm_reports (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nm_teams(id),
  session_id text not null,
  kind text not null,
  created_by uuid references nm_users(id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists nm_datasets (
  id text primary key,
  team_id uuid not null references nm_teams(id),
  created_by uuid references nm_users(id),
  created_at timestamptz not null default now(),
  filter jsonb not null,
  schema_version integer not null,
  row_count integer not null
);

-- Raw sensor data, kept apart from everything derived. Default backend: bytea in PostgreSQL
-- (server/storage.ts); an object store can replace it without schema changes to the rest.
create table if not exists nm_raw_chunks (
  team_id uuid not null references nm_teams(id),
  recording_id text not null,
  chunk_index integer not null check (chunk_index >= 0),
  sha256 text not null,
  frame_count integer not null,
  encoding text not null,
  bytes bytea,
  object_key text,
  created_at timestamptz not null default now(),
  primary key (team_id, recording_id, chunk_index)
);

create table if not exists nm_changes (
  seq bigserial primary key,
  team_id uuid not null references nm_teams(id),
  entity text not null,
  entity_id text not null,
  rev integer not null,
  deleted boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists nm_changes_team_seq on nm_changes(team_id, seq);

create table if not exists nm_idempotency (
  team_id uuid not null references nm_teams(id),
  op_id text not null,
  entity text not null,
  entity_id text not null,
  rev integer not null,
  created_at timestamptz not null default now(),
  primary key (team_id, op_id)
);

create table if not exists nm_audit_events (
  id bigserial primary key,
  team_id uuid references nm_teams(id),
  user_id uuid references nm_users(id),
  device_id text,
  action text not null,
  entity text,
  entity_id text,
  rev integer,
  op_id text,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists nm_audit_team on nm_audit_events(team_id, at);
create index if not exists nm_audit_entity on nm_audit_events(entity, entity_id);
`,
  },
];
