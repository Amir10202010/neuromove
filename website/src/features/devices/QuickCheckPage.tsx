// Быстрая проверка с угломером — всё на одной странице, без пациентов и сеансов.
// 1) подключить стенд по USB (прошивка imu-csv v1, хватает двух датчиков: плечо и предплечье);
// 2) поставить ноль — рука вдоль тела, 3 с неподвижно;
// 3) выставить угол, прочитать угломер, ввести число → прибор берёт медиану за последнюю секунду,
//    строка с ошибкой сразу появляется в таблице, итог и формулы — под ней.
// Углы считает тот же код, что живой тест (core/pipeline.ts). Замеры хранятся в этом браузере
// (localStorage), сырой поток можно скачать с отметками `# mark seq=… ref=…` — его же читает
// «Проверка точности» на странице «Датчики».

import { CircleAlert, Download, FlaskConical, RotateCcw, Trash2, Usb } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { EXERCISES, type ExerciseId } from '../../core/exercises';
import {
  GONIO_STEADY_SD,
  GONIO_THRESHOLD_DEG,
  GONIO_WINDOW_SEC,
  captureWindow,
  rowError,
  summarizeGonio,
  type GonioRow,
} from '../../core/goniometerCheck';
import {
  Calibrator,
  MotionPipeline,
  exerciseSample,
  missingSensors,
  newElbowTrack,
  referenceFrom,
  type AngleReference,
  type ElbowTrack,
} from '../../core/pipeline';
import { accCalToPassport, serializeImuCsv, withMarks } from '../../devices/contract';
import { SerialDevice, isWebSerialSupported } from '../../devices/SerialDevice';
import { SimulatorDevice } from '../../devices/SimulatorDevice';
import { PLACEMENTS, emptyStatus, type DeviceStatus, type NeuroMoveDevice, type Placement, type RawFrame, type Side } from '../../devices/types';
import { downloadText, stamp } from '../../data/export';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { buildProfile } from '../../simulation/profiles';
import { useAppStore } from '../../state/appStore';
import { Button } from '../../ui/Button';
import '../../styles/quickcheck.css';

const MOVES: ExerciseId[] = ['elbow_flexion', 'shoulder_flexion', 'shoulder_abduction'];
const STORE_KEY = 'nm.quickcheck.v1';
/** Сырой поток держим не дольше 20 минут на 100 Гц. */
const MAX_FRAMES = 20 * 60 * 100;
const EMPTY: DeviceStatus = emptyStatus();

interface Row extends GonioRow {
  id: number;
  move: ExerciseId;
  seq: number;
  at: string;
}

// ── Тексты: ключ — русский, английский перевод рядом; казахский пока = русский ──
const EN: Record<string, string> = {
  'Проверка с угломером': 'Goniometer check',
  'Подключили — поставили ноль — сравнили с угломером. Всё на этой странице.': 'Connect, set zero, compare with a goniometer. Everything on this page.',
  '1. Подключение': '1. Connect',
  'Стенд по USB': 'Stand over USB',
  'Симулятор (ДЕМО)': 'Simulator (DEMO)',
  'Отключить': 'Disconnect',
  'Прошивка с 8 ноября, два датчика: плечо — SDA D23, SCL D22; предплечье — SDA D21, SCL D19; питание 3V3 и GND. Туловище не нужно.':
    'Firmware since 8 Nov, two sensors: upper arm — SDA D23, SCL D22; forearm — SDA D21, SCL D19; power 3V3 and GND. No trunk sensor needed.',
  'Нет связи': 'Not connected',
  'Подключение…': 'Connecting…',
  'Данные идут': 'Streaming',
  'Переподключение…': 'Reconnecting…',
  'Ошибка': 'Error',
  'Этот браузер не умеет USB (Web Serial). Откройте в Chrome или Edge на компьютере.': 'This browser has no Web Serial. Use Chrome or Edge on a computer.',
  'Движение': 'Movement',
  'Сгибание в локте': 'Elbow flexion',
  'Плечо вперёд': 'Shoulder flexion',
  'Плечо в сторону': 'Shoulder abduction',
  'Рука': 'Arm',
  'правая': 'right',
  'левая': 'left',
  'Нет датчика: {list}. Для этого движения нужен.': 'Missing sensor: {list}. This movement needs it.',
  '2. Ноль': '2. Zero',
  'Рука свободно вдоль тела, ладонь к бедру, не двигаться 3 секунды.': 'Arm hanging along the body, palm to thigh, keep still for 3 seconds.',
  'Поставить ноль': 'Set zero',
  'Ноль заново': 'Zero again',
  'Держите неподвижно…': 'Hold still…',
  'Было движение — начинаем отсчёт заново.': 'Movement detected — restarting.',
  'Ноль стоит.': 'Zero is set.',
  '3. Замеры': '3. Measurements',
  'Прибор сейчас': 'Device now',
  'стоит': 'steady',
  'двигается': 'moving',
  'Угломер, °': 'Goniometer, °',
  'Записать': 'Record',
  'Выставьте угол, подержите 1–2 с, введите число с угломера и нажмите Enter.': 'Set the angle, hold 1–2 s, type the goniometer reading and press Enter.',
  'Сначала поставьте ноль.': 'Set zero first.',
  'Введите угол угломера числом от −30 до 200.': 'Enter the goniometer angle as a number from −30 to 200.',
  'Угла прибора нет — проверьте датчики.': 'No device angle — check the sensors.',
  'Рука двигалась (разброс {sd}°) — замер записан, но помечен.': 'The arm moved (spread {sd}°) — recorded but flagged.',
  'Угломер': 'Goniometer',
  'Прибор': 'Device',
  'Ошибка, прибор − угломер': 'Error, device − goniometer',
  'Разброс за 1 с': 'Spread over 1 s',
  'Пока замеров нет. Рекомендуемые углы: 0, 30, 60, 90, 120° — каждый 2–3 раза.': 'No measurements yet. Suggested angles: 0, 30, 60, 90, 120° — each 2–3 times.',
  'Итог': 'Summary',
  'Замеров': 'Measurements',
  'Средняя абсолютная ошибка (MAE)': 'Mean absolute error (MAE)',
  'Систематическая ошибка (bias)': 'Systematic error (bias)',
  'Среднеквадратичная (RMSE)': 'Root mean square (RMSE)',
  'Наибольшая |ошибка|': 'Largest |error|',
  'Разброс ошибок (SD)': 'Error spread (SD)',
  'Пределы согласия 95 %': '95 % limits of agreement',
  'Проходит: MAE ≤ {t}°': 'Pass: MAE ≤ {t}°',
  'Не проходит: MAE > {t}°': 'Fail: MAE > {t}°',
  'Формулы': 'Formulas',
  'Скачать таблицу CSV': 'Download table CSV',
  'Скачать сырую запись': 'Download raw recording',
  'Очистить замеры': 'Clear measurements',
  'Удалить': 'Delete',
  'нужно 3 замера': 'needs 3',
  'ошибка замера': 'error of one measurement',
  'систематическая: прибор в среднем завышает (+) или занижает (−)': 'systematic: device reads high (+) or low (−) on average',
  'главный итог, сравнивается с порогом 5°': 'main result, compared with the 5° threshold',
  'чувствительна к редким большим промахам': 'sensitive to rare large misses',
  'разброс ошибок вокруг bias': 'spread of errors around bias',
  'Бланд — Альтман: 95 % будущих замеров попадут в этот коридор': 'Bland–Altman: 95 % of future readings fall in this band',
  'Угломер сам ошибается на 2–5°, поэтому итог — это согласие двух приборов, а не точность одного.': 'A goniometer itself is off by 2–5°, so the result is agreement between two instruments, not the accuracy of one.',
  'Данные симулятора — проверены формулы, а не железо.': 'Simulator data — this checks the formulas, not the hardware.',
  'плечо': 'upper arm',
  'предплечье': 'forearm',
  'туловище': 'trunk',
};

function useTx() {
  const locale = useAppStore((s) => s.settings.locale);
  return useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const s = locale === 'en' ? EN[key] ?? key : key;
      return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
    },
    [locale],
  );
}

const MOVE_LABEL: Record<ExerciseId, string> = {
  elbow_flexion: 'Сгибание в локте',
  shoulder_flexion: 'Плечо вперёд',
  shoulder_abduction: 'Плечо в сторону',
  forearm_rotation: 'Поворот предплечья',
};
const PLACE_LABEL: Record<Placement, string> = { trunk: 'туловище', upper_l: 'плечо', upper_r: 'плечо', fore_l: 'предплечье', fore_r: 'предплечье' };

function loadRows(): Row[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as Row[]).filter((r) => Number.isFinite(r.gonio) && Number.isFinite(r.device)) : [];
  } catch {
    return [];
  }
}
function saveRows(rows: Row[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(rows));
  } catch {
    // приватное окно или хранилище запрещено — замеры живут до закрытия вкладки
  }
}

function sideOf(placements: readonly Placement[]): Side {
  return placements.some((p) => p === 'upper_l' || p === 'fore_l') && !placements.some((p) => p === 'upper_r' || p === 'fore_r') ? 'left' : 'right';
}

type CalState = 'none' | 'running' | 'moved' | 'done';

/** Поток устройства → углы: калибровка, текущий угол, окно последней секунды, сырые кадры. */
class Engine {
  pipe = new MotionPipeline();
  cal: Calibrator | null = null;
  ref: AngleReference | null = null;
  track: ElbowTrack = newElbowTrack();
  calState: CalState = 'none';
  calProgress = 0;
  move: ExerciseId = 'elbow_flexion';
  side: Side = 'right';
  /** Углы прибора с временем кадра: окно для замера и для «стоит/двигается». */
  recent: { t: number; seq: number; angle: number }[] = [];
  frames: RawFrame[] = [];
  lastT = 0;
  lastSeq = 0;

  constructor(private readonly device: NeuroMoveDevice) {}

  startCal(): void {
    const accCal = this.device.getStatus().info?.accCal ?? {};
    this.pipe.setAccCal(accCal);
    this.cal = new Calibrator(3).withAccCal(accCal);
    this.calState = 'running';
    this.calProgress = 0;
    this.ref = null;
    this.recent = [];
    this.track = newElbowTrack();
  }

  setMove(m: ExerciseId): void {
    this.move = m;
    this.track = newElbowTrack();
    this.recent = [];
  }

  push(frames: readonly RawFrame[]): void {
    const rate = this.device.getStatus().info?.rateHz ?? 100;
    for (const f of frames) {
      if (this.frames.length < MAX_FRAMES) this.frames.push(f);
      this.pipe.process(f, rate);
      this.lastT = f.t;
      this.lastSeq = f.seq;
      if (this.cal) {
        const r = this.cal.push(f);
        this.calProgress = this.cal.progress;
        if (r === 'moved') {
          this.calState = 'moved';
          this.cal = new Calibrator(3).withAccCal(this.device.getStatus().info?.accCal ?? {});
        } else if (r === 'done') {
          const res = this.cal.result();
          this.pipe.setBias(res.bias);
          this.pipe.seedUp(res.up);
          this.ref = referenceFrom(res);
          this.cal = null;
          this.calState = 'done';
        } else if (this.calState === 'moved' && this.cal.progress > 0.3) {
          this.calState = 'running';
        }
        continue;
      }
      if (!this.ref) continue;
      const s = exerciseSample(EXERCISES[this.move], this.side, this.pipe, this.ref, 0, this.track);
      if (!s) continue;
      this.recent.push({ t: f.t, seq: f.seq, angle: s.angle });
    }
    const cut = this.lastT - 3;
    if (this.recent.length && (this.recent[0]?.t ?? 0) < cut) this.recent = this.recent.filter((r) => r.t >= cut);
  }

  window(sec: number): { angles: number[]; seq: number } {
    const from = this.lastT - sec;
    const w = this.recent.filter((r) => r.t >= from);
    return { angles: w.map((r) => r.angle), seq: w[w.length - 1]?.seq ?? this.lastSeq };
  }

  missing(): Placement[] {
    if (!this.ref) return [];
    return missingSensors(EXERCISES[this.move], this.side, this.pipe, this.ref, this.lastT);
  }
}

export function QuickCheckPage() {
  const tx = useTx();
  const { f } = useI18n();
  const [device, setDevice] = useState<NeuroMoveDevice | null>(null);
  const engine = useRef<Engine | null>(null);
  const [move, setMove] = useState<ExerciseId>('elbow_flexion');
  const [rows, setRows] = useState<Row[]>(loadRows);
  const [gonioText, setGonioText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'warn'; text: string } | null>(null);
  const [live, setLive] = useState<{ angle: number | null; spread: number | null; cal: CalState; progress: number; missing: Placement[] }>({
    angle: null,
    spread: null,
    cal: 'none',
    progress: 0,
    missing: [],
  });
  const input = useRef<HTMLInputElement>(null);

  const subscribe = useCallback((cb: () => void) => (device ? device.onStatus(() => cb()) : () => undefined), [device]);
  const status = useSyncExternalStore(subscribe, () => device?.getStatus() ?? EMPTY);
  const placements = status.info?.placements ?? [];
  const side = sideOf(placements);
  const simulated = status.info?.simulated ?? device?.kind === 'simulator';

  useEffect(() => saveRows(rows), [rows]);

  // Поток → движок; данные начинают приниматься, как только устройство подключилось
  useEffect(() => {
    if (!device) return;
    const eng = new Engine(device);
    eng.setMove(move);
    engine.current = eng;
    const unS = device.onStatus((s) => {
      if (s.phase === 'connected') void device.start();
    });
    const unD = device.onData((fr) => eng.push(fr));
    const timer = setInterval(() => {
      const w = eng.window(0.3);
      const w1 = eng.window(GONIO_WINDOW_SEC);
      const c = captureWindow(w1.angles);
      setLive({
        angle: w.angles.length ? captureWindow(w.angles)?.device ?? null : null,
        spread: c?.spread ?? null,
        cal: eng.calState,
        progress: eng.calProgress,
        missing: eng.missing(),
      });
    }, 100);
    return () => {
      unS();
      unD();
      clearInterval(timer);
      engine.current = null;
      void device.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- движение передаётся в движок отдельно
  }, [device]);

  useEffect(() => {
    engine.current?.setMove(move);
  }, [move]);
  useEffect(() => {
    if (engine.current) engine.current.side = side;
  }, [side]);

  const connect = async (kind: 'usb' | 'simulator') => {
    setMsg(null);
    const d =
      kind === 'usb'
        ? new SerialDevice()
        : new SimulatorDevice({ seed: Date.now() >>> 0, profile: buildProfile({ left: 0.05, right: 0.05 }) });
    if (d instanceof SimulatorDevice) d.instruct({ kind: 'hold_still' });
    setDevice(d);
    await d.connect();
  };

  const calibrate = () => {
    const eng = engine.current;
    if (!eng) return;
    eng.side = side;
    eng.startCal();
    if (device instanceof SimulatorDevice) {
      device.instruct({ kind: 'hold_still' });
      // Симулятор после нуля медленно двигает руку, чтобы было что мерить
      setTimeout(() => device.instruct({ kind: 'exercise', exercise: move, side }), 3500);
    }
  };

  const record = () => {
    const eng = engine.current;
    if (!eng || !eng.ref) return setMsg({ kind: 'error', text: tx('Сначала поставьте ноль.') });
    const g = Number(gonioText.replace(',', '.').replace('−', '-'));
    if (!gonioText.trim() || !Number.isFinite(g) || g < -30 || g > 200) return setMsg({ kind: 'error', text: tx('Введите угол угломера числом от −30 до 200.') });
    const w = eng.window(GONIO_WINDOW_SEC);
    const c = captureWindow(w.angles);
    if (!c) return setMsg({ kind: 'error', text: tx('Угла прибора нет — проверьте датчики.') });
    const row: Row = { id: Date.now(), move, gonio: g, device: c.device, spread: c.spread, seq: w.seq, at: new Date().toISOString() };
    setRows((rs) => [...rs, row]);
    setMsg(c.spread > GONIO_STEADY_SD ? { kind: 'warn', text: tx('Рука двигалась (разброс {sd}°) — замер записан, но помечен.', { sd: f.num(c.spread, 1) }) } : null);
    setGonioText('');
    input.current?.focus();
  };

  const shown = rows.filter((r) => r.move === move);
  const sum = summarizeGonio(shown);
  const deg = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? '–' : `${f.num(x, d)}°`);
  const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${f.num(Math.abs(x), 1)}°`;

  const downloadTable = () => {
    const head = 'n,movement,side,goniometer_deg,device_deg,error_deg,abs_error_deg,spread_1s_deg,seq,time';
    const lines = shown.map((r, i) =>
      [i + 1, r.move, side, r.gonio, r.device.toFixed(2), rowError(r).toFixed(2), Math.abs(rowError(r)).toFixed(2), r.spread.toFixed(2), r.seq, r.at].join(','),
    );
    const s = sum;
    const foot = [
      '',
      `# n=${s.n}`,
      `# mae_deg=${s.mae?.toFixed(2) ?? ''} bias_deg=${s.bias?.toFixed(2) ?? ''} rmse_deg=${s.rmse?.toFixed(2) ?? ''} max_abs_deg=${s.maxAbs?.toFixed(2) ?? ''} sd_deg=${s.sd?.toFixed(2) ?? ''}`,
      `# loa_deg=${s.limits ? `${s.limits[0].toFixed(2)};${s.limits[1].toFixed(2)}` : ''} threshold_deg=${GONIO_THRESHOLD_DEG} passed=${s.passed ?? ''}${simulated ? ' demo=yes' : ''}`,
    ];
    downloadText(`neuromove-${simulated ? 'DEMO-' : ''}goniometer-${move}-${stamp()}.csv`, [head, ...lines, ...foot].join('\n'), 'text/csv;charset=utf-8');
  };

  const downloadRaw = () => {
    const eng = engine.current;
    if (!eng || !eng.frames.length) return;
    const info = device?.getStatus().info;
    const present = new Set(eng.frames.flatMap((fr) => Object.keys(fr.data)));
    const csv = withMarks(
      serializeImuCsv(
        {
          device: (info?.id ?? 'NM').replace(/\s+/g, '_'),
          firmware: info?.firmware ?? '–',
          rateHz: info?.rateHz ?? 100,
          accG: info?.accRangeG ?? 4,
          gyroDps: info?.gyroRangeDps ?? 1000,
          sensors: PLACEMENTS.filter((p) => present.has(p)),
          extra: { kind: 'bench', exercise: move, side, date: new Date().toISOString(), ...(simulated ? { demo: 'yes' } : {}), ...accCalToPassport(info?.accCal) },
        },
        eng.frames,
      ),
      shown.map((r) => ({ seq: r.seq, ref: r.gonio })),
    );
    downloadText(`neuromove-${simulated ? 'DEMO-' : ''}bench-${move}-${side}-${stamp()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const phase = status.phase;
  const phaseText =
    phase === 'streaming' || phase === 'connected'
      ? tx('Данные идут')
      : phase === 'connecting' || phase === 'requesting' || phase === 'searching'
        ? tx('Подключение…')
        : phase === 'reconnecting'
          ? tx('Переподключение…')
          : phase === 'error'
            ? tx('Ошибка')
            : tx('Нет связи');
  const connected = phase === 'streaming' || phase === 'connected';
  const steady = live.spread !== null && live.spread <= GONIO_STEADY_SD;
  const ready = live.cal === 'done';

  return (
    <div className="page qc">
      <PageHeader title={tx('Проверка с угломером')} lead={tx('Подключили — поставили ноль — сравнили с угломером. Всё на этой странице.')} />

      <div className="qc-steps">
        {/* 1. Подключение */}
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{tx('1. Подключение')}</h2>
            <span className={`badge ${connected ? 'badge--good' : phase === 'error' ? 'badge--critical' : ''}`}>{phaseText}</span>
          </div>
          <div className="card__body stack">
            {!device || phase === 'idle' || phase === 'error' ? (
              <div className="row row--wrap" style={{ gap: 8 }}>
                <Button variant="primary" icon={<Usb />} onClick={() => void connect('usb')} disabled={!isWebSerialSupported()}>
                  {tx('Стенд по USB')}
                </Button>
                <Button variant="ghost" icon={<FlaskConical />} onClick={() => void connect('simulator')}>
                  {tx('Симулятор (ДЕМО)')}
                </Button>
              </div>
            ) : (
              <div className="row row--wrap" style={{ gap: 8 }}>
                <Button size="sm" onClick={() => setDevice(null)}>
                  {tx('Отключить')}
                </Button>
                {status.info && (
                  <span className="muted mono" style={{ fontSize: 'var(--fs-xs)' }}>
                    {status.info.id} · fw {status.info.firmware} · {status.info.rateHz} Hz
                  </span>
                )}
              </div>
            )}
            <p className="field__hint">{tx('Прошивка с 8 ноября, два датчика: плечо — SDA D23, SCL D22; предплечье — SDA D21, SCL D19; питание 3V3 и GND. Туловище не нужно.')}</p>
            {!isWebSerialSupported() && <p className="field__hint">{tx('Этот браузер не умеет USB (Web Serial). Откройте в Chrome или Edge на компьютере.')}</p>}
            {status.error && (
              <div className="callout callout--critical" role="alert">
                <CircleAlert aria-hidden />
                <span>{status.error.message}</span>
              </div>
            )}
            {status.sensors.length > 0 && (
              <ul className="qc-sensors">
                {status.sensors.map((s) => (
                  <li key={s.placement}>
                    <span className={`dot ${s.online ? 'dot--good' : ''}`} aria-hidden /> {tx(PLACE_LABEL[s.placement])} <span className="mono muted">{s.placement}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="row row--wrap" style={{ gap: 12 }}>
              <label className="field">
                <span className="field__label">{tx('Движение')}</span>
                <select className="select" value={move} onChange={(e) => setMove(e.target.value as ExerciseId)}>
                  {MOVES.map((m) => (
                    <option key={m} value={m}>
                      {tx(MOVE_LABEL[m])}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span className="field__label">{tx('Рука')}</span>
                <span className="qc-side">{tx(side === 'right' ? 'правая' : 'левая')}</span>
              </div>
            </div>
            {live.missing.length > 0 && (
              <div className="callout callout--warn" role="alert">
                <CircleAlert aria-hidden />
                <span>{tx('Нет датчика: {list}. Для этого движения нужен.', { list: live.missing.map((p) => tx(PLACE_LABEL[p])).join(', ') })}</span>
              </div>
            )}
            {simulated && device && <p className="field__hint">{tx('Данные симулятора — проверены формулы, а не железо.')}</p>}
          </div>
        </section>

        {/* 2. Ноль */}
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{tx('2. Ноль')}</h2>
            {ready && <span className="badge badge--good">{tx('Ноль стоит.')}</span>}
          </div>
          <div className="card__body stack">
            <p className="secondary">{tx('Рука свободно вдоль тела, ладонь к бедру, не двигаться 3 секунды.')}</p>
            <div className="row" style={{ gap: 12 }}>
              <Button variant={ready ? 'secondary' : 'primary'} icon={<RotateCcw />} onClick={calibrate} disabled={!connected || live.cal === 'running'}>
                {ready ? tx('Ноль заново') : tx('Поставить ноль')}
              </Button>
              {(live.cal === 'running' || live.cal === 'moved') && (
                <div className="qc-progress" aria-label={tx('Держите неподвижно…')}>
                  <div className="qc-progress__fill" style={{ width: `${Math.round(live.progress * 100)}%` }} />
                </div>
              )}
            </div>
            {live.cal === 'running' && <span className="field__hint">{tx('Держите неподвижно…')}</span>}
            {live.cal === 'moved' && <span className="field__error">{tx('Было движение — начинаем отсчёт заново.')}</span>}
          </div>
        </section>
      </div>

      {/* 3. Замеры */}
      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{tx('3. Замеры')}</h2>
        </div>
        <div className="card__body stack">
          <div className="qc-measure">
            <div className="qc-live">
              <span className="qc-live__label">{tx('Прибор сейчас')}</span>
              <span className="qc-live__value num" aria-live="off">
                {ready && live.angle !== null ? `${f.num(live.angle, 1)}°` : '–'}
              </span>
              {ready && live.spread !== null && (
                <span className={`badge ${steady ? 'badge--good' : 'badge--warn'}`}>
                  {tx(steady ? 'стоит' : 'двигается')} · ±{f.num(live.spread, 1)}°
                </span>
              )}
            </div>
            <form
              className="qc-entry"
              onSubmit={(e) => {
                e.preventDefault();
                record();
              }}
            >
              <label className="field">
                <span className="field__label">{tx('Угломер, °')}</span>
                <input
                  ref={input}
                  className="input qc-entry__input num"
                  inputMode="decimal"
                  value={gonioText}
                  onChange={(e) => setGonioText(e.target.value)}
                  placeholder="90"
                  disabled={!ready}
                />
              </label>
              <Button variant="primary" type="submit" disabled={!ready}>
                {tx('Записать')}
              </Button>
            </form>
          </div>
          <p className="field__hint">{ready ? tx('Выставьте угол, подержите 1–2 с, введите число с угломера и нажмите Enter.') : tx('Сначала поставьте ноль.')}</p>
          {msg && (
            <span className={msg.kind === 'error' ? 'field__error' : 'qc-warn'} role="alert">
              {msg.text}
            </span>
          )}

          <div className="table-wrap">
            <table className="table table--compact qc-table">
              <thead>
                <tr>
                  <th className="num">№</th>
                  <th className="num">{tx('Угломер')}</th>
                  <th className="num">{tx('Прибор')}</th>
                  <th className="num">{tx('Ошибка, прибор − угломер')}</th>
                  <th className="num">{tx('Разброс за 1 с')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      {tx('Пока замеров нет. Рекомендуемые углы: 0, 30, 60, 90, 120° — каждый 2–3 раза.')}
                    </td>
                  </tr>
                ) : (
                  shown.map((r, i) => {
                    const e = rowError(r);
                    return (
                      <tr key={r.id}>
                        <td className="num">{i + 1}</td>
                        <td className="num">{deg(r.gonio)}</td>
                        <td className="num">{deg(r.device)}</td>
                        <td className={`num ${Math.abs(e) > GONIO_THRESHOLD_DEG ? 'qc-bad' : ''}`}>{signed(e)}</td>
                        <td className={`num ${r.spread > GONIO_STEADY_SD ? 'qc-bad' : 'muted'}`}>±{f.num(r.spread, 1)}°</td>
                        <td>
                          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tx('Удалить')} title={tx('Удалить')} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="qc-steps">
        {/* Итог */}
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{tx('Итог')}</h2>
            {sum.passed !== null && (
              <span className={`badge ${sum.passed ? 'badge--good' : 'badge--critical'}`}>
                {tx(sum.passed ? 'Проходит: MAE ≤ {t}°' : 'Не проходит: MAE > {t}°', { t: GONIO_THRESHOLD_DEG })}
              </span>
            )}
          </div>
          <div className="card__body stack">
            <dl className="kv kv--wide qc-kv">
              <dt>{tx('Замеров')}</dt>
              <dd className="num">{sum.n}</dd>
              <dt>{tx('Средняя абсолютная ошибка (MAE)')}</dt>
              <dd className="num qc-main">{deg(sum.mae)}</dd>
              <dt>{tx('Систематическая ошибка (bias)')}</dt>
              <dd className="num">{sum.bias === null ? '–' : signed(sum.bias)}</dd>
              <dt>{tx('Среднеквадратичная (RMSE)')}</dt>
              <dd className="num">{deg(sum.rmse)}</dd>
              <dt>{tx('Наибольшая |ошибка|')}</dt>
              <dd className="num">{deg(sum.maxAbs)}</dd>
              <dt>{tx('Разброс ошибок (SD)')}</dt>
              <dd className="num">{deg(sum.sd)}</dd>
              <dt>{tx('Пределы согласия 95 %')}</dt>
              <dd className="num">{sum.limits ? `${signed(sum.limits[0])} … ${signed(sum.limits[1])}` : <span className="muted">{tx('нужно 3 замера')}</span>}</dd>
            </dl>
            <div className="row row--wrap" style={{ gap: 8 }}>
              <Button size="sm" icon={<Download />} onClick={downloadTable} disabled={!shown.length}>
                {tx('Скачать таблицу CSV')}
              </Button>
              <Button size="sm" icon={<Download />} onClick={downloadRaw} disabled={!engine.current?.frames.length}>
                {tx('Скачать сырую запись')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setRows((rs) => rs.filter((r) => r.move !== move))} disabled={!shown.length}>
                {tx('Очистить замеры')}
              </Button>
            </div>
          </div>
        </section>

        {/* Формулы */}
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{tx('Формулы')}</h2>
          </div>
          <div className="card__body stack">
            <ul className="qc-formulas">
              <li>
                <code>eᵢ = θприбор,ᵢ − θугломер,ᵢ</code> <span>{tx('ошибка замера')}</span>
              </li>
              <li>
                <code>MAE = (1/n)·Σ|eᵢ|</code> <span>{tx('главный итог, сравнивается с порогом 5°')}</span>
              </li>
              <li>
                <code>bias = (1/n)·Σeᵢ</code> <span>{tx('систематическая: прибор в среднем завышает (+) или занижает (−)')}</span>
              </li>
              <li>
                <code>RMSE = √((1/n)·Σeᵢ²)</code> <span>{tx('чувствительна к редким большим промахам')}</span>
              </li>
              <li>
                <code>SD = √(Σ(eᵢ − bias)² / (n − 1))</code> <span>{tx('разброс ошибок вокруг bias')}</span>
              </li>
              <li>
                <code>LoA = bias ± 1,96·SD</code> <span>{tx('Бланд — Альтман: 95 % будущих замеров попадут в этот коридор')}</span>
              </li>
            </ul>
            <p className="field__hint">{tx('Угломер сам ошибается на 2–5°, поэтому итог — это согласие двух приборов, а не точность одного.')}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
