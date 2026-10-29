// Эксперименты C1–C17 (docs/ENGINEERING_10H/EXPERIMENTS.md): каждый сценарий — запись от эталона,
// прогон через движок приложения, ошибки и вердикт по критерию, записанному до прогона.
//
// Быстрый режим (npm test) — 2 зерна и 2 минуты в долгом сценарии; полный (npm run experiments) —
// 8 зёрен и 10 минут, результаты пишутся в docs/ENGINEERING_10H/data/.

import type { ExerciseId } from '../core/exercises';
import type { AccCalibration } from '../core/imu';
import { ImuCsvParser, SeqUnwrapper, serializeImuCsv } from '../devices/contract';
import type { Placement, RawFrame, Side } from '../devices/types';
import type { BodyPose, BodyTruth } from './body';
import { generate, keyframes, sixPoseCalibration, type ErrorProfile, type GenSpec, type Generated } from './gen';
import { errStats, r2, runEngine, type EngineRun, type EngineRunOptions, type ErrStats } from './harness';
import { RAD, qAxis, type Q, type V } from './quat';
import { XRng } from './rng';
import { CAL_SEC, armPose, placesFor, repTrack, stairsTrack, truthFor } from './scenarios';

export interface ScenarioResult {
  id: string;
  criterion: string;
  /** Что именно сравнивали и при каких условиях. */
  setup: string;
  seeds: number[];
  /** По каждому зерну: MAE, RMSE, P95, максимум, средняя со знаком, покрытие. */
  perSeed: Record<string, number | string | null>[];
  /** Сводка: худшее по зёрнам или среднее — см. summaryRule. */
  summary: Record<string, number | string | null>;
  summaryRule: string;
  pass: boolean;
  note?: string;
  /**
   * Известное ограничение: сценарий не проходит, и это записано в FINDINGS.md под этим номером.
   * Тест требует, чтобы он и дальше не проходил: исправили — обновите находку и уберите пометку.
   */
  knownLimitation?: string;
  /**
   * Защита от регрессии для известного ограничения, которое зависит от датчика (F2): критерий не выполнен,
   * но и хуже нынешнего становиться не должно. Это не приёмка — в таблице такой сценарий остаётся «нет».
   */
  guard?: { rule: string; ok: boolean };
}

export interface ExperimentOptions {
  full: boolean;
}

const RIGHT: Side = 'right';

function calFor(g: Generated, seed: number, tilt = 0): Partial<Record<Placement, AccCalibration>> {
  const out: Partial<Record<Placement, AccCalibration>> = {};
  const rng = new XRng(seed);
  for (const [p, e] of Object.entries(g.errors)) {
    const c = sixPoseCalibration(e, rng, tilt);
    if (c) out[p as Placement] = { off: c.off, scale: c.scale };
  }
  return out;
}

function statRow(seed: number, s: ErrStats, extra: Record<string, number | string | null> = {}): Record<string, number | string | null> {
  return { seed, n: s.n, coverage: r2(s.coverage), bias: r2(s.bias), mae: r2(s.mae), rmse: r2(s.rmse), p95: r2(s.p95), max: r2(s.max), ...extra };
}

function worst(rows: Record<string, number | string | null>[], key: string): number {
  return Math.max(...rows.map((r) => Math.abs(Number(r[key]))));
}

function meanOf(rows: Record<string, number | string | null>[], key: string): number {
  return r2(rows.reduce((s, r) => s + Number(r[key]), 0) / rows.length);
}

interface Setup {
  spec: Omit<GenSpec, 'seed'>;
  run: Omit<EngineRunOptions, 'accCal'>;
  /** Поправки калибровки в 6 положениях к каждому датчику. */
  sixPose?: boolean;
}

function runSeed(s: Setup, seed: number): { gen: Generated; run: EngineRun } {
  const gen = generate({ ...s.spec, seed });
  const run = runEngine(gen, { ...s.run, ...(s.sixPose ? { accCal: calFor(gen, seed + 1000) } : {}) });
  return { gen, run };
}

// ── Сценарии ────────────────────────────────────────────────────────────────

function staticSetup(exercise: ExerciseId, side: Side, profile: ErrorProfile, extra: Partial<GenSpec> = {}): Setup {
  const places = placesFor(side);
  if (exercise === 'forearm_rotation') {
    // Установка: локоть 90°, нейтраль 2 с; затем ступени поворота
    const elbow = keyframes([[0, 0], [CAL_SEC, 0], [CAL_SEC + 1.5, 90]]);
    const st = stairsTrack([-80, -40, 0, 40, 80], 1.5, 3, CAL_SEC + 3.5);
    return {
      spec: { durationSec: st.end, motion: (t) => armPose(side, { elbow: elbow(t), proSup: st.track(t) }), places, errors: profile, ...extra },
      run: { exercise, side, truthOf: truthFor(exercise, side), windows: st.holds },
      sixPose: profile !== 'ideal',
    };
  }
  if (exercise === 'elbow_flexion') {
    const st = stairsTrack([30, 60, 90, 120, 140]);
    return {
      spec: { durationSec: st.end, motion: (t) => armPose(side, { elbow: st.track(t) }), places, errors: profile, ...extra },
      run: { exercise, side, truthOf: truthFor(exercise, side), windows: st.holds },
      sixPose: profile !== 'ideal',
    };
  }
  const plane = exercise === 'shoulder_flexion' ? 0 : 90;
  const st = stairsTrack([30, 60, 90, 120, 150]);
  return {
    spec: { durationSec: st.end, motion: (t) => armPose(side, { plane, elevation: st.track(t) }), places, errors: profile, ...extra },
    run: { exercise, side, truthOf: truthFor(exercise, side), windows: st.holds },
    sixPose: profile !== 'ideal',
  };
}

function repsSetup(rise: number, hold: number, extra: Partial<GenSpec> = {}): Setup {
  const tr = repTrack(150, rise, hold, 3);
  const dur = CAL_SEC + 3 * (2 * rise + hold + 1) + 1;
  return {
    spec: { durationSec: dur, motion: (t) => armPose(RIGHT, { plane: 0, elevation: tr(t) }), places: placesFor(RIGHT), errors: 'typical', ...extra },
    run: { exercise: 'shoulder_flexion', side: RIGHT, truthOf: truthFor('shoulder_flexion', RIGHT) },
    sixPose: true,
  };
}

function multiSeed(
  id: string,
  criterion: string,
  setup: string,
  seeds: number[],
  build: (seed: number) => { row: Record<string, number | string | null> },
  judge: (rows: Record<string, number | string | null>[]) => { summary: Record<string, number | string | null>; rule: string; pass: boolean; note?: string },
): ScenarioResult {
  const rows = seeds.map((s) => build(s).row);
  const j = judge(rows);
  return { id, criterion, setup, seeds, perSeed: rows, summary: j.summary, summaryRule: j.rule, pass: j.pass, ...(j.note ? { note: j.note } : {}) };
}

/** C1 и C15: точность в покое по каждому движению. */
function staticScenario(id: string, criterion: string, exercise: ExerciseId, side: Side, profile: ErrorProfile, seeds: number[], extra: Partial<GenSpec> = {}, maeLim = 1, maxLim = 2): ScenarioResult {
  return multiSeed(
    id,
    criterion,
    `${exercise}, ${side}, датчик «${profile}»${profile !== 'ideal' ? ' + калибровка в 6 положениях' : ''}${extra.misalignDeg ? `, перекос ${extra.misalignDeg}°` : ''}; окна удержаний`,
    seeds,
    (seed) => {
      const { run } = runSeed(staticSetup(exercise, side, profile, extra), seed);
      return { row: statRow(seed, run.stats) };
    },
    (rows) => {
      const mae = worst(rows, 'mae');
      const max = worst(rows, 'max');
      return { summary: { worstMae: mae, worstMax: max, meanMae: meanOf(rows, 'mae') }, rule: 'худшее по зёрнам', pass: mae <= maeLim && max <= maxLim };
    },
  );
}

export function runExperiments(o: ExperimentOptions): ScenarioResult[] {
  const seeds = o.full ? [11, 12, 13, 14, 15, 16, 17, 18] : [11, 12];
  const out: ScenarioResult[] = [];

  // C1: покой — сначала идеальный датчик (только алгоритм), затем реальный с калибровкой
  for (const ex of ['shoulder_flexion', 'shoulder_abduction', 'elbow_flexion', 'forearm_rotation'] as ExerciseId[]) {
    out.push(staticScenario(`C1-${ex}-ideal`, 'C1 (алгоритм): MAE ≤ 1,0°, максимум ≤ 2,0°', ex, RIGHT, 'ideal', seeds));
    out.push(withF2Guard(staticScenario(`C1-${ex}`, 'C1: MAE ≤ 1,0°, максимум ≤ 2,0°', ex, RIGHT, 'typical', seeds)));
  }

  // C2, C3: медленно и быстро
  for (const [id, rise, hold, rmseLim, romLim] of [
    ['C2-slow', 3, 1, 2, 2],
    ['C3-fast', 0.6, 0.3, 5, 4],
  ] as const) {
    out.push(
      multiSeed(
        id,
        id === 'C2-slow' ? 'C2: RMSE ≤ 2°, ошибка ROM повтора ≤ 2°' : 'C3: RMSE ≤ 5°, ошибка ROM повтора ≤ 4°',
        `подъём вперёд 0 → 150° за ${rise} с, 3 повтора; датчик «typical» + 6 положений`,
        seeds,
        (seed) => {
          const { run } = runSeed(repsSetup(rise, hold), seed);
          const romErr = run.reps.length ? Math.max(...run.reps.map((r) => Math.abs(r.error))) : NaN;
          return { row: statRow(seed, run.stats, { reps: run.reps.length, worstRomErr: r2(romErr) }) };
        },
        (rows) => {
          const rmse = worst(rows, 'rmse');
          const rom = worst(rows, 'worstRomErr');
          const reps = Math.min(...rows.map((r) => Number(r.reps)));
          return { summary: { worstRmse: rmse, worstRomErr: rom, minReps: reps }, rule: 'худшее по зёрнам', pass: rmse <= rmseLim && rom <= romLim && reps === 3 };
        },
      ),
    );
  }

  // C4: рывок локтя быстрее 1000 °/с — упор гироскопа
  out.push(
    multiSeed(
      'C4-flick',
      'C4: упор посчитан, шаг помечен «saturation», нет NaN',
      'локоть 0 → 130° за 0,15 с (пик ~1600 °/с), 3 раза',
      seeds,
      (seed) => {
        const tr = repTrack(130, 0.15, 0.5, 3);
        const gen = generate({ durationSec: CAL_SEC + 3 * 1.8 + 1, motion: (t) => armPose(RIGHT, { elbow: tr(t) }), places: placesFor(RIGHT), seed, errors: 'typical' });
        const run = runEngine(gen, { exercise: 'elbow_flexion', side: RIGHT, truthOf: truthFor('elbow_flexion', RIGHT) });
        const nan = run.angle.some((a) => a !== null && !Number.isFinite(a));
        return { row: { seed, saturated: run.saturated, flagged: run.flags.includes('saturation') ? 'да' : 'нет', nan: nan ? 'да' : 'нет', reps: run.reps.length } };
      },
      (rows) => {
        const pass = rows.every((r) => Number(r.saturated) > 0 && r.flagged === 'да' && r.nan === 'нет');
        return { summary: { minSaturated: Math.min(...rows.map((r) => Number(r.saturated))), flaggedAll: rows.every((r) => r.flagged === 'да') ? 'да' : 'нет' }, rule: 'все зёрна', pass };
      },
    ),
  );

  // C5: остаточное смещение гироскопа после калибровки
  out.push(
    staticScenario('C5-gyro-drift', 'C5: MAE ≤ 1,0° при +0,5 °/с после калибровки', 'shoulder_flexion', RIGHT, 'typical', seeds, {
      gyroDrift: (t) => (t > CAL_SEC ? [0.5, 0.5, 0.5] : [0, 0, 0]),
    }, 1, Infinity),
  );

  // C6: ноль и масштаб акселерометра на краю даташита — без поправок и с поправками
  for (const cal of [false, true]) {
    const r6 = multiSeed(
      `C6-edge-${cal ? 'cal' : 'nocal'}`,
      cal ? 'C6: с поправками 6 положений MAE ≤ 1,0°' : 'C6: без поправок — записать',
      'подъём вперёд, ступени; датчик «edge»',
      seeds,
      (seed) => {
        const s = staticSetup('shoulder_flexion', RIGHT, 'edge');
        const gen = generate({ ...s.spec, seed });
        const run = runEngine(gen, { ...s.run, ...(cal ? { accCal: calFor(gen, seed + 1000) } : {}) });
        return { row: statRow(seed, run.stats) };
      },
      (rows) => {
        const mae = worst(rows, 'mae');
        return { summary: { worstMae: mae, worstMax: worst(rows, 'max'), meanMae: meanOf(rows, 'mae') }, rule: 'худшее по зёрнам', pass: cal ? mae <= 1 : true };
      },
    );
    out.push(cal ? withF2Guard(r6) : r6);
  }

  // C6t: калибровка в 6 положениях на неровном столе — грани стоят с наклоном
  {
    const flat: Record<number, number> = {};
    for (const tilt of [0, 2, 5, 10, 14]) {
      const r = multiSeed(
        `C6t-tilt-${tilt}`,
        tilt <= 5 ? 'C6t: рост MAE против ровных граней ≤ 0,3°' : 'C6t: записать',
        `грани калибровки с наклоном ${tilt}°, подъём вперёд в покое; датчик «typical»`,
        seeds,
        (seed) => {
          const st = staticSetup('shoulder_flexion', RIGHT, 'typical');
          const gen = generate({ ...st.spec, seed });
          const run = runEngine(gen, { ...st.run, accCal: calFor(gen, seed + 1000, tilt) });
          return { row: statRow(seed, run.stats) };
        },
        (rows) => {
          const mean = meanOf(rows, 'mae');
          if (tilt === 0) flat[0] = mean;
          const growth = r2(mean - (flat[0] ?? mean));
          return { summary: { meanMae: mean, worstMae: worst(rows, 'mae'), growthVsFlat: growth }, rule: 'среднее по зёрнам', pass: tilt <= 5 ? growth <= 0.3 : true };
        },
      );
      out.push(r);
    }
  }

  // C7: шум × 3
  out.push(staticScenario('C7-noise3', 'C7: MAE ≤ 1,5° при шуме × 3', 'shoulder_flexion', RIGHT, 'typical', seeds, { noise: 3 }, 1.5, Infinity));

  // C8: дрожание момента отсчёта — сравнение с тем же зерном без дрожания
  out.push(
    multiSeed(
      'C8-jitter',
      'C8: MAE растёт ≤ 0,3° при дрожании σ = 1 мс',
      'медленные повторы; то же зерно с дрожанием и без',
      seeds,
      (seed) => {
        const base = runSeed(repsSetup(3, 1), seed).run.stats.mae;
        const jit = runSeed(repsSetup(3, 1, { jitterMs: 1 }), seed).run.stats.mae;
        return { row: { seed, maeBase: r2(base), maeJitter: r2(jit), delta: r2(jit - base) } };
      },
      (rows) => {
        const d = Math.max(...rows.map((r) => Number(r.delta)));
        return { summary: { worstDelta: d }, rule: 'худшее по зёрнам', pass: d <= 0.3 };
      },
    ),
  );

  // C9: пропуски — 5 % случайных и пачка 0,3 с посреди подъёма
  out.push(
    multiSeed(
      'C9-drops',
      'C9: MAE растёт ≤ 0,3° при 5 % пропусков; после пачки 0,3 с ошибка < 2° не позже 1 с',
      'медленные повторы; кадры теряются до движка',
      seeds,
      (seed) => {
        const s = repsSetup(3, 1);
        const gen = generate({ ...s.spec, seed });
        const accCal = calFor(gen, seed + 1000);
        const base = runEngine(gen, { ...s.run, accCal });
        const rng = new XRng(seed + 7);
        const drop = runEngine(gen, { ...s.run, accCal, deliver: (f) => (rng.next() < 0.05 ? null : [f]) });
        // Пачка: 0,3 с в середине первого подъёма
        const g0 = CAL_SEC + 1.35;
        const burst = runEngine(gen, { ...s.run, accCal, deliver: (f) => (f.t >= g0 && f.t < g0 + 0.3 ? null : [f]) });
        let recoverErr = 0;
        for (let i = 0; i < burst.t.length; i++) {
          const t = burst.t[i] as number;
          const a = burst.angle[i];
          if (t >= g0 + 1.3 && t < g0 + 3 && a !== null && a !== undefined) recoverErr = Math.max(recoverErr, Math.abs(a - (burst.truth[i] as number)));
        }
        return { row: { seed, maeBase: r2(base.stats.mae), maeDrop5: r2(drop.stats.mae), delta: r2(drop.stats.mae - base.stats.mae), errAfterBurst: r2(recoverErr), burstFlag: burst.flags.includes('data_gap') ? 'да' : 'нет' } };
      },
      (rows) => {
        const d = Math.max(...rows.map((r) => Number(r.delta)));
        const rec = Math.max(...rows.map((r) => Number(r.errAfterBurst)));
        return { summary: { worstDelta: d, worstErrAfterBurst: rec }, rule: 'худшее по зёрнам', pass: d <= 0.3 && rec < 2 };
      },
    ),
  );

  // C10: повтор строк — через разбор потока, как в USB (SerialDevice: ImuCsvParser + SeqUnwrapper)
  out.push(
    multiSeed(
      'C10-duplicates',
      'C10: повтор строки не сбрасывает фильтр; MAE растёт ≤ 0,1°',
      '2 % строк приходят дважды; путь USB и путь «в обход разбора»',
      seeds,
      (seed) => {
        const s = repsSetup(3, 1);
        const gen = generate({ ...s.spec, seed });
        const accCal = calFor(gen, seed + 1000);
        const base = runEngine(gen, { ...s.run, accCal });
        const rng = new XRng(seed + 9);
        const dupLines = viaSerial(gen, () => rng.next() < 0.02);
        const viaParser = runEngine({ ...gen, frames: dupLines.frames }, { ...s.run, accCal, deliver: (f) => [f] });
        const rng2 = new XRng(seed + 9);
        const raw = runEngine(gen, { ...s.run, accCal, deliver: (f) => (rng2.next() < 0.02 ? [f, f] : [f]) });
        return { row: { seed, maeBase: r2(base.stats.mae), maeParser: r2(viaParser.stats.mae), deltaParser: r2(viaParser.stats.mae - base.stats.mae), maeRawDup: r2(raw.stats.mae), deltaRawDup: r2(raw.stats.mae - base.stats.mae), dropped: dupLines.dropped } };
      },
      (rows) => {
        const d = Math.max(...rows.map((r) => Number(r.deltaParser)));
        return { summary: { worstDeltaParser: d, worstDeltaRawDup: Math.max(...rows.map((r) => Number(r.deltaRawDup))) }, rule: 'худшее по зёрнам; критерий — путь USB', pass: d <= 0.1 };
      },
    ),
  );

  // C11: перезагрузка платы посреди записи
  out.push(
    multiSeed(
      'C11-reset',
      'C11: время только растёт, разрыв учтён, нет NaN',
      'seq снова с 0 после 15 с записи, 1 с без данных; путь USB',
      seeds,
      (seed) => {
        const s = repsSetup(3, 1);
        const gen = generate({ ...s.spec, seed });
        const k0 = 15 * gen.rateHz;
        const cut = gen.frames.filter((f) => f.seq < k0 || f.seq >= k0 + gen.rateHz).map((f) => (f.seq >= k0 ? { ...f, seq: f.seq - k0 - gen.rateHz } : f));
        const serial = viaSerial({ ...gen, frames: cut }, () => false, (prev, cur) => (cur.seq === 0 && prev ? gen.rateHz + 1 : 1));
        let mono = true;
        for (let i = 1; i < serial.frames.length; i++) if ((serial.frames[i] as RawFrame).t <= (serial.frames[i - 1] as RawFrame).t) mono = false;
        const run = runEngine({ ...gen, frames: serial.frames, truth: serial.frames.map((f) => gen.truth[Math.min(gen.truth.length - 1, f.seq)] as BodyTruth) }, { ...s.run, accCal: calFor(gen, seed + 1000) });
        const nan = run.angle.some((a) => a !== null && !Number.isFinite(a));
        return { row: { seed, monotonic: mono ? 'да' : 'нет', resets: serial.resets, nan: nan ? 'да' : 'нет', reps: run.reps.length } };
      },
      (rows) => ({
        summary: { allMonotonic: rows.every((r) => r.monotonic === 'да') ? 'да' : 'нет', anyNaN: rows.some((r) => r.nan === 'да') ? 'да' : 'нет' },
        rule: 'все зёрна',
        pass: rows.every((r) => r.monotonic === 'да' && r.nan === 'нет' && Number(r.resets) === 1),
      }),
    ),
  );

  // C12: долгая запись — смещение гироскопа медленно гуляет
  {
    const dur = o.full ? 600 : 120;
    out.push(
      multiSeed(
        'C12-long',
        'C12: MAE последней минуты ≤ MAE первой + 0,5°',
        `${dur / 60} мин: подъём вперёд до 120° каждые 10 с, смещение гироскопа — случайное блуждание 0,02 °/с/√с`,
        seeds.slice(0, 2),
        (seed) => {
          const keys: [number, number][] = [[0, 0], [CAL_SEC, 0]];
          for (let t = CAL_SEC + 2; t + 6 < dur; t += 10) keys.push([t, 0], [t + 2, 120], [t + 3, 120], [t + 5, 0]);
          const tr = keyframes(keys);
          const walk = new XRng(seed + 3);
          const bias: Record<string, [number, number, number]> = {};
          // Вызывается на каждом отсчёте 1 кГц: шаг блуждания — σ·√(1 мс)
          const drift = (t: number, place: string): [number, number, number] => {
            if (t < CAL_SEC) return [0, 0, 0];
            const b = (bias[place] ??= [0, 0, 0]);
            const k = 0.02 * Math.sqrt(1 / 1000);
            b[0] += walk.normal(k);
            b[1] += walk.normal(k);
            b[2] += walk.normal(k);
            return b;
          };
          const gen = generate({ durationSec: dur, motion: (t) => armPose(RIGHT, { plane: 0, elevation: tr(t) }), places: placesFor(RIGHT), seed, errors: 'typical', gyroDrift: drift });
          const accCal = calFor(gen, seed + 1000);
          const first = runEngine(gen, { exercise: 'shoulder_flexion', side: RIGHT, truthOf: truthFor('shoulder_flexion', RIGHT), accCal, windows: [[CAL_SEC, CAL_SEC + 60]] });
          const last = runEngine(gen, { exercise: 'shoulder_flexion', side: RIGHT, truthOf: truthFor('shoulder_flexion', RIGHT), accCal, windows: [[dur - 60, dur]] });
          return { row: { seed, maeFirst: r2(first.stats.mae), maeLast: r2(last.stats.mae), growth: r2(last.stats.mae - first.stats.mae), driftEnd: r2(Math.hypot(...(bias.upper_r ?? [0, 0, 0]))) } };
        },
        (rows) => {
          const g = Math.max(...rows.map((r) => Number(r.growth)));
          return { summary: { worstGrowth: g }, rule: 'худшее по зёрнам', pass: g <= 0.5 };
        },
      ),
    );
  }

  // C13: локоть, плечо отклоняется вместе со сгибанием — вперёд, назад, в сторону
  for (const [dir, plane] of [['вперёд', 0], ['назад', 180], ['в сторону', 90]] as const) {
    for (const dev of [5, 10, 15, 20]) {
      out.push(
        multiSeed(
          `C13-elbow-${plane}-${dev}`,
          'C13: ошибка ROM ≤ 5° или шаг помечен',
          `локоть до 120°, плечо ${dir} на ${dev}° вместе со сгибанием; «typical» + 6 положений`,
          seeds,
          (seed) => {
            const elbow = repTrack(120, 1.5, 1, 3);
            const upper = repTrack(dev, 1.5, 1, 3);
            const gen = generate({ durationSec: CAL_SEC + 3 * 5 + 1, motion: (t) => armPose(RIGHT, { plane, elevation: upper(t), elbow: elbow(t) }), places: placesFor(RIGHT), seed, errors: 'typical' });
            const run = runEngine(gen, { exercise: 'elbow_flexion', side: RIGHT, truthOf: truthFor('elbow_flexion', RIGHT), accCal: calFor(gen, seed + 1000) });
            const romErr = run.reps.length ? Math.max(...run.reps.map((r) => Math.abs(r.error))) : NaN;
            return { row: statRow(seed, run.stats, { reps: run.reps.length, worstRomErr: r2(romErr), flagged: run.flags.includes('upper_not_pinned') ? 'да' : 'нет' }) };
          },
          (rows) => {
            const rom = worst(rows, 'worstRomErr');
            const silent = rows.some((r) => Math.abs(Number(r.worstRomErr)) > 5 && r.flagged !== 'да');
            const reps = Math.min(...rows.map((r) => Number(r.reps)));
            return { summary: { worstRomErr: rom, silentOver5: silent ? 'да' : 'нет', minReps: reps }, rule: 'худшее по зёрнам', pass: !silent && reps === 3 && Number.isFinite(rom) };
          },
        ),
      );
    }
  }

  // C13L: левая рука — знак шарнира у неё −Z датчика плеча (pipeline.ts, HINGE_SIGN)
  for (const [dir, plane] of [['вперёд', 0], ['назад', 180], ['в сторону', 90]] as const) {
    out.push(
      multiSeed(
        `C13L-elbow-${plane}-10`,
        'C13: ошибка ROM ≤ 5° или шаг помечен',
        `левая рука: локоть до 120°, плечо ${dir} на 10° вместе со сгибанием`,
        seeds,
        (seed) => {
          const elbow = repTrack(120, 1.5, 1, 3);
          const upper = repTrack(10, 1.5, 1, 3);
          const gen = generate({ durationSec: CAL_SEC + 3 * 5 + 1, motion: (t) => armPose('left', { plane, elevation: upper(t), elbow: elbow(t) }), places: placesFor('left'), seed, errors: 'typical' });
          const run = runEngine(gen, { exercise: 'elbow_flexion', side: 'left', truthOf: truthFor('elbow_flexion', 'left'), accCal: calFor(gen, seed + 1000) });
          const romErr = run.reps.length ? Math.max(...run.reps.map((r) => Math.abs(r.error))) : NaN;
          return { row: statRow(seed, run.stats, { reps: run.reps.length, worstRomErr: r2(romErr), flagged: run.flags.includes('upper_not_pinned') ? 'да' : 'нет' }) };
        },
        (rows) => {
          const rom = worst(rows, 'worstRomErr');
          const silent = rows.some((r) => Math.abs(Number(r.worstRomErr)) > 5 && r.flagged !== 'да');
          const reps = Math.min(...rows.map((r) => Number(r.reps)));
          return { summary: { worstRomErr: rom, silentOver5: silent ? 'да' : 'нет', minReps: reps }, rule: 'худшее по зёрнам', pass: !silent && reps === 3 && Number.isFinite(rom) };
        },
      ),
    );
  }

  // C13x: крайние случаи выбора ветви локтя — описаны в FINDINGS (F1) как места, где гравитации мало
  const elbowCase = (id: string, setup: string, motion: (t: number) => BodyPose, dur: number, extra: Partial<GenSpec> = {}, maxErrLim = 5) =>
    multiSeed(
      id,
      `C13x: максимум ошибки угла ≤ ${maxErrLim}° или шаг помечен`,
      setup,
      seeds,
      (seed) => {
        const gen = generate({ durationSec: dur, motion, places: placesFor(RIGHT), seed, errors: 'typical', ...extra });
        const run = runEngine(gen, { exercise: 'elbow_flexion', side: RIGHT, truthOf: truthFor('elbow_flexion', RIGHT), accCal: calFor(gen, seed + 1000) });
        const romErr = run.reps.length ? Math.max(...run.reps.map((r) => Math.abs(r.error))) : null;
        return { row: statRow(seed, run.stats, { reps: run.reps.length, worstRomErr: romErr === null ? null : r2(romErr), flagged: run.flags.includes('upper_not_pinned') ? 'да' : 'нет' }) };
      },
      (rows) => {
        const mx = worst(rows, 'max');
        const flagged = rows.every((r) => r.flagged === 'да');
        return { summary: { worstMax: mx, worstMae: worst(rows, 'mae'), flaggedAll: flagged ? 'да' : 'нет' }, rule: 'худшее по зёрнам', pass: mx <= maxErrLim || flagged };
      },
    );
  {
    const back = keyframes([[0, 0], [CAL_SEC, 0], [CAL_SEC + 2, 15], [CAL_SEC + 4, 15], [CAL_SEC + 6, 0], [CAL_SEC + 8, 0]]);
    out.push(elbowCase('C13x-straight-shoulder-back', 'локоть прямой, плечо уходит назад на 15° и возвращается', (t) => armPose(RIGHT, { plane: 180, elevation: back(t) }), CAL_SEC + 8));
    const hyper = keyframes([[0, 0], [CAL_SEC, 0], [CAL_SEC + 1.5, -10], [CAL_SEC + 3, -10], [CAL_SEC + 4.5, 0], [CAL_SEC + 6, 0]]);
    out.push({ ...elbowCase('C13x-hyperextension', 'переразгибание локтя до −10°, плечо висит', (t) => armPose(RIGHT, { elbow: hyper(t) }), CAL_SEC + 6), knownLimitation: 'F3' });
    // Плечо назад на 15°, локоть останавливается ровно у вертикали предплечья (15°), затем разгибается
    const sh = keyframes([[0, 0], [CAL_SEC, 0], [CAL_SEC + 1.5, 15], [CAL_SEC + 6, 15], [CAL_SEC + 7.5, 0], [CAL_SEC + 8.5, 0]]);
    const el = keyframes([[0, 0], [CAL_SEC, 0], [CAL_SEC + 1.5, 15], [CAL_SEC + 3.5, 15], [CAL_SEC + 5, 0], [CAL_SEC + 8.5, 0]]);
    out.push(elbowCase('C13x-stop-at-vertical', 'плечо назад 15°, локоть 15° (предплечье на вертикали) стоит 2 с, затем разгибается', (t) => armPose(RIGHT, { plane: 180, elevation: sh(t), elbow: el(t) }), CAL_SEC + 8.5));
    const elbow = repTrack(120, 1.5, 1, 3);
    const pro = repTrack(60, 1.5, 1, 3);
    out.push({ ...elbowCase('C13x-carrying-pronation', 'вальгус 10°, при сгибании предплечье пронируется на 60°', (t) => armPose(RIGHT, { elbow: elbow(t), proSup: -pro(t), carrying: 10 }), CAL_SEC + 16), knownLimitation: 'F4' });
    const upperBack = repTrack(10, 1.5, 1, 3);
    for (const rot of [20, 30]) {
      out.push(
        elbowCase(
          `C13x-strap-rotated-${rot}`,
          `ремешок плеча повёрнут вокруг руки на ${rot}°, плечо назад 10° при сгибании`,
          (t) => armPose(RIGHT, { plane: 180, elevation: upperBack(t), elbow: elbow(t) }),
          CAL_SEC + 16,
          { mountExtra: { upper_r: qAxisDeg([1, 0, 0], rot) } },
        ),
      );
    }
    out.push(elbowCase('C13x-noise3-back10', 'шум × 3, плечо назад 10° при сгибании', (t) => armPose(RIGHT, { plane: 180, elevation: upperBack(t), elbow: elbow(t) }), CAL_SEC + 16, { noise: 3 }));
  }

  // C14: поза калибровки — рука не висит вертикально (контрактура)
  for (const [what, ex, delta] of [
    ['плечо поднято вперёд', 'shoulder_flexion', 10],
    ['плечо поднято вперёд', 'shoulder_flexion', 20],
    ['локоть согнут (контрактура)', 'elbow_flexion', 20],
    ['локоть согнут (контрактура)', 'elbow_flexion', 30],
  ] as const) {
    out.push(
      multiSeed(
        `C14-${ex}-${delta}`,
        'C14: записать ошибку против анатомического угла; если > 5° — нужно предупреждение',
        `${what} на ${delta}° в позе калибровки; движение до 140°`,
        seeds,
        (seed) => {
          const tr = repTrack(140, 1.5, 1, 3, 1, CAL_SEC, delta);
          const motion = (t: number): BodyPose => (ex === 'shoulder_flexion' ? armPose(RIGHT, { plane: 0, elevation: tr(t) }) : armPose(RIGHT, { elbow: tr(t) }));
          const gen = generate({ durationSec: CAL_SEC + 3 * 5 + 1, motion, places: placesFor(RIGHT), seed, errors: 'typical' });
          const run = runEngine(gen, { exercise: ex, side: RIGHT, truthOf: truthFor(ex, RIGHT), accCal: calFor(gen, seed + 1000) });
          const romErr = run.reps.length ? run.reps.map((r) => r.error).reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0) : NaN;
          return { row: { seed, reps: run.reps.length, romErr: r2(romErr), events: run.calibrationAttempts } };
        },
        (rows) => ({ summary: { worstRomErr: worst(rows, 'romErr') }, rule: 'худшее по зёрнам', pass: true, note: 'описательный: прибор меряет дугу от позы калибровки' }),
      ),
    );
  }

  // C15: перекос крепления
  for (const mis of [5, 10]) {
    out.push(staticScenario(`C15-flex-mis${mis}`, 'C15: подъём MAE ≤ 1°', 'shoulder_flexion', RIGHT, 'typical', seeds, { misalignDeg: mis }, 1, Infinity));
    out.push(staticScenario(`C15-elbow-mis${mis}`, 'C15: локоть MAE ≤ 1,5°', 'elbow_flexion', RIGHT, 'typical', seeds, { misalignDeg: mis }, 1.5, Infinity));
    out.push(staticScenario(`C15-rot-mis${mis}`, 'C15: поворот MAE ≤ 3°', 'forearm_rotation', RIGHT, 'typical', seeds, { misalignDeg: mis }, 3, Infinity));
  }

  // C16: наклон туловища назад при подъёме руки
  out.push(
    multiSeed(
      'C16-trunk',
      'C16: наклон туловища с ошибкой ≤ 1,5°',
      'подъём вперёд до 150°, туловище отклоняется назад на 10° вместе с рукой',
      seeds,
      (seed) => {
        const arm = repTrack(150, 2, 1, 3);
        const lean = repTrack(-10, 2, 1, 3);
        const gen = generate({ durationSec: CAL_SEC + 3 * 6 + 1, motion: (t) => armPose(RIGHT, { plane: 0, elevation: arm(t) }, { pitch: lean(t) }), places: placesFor(RIGHT), seed, errors: 'typical' });
        const run = runEngine(gen, { exercise: 'shoulder_flexion', side: RIGHT, truthOf: truthFor('shoulder_flexion', RIGHT), accCal: calFor(gen, seed + 1000) });
        // Прибор меряет подъём в мире: разница с подъёмом относительно туловища — и есть компенсация
        let gap = 0;
        for (let i = 0; i < run.t.length; i++) gap = Math.max(gap, Math.abs((gen.truth[i] as BodyTruth).right.elevationWorld - (gen.truth[i] as BodyTruth).right.elevationThorax));
        return { row: { seed, trunkMae: r2(run.trunkStats.mae), trunkMax: r2(run.trunkStats.max), armMae: r2(run.stats.mae), worldVsThoraxMax: r2(gap) } };
      },
      (rows) => {
        const m = worst(rows, 'trunkMax');
        return { summary: { worstTrunkMax: m, worstTrunkMae: worst(rows, 'trunkMae') }, rule: 'худшее по зёрнам', pass: worst(rows, 'trunkMae') <= 1.5 };
      },
    ),
  );

  // C17: знак супинации на обеих руках
  for (const side of ['right', 'left'] as Side[]) {
    out.push(staticScenario(`C17-rot-${side}`, 'C17: знак верный (MAE ≤ 3°)', 'forearm_rotation', side, 'typical', seeds, {}, 3, Infinity));
  }

  return out;
}

/** Путь USB: кадры → строки imu-csv → ImuCsvParser + SeqUnwrapper, как SerialDevice.readLoop. */
function viaSerial(
  gen: Generated,
  duplicate: () => boolean,
  gapOnReset: (prev: RawFrame | null, cur: RawFrame) => number = () => 1,
): { frames: RawFrame[]; dropped: number; resets: number } {
  const places = Object.keys(gen.frames[0]?.data ?? {}) as Placement[];
  const text = serializeImuCsv({ device: 'NM-01', firmware: '0.1', rateHz: gen.rateHz, accG: 4, gyroDps: 1000, sensors: places, extra: {} }, gen.frames);
  const parser = new ImuCsvParser();
  const unwrap = new SeqUnwrapper();
  const out: RawFrame[] = [];
  let dropped = 0;
  let prevRaw: RawFrame | null = null;
  for (const line of text.split('\n')) {
    const lines = /^\d/.test(line) && duplicate() ? [line, line] : [line];
    for (const l of lines) {
      const r = parser.pushLine(l);
      if (r.kind !== 'frame') continue;
      const ready = unwrap.push(r.frame.seq, r.frame, gapOnReset(prevRaw, r.frame));
      prevRaw = r.frame;
      if (!ready.length && !unwrap.waiting) dropped += 1;
      for (const u of ready) out.push({ ...u.item, seq: u.seq, t: u.seq / gen.rateHz });
    }
  }
  return { frames: out, dropped, resets: unwrap.resets };
}

/**
 * F2: остаток перекрёстной чувствительности датчика после калибровки в 6 положениях (~1°).
 * Критерий C1 (1,0°) с ним выполняется не на каждом датчике; защита — не хуже 1,5° в среднем и 2,5° в отсчёте.
 */
function withF2Guard(r: ScenarioResult): ScenarioResult {
  const mae = Number(r.summary.worstMae);
  const max = Number(r.summary.worstMax);
  return { ...r, knownLimitation: 'F2', guard: { rule: 'худшее MAE ≤ 1,5°, худший отсчёт ≤ 2,5°', ok: mae <= 1.5 && max <= 2.5 } };
}

/** Поворот крепления вокруг оси датчика, градусы. */
function qAxisDeg(axis: V, deg: number): Q {
  return qAxis(axis, deg * RAD);
}

export { errStats };
