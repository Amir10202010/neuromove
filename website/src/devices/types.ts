// Единый интерфейс устройства NeuroMove.
//
// Главное правило архитектуры: интерфейс и алгоритмы НЕ знают, откуда пришли данные.
// Сегодня источник — симулятор, завтра — настоящие датчики по USB или Bluetooth.
// Все они реализуют один и тот же NeuroMoveDevice и отдают одно и то же:
// СЫРЫЕ числа с датчиков (как в контракте с железом, софт.md, раздел 1).
// Углы, повторы и метрики считает приложение (src/core), а не устройство.

import type { AccCalibration } from '../core/imu';

/** Места датчиков. Порядок = номер места в пакете Bluetooth по контракту: 0 — туловище … 4 — предплечье П. */
export const PLACEMENTS = ['trunk', 'upper_l', 'upper_r', 'fore_l', 'fore_r'] as const;
export type Placement = (typeof PLACEMENTS)[number];

export type Side = 'left' | 'right';

export function placementOf(segment: 'upper' | 'fore', side: Side): Placement {
  return `${segment}_${side === 'left' ? 'l' : 'r'}` as Placement;
}

/** Откуда данные. */
export type DeviceKind = 'simulator' | 'usb' | 'ble' | 'replay';

/**
 * Один момент времени. `data[place]` — 6 целых чисел прямо с датчика:
 * ax, ay, az (8192 = 1 g), gx, gy, gz (32.8 = 1 °/с). Датчика может не быть в кадре —
 * например, Bluetooth-блоки присылают пакеты по отдельности.
 */
export interface RawFrame {
  /** Номер отсчёта. Пропуск номера = потерянный пакет. */
  seq: number;
  /** Время от начала потока, секунды (= seq / частота). */
  t: number;
  data: Partial<Record<Placement, Int16Array>>;
}

export interface DeviceInfo {
  id: string;
  name: string;
  kind: DeviceKind;
  firmware: string;
  /** Версия формата данных из паспорта: `imu-csv v1` и т. п. */
  format: string;
  rateHz: number;
  accRangeG: number;
  gyroRangeDps: number;
  placements: Placement[];
  /** true — данные сгенерированы. Такие сеансы всегда помечаются «ДЕМО». */
  simulated: boolean;
  /** Поправки акселерометра из паспорта (`# cal_<место>=…`), если датчики откалиброваны. */
  accCal?: Partial<Record<Placement, AccCalibration>>;
  /** Отпечатки модулей датчиков из паспорта (`id_<место>`): каким модулем снят замер. */
  moduleIds?: Partial<Record<Placement, string>>;
}

export type ConnectionPhase =
  | 'idle' // не подключено
  | 'requesting' // открыто окно выбора устройства в браузере
  | 'searching' // поиск
  | 'connecting' // рукопожатие, чтение паспорта, датчики выходят на связь
  | 'connected' // готово, поток ещё не идёт
  | 'streaming' // данные идут
  | 'reconnecting' // связь потеряна, пробуем восстановить
  | 'error';

export interface SensorState {
  placement: Placement;
  /** Датчик на связи и присылает данные. */
  online: boolean;
  /** Заряд, %. null — устройство не сообщает. */
  battery: number | null;
  lowBattery: boolean;
  /** Качество связи 0…1: доля дошедших отсчётов за последние секунды. */
  link: number;
}

export type DeviceErrorCode =
  | 'unsupported' // браузер не умеет Web Serial / Web Bluetooth
  | 'cancelled' // пользователь закрыл окно выбора
  | 'not_found' // устройство не найдено
  | 'bad_format' // паспорт или данные не по контракту
  | 'connection_lost' // связь потеряна и не восстановилась
  | 'permission' // браузер не дал доступ
  | 'unknown';

export interface DeviceError {
  code: DeviceErrorCode;
  message: string;
}

export interface DeviceStatus {
  phase: ConnectionPhase;
  info: DeviceInfo | null;
  sensors: SensorState[];
  /** Сколько отсчётов пришло и сколько потеряно (по пропускам seq). */
  received: number;
  lost: number;
  reconnect: { attempt: number; max: number } | null;
  error: DeviceError | null;
}

export type Unsubscribe = () => void;

/**
 * То, что должно уметь любое устройство — симулятор, USB, Bluetooth, файл записи.
 * Чтобы подключить новое железо, достаточно написать ещё один класс с этим интерфейсом.
 */
export interface NeuroMoveDevice {
  readonly kind: DeviceKind;
  /** Найти и подключить. Для USB и Bluetooth вызывать только из обработчика нажатия кнопки. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Начать поток отсчётов. */
  start(): Promise<void>;
  /** Остановить поток, не разрывая связь. */
  stop(): Promise<void>;
  getStatus(): DeviceStatus;
  onStatus(callback: (status: DeviceStatus) => void): Unsubscribe;
  /** Данные приходят пачками: так дешевле, чем по одному отсчёту. */
  onData(callback: (frames: readonly RawFrame[]) => void): Unsubscribe;
}

export function emptyStatus(): DeviceStatus {
  return { phase: 'idle', info: null, sensors: [], received: 0, lost: 0, reconnect: null, error: null };
}
