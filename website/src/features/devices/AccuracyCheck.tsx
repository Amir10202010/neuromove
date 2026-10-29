// «Проверка точности» на экране «Датчики»: запись станка или добровольца с отметками эталона
// (`# mark seq=… ref=…`) → угол прибора у каждой отметки → ошибка и итог против порога SMART v2.
// Считает `core/validation.ts` — теми же формулами, что живой тест. Запись берётся из файла
// или пишется прямо здесь с подключённых датчиков (вместо record.py из плана лаборатории).
// В пространство пациентов ничего не сохраняется: запись проверки — не сеанс пациента.

import { CircleDot, FileUp, Flag, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EXERCISES, type ExerciseId } from '../../core/exercises';
import { validateRecording, type ReferenceMark, type ValidationResult } from '../../core/validation';
import { downloadText, exportName, stamp } from '../../data/export';
import { accCalFromPassport, accCalToPassport, isSimulatedRecording, parseImuCsv, serializeImuCsv, withMarks } from '../../devices/contract';
import type { AccCalibration } from '../../core/imu';
import { PLACEMENTS, type NeuroMoveDevice, type Placement, type RawFrame, type Side, type Unsubscribe } from '../../devices/types';
import { benchCsv } from '../../simulation/bench';
import { useI18n } from '../../i18n';
import { MAX_RECORDING_MB, readTextFile } from '../../lib/files';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';

/** Порог средней ошибки — критерий SMART v2, записан до первого замера (трекер.md). */
const THRESHOLD_DEG = 5;
/** Поворот предплечья по одной записи не проверить: нужна установка «локоть 90°, нейтраль». */
const CHECKABLE = (Object.keys(EXERCISES) as ExerciseId[]).filter((e) => EXERCISES[e].angle !== 'rotation');

/** Не больше 15 минут на 100 Гц: дольше проверка не идёт, а память вкладки не бесконечна. */
const MAX_FRAMES = 15 * 60 * 100;

interface Loaded {
  name: string;
  frames: readonly RawFrame[];
  marks: readonly ReferenceMark[];
  rateHz: number;
  /** Запись симулятора: проверяются формулы, а не прибор. */
  simulated: boolean;
  /** Поправки акселерометра из паспорта записи — считаем с ними, как живой тест */
  accCal: Partial<Record<Placement, AccCalibration>>;
}

/** Запись отсчётов с подключённого устройства и отметки эталона по нажатию. */
function useBenchRecorder(device: NeuroMoveDevice | null) {
  const frames = useRef<RawFrame[]>([]);
  const marks = useRef<ReferenceMark[]>([]);
  const unsub = useRef<Unsubscribe | null>(null);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState({ frames: 0, marks: 0 });

  // Устройство отключили или ушли со страницы — запись прекращается
  useEffect(() => {
    return () => {
      unsub.current?.();
      unsub.current = null;
      setRecording(false);
    };
  }, [device]);

  // Счётчик на экране — дважды в секунду, а не на каждую пачку отсчётов
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setProgress({ frames: frames.current.length, marks: marks.current.length }), 500);
    return () => clearInterval(id);
  }, [recording]);

  const start = () => {
    if (!device) return;
    frames.current = [];
    marks.current = [];
    setProgress({ frames: 0, marks: 0 });
    unsub.current = device.onData((batch) => {
      if (frames.current.length < MAX_FRAMES) frames.current.push(...batch);
    });
    setRecording(true);
  };

  /** Отметка на последнем пришедшем отсчёте: 'empty' — данных ещё нет, 'full' — запись упёрлась в предел. */
  const mark = (ref: number): 'ok' | 'empty' | 'full' => {
    // После предела отсчёты не пишутся — отметка легла бы на старый отсчёт, а не на этот угол
    if (frames.current.length >= MAX_FRAMES) return 'full';
    const last = frames.current[frames.current.length - 1];
    if (!last) return 'empty';
    marks.current.push({ seq: last.seq, ref });
    setProgress({ frames: frames.current.length, marks: marks.current.length });
    return 'ok';
  };

  const stop = (): { frames: RawFrame[]; marks: ReferenceMark[] } => {
    unsub.current?.();
    unsub.current = null;
    setRecording(false);
    return { frames: frames.current, marks: marks.current };
  };

  return { recording, progress, start, mark, stop };
}

export function AccuracyCheck({ device, streaming }: { device: NeuroMoveDevice | null; streaming: boolean }) {
  const { t, f } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const recorder = useBenchRecorder(device);
  const [refText, setRefText] = useState('0');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [exercise, setExercise] = useState<ExerciseId>('elbow_flexion');
  const [side, setSide] = useState<Side>('right');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    // Новый файл заменяет прежний целиком: при ошибке «Посчитать» не должен считать старую запись
    setResult(null);
    setLoaded(null);
    const text = await readTextFile(file, MAX_RECORDING_MB);
    if (text === null) return setError(t('device.fileTooLarge', { mb: MAX_RECORDING_MB }));
    const parsed = parseImuCsv(text);
    if (!parsed.frames.length) return setError(t('device.replayError'));
    if (!parsed.marks.length) return setError(t('accuracy.noMarks'));
    setError(null);
    // Движение и сторону пишет в паспорт программа записи (софт.md, «Паспорт записи»)
    const ex = parsed.passport.extra.exercise;
    if (ex && CHECKABLE.includes(ex as ExerciseId)) setExercise(ex as ExerciseId);
    const sd = parsed.passport.extra.side;
    if (sd === 'left' || sd === 'right') setSide(sd);
    setLoaded({
      name: file.name,
      frames: parsed.frames,
      marks: parsed.marks,
      rateHz: parsed.passport.rateHz,
      simulated: isSimulatedRecording(parsed.passport),
      accCal: accCalFromPassport(parsed.passport.extra),
    });
  };

  const placeMark = () => {
    const ref = Number(refText.replace(',', '.'));
    if (!refText.trim() || !Number.isFinite(ref) || ref < -180 || ref > 180) return setError(t('accuracy.rec.badRef'));
    const r = recorder.mark(ref);
    setError(r === 'ok' ? null : r === 'full' ? t('accuracy.rec.full') : t('accuracy.rec.empty'));
  };

  const stopRecording = () => {
    const rec = recorder.stop();
    if (!device || !rec.frames.length) return setError(t('accuracy.rec.empty'));
    const info = device.getStatus().info;
    const rateHz = info?.rateHz ?? 100;
    const simulated = info?.simulated ?? device.kind === 'simulator';
    const present = new Set(rec.frames.flatMap((fr) => Object.keys(fr.data)));
    const csv = withMarks(
      serializeImuCsv(
        {
          device: (info?.id ?? 'NM').replace(/\s+/g, '_'),
          firmware: info?.firmware ?? '–',
          rateHz,
          accG: info?.accRangeG ?? 4,
          gyroDps: info?.gyroRangeDps ?? 1000,
          sensors: PLACEMENTS.filter((p) => present.has(p)),
          extra: { kind: 'bench', exercise, side, date: new Date().toISOString(), ...(simulated ? { demo: 'yes' } : {}), ...accCalToPassport(info?.accCal) },
        },
        rec.frames,
      ),
      rec.marks,
    );
    // Файл — сразу на диск: это сырые данные проверки, их хранят как есть (правило проекта)
    const name = exportName(simulated, ['bench', exercise, side, stamp()], 'csv');
    downloadText(name, csv, 'text/csv;charset=utf-8');
    setResult(null);
    setLoaded(null);
    if (!rec.marks.length) return setError(t('accuracy.noMarks'));
    setError(null);
    setLoaded({ name, frames: rec.frames, marks: rec.marks, rateHz, simulated, accCal: info?.accCal ?? {} });
  };

  /** Запись станка на симуляторе — показать метод за один клик. Подписана: проверены формулы, а не прибор. */
  const loadExample = () => {
    const ex = exercise === 'elbow_flexion' || exercise === 'shoulder_abduction' ? exercise : 'shoulder_flexion';
    const parsed = parseImuCsv(benchCsv(ex, side));
    setResult(null);
    setError(null);
    setLoaded({ name: t('accuracy.exampleName'), frames: parsed.frames, marks: parsed.marks, rateHz: parsed.passport.rateHz, simulated: true, accCal: {} });
  };

  const run = () => {
    if (!loaded) return;
    setResult(
      validateRecording({ frames: loaded.frames, marks: loaded.marks, rateHz: loaded.rateHz, exercise, side, thresholdDeg: THRESHOLD_DEG, accCal: loaded.accCal }),
    );
  };

  const deg = (x: number | null) => (x === null ? '–' : `${f.num(x, 1)}°`);

  return (
    <section className="card" aria-labelledby="acc-title">
      <div className="card__header">
        <div>
          <h2 id="acc-title" className="card__title">
            {t('accuracy.title')}
          </h2>
          <div className="card__subtitle">{t('accuracy.subtitle', { threshold: THRESHOLD_DEG })}</div>
        </div>
      </div>
      <div className="card__body stack">
        <p className="secondary">{t('accuracy.text')}</p>
        <div className="row row--wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv,text/plain"
            hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button icon={<FileUp />} onClick={() => input.current?.click()}>
            {t('accuracy.pick')}
          </Button>
          <Field label={t('accuracy.exercise')}>
            <select
              className="select"
              value={exercise}
              onChange={(e) => {
                setExercise(e.target.value as ExerciseId);
                setResult(null); // итог относился к другому движению
              }}
            >
              {CHECKABLE.map((e) => (
                <option key={e} value={e}>
                  {t(`exercise.${e}.name`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('accuracy.side')}>
            <select
              className="select"
              value={side}
              onChange={(e) => {
                setSide(e.target.value as Side);
                setResult(null);
              }}
            >
              <option value="right">{t('side.rightArm')}</option>
              <option value="left">{t('side.leftArm')}</option>
            </select>
          </Field>
          <Button variant="primary" onClick={run} disabled={!loaded}>
            {t('accuracy.run')}
          </Button>
          <Button variant="ghost" onClick={loadExample}>
            {t('accuracy.example')}
          </Button>
        </div>
        {loaded && !error && <span className="field__hint">{t('accuracy.loaded', { name: loaded.name, marks: loaded.marks.length })}</span>}
        {error && (
          <span className="field__error" role="alert">
            {error}
          </span>
        )}

        <div className="acc-rec stack" style={{ gap: 10 }}>
          <h3 className="card__title" style={{ fontSize: 'var(--fs-md)' }}>
            {t('accuracy.rec.title')}
          </h3>
          <p className="secondary">{t('accuracy.rec.text')}</p>
          {!device || (!streaming && !recorder.recording) ? (
            <span className="field__hint">{t('accuracy.rec.needDevice')}</span>
          ) : !recorder.recording ? (
            <div>
              <Button icon={<CircleDot />} onClick={recorder.start}>
                {t('accuracy.rec.start')}
              </Button>
            </div>
          ) : (
            <div className="row row--wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
              <Field label={t('accuracy.rec.ref')}>
                <input
                  className="input"
                  inputMode="decimal"
                  value={refText}
                  style={{ width: 110 }}
                  onChange={(e) => setRefText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && placeMark()}
                />
              </Field>
              <Button variant="primary" icon={<Flag />} onClick={placeMark}>
                {t('accuracy.rec.mark')}
              </Button>
              <Button variant="danger" icon={<Square />} onClick={stopRecording}>
                {t('accuracy.rec.stop')}
              </Button>
              <span className="secondary num" aria-live="polite">
                {t('accuracy.rec.status', { time: f.num(recorder.progress.frames / (device.getStatus().info?.rateHz ?? 100), 0), marks: recorder.progress.marks })}
              </span>
            </div>
          )}
        </div>

        {result && result.problem && (
          <p className="field__error" role="alert">
            {t(`accuracy.problem.${result.problem}`)}
          </p>
        )}

        {result && !result.problem && (
          <div className="stack" style={{ gap: 12 }} aria-live="polite">
            <div className="row row--wrap" style={{ gap: 8 }}>
              <span className={`badge ${result.passed ? 'badge--good' : 'badge--critical'}`}>
                {result.passed ? t('accuracy.passed', { threshold: THRESHOLD_DEG }) : t('accuracy.failed', { threshold: THRESHOLD_DEG })}
              </span>
              <span className="badge">{t('accuracy.mae', { value: deg(result.mae) })}</span>
              <span className="badge">{t('accuracy.max', { value: deg(result.maxAbs) })}</span>
              <span className="badge">{t('accuracy.bias', { value: deg(result.bias) })}</span>
              {result.limits && <span className="badge">{t('accuracy.limits', { low: deg(result.limits[0]), high: deg(result.limits[1]) })}</span>}
              {loaded?.simulated && <span className="badge badge--demo">{t('accuracy.simulated')}</span>}
              {loaded && !loaded.simulated && (
                <span className="badge">{Object.keys(loaded.accCal).length ? t('accuracy.withCal') : t('accuracy.noCal')}</span>
              )}
            </div>
            <div className="table-wrap">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th>{t('accuracy.col.mark')}</th>
                    <th>{t('accuracy.col.ref')}</th>
                    <th>{t('accuracy.col.measured')}</th>
                    <th>{t('accuracy.col.error')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.marks.map((m, i) => (
                    <tr key={`${m.seq}-${i}`}>
                      <td className="num">{f.num(m.seq / loaded!.rateHz, 1)} {t('accuracy.sec')}</td>
                      <td className="num">{deg(m.ref)}</td>
                      <td className="num">{deg(m.measured)}</td>
                      <td className="num">{deg(m.error)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
              {t('accuracy.note')}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
