// Контракт с железом: разбор и запись imu-csv v1, пакет Bluetooth на 18 байт.

import { describe, expect, it } from 'vitest';
import { ImuSimulator } from '../simulation/imuModel';
import { restingPose } from '../simulation/kinematics';
import { createRng } from '../lib/random';
import { encodeBlePacket, isSimulatedRecording, LineSplitter, parseBlePacket, parseImuCsv, SeqUnwrapper, sensorsAfterHeader, serializeImuCsv, ImuCsvParser } from './contract';
import type { SensorState } from './types';

describe('imu-csv v1', () => {
  const sample = [
    '# imu-csv v1',
    '# device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=trunk,upper_r,fore_r',
    'seq,trunk_ax,trunk_ay,trunk_az,trunk_gx,trunk_gy,trunk_gz,upper_r_ax,upper_r_ay,upper_r_az,upper_r_gx,upper_r_gy,upper_r_gz,fore_r_ax,fore_r_ay,fore_r_az,fore_r_gx,fore_r_gy,fore_r_gz',
    '0,152,-40,8174,12,-35,7,98,15,8201,-4,20,11,5,6,7,8,9,10',
    '1,150,-41,8170,11,-34,6,97,14,8200,-3,21,12,5,6,7,8,9,10',
    '# mark seq=1 ref=90',
    '3,1,2,3,4,5,6,1,2,3,4,5,6,1,2,3,4,5,6',
  ].join('\n');

  it('паспорт и отсчёты читаются', () => {
    const r = parseImuCsv(sample);
    expect(r.passport.device).toBe('NM-01');
    expect(r.passport.rateHz).toBe(100);
    expect(r.passport.sensors).toEqual(['trunk', 'upper_r', 'fore_r']);
    expect(r.frames).toHaveLength(3);
    expect(Array.from(r.frames[0]!.data.trunk!)).toEqual([152, -40, 8174, 12, -35, 7]);
    expect(r.frames[2]!.t).toBeCloseTo(0.03);
    expect(r.marks).toEqual([{ seq: 1, ref: 90 }]);
  });

  it('неверная строка не роняет разбор, а считается', () => {
    const p = new ImuCsvParser();
    for (const line of sample.split('\n').slice(0, 3)) p.pushLine(line);
    expect(p.pushLine('5,1,2,3').kind).toBe('error');
    expect(p.pushLine('6,a,b,c,d,e,f,1,2,3,4,5,6,1,2,3,4,5,6').kind).toBe('error');
    expect(p.errors).toBe(2);
  });

  it('запись и обратное чтение дают те же числа', () => {
    const sim = new ImuSimulator(5);
    const frames = Array.from({ length: 50 }, (_, i) => sim.frame(restingPose(), i));
    const text = serializeImuCsv(
      { device: 'NM-SIM-01', firmware: 'sim-0.1', rateHz: 100, accG: 4, gyroDps: 1000, sensors: ['trunk', 'upper_l', 'upper_r', 'fore_l', 'fore_r'], extra: { patient: 'P01', algo: 'nm-core-0.1' } },
      frames,
    );
    const back = parseImuCsv(text);
    expect(back.frames).toHaveLength(50);
    expect(back.passport.extra.patient).toBe('P01');
    expect(Array.from(back.frames[17]!.data.fore_r!)).toEqual(Array.from(frames[17]!.data.fore_r!));
  });
});

describe('происхождение записи', () => {
  const head = (passport: string) =>
    ['# imu-csv v1', passport, 'seq,fore_r_ax,fore_r_ay,fore_r_az,fore_r_gx,fore_r_gy,fore_r_gz', '0,1,2,3,4,5,6'].join('\n');

  it('выгрузка из демо и запись симулятора узнаются по паспорту', () => {
    const demo = parseImuCsv(head('# device=NM-01 fw=0.1 rate_hz=100 sensors=fore_r\n# patient=P01 demo=yes'));
    expect(isSimulatedRecording(demo.passport)).toBe(true);
    const sim = parseImuCsv(head('# device=NeuroMove_Kit_·_симулятор fw=sim-1 rate_hz=100 sensors=fore_r'));
    expect(isSimulatedRecording(sim.passport)).toBe(true);
    const real = parseImuCsv(head('# device=NM-01 fw=0.1 rate_hz=100 sensors=fore_r\n# patient=P07 demo=no'));
    expect(isSimulatedRecording(real.passport)).toBe(false);
  });

  it('число вне int16 — ошибка строки, а не «завёрнутый» отсчёт', () => {
    const r = parseImuCsv(['# imu-csv v1', 'seq,fore_r_ax,fore_r_ay,fore_r_az,fore_r_gx,fore_r_gy,fore_r_gz', '0,1,2,3,4,5,6', '1,40000,2,3,4,5,6'].join('\n'));
    expect(r.frames).toHaveLength(1);
    expect(r.errors).toBe(1);
  });
});

describe('поток с USB: куски, мусор, перезагрузка платы', () => {
  const HEAD = 'seq,fore_r_ax,fore_r_ay,fore_r_az,fore_r_gx,fore_r_gy,fore_r_gz';
  const PASSPORT = ['# imu-csv v1', '# device=NM-01 fw=0.1 rate_hz=100 sensors=fore_r', HEAD];
  const row = (seq: number) => `${seq},-8192,10,20,1,2,3`;

  it('строки одинаковы при любых границах кусков, с \\r\\n и без', () => {
    const text = [...PASSPORT, row(0), row(1), row(2)].join('\r\n') + '\r\n' + [row(3), row(4)].join('\n') + '\n';
    const expected = text.split('\n').slice(0, -1);
    const rng = createRng(7);
    for (let trial = 0; trial < 50; trial++) {
      const splitter = new LineSplitter();
      const got: string[] = [];
      for (let i = 0; i < text.length; ) {
        const n = rng.int(1, 40);
        got.push(...splitter.push(text.slice(i, i + n)));
        i += n;
      }
      expect(got).toEqual(expected);
    }
  });

  it('мусор без перевода строки (неверная скорость порта) не копится в памяти', () => {
    const splitter = new LineSplitter(4096);
    expect(splitter.push('\u0000\u00ff'.repeat(3000))).toEqual([]);
    expect(splitter.overflows).toBe(1);
    expect(splitter.push(`${row(0)}\n`)).toEqual([row(0)]);
  });

  /** Номера на выходе для последовательности номеров на входе. */
  const feed = (u: SeqUnwrapper, seqs: number[], gaps: Record<number, number> = {}) =>
    seqs.flatMap((x, i) => u.push(x, i, gaps[i] ?? 1).map((r) => r.seq));

  it('16-битный seq: 65 535 → 0 продолжается без скачка назад', () => {
    const u = new SeqUnwrapper();
    expect(feed(u, [65534, 65535, 0, 1])).toEqual([65534, 65535, 65536, 65537]);
    expect(u.resets).toBe(1);
  });

  it('перезагрузка платы после паузы 2 с на 100 Гц — пропуск в 200 номеров, движок увидит разрыв', () => {
    const u = new SeqUnwrapper();
    expect(feed(u, [500, 0, 1], { 1: 200 })).toEqual([500, 700, 701]);
  });

  it('повтор той же строки выбрасывается', () => {
    const u = new SeqUnwrapper();
    expect(feed(u, [10, 10, 11])).toEqual([10, 11]);
    expect(u.duplicates).toBe(1);
  });

  it('испорченная цифра в номере — строка выброшена, ни перезагрузки, ни разрыва в тысячи номеров', () => {
    // 1234 потерял цифру → 124; затем 92345 вместо 1236 — лишняя цифра
    const u = new SeqUnwrapper();
    expect(feed(u, [1232, 1233, 124, 1235, 92345, 1237, 1238])).toEqual([1232, 1233, 1235, 1237, 1238]);
    expect(u.resets).toBe(0);
    expect(u.corrupt).toBe(2);
  });

  it('настоящий долгий разрыв вперёд (плата стояла 3 с) принимается после подтверждения', () => {
    const u = new SeqUnwrapper();
    expect(feed(u, [100, 101, 401, 402])).toEqual([100, 101, 401, 402]);
    expect(u.corrupt).toBe(0);
  });

  it('старая строка, пришедшая повторно не подряд, — испорченная, а не перезагрузка', () => {
    const u = new SeqUnwrapper();
    expect(feed(u, [10, 11, 12, 10, 13])).toEqual([10, 11, 12, 13]);
    expect(u.resets).toBe(0);
  });

  it('путь USB: одна строка с испорченным номером на 5 000 — потерь не больше одной строки', () => {
    const rng = createRng(11);
    const u = new SeqUnwrapper();
    const out: number[] = [];
    for (let k = 0; k < 5000; k++) {
      let seq = k;
      // Каждая 997-я строка — потеря случайной цифры номера
      if (k % 997 === 500) {
        const str = String(k);
        const i = rng.int(0, str.length - 1);
        seq = Number(str.slice(0, i) + str.slice(i + 1)) || 0;
      }
      out.push(...u.push(seq, k).map((r) => r.seq));
    }
    expect(u.resets).toBe(0);
    // Всё монотонно, и между соседними номерами — не больше одной пропущенной строки
    for (let i = 1; i < out.length; i++) expect((out[i] as number) - (out[i - 1] as number)).toBeLessThanOrEqual(2);
    expect(out.length).toBeGreaterThanOrEqual(5000 - 6);
  });

  it('файл с перезагрузкой платы посередине: время только растёт, отметка сдвинута вместе с отсчётами', () => {
    const text = [...PASSPORT, row(0), row(1), row(2), ...PASSPORT, row(0), '# mark seq=1 ref=90', row(1)].join('\n');
    const r = parseImuCsv(text);
    expect(r.frames.map((f) => f.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(r.frames.map((f) => f.t)).toEqual([0, 0.01, 0.02, 0.03, 0.04]);
    expect(r.marks).toEqual([{ seq: 4, ref: 90 }]);
    expect(r.errors).toBe(0);
  });
});

describe('прошивка убрала датчик из потока и вернула его', () => {
  const head = (sensors: string[]) => [
    '# imu-csv v1',
    `# device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=${sensors.join(',')}`,
    ['seq', ...sensors.flatMap((p) => ['ax', 'ay', 'az', 'gx', 'gy', 'gz'].map((a) => `${p}_${a}`))].join(','),
  ];
  const line = (seq: number, n: number) => [seq, ...Array.from({ length: n * 6 }, (_, i) => i)].join(',');

  it('разбор: новый заголовок меняет набор датчиков, строки читаются по нему', () => {
    const parser = new ImuCsvParser();
    for (const l of head(['trunk', 'upper_r', 'fore_r'])) parser.pushLine(l);
    expect(parser.sensors).toEqual(['trunk', 'upper_r', 'fore_r']);
    expect(parser.pushLine(line(0, 3)).kind).toBe('frame');
    for (const l of head(['trunk', 'fore_r'])) parser.pushLine(l);
    expect(parser.sensors).toEqual(['trunk', 'fore_r']);
    const r = parser.pushLine(line(5, 2));
    expect(r.kind).toBe('frame');
    if (r.kind === 'frame') expect(Object.keys(r.frame.data)).toEqual(['trunk', 'fore_r']);
    // Старая строка на три датчика после нового заголовка — ошибка, а не отсчёт со сдвинутыми числами
    expect(parser.pushLine(line(6, 3)).kind).toBe('error');
  });

  it('статус: датчик, которого нет в заголовке, — не на связи; вернувшийся — снова на связи', () => {
    const all: SensorState[] = ['trunk', 'upper_r', 'fore_r'].map((p) => ({ placement: p as SensorState['placement'], online: true, battery: null, lowBattery: false, link: 1 }));
    const dropped = sensorsAfterHeader(all, ['trunk', 'fore_r']);
    expect(dropped.map((s) => [s.placement, s.online])).toEqual([['trunk', true], ['upper_r', false], ['fore_r', true]]);
    expect(dropped.find((s) => s.placement === 'upper_r')?.link).toBe(0);
    const back = sensorsAfterHeader(dropped, ['trunk', 'upper_r', 'fore_r']);
    expect(back.every((s) => s.online)).toBe(true);
    // Датчик, которого не было при подключении, появился — добавляется
    const extra = sensorsAfterHeader(all, ['trunk', 'upper_r', 'fore_r', 'upper_l']);
    expect(extra.map((s) => s.placement)).toEqual(['trunk', 'upper_r', 'fore_r', 'upper_l']);
  });
});

describe('выгрузка сырых данных', () => {
  it('пропавший датчик не превращается в нули: туда и обратно — те же датчики в тех же кадрах', () => {
    const d = (k: number) => new Int16Array([k, -k, 8192, 1, 2, 3]);
    const frames = [0, 1, 2, 3, 4, 5].map((seq) => ({
      seq,
      t: seq / 100,
      data: seq >= 2 && seq <= 3 ? { trunk: d(seq), fore_r: d(seq + 10) } : { trunk: d(seq), upper_r: d(seq + 20), fore_r: d(seq + 10) },
    }));
    const text = serializeImuCsv({ device: 'NM-01', firmware: '0.1', rateHz: 100, accG: 4, gyroDps: 1000, sensors: ['trunk', 'upper_r', 'fore_r'], extra: {} }, frames);
    expect(text).not.toMatch(/,0,0,0,0,0,0(,|$)/m);
    const back = parseImuCsv(text);
    expect(back.errors).toBe(0);
    expect(back.frames.map((f) => Object.keys(f.data).sort().join(','))).toEqual(frames.map((f) => Object.keys(f.data).sort().join(',')));
    for (let i = 0; i < frames.length; i++) {
      for (const [p, v] of Object.entries(frames[i]!.data)) expect(Array.from(back.frames[i]!.data[p as 'trunk']!)).toEqual(Array.from(v));
    }
  });

  it('обычная запись без пропаж — один заголовок, как раньше', () => {
    const frames = [0, 1, 2].map((seq) => ({ seq, t: seq / 100, data: { trunk: new Int16Array(6), fore_r: new Int16Array(6) } }));
    const text = serializeImuCsv({ device: 'NM-01', firmware: '0.1', rateHz: 100, accG: 4, gyroDps: 1000, sensors: ['trunk', 'fore_r'], extra: {} }, frames);
    expect(text.split('\n').filter((l) => l.startsWith('seq')).length).toBe(1);
  });
});

describe('Bluetooth-пакет', () => {
  it('18 байт little-endian туда и обратно', () => {
    const raw = new Int16Array([100, -200, 8192, -32768, 32767, 5]);
    const v = encodeBlePacket({ seq: 123456, place: 'fore_l', lowBattery: true, raw });
    expect(v.byteLength).toBe(18);
    const p = parseBlePacket(v)!;
    expect(p.seq).toBe(123456);
    expect(p.place).toBe('fore_l');
    expect(p.lowBattery).toBe(true);
    expect(Array.from(p.raw)).toEqual(Array.from(raw));
  });

  it('короткий пакет и неизвестное место — отбрасываются', () => {
    expect(parseBlePacket(new DataView(new ArrayBuffer(10)))).toBeNull();
    const v = new DataView(new ArrayBuffer(18));
    v.setUint8(4, 9);
    expect(parseBlePacket(v)).toBeNull();
  });
});

describe('паспорт не по контракту — отказ, а не тихо неверные углы', async () => {
  const { passportProblem, passportText } = await import('./contract');
  const { ReplayDevice } = await import('./ReplayDevice');
  const file = (passport: string) =>
    ['# imu-csv v1', `# ${passport} sensors=fore_r`, 'seq,fore_r_ax,fore_r_ay,fore_r_az,fore_r_gx,fore_r_gy,fore_r_gz', ...Array.from({ length: 10 }, (_, i) => `${i},-8192,0,0,0,0,0`)].join('\n');

  it('диапазоны ±8 g и ±2000 °/с, отрицательная и огромная частота — отказ с объяснением', () => {
    const base = parseImuCsv(file('device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000')).passport;
    expect(passportProblem(base)).toBeNull();
    expect(passportProblem({ ...base, accG: 8, gyroDps: 2000 })).toMatch(/±8 g и ±2000 °\/с/);
    expect(passportProblem({ ...base, rateHz: -100 })).toMatch(/вне 10–1000/);
    expect(passportProblem({ ...base, rateHz: 1e6 })).toMatch(/вне 10–1000/);
    expect(passportProblem({ ...base, format: 'imu-csv v2' })).toMatch(/нужен imu-csv v1/);
  });

  it('запись с ±8 g не проигрывается: устройство сообщает «не по контракту»', async () => {
    const dev = new ReplayDevice(file('device=NM-01 fw=0.1 rate_hz=100 acc_g=8 gyro_dps=1000'), 'x.csv');
    await dev.connect();
    expect(dev.getStatus().phase).toBe('error');
    expect(dev.getStatus().error?.code).toBe('bad_format');
    expect(dev.getStatus().error?.message).toMatch(/±8 g/);
  });

  it('имя устройства в 5 000 знаков с управляющими символами — в сеанс попадает не больше 64 знаков без них', async () => {
    expect(passportText('NM\u0000-01\u001b[31m' + 'x'.repeat(5000))).toBe('NM-01[31m' + 'x'.repeat(55));
    const dev = new ReplayDevice(file(`device=${'Я'.repeat(5000)} fw=${'1'.repeat(500)} rate_hz=100 acc_g=4 gyro_dps=1000`), 'x.csv');
    await dev.connect();
    expect(dev.getStatus().info?.firmware.length).toBeLessThanOrEqual(32);
    expect(dev.getStatus().info?.id.length).toBeLessThanOrEqual(64);
  });
});
