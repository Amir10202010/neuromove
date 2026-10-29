// Прошивка стенда и приложение — одной строкой байт. test/golden.csv пишет сама прошивка
// (firmware/test/host_test.cpp, стенд на поддельных MPU-6050); здесь её разбирает
// тот же код, что читает USB-порт. Поменяли формат с одной стороны — тест падает.

import { describe, expect, it } from 'vitest';
// Текст файла целиком — импорт Vite «?raw»: без типов Node в коде приложения
import golden from '../../../firmware/test/golden.csv?raw';
import { createRng } from '../lib/random';
import { accCalFromPassport, accCalToPassport, ImuCsvParser, isSimulatedRecording, LineSplitter, moduleIdsFromPassport, moduleIdsToPassport, parseImuCsv, SeqUnwrapper } from './contract';
import type { RawFrame } from './types';

describe('вывод прошивки стенда (firmware/test/golden.csv)', () => {
  const r = parseImuCsv(golden);

  it('паспорт по контракту: устройство, частота, диапазоны, места датчиков', () => {
    expect(r.errors).toBe(0);
    expect(r.passport).toMatchObject({
      format: 'imu-csv v1',
      device: 'NM-01',
      firmware: '0.1',
      rateHz: 100,
      accG: 4,
      gyroDps: 1000,
      sensors: ['trunk', 'upper_r', 'fore_r'],
    });
    expect(r.passport.extra).toMatchObject({ board: 'esp32s3', i2c_hz: '100000', arm: 'right' });
    // Настоящее устройство: в пространстве клиники запись принимается
    expect(isSimulatedRecording(r.passport)).toBe(false);
  });

  it('отсчёты: номера подряд, время seq / rate_hz, числа со знаком', () => {
    expect(r.frames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(r.frames.map((f) => f.t)).toEqual([0, 0.01, 0.02]);
    expect([...(r.frames[0]?.data.fore_r ?? [])]).toEqual([-8192, 200, 44, -3, 0, 2000]);
    expect([...(r.frames[2]?.data.trunk ?? [])]).toEqual([-8190, -2, 50, -1, -2, 0]);
  });

  it('отпечатки модулей из паспорта: у каждого места свой, туда и обратно без потерь', () => {
    const ids = moduleIdsFromPassport(r.passport.extra);
    expect(ids).toEqual({ trunk: '5A4C6311', upper_r: '5A4C6322', fore_r: '5A4C6333' });
    expect(moduleIdsToPassport(ids)).toEqual({ id_trunk: '5A4C6311', id_upper_r: '5A4C6322', id_fore_r: '5A4C6333' });
    // Мусор вместо отпечатка не берётся; «none» у копии чипа — берётся как есть
    expect(moduleIdsFromPassport({ id_fore_r: '=cmd|x', id_trunk: 'none', id_upper_r: '5a4c6322' })).toEqual({ trunk: 'none' });
  });

  it('поправки акселерометра из паспорта — и обратно в паспорт без потерь', () => {
    const cal = accCalFromPassport(r.passport.extra);
    expect(Object.keys(cal)).toEqual(['fore_r']);
    expect(cal.fore_r?.off).toEqual([12, -30, 45]);
    expect(cal.fore_r?.scale).toEqual([1.0012, 0.9988, 1.0005]);
    expect(accCalToPassport(cal)).toEqual({ cal_fore_r: '12,-30,45,10012,9988,10005' });
  });

  it('поток из порта кусками любой длины даёт те же отсчёты, что файл', () => {
    const rng = createRng(3);
    for (let trial = 0; trial < 30; trial++) {
      const lines = new LineSplitter();
      const parser = new ImuCsvParser();
      const unwrap = new SeqUnwrapper();
      const frames: RawFrame[] = [];
      for (let i = 0; i < golden.length; ) {
        const n = rng.int(1, 64);
        for (const line of lines.push(golden.slice(i, i + n))) {
          const res = parser.pushLine(line);
          if (res.kind !== 'frame') continue;
          for (const u of unwrap.push(res.frame.seq, res.frame)) frames.push({ ...u.item, seq: u.seq });
        }
        i += n;
      }
      expect(frames.map((f) => f.seq)).toEqual([0, 1, 2]);
      expect(frames.map((f) => [...(f.data.upper_r ?? [])])).toEqual(r.frames.map((f) => [...(f.data.upper_r ?? [])]));
      expect(parser.passport.extra.cal_fore_r).toBe('12,-30,45,10012,9988,10005');
    }
  });

  it('испорченная строка поправок не берётся — лучше без поправок, чем с неверными', () => {
    expect(accCalFromPassport({ cal_fore_r: '1,2,3,4,5' })).toEqual({});
    expect(accCalFromPassport({ cal_fore_r: '1,2,3,0,10000,10000' })).toEqual({});
    expect(accCalFromPassport({ cal_fore_r: '99999,2,3,10000,10000,10000' })).toEqual({});
    expect(accCalFromPassport({ cal_fore_r: '1.5,2,3,10000,10000,10000' })).toEqual({});
    expect(accCalFromPassport({ cal_elbow: '1,2,3,10000,10000,10000' })).toEqual({});
  });
});

// Крайние случаи, которые пишет сама прошивка (firmware/test/fixtures, host_test.cpp → testFixtures)
import dropAndReturn from '../../../firmware/test/fixtures/drop-and-return.csv?raw';
import foreignCal from '../../../firmware/test/fixtures/foreign-calibration.csv?raw';
import reboot from '../../../firmware/test/fixtures/reboot.csv?raw';
import cloneChip from '../../../firmware/test/fixtures/clone-chip.csv?raw';

describe('образцы протокола от прошивки', () => {
  it('датчик выпал и вернулся: строки без него, затем снова с ним; разрыв в 500 номеров принят после подтверждения', () => {
    const r = parseImuCsv(dropAndReturn);
    expect(r.errors).toBe(0);
    const sets = r.frames.map((f) => Object.keys(f.data).join(','));
    expect(sets.slice(0, 3)).toEqual(Array(3).fill('trunk,upper_r,fore_r'));
    expect(sets.filter((s) => s === 'trunk,upper_r').length).toBe(8);
    expect(sets.at(-1)).toBe('trunk,upper_r,fore_r');
    const seqs = r.frames.map((f) => f.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs.at(-1)).toBe(542);
    // Сообщения человеку (строки «#» без «=») в паспорт не попали
    expect(Object.keys(r.passport.extra).some((k) => k.includes(' '))).toBe(false);
  });

  it('чужие поправки: прошивка их не применила — в паспорте нет cal_fore_r, приложение ничего не применит', () => {
    const r = parseImuCsv(foreignCal);
    expect(r.errors).toBe(0);
    expect(foreignCal).toContain('сняты с другого модуля (отпечаток 5A4C6322, сейчас 5A4C6333)');
    expect(accCalFromPassport(r.passport.extra)).toEqual({});
    expect(moduleIdsFromPassport(r.passport.extra).fore_r).toBe('5A4C6333');
  });

  it('перезагрузка платы посреди записи: время только растёт, ни одной ошибки разбора', () => {
    const r = parseImuCsv(reboot);
    expect(r.errors).toBe(0);
    const seqs = r.frames.map((f) => f.seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    expect(r.frames).toHaveLength(5 + 3);
  });

  it('копия чипа: предупреждение для человека, отпечатка нет — «none»', () => {
    const r = parseImuCsv(cloneChip);
    expect(r.errors).toBe(0);
    expect(cloneChip).toContain('WHO_AM_I 0x72');
    expect(moduleIdsFromPassport(r.passport.extra).fore_r).toBe('none');
    expect(isSimulatedRecording(r.passport)).toBe(false);
  });
});
