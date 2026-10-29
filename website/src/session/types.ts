// Типы живого сеанса. Их видит интерфейс; сам движок — в SessionEngine.ts.

import type { ExerciseId } from '../core/exercises';
import type { StepSummary } from '../core/metrics';
import type { Placement, Side } from '../devices/types';

/**
 * Указание пациенту — то, что специалист говорит ребёнку вслух.
 * Интерфейс показывает его на экране; виртуальный пациент симулятора выполняет.
 */
export type Instruction =
  | { kind: 'rest' }
  | { kind: 'hold_still' }
  | { kind: 'exercise'; exercise: ExerciseId; side: Side };

export type EnginePhase =
  | 'ready' // создан, ждёт старта
  | 'calibrating' // 3 секунды неподвижно
  | 'positioning' // установка перед шагом (предплечье в горизонталь)
  | 'recording' // идёт шаг, считаем повторы
  | 'step_done' // шаг закончен, короткая пауза перед следующим
  | 'paused' // пауза по кнопке
  | 'interrupted' // пропала связь с датчиками
  | 'finished';

/** Все события сеанса — один список: по нему же проверяется архив (data/backup.ts). */
export const SESSION_EVENT_KINDS = [
  'session_start',
  'calibration_start',
  'calibration_moved',
  'calibration_done',
  'calibration_forced',
  'calibration_pose',
  'step_start',
  'positioning_done',
  'rep',
  'step_done',
  'step_skipped',
  'pause',
  'resume',
  'connection_lost',
  'connection_restored',
  'data_gap',
  'sensor_lost',
  'sensor_restored',
  'mount_flipped',
  'low_battery',
  'session_stopped',
  'session_finished',
] as const;
export type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];

export interface SessionEvent {
  kind: SessionEventKind;
  /** Время от начала сеанса, секунды. */
  t: number;
  step?: number;
  value?: number;
}

export interface RepLive {
  rom: number;
  sparc: number;
  trunk: number | null;
  supination: number | null;
  pronation: number | null;
}

export type StepStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface StepLive {
  exercise: ExerciseId;
  side: Side;
  targetReps: number;
  durationSec: number | null;
  status: StepStatus;
  reps: RepLive[];
  /** Сколько секунд шёл шаг (запись). */
  elapsed: number;
  flags: string[];
}

export interface QualityStats {
  received: number;
  lost: number;
  saturated: number;
  /** Полнота данных, %. */
  percent: number;
}

export type EngineHint = 'sensor_missing' | 'mount_flipped' | 'no_reps' | 'upper_lift' | 'forearm_level' | null;

export interface EngineSnapshot {
  phase: EnginePhase;
  /** Во что вернуться после паузы или обрыва. */
  resumeTo: EnginePhase | null;
  connection: 'ok' | 'lost' | 'restored';
  stepIndex: number;
  steps: StepLive[];
  calibration: { progress: number; attempt: number; moved: boolean };
  positioning: { ready: boolean; progress: number };
  /** Секунды активной записи — без пауз. */
  activeSec: number;
  quality: QualityStats;
  hint: EngineHint;
  /** Датчики, без которых угол текущего шага не считается: не на связи или не откалиброваны. */
  missing: Placement[];
  /** Датчик, надетый наоборот (крышкой к коже), — в текущем шаге; null — таких нет. */
  flipped: Placement | null;
  events: SessionEvent[];
  /** Номер версии снимка: растёт при каждом обновлении. */
  version: number;
}

/** Текущие значения для отрисовки 60 раз в секунду — без перерисовки React. */
export interface LiveValues {
  t: number;
  angle: number | null;
  trunk: number | null;
  check: number | null;
  /** Максимум угла в текущем повторе. */
  repPeak: number | null;
  inRep: boolean;
  /** Подъём плеча и предплечья от позы калибровки — для фигурки на экране. */
  upperElevation: number | null;
  foreElevation: number | null;
}

/** Прореженная запись шага для графика в отчёте (20 Гц). */
export interface StepTrace {
  t: number[];
  angle: number[];
  trunk: (number | null)[];
}

export interface StepResult {
  summary: StepSummary;
  trace: StepTrace;
  status: 'done' | 'partial' | 'skipped';
}

export interface EngineResult {
  steps: StepResult[];
  events: SessionEvent[];
  quality: QualityStats;
  activeSec: number;
  /** От старта до конца по времени устройства, секунды. */
  totalSec: number;
  calibrationAttempts: number;
  /**
   * Наклон каждого датчика от вертикали в позе калибровки, градусы — по правилу крепления (ось X вдоль
   * кости), с точностью до перекоса ремешка. Рука не висела — углы считаются от этой позы (дуга движения).
   */
  calibrationPose: Partial<Record<Placement, number>>;
  /** Все шаги пройдены до конца. */
  completed: boolean;
}
