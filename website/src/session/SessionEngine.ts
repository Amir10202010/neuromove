// Движок сеанса: калибровка → шаги протокола → повторы → итог.
//
// Движок живёт только по времени отсчётов (RawFrame.t), без таймеров браузера.
// Поэтому один и тот же код:
//   • ведёт живой сеанс — кадры приходят от устройства 100 раз в секунду;
//   • «проигрывает» сеанс мгновенно — так построены демо-истории пациентов:
//     все их цифры посчитаны этими же алгоритмами из сырых чисел симулятора.
//
// Движок не знает, откуда кадры: симулятор, USB, Bluetooth или файл записи.

import { EXERCISES, repThresholds, type ExerciseDef, type ExerciseId } from '../core/exercises';
import { QUALITY_LIMITS, emptyBuffers, repMetrics, signalQuality, summarizeStep, type RepMetrics, type StepBuffers, type StepFlag } from '../core/metrics';
import {
  Calibrator,
  MotionPipeline,
  currentRoll,
  exerciseSample,
  forearmReady,
  missingSensors,
  mountFlipped,
  newElbowTrack,
  referenceFrom,
  type AngleReference,
  type ElbowTrack,
  type ExerciseSample,
} from '../core/pipeline';
import type { AccCalibration } from '../core/imu';
import type { ProtocolStep } from '../core/protocols';
import { BidirectionalRepDetector, RepDetector, type RepWindow } from '../core/reps';
import { angleBetween, elevation } from '../core/orientation';
import { PLACEMENTS, placementOf, type DeviceStatus, type Placement, type RawFrame, type Side } from '../devices/types';
import { LiveSeries } from './LiveSeries';
import type {
  EngineHint,
  EnginePhase,
  EngineResult,
  EngineSnapshot,
  Instruction,
  LiveValues,
  SessionEvent,
  SessionEventKind,
  StepLive,
  StepResult,
  StepTrace,
} from './types';

export interface EngineOptions {
  steps: ProtocolStep[];
  rateHz?: number;
  /** Ожидаемый размах для порогов повторов: из прошлого теста пациента или по умолчанию. */
  expectedRom?: (exercise: ExerciseId, side: Side) => number;
  /** Сам переходить к следующему шагу, когда повторы собраны. */
  autoAdvance?: boolean;
  calibrationSec?: number;
  /** Пауза между шагами, секунды времени устройства. */
  stepGapSec?: number;
  /** Сколько раз повторять калибровку, прежде чем принять как есть. */
  maxCalibrationAttempts?: number;
  /** Сохранять сырые кадры для выгрузки CSV. */
  recordRaw?: boolean;
  /** Продолжение прерванного сеанса (после перезагрузки страницы). */
  resume?: { stepIndex: number; completed: StepResult[]; events: SessionEvent[]; activeSec: number };
  /** Поправки акселерометра из паспорта устройства — и для потока, и для позы калибровки. */
  accCal?: Partial<Record<Placement, AccCalibration>>;
}

interface StepState {
  step: ProtocolStep;
  def: ExerciseDef;
  status: StepLive['status'];
  buffers: StepBuffers;
  detector: RepDetector | BidirectionalRepDetector;
  reps: RepMetrics[];
  flags: StepFlag[];
  startT: number | null;
  lastRepT: number | null;
  elapsed: number;
  /** Готовый результат шага, восстановленный после перезагрузки. */
  restored?: StepResult;
}

const SNAPSHOT_INTERVAL = 0.1; // секунды времени устройства между обновлениями экрана
/** Сегмент руки отклонён от вертикали в позе калибровки больше этого — углы будут дугой от этой позы. */
export const CAL_POSE_WARN_DEG = 15;
const NO_REPS_HINT_SEC = 15;
const MAX_EVENTS = 400;

export class SessionEngine {
  private phase: EnginePhase = 'ready';
  private resumeTo: EnginePhase | null = null;
  private connection: EngineSnapshot['connection'] = 'ok';
  private stepIndex = 0;
  private readonly steps: StepState[];
  private readonly pipe = new MotionPipeline();
  private readonly rateHz: number;
  private readonly opts: Required<Omit<EngineOptions, 'resume' | 'expectedRom'>> & Pick<EngineOptions, 'expectedRom'>;

  private calibrator: Calibrator | null = null;
  private calAttempts = 0;
  private calMoved = false;
  /** Калибровка принята «как есть» после последней попытки — с движением: углы этой калибровки ненадёжны. */
  private calForced = false;
  /** Наклон датчиков от вертикали в последней калибровке (по оси X — вдоль кости), градусы. */
  private calPose: Partial<Record<Placement, number>> = {};
  private ref: AngleReference | null = null;

  private rollZero = 0;
  /** Нужные датчики, которых сейчас нет (не на связи или не откалиброваны): угол шага не считается. */
  private missing: Placement[] = [];
  /** Датчик текущего шага, надетый наоборот (pipeline.ts, mountFlipped). */
  private flipped: Placement | null = null;
  /** Ветвь угла локтя (pipeline.ts, elbowFlexion): с новым шагом, калибровкой и после разрыва — заново. */
  private elbowTrack: ElbowTrack = newElbowTrack();
  private posSince: number | null = null;
  private posCos = 0;
  private posSin = 0;

  private t0: number | null = null;
  private tNow = 0;
  private stepDoneAt = 0;
  private activeSec = 0;
  /** Последний номер отсчёта по каждому датчику: Bluetooth-блоки нумеруют отсчёты сами. */
  private readonly lastSeq = new Map<string, number>();
  private received = 0;
  private lost = 0;
  private events: SessionEvent[] = [];

  private version = 0;
  private lastEmitT = -Infinity;
  private snapshot: EngineSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly instructionListeners = new Set<(ins: Instruction, t: number) => void>();
  private readonly rawChunks: RawFrame[][] = [[]];
  private pendingInstruction: Instruction | null = null;

  /** Последние секунды главного угла — для живого графика. */
  readonly series = new LiveSeries(1500);
  /** Текущие значения — для угломера и фигурки, читаются 60 раз в секунду. */
  readonly live: LiveValues = {
    t: 0,
    angle: null,
    trunk: null,
    check: null,
    repPeak: null,
    inRep: false,
    upperElevation: null,
    foreElevation: null,
  };

  constructor(options: EngineOptions) {
    this.rateHz = options.rateHz ?? 100;
    this.opts = {
      steps: options.steps,
      rateHz: this.rateHz,
      autoAdvance: options.autoAdvance ?? true,
      calibrationSec: options.calibrationSec ?? 3,
      stepGapSec: options.stepGapSec ?? 1.4,
      maxCalibrationAttempts: options.maxCalibrationAttempts ?? 4,
      recordRaw: options.recordRaw ?? false,
      expectedRom: options.expectedRom,
      accCal: options.accCal ?? {},
    };
    this.pipe.setAccCal(this.opts.accCal);
    this.steps = options.steps.map((step) => this.makeStep(step));
    if (options.resume) {
      const r = options.resume;
      r.completed.forEach((res, i) => {
        const st = this.steps[i];
        if (!st) return;
        st.restored = res;
        st.status = res.status === 'skipped' ? 'skipped' : 'done';
      });
      this.stepIndex = Math.min(r.stepIndex, this.steps.length - 1);
      this.events = [...r.events];
      this.activeSec = r.activeSec;
    }
    this.snapshot = this.buildSnapshot();
  }

  private makeStep(step: ProtocolStep): StepState {
    const def = EXERCISES[step.exercise];
    const expected = this.opts?.expectedRom?.(step.exercise, step.side) ?? def.expectedRom;
    const th = repThresholds(def, expected);
    return {
      step,
      def,
      status: 'pending',
      buffers: emptyBuffers(),
      detector: def.reps === 'bidirectional' ? new BidirectionalRepDetector(th.low, th.high) : new RepDetector(th.low, th.high),
      reps: [],
      flags: [],
      startT: null,
      lastRepT: null,
      elapsed: 0,
    };
  }

  // ── Подписки ──────────────────────────────────────────────────────────────

  /** Стрелочная функция — чтобы её можно было передать в useSyncExternalStore без bind. */
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  onInstruction(cb: (ins: Instruction, t: number) => void): () => void {
    this.instructionListeners.add(cb);
    return () => this.instructionListeners.delete(cb);
  }

  getSnapshot = (): EngineSnapshot => this.snapshot;

  get currentPhase(): EnginePhase {
    return this.phase;
  }

  get isFinished(): boolean {
    return this.phase === 'finished';
  }

  /** Сырые кадры сеанса — для выгрузки в CSV по контракту. */
  get rawFrames(): RawFrame[] {
    return this.rawChunks.flat();
  }

  // ── Команды специалиста ───────────────────────────────────────────────────

  /** Старт: калибровка, затем первый шаг. */
  start(): void {
    if (this.phase !== 'ready') return;
    this.log('session_start');
    this.beginCalibration();
  }

  pause(): void {
    if (!this.isActivePhase(this.phase)) return;
    this.resumeTo = this.phase;
    this.phase = 'paused';
    this.log('pause');
    this.instruct({ kind: 'rest' });
    this.emit(true);
  }

  resume(): void {
    if (this.phase !== 'paused' && this.phase !== 'interrupted') return;
    const to = this.resumeTo ?? 'recording';
    this.resumeTo = null;
    this.connection = 'ok';
    this.log('resume');
    // Всё, что было «в полёте», начинаем заново: неподвижность калибровки прервана,
    // незаконченный повтор не засчитываем.
    if (to === 'calibrating') {
      this.beginCalibration();
      return;
    }
    const st = this.current;
    if (st && (to === 'recording' || to === 'positioning')) {
      st.detector.reset(st.buffers.angle.length);
          this.elbowTrack = newElbowTrack();
      if (to === 'positioning') this.beginPositioning(st);
      else {
        this.phase = 'recording';
        this.instruct({ kind: 'exercise', exercise: st.step.exercise, side: st.step.side });
      }
    } else {
      this.phase = to;
    }
    this.emit(true);
  }

  /** Повторить калибровку посреди сеанса — например, если сдвинулся ремешок. */
  recalibrate(): void {
    if (this.phase === 'finished' || this.phase === 'ready') return;
    const st = this.current;
    if (st && st.status === 'active') st.detector.reset(st.buffers.angle.length);
          this.elbowTrack = newElbowTrack();
    this.resumeTo = null;
    this.beginCalibration();
  }

  /** Перейти к следующему шагу: досрочно закончить текущий или пропустить его. */
  nextStep(): void {
    const st = this.current;
    if (!st || this.phase === 'finished' || this.phase === 'ready' || this.phase === 'calibrating') return;
    if (st.status === 'active') {
      if (st.reps.length === 0) {
        st.status = 'skipped';
        st.flags.push('skipped');
        this.log('step_skipped', this.stepIndex);
      } else {
        st.status = 'done';
        this.log('step_done', this.stepIndex, st.reps.length);
      }
    }
    this.resumeTo = null;
    this.advance();
  }

  /** Закончить сеанс досрочно: собранное сохраняется, недоделанное помечается. */
  stop(): void {
    if (this.phase === 'finished') return;
    for (let i = 0; i < this.steps.length; i++) {
      const st = this.steps[i] as StepState;
      if (st.status === 'active') st.status = st.reps.length ? 'done' : 'skipped';
      else if (st.status === 'pending') st.status = 'skipped';
    }
    this.log('session_stopped');
    this.finish();
  }

  /** Реакция на состояние устройства: обрыв связи ставит сеанс на паузу. */
  handleDeviceStatus(s: DeviceStatus): void {
    const linkDown = s.phase === 'reconnecting' || s.phase === 'error' || s.phase === 'idle';
    if (linkDown && this.isActivePhase(this.phase)) {
      this.resumeTo = this.phase;
      this.phase = 'interrupted';
      this.connection = 'lost';
      this.log('connection_lost');
      this.emit(true);
    } else if (linkDown && this.phase === 'paused') {
      // Связь пропала на паузе: после восстановления продолжить можно будет как после паузы
      this.connection = 'lost';
      this.emit(true);
    } else if (s.phase === 'streaming' && this.connection === 'lost') {
      this.connection = 'restored';
      this.log('connection_restored');
      this.emit(true);
    }
    const low = s.sensors.find((x) => x.lowBattery);
    if (low && !this.events.some((e) => e.kind === 'low_battery')) {
      this.log('low_battery', undefined, low.battery ?? undefined);
      this.emit(true);
    }
  }

  // ── Поток данных ──────────────────────────────────────────────────────────

  process(frames: readonly RawFrame[]): void {
    for (const f of frames) this.processFrame(f);
    this.emit(false);
  }

  private processFrame(f: RawFrame): void {
    // Учёт потерь по каждому датчику: пропуск номера отсчёта = потерянный пакет.
    // Считаем только во время записи: отсчёты, пропавшие на паузе или при обрыве
    // (запись стояла, прерванный повтор не засчитан), полноту записанного не портят.
    const st = this.current;
    const primary = st ? placementOf(st.def.angle === 'elevation' ? 'upper' : 'fore', st.step.side) : null;
    const counting = this.isActivePhase(this.phase);
    for (const p of Object.keys(f.data)) {
      const last = this.lastSeq.get(p);
      if (last !== undefined && f.seq > last + 1 && counting) {
        const gap = f.seq - last - 1;
        this.lost += gap;
        if (p === primary && gap / this.rateHz > 0.3 && this.phase === 'recording' && st) {
          // Повтор, разорванный пропуском, не засчитываем
          st.detector.reset(st.buffers.angle.length);
          this.elbowTrack = newElbowTrack();
          if (!st.flags.includes('data_gap')) st.flags.push('data_gap');
          this.log('data_gap', this.stepIndex, Math.round((gap / this.rateHz) * 10) / 10);
        }
      }
      if (last === undefined || f.seq > last) this.lastSeq.set(p, f.seq);
      if (counting) this.received += 1;
    }

    if (this.t0 === null) {
      this.t0 = f.t;
      const pending = this.pendingInstruction;
      this.pendingInstruction = null;
      if (pending) this.instruct(pending);
    }
    const dt = f.t - (this.t0 + this.tNow);
    this.tNow = f.t - this.t0;

    const active = this.isActivePhase(this.phase);
    if (active) {
      if (dt > 0 && dt < 0.5) this.activeSec += dt;
      if (this.opts.recordRaw) this.recordRaw(f);
    }

    this.pipe.process(f, this.rateHz);
    this.updateFigure();

    switch (this.phase) {
      case 'calibrating':
        this.stepCalibration(f);
        break;
      case 'positioning':
        this.stepPositioning();
        break;
      case 'recording':
        this.stepRecording(f);
        break;
      case 'step_done':
        if (this.opts.autoAdvance && this.tNow - this.stepDoneAt >= this.opts.stepGapSec) this.advance();
        break;
      default:
        break;
    }
  }

  private recordRaw(f: RawFrame): void {
    let chunk = this.rawChunks[this.rawChunks.length - 1] as RawFrame[];
    // Кусками по 10 секунд — как в IndexedDB (софт.md, раздел 4)
    if (chunk.length >= this.rateHz * 10) {
      chunk = [];
      this.rawChunks.push(chunk);
    }
    chunk.push(f);
  }

  // ── Калибровка ────────────────────────────────────────────────────────────

  private beginCalibration(): void {
    this.phase = 'calibrating';
    this.calibrator = new Calibrator(this.opts.calibrationSec).withAccCal(this.opts.accCal);
    this.calAttempts += 1;
    this.log('calibration_start', undefined, this.calAttempts);
    this.instruct({ kind: 'hold_still' });
    this.emit(true);
  }

  private stepCalibration(f: RawFrame): void {
    const cal = this.calibrator;
    if (!cal) return;
    const r = cal.push(f);
    if (r === 'moved' && this.calAttempts < this.opts.maxCalibrationAttempts) {
      this.calMoved = true;
      this.log('calibration_moved', undefined, this.calAttempts);
      this.beginCalibration();
      return;
    }
    if (r === 'done' || (r === 'moved' && cal.progress >= 1)) {
      const res = cal.result();
      // Попытки кончились, а ребёнок так и не замер: принимаем, но честно помечаем всё, что посчитано так
      this.calForced = r === 'moved';
      if (this.calForced) this.log('calibration_forced', undefined, this.calAttempts);
      // Поза калибровки: насколько каждый сегмент отклонён от вертикали. Ось X датчика идёт вдоль кости
      // (правило крепления), перекос ремешка — до ~10°, поэтому предупреждаем с 15°
      this.calPose = {};
      for (const [p, up] of Object.entries(res.up) as [Placement, NonNullable<(typeof res.up)[Placement]>][]) {
        this.calPose[p] = Math.round(elevation(up));
      }
      const worst = Math.max(0, ...Object.entries(this.calPose).filter(([p]) => p !== 'trunk').map(([, v]) => v as number));
      if (worst >= CAL_POSE_WARN_DEG) this.log('calibration_pose', undefined, worst);
      this.pipe.setBias(res.bias);
      this.pipe.seedUp(res.up);
      this.ref = referenceFrom(res);
      this.calibrator = null;
      this.calMoved = false;
      this.log('calibration_done', undefined, this.calAttempts);
      const st = this.current;
      if (st && st.status === 'active') {
        // Калибровка посреди шага — продолжаем тот же шаг
        st.detector.reset(st.buffers.angle.length);
          this.elbowTrack = newElbowTrack();
        if (st.def.positioning) this.beginPositioning(st);
        else {
          this.phase = 'recording';
          this.instruct({ kind: 'exercise', exercise: st.step.exercise, side: st.step.side });
        }
        this.emit(true);
      } else {
        this.beginStep();
      }
    }
  }

  // ── Шаги ──────────────────────────────────────────────────────────────────

  private get current(): StepState | undefined {
    return this.steps[this.stepIndex];
  }

  private beginStep(): void {
    // Пропускаем шаги, восстановленные после перезагрузки
    while (this.current && (this.current.status === 'done' || this.current.status === 'skipped')) this.stepIndex += 1;
    const st = this.current;
    if (!st) {
      this.finish();
      return;
    }
    st.status = 'active';
    this.elbowTrack = newElbowTrack();
    this.missing = [];
    this.flipped = null;
    st.startT = this.tNow;
    st.lastRepT = this.tNow;
    this.series.clear();
    this.log('step_start', this.stepIndex);
    if (st.def.positioning) this.beginPositioning(st);
    else {
      this.phase = 'recording';
      this.instruct({ kind: 'exercise', exercise: st.step.exercise, side: st.step.side });
    }
    this.emit(true);
  }

  private beginPositioning(st: StepState): void {
    this.phase = 'positioning';
    this.posSince = null;
    this.posCos = 0;
    this.posSin = 0;
    this.instruct({ kind: 'exercise', exercise: st.step.exercise, side: st.step.side });
  }

  /** Поворот предплечья: ждём, пока предплечье горизонтально и неподвижно 0.6 с — это нейтраль. */
  private stepPositioning(): void {
    const st = this.current;
    if (!st) return;
    const side = st.step.side;
    if (!forearmReady(this.pipe, side, this.ref ?? undefined, this.t0 === null ? undefined : this.t0 + this.tNow)) {
      this.posSince = null;
      this.posCos = 0;
      this.posSin = 0;
      return;
    }
    // Предплечье надето крышкой к коже — супинация и пронация поменялись бы местами: нейтраль не ловим
    const foreP = placementOf('fore', side);
    const fore = this.pipe.latest[foreP];
    if (fore && mountFlipped('forward', side, fore.up)) {
      this.markFlipped(st, foreP);
      this.posSince = null;
      this.posCos = 0;
      this.posSin = 0;
      return;
    }
    if (this.flipped === foreP) {
      this.flipped = null;
      this.emit(true);
    }
    const r = currentRoll(this.pipe, side);
    if (r === null) return;
    if (this.posSince === null) this.posSince = this.tNow;
    // Среднее угла по кругу: через синус и косинус, чтобы 179° и −179° не дали 0°
    this.posCos += Math.cos((r * Math.PI) / 180);
    this.posSin += Math.sin((r * Math.PI) / 180);
    if (this.tNow - this.posSince >= 0.6) {
      this.rollZero = (Math.atan2(this.posSin, this.posCos) * 180) / Math.PI;
      this.phase = 'recording';
      st.lastRepT = this.tNow;
      this.log('positioning_done', this.stepIndex);
      this.emit(true);
    }
  }

  private stepRecording(f: RawFrame): void {
    const st = this.current;
    if (!st || !this.ref) return;
    const primary = placementOf(st.def.angle === 'elevation' ? 'upper' : 'fore', st.step.side);
    // Сначала — все ли датчики на месте, включая главный: пропал главный — его кадров нет вовсе,
    // и без этой проверки угломер замёрз бы без пометки (поймано сквозным тестом сбоя «датчик отвалился»)
    if (!this.checkSensors(st, f.t)) return;
    if (!f.data[primary]) return; // угол считаем, когда пришёл отсчёт главного датчика
    if (this.calForced && !st.flags.includes('calibration_moved')) st.flags.push('calibration_moved');

    const s = exerciseSample(st.def, st.step.side, this.pipe, this.ref, this.rollZero, this.elbowTrack);
    if (!s) return;
    // Подъём руки выше 45°: видно, надет ли датчик плеча крышкой наружу. На сами углы подъёма переворот
    // не влияет, а на локоть — да, поэтому предупреждаем до шага с локтем
    if ((st.def.id === 'shoulder_flexion' || st.def.id === 'shoulder_abduction') && s.angle > 45) {
      const upper = this.pipe.latest[primary];
      if (upper && mountFlipped(st.def.id === 'shoulder_abduction' ? 'sideways' : 'forward', st.step.side, upper.up)) this.markFlipped(st, primary);
    }
    // Упор датчика движения (главного, а у локтя и плеча): значение в этот момент ненадёжно — шаг помечаем
    const upperSat = st.def.angle === 'elbow' && this.pipe.latest[placementOf('upper', st.step.side)]?.saturated;
    if ((this.pipe.latest[primary]?.saturated || upperSat) && !st.flags.includes('saturation')) st.flags.push('saturation');
    const b = st.buffers;
    const k = b.angle.length;
    b.t.push(this.tNow);
    b.angle.push(s.angle);
    b.speed.push(s.speed);
    b.trunk.push(s.trunk);
    b.check.push(s.check);
    st.elapsed = this.tNow - (st.startT ?? this.tNow);

    const rep = st.detector.push(k, s.angle);
    this.updateLive(s, st.detector.inProgress);
    this.series.push(this.tNow, s.angle, s.trunk, st.detector.inProgress);

    if (rep) this.completeRep(st, rep);

    const byTime = st.step.durationSec !== undefined && st.elapsed >= st.step.durationSec;
    const byReps = st.step.reps > 0 && st.reps.length >= st.step.reps;
    if (byTime || byReps) {
      st.status = 'done';
      this.phase = 'step_done';
      this.stepDoneAt = this.tNow;
      this.log('step_done', this.stepIndex, st.reps.length);
      this.instruct({ kind: 'rest' });
      this.emit(true);
    }
  }

  /**
   * Все ли датчики движения на месте. Пропал нужный датчик — угла нет: шаг помечается, незаконченный
   * повтор не засчитывается, специалист видит, какого датчика нет. Вернулся — запись продолжается.
   */
  private checkSensors(st: StepState, t: number): boolean {
    if (!this.ref) return false;
    const missing = missingSensors(st.def, st.step.side, this.pipe, this.ref, t);
    if (missing.length) {
      // Угломер и график не должны показывать замёрзшее число
      this.live.angle = null;
      this.live.trunk = null;
      this.live.check = null;
      this.live.inRep = false;
      if (!this.missing.length) {
        st.detector.reset(st.buffers.angle.length);
        this.elbowTrack = newElbowTrack();
        if (!st.flags.includes('sensor_lost')) st.flags.push('sensor_lost');
        this.log('sensor_lost', this.stepIndex, PLACEMENTS.indexOf(missing[0] as Placement));
        this.missing = missing;
        this.emit(true);
      }
      this.missing = missing;
      return false;
    }
    if (this.missing.length) {
      this.missing = [];
      this.log('sensor_restored', this.stepIndex);
      this.emit(true);
    }
    return true;
  }

  /** Датчик надет наоборот: событие и пометка один раз на шаг, подсказка — пока не поправят. */
  private markFlipped(st: StepState, p: Placement): void {
    if (this.flipped === p) return;
    this.flipped = p;
    if (!st.flags.includes('mount_flipped')) {
      st.flags.push('mount_flipped');
      this.log('mount_flipped', this.stepIndex, PLACEMENTS.indexOf(p));
    }
    this.emit(true);
  }

  private completeRep(st: StepState, w: RepWindow): void {
    const m = repMetrics(st.def, st.buffers, w, st.reps.length, this.rateHz);
    st.reps.push(m);
    st.lastRepT = this.tNow;
    this.live.repPeak = null;
    this.log('rep', this.stepIndex, Math.round(m.rom * 10) / 10);
    this.emit(true);
  }

  private advance(): void {
    this.stepIndex += 1;
    if (this.stepIndex >= this.steps.length) {
      this.stepIndex = this.steps.length - 1;
      this.finish();
      return;
    }
    this.beginStep();
  }

  private finish(): void {
    this.phase = 'finished';
    this.resumeTo = null;
    this.log('session_finished');
    this.instruct({ kind: 'rest' });
    this.emit(true);
  }

  // ── Живые значения ────────────────────────────────────────────────────────

  private updateLive(s: ExerciseSample, inRep: boolean): void {
    this.live.t = this.tNow;
    this.live.angle = s.angle;
    this.live.trunk = s.trunk;
    this.live.check = s.check;
    this.live.inRep = inRep;
    if (inRep) this.live.repPeak = Math.max(this.live.repPeak ?? -Infinity, s.angle);
  }

  /** Подъём плеча и предплечья текущей стороны — для фигурки, в любой фазе. */
  private updateFigure(): void {
    const st = this.current;
    if (!st || !this.ref) return;
    const up = this.pipe.latest[placementOf('upper', st.step.side)];
    const fore = this.pipe.latest[placementOf('fore', st.step.side)];
    const ru = this.ref.up[placementOf('upper', st.step.side)];
    const rf = this.ref.up[placementOf('fore', st.step.side)];
    this.live.upperElevation = up && ru ? angleBetween(up.up, ru) : null;
    this.live.foreElevation = fore && rf ? angleBetween(fore.up, rf) : null;
    if (this.phase !== 'recording') {
      this.live.t = this.tNow;
      const trunk = this.pipe.latest.trunk;
      this.live.trunk = trunk && this.ref.up.trunk ? angleBetween(trunk.up, this.ref.up.trunk) : null;
    }
  }

  // ── Служебное ─────────────────────────────────────────────────────────────

  private isActivePhase(p: EnginePhase): boolean {
    return p === 'calibrating' || p === 'positioning' || p === 'recording' || p === 'step_done';
  }

  private instruct(ins: Instruction): void {
    // До первого отсчёта время устройства неизвестно — отдадим указание, когда оно придёт
    if (this.t0 === null) {
      this.pendingInstruction = ins;
      return;
    }
    for (const cb of this.instructionListeners) cb(ins, this.t0 + this.tNow);
  }

  private log(kind: SessionEventKind, step?: number, value?: number): void {
    const e: SessionEvent = { kind, t: Math.round(this.tNow * 100) / 100 };
    if (step !== undefined) e.step = step;
    if (value !== undefined) e.value = value;
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  private hint(): EngineHint {
    const st = this.current;
    if (!st) return null;
    if (this.flipped && (this.phase === 'recording' || this.phase === 'positioning')) return 'mount_flipped';
    if (this.phase !== 'recording') return null;
    if (this.missing.length) return 'sensor_missing';
    if (st.def.check === 'upper_lift' && (this.live.check ?? 0) > QUALITY_LIMITS.upperLift) return 'upper_lift';
    if (st.def.check === 'forearm_level' && Math.abs((this.live.check ?? 90) - 90) > QUALITY_LIMITS.forearmLevel)
      return 'forearm_level';
    if (st.lastRepT !== null && this.tNow - st.lastRepT > NO_REPS_HINT_SEC) return 'no_reps';
    return null;
  }

  private emit(force: boolean): void {
    if (!force && this.tNow - this.lastEmitT < SNAPSHOT_INTERVAL) return;
    this.lastEmitT = this.tNow;
    this.version += 1;
    this.snapshot = this.buildSnapshot();
    for (const cb of this.listeners) cb();
  }

  private buildSnapshot(): EngineSnapshot {
    const cal = this.calibrator;
    const st = this.current;
    return {
      phase: this.phase,
      resumeTo: this.resumeTo,
      connection: this.connection,
      stepIndex: this.stepIndex,
      steps: this.steps.map((s) => this.stepLive(s)),
      calibration: { progress: cal?.progress ?? (this.ref ? 1 : 0), attempt: this.calAttempts, moved: this.calMoved },
      positioning: {
        ready: this.posSince !== null,
        progress: this.posSince === null ? 0 : Math.min(1, (this.tNow - this.posSince) / 0.6),
      },
      activeSec: this.activeSec,
      quality: this.qualityStats(),
      hint: st ? this.hint() : null,
      missing: this.phase === 'recording' ? [...this.missing] : [],
      flipped: this.flipped,
      events: this.events.slice(-60),
      version: this.version,
    };
  }

  private stepLive(s: StepState): StepLive {
    if (s.restored) {
      const sum = s.restored.summary;
      return {
        exercise: sum.exercise,
        side: sum.side,
        targetReps: sum.targetReps,
        durationSec: s.step.durationSec ?? null,
        status: s.status,
        reps: sum.reps.map((r) => ({ rom: r.rom, sparc: r.sparc, trunk: r.trunk, supination: r.supination, pronation: r.pronation })),
        elapsed: 0,
        flags: sum.flags,
      };
    }
    return {
      exercise: s.step.exercise,
      side: s.step.side,
      targetReps: s.step.reps,
      durationSec: s.step.durationSec ?? null,
      status: s.status,
      reps: s.reps.map((r) => ({ rom: r.rom, sparc: r.sparc, trunk: r.trunk, supination: r.supination, pronation: r.pronation })),
      elapsed: s.elapsed,
      flags: s.flags,
    };
  }

  private qualityStats() {
    const saturated = this.pipe.saturatedSamples;
    return { received: this.received, lost: this.lost, saturated, percent: signalQuality(this.received, this.lost, saturated) };
  }

  // ── Итог ──────────────────────────────────────────────────────────────────

  result(): EngineResult {
    const steps: StepResult[] = this.steps.map((s) => {
      if (s.restored) return s.restored;
      const summary = summarizeStep(s.def, s.step.side, s.reps, s.step.reps, s.flags);
      const status: StepResult['status'] =
        s.status === 'skipped' ? 'skipped' : s.step.reps > 0 && s.reps.length < s.step.reps ? 'partial' : 'done';
      return { summary, trace: downsample(s.buffers, this.rateHz, 20), status };
    });
    return {
      steps,
      events: [...this.events],
      quality: this.qualityStats(),
      activeSec: this.activeSec,
      totalSec: this.tNow,
      calibrationAttempts: this.calAttempts,
      calibrationPose: { ...this.calPose },
      completed: steps.every((s) => s.status === 'done'),
    };
  }

  /** То, что нужно, чтобы продолжить сеанс после перезагрузки страницы. */
  resumeState(): NonNullable<EngineOptions['resume']> {
    const completed: StepResult[] = [];
    const all = this.result().steps;
    for (let i = 0; i < this.steps.length; i++) {
      const st = this.steps[i] as StepState;
      if (st.status === 'done' || st.status === 'skipped') completed.push(all[i] as StepResult);
      else break;
    }
    return { stepIndex: completed.length, completed, events: this.events, activeSec: this.activeSec };
  }
}

/** Прореживание записи шага до ~20 Гц для графика в отчёте. */
function downsample(b: StepBuffers, rateHz: number, targetHz: number): StepTrace {
  const every = Math.max(1, Math.round(rateHz / targetHz));
  const out: StepTrace = { t: [], angle: [], trunk: [] };
  for (let i = 0; i < b.angle.length; i += every) {
    out.t.push(Math.round((b.t[i] as number) * 100) / 100);
    out.angle.push(Math.round((b.angle[i] as number) * 10) / 10);
    const tr = b.trunk[i];
    out.trunk.push(tr === null || tr === undefined ? null : Math.round(tr * 10) / 10);
  }
  return out;
}
