// Модели данных. Правила приватности из софт.md, раздел 4:
// в приложении нет ФИО, ИИН, фото и видео с лицом — только код пациента (P07).
// Таблица «код ↔ ФИО» живёт только у центра.
//
// Демо и клиника — два раздельных рабочих пространства (workspace). Демо-данные
// никогда не смешиваются с настоящими: «Демо-режим всегда подписан „ДЕМО“ и не
// попадает в историю детей» (софт.md, «Фейковые датчики»).

import type { ExerciseId } from '../core/exercises';
import type { ProtocolId } from '../core/protocols';
import type { AccCalibration } from '../core/imu';
import type { DeviceKind, Placement, Side } from '../devices/types';
import type { QualityStats, SessionEvent, StepResult } from '../session/types';

export type Workspace = 'demo' | 'clinic';

/** Форма ДЦП (упрощённо, по топографии и типу). */
export type CpForm = 'hemiplegia' | 'diplegia' | 'tetraplegia' | 'dyskinetic' | 'ataxic' | 'other';
export type AffectedSide = Side | 'both' | 'none';
export type Level = 1 | 2 | 3 | 4 | 5;
export type PatientStatus = 'active' | 'paused' | 'discharged';

export interface Goal {
  id: string;
  exercise: ExerciseId;
  side: Side;
  /** Целевой объём движения, градусы. Ставит специалист. */
  targetRom: number;
  dueDate: string | null;
  createdAt: string;
  achievedAt: string | null;
}

export interface Patient {
  id: string;
  workspace: Workspace;
  /**
   * Как пациента зовут в приложении: имя, без фамилии («Алихан»). Поле называется code
   * с первых версий, когда здесь был код вроде P07: так старые архивы и записи читаются без переделки.
   */
  code: string;
  birthYear: number;
  cpForm: CpForm;
  /** GMFCS — крупная моторика; MACS — как ребёнок пользуется руками. */
  gmfcs: Level | null;
  macs: Level | null;
  affectedSide: AffectedSide;
  status: PatientStatus;
  courseStart: string | null;
  createdAt: string;
  goals: Goal[];
  /** Следующий визит (ISO) — для «Сеансы сегодня». */
  nextVisit: string | null;
  /** Протокол следующего визита. */
  nextProtocol: ProtocolId | null;
  /** Только демо: ключ профиля движений виртуального пациента. */
  demoProfile?: string;
}

export interface SessionDevice {
  kind: DeviceKind;
  name: string;
  firmware: string;
  format: string;
  rateHz: number;
  simulated: boolean;
  /** Поправки акселерометра, с которыми считали сеанс (калибровка датчиков в 6 положениях). */
  accCal?: Partial<Record<Placement, AccCalibration>>;
  /** Отпечатки модулей датчиков (заводские значения самопроверки MPU-6050), `none` — у копии чипа. */
  moduleIds?: Partial<Record<Placement, string>>;
}

export interface Session {
  id: string;
  workspace: Workspace;
  patientId: string;
  startedAt: string;
  endedAt: string;
  protocolId: ProtocolId;
  steps: StepResult[];
  events: SessionEvent[];
  quality: QualityStats;
  activeSec: number;
  totalSec: number;
  calibrationAttempts: number;
  /** Наклон датчиков от вертикали в позе калибровки, градусы (SessionEngine). Нет у сеансов до 2 октября 2026. */
  calibrationPose?: Partial<Record<Placement, number>>;
  status: 'completed' | 'incomplete';
  device: SessionDevice;
  /** Версии — чтобы пересчитать старые тесты, когда улучшится формула (софт.md, «Сохранность»). */
  algorithmVersion: string;
  appVersion: string;
  clinician: string;
  note: string;
  /** Сеанс на симуляторе. Всегда подписан «ДЕМО». */
  demo: boolean;
  /** Сохранены ли сырые отсчёты (выгрузка CSV). */
  hasRaw: boolean;
}

/** Сеанс на смоделированных данных — симулятор или повтор выгрузки из демо. В клинику не попадает. */
export function isSimulatedSession(s: Pick<Session, 'demo' | 'device'>): boolean {
  return s.demo || s.device.simulated || s.device.kind === 'simulator';
}

export type NoteKind = 'clinical' | 'summary';

export interface Note {
  id: string;
  workspace: Workspace;
  patientId: string;
  sessionId: string | null;
  createdAt: string;
  author: string;
  text: string;
  kind: NoteKind;
}

export type AlertKind =
  | 'rom_drop'
  | 'trunk_compensation'
  | 'signal_quality'
  | 'goal_reached'
  | 'incomplete_session'
  | 'measurement_conditions'
  | 'plateau';
export type AlertSeverity = 'info' | 'attention' | 'warning';

export interface Alert {
  id: string;
  workspace: Workspace;
  patientId: string;
  sessionId: string | null;
  kind: AlertKind;
  severity: AlertSeverity;
  createdAt: string;
  params: Record<string, string | number>;
  acknowledged: boolean;
}

export type Role = 'physician' | 'therapist' | 'researcher';

export interface Profile {
  name: string;
  role: Role;
  clinic: string;
  createdAt: string;
}

export type Locale = 'ru' | 'kk' | 'en';

export interface Settings {
  locale: Locale;
  workspace: Workspace;
  /** Сам переходить к следующему шагу теста. */
  autoAdvance: boolean;
  /** Когда последний раз выгружали архив — напоминание раз в 7 дней (софт.md). */
  lastBackupAt: string | null;
  /** Способ подключения датчиков по умолчанию в пространстве клиники. */
  preferredDevice: DeviceKind | null;
  /**
   * Подробный режим: на карточке пациента и в отчёте о сеансе открыты таблицы, графики,
   * плавность и каждый повтор. По умолчанию — простой вид: главное словами.
   */
  details: boolean;
  /** Карточка «Впервые здесь? Пройдите демо» на главной скрыта. */
  helloHidden: boolean;
}

/** Всё содержимое одного рабочего пространства — для архива и снимка демо. */
export interface WorkspaceData {
  patients: Patient[];
  sessions: Session[];
  notes: Note[];
  alerts: Alert[];
}
