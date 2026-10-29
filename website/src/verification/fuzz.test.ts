// Свойства и fuzz (P2-1 в docs/ENGINEERING_10H): всё, что принимает чужие данные, на случайном входе.
// Зёрна фиксированы — любой провал повторяется. Свойства — то, что должно быть верно на ЛЮБОМ входе.

import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { ImuCsvParser, LineSplitter, SeqUnwrapper, parseImuCsv } from '../devices/contract';
import { PLACEMENTS, type Placement, type RawFrame } from '../devices/types';
import { parseWorkspaceBackup } from '../data/backup';
import { generateDemoWorkspace } from '../data/seed/demo';
import { SessionEngine } from '../session/SessionEngine';
import { XRng } from './rng';

const pick = <T,>(rng: XRng, xs: readonly T[]): T => xs[Math.floor(rng.next() * xs.length)] as T;

/** Случайная «строка из порта»: обрывки формата, числа на границах int16, мусор, юникод. */
function randomLine(rng: XRng): string {
  const parts = ['seq', 'trunk_ax', '#', 'imu-csv v1', 'mark', 'seq=12', 'ref=90', 'sensors=trunk,fore_r', '=', ',', '-', '32767', '-32768', '32768', '1e3', 'NaN', 'Infinity', '0x10', ' ', '\t', 'ё', '\u0000', '🙂', '99999999999999999999'];
  const n = 1 + Math.floor(rng.next() * 40);
  let s = '';
  for (let i = 0; i < n; i++) s += rng.next() < 0.6 ? String(Math.floor(rng.uniform(-40000, 40000))) + (rng.next() < 0.8 ? ',' : '') : pick(rng, parts);
  return s;
}

describe('разбор строк: на любом входе не падает и не пропускает неверное', () => {
  it('10 000 случайных строк после настоящего паспорта: только допустимые исходы, числа отсчётов — int16', () => {
    const rng = new XRng(101);
    const p = new ImuCsvParser();
    for (const l of ['# imu-csv v1', '# device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=trunk,fore_r', 'seq,trunk_ax,trunk_ay,trunk_az,trunk_gx,trunk_gy,trunk_gz,fore_r_ax,fore_r_ay,fore_r_az,fore_r_gx,fore_r_gy,fore_r_gz']) p.pushLine(l);
    let frames = 0;
    for (let i = 0; i < 10_000; i++) {
      const r = p.pushLine(randomLine(rng));
      expect(['passport', 'header', 'frame', 'mark', 'skip', 'error']).toContain(r.kind);
      if (r.kind === 'frame') {
        frames += 1;
        expect(Number.isInteger(r.frame.seq)).toBe(true);
        for (const d of Object.values(r.frame.data)) for (const v of d) expect(v >= -32768 && v <= 32767).toBe(true);
      }
    }
    // Случайные строки иногда похожи на отсчёт — это нормально; главное, что ни одна не уронила разбор
    expect(frames).toBeGreaterThanOrEqual(0);
  });

  it('заголовок с неизвестным местом датчика — ошибка, а не «датчик с пустым именем»', () => {
    const p = new ImuCsvParser();
    expect(p.pushLine('seq,elbow_ax,elbow_ay,elbow_az,elbow_gx,elbow_gy,elbow_gz').kind).toBe('error');
    expect(p.ready).toBe(false);
  });
});

describe('нарезка потока: куски любой длины дают те же строки, буфер ограничен', () => {
  it('500 случайных нарезок одного текста: строки совпадают с разбиением целиком', () => {
    const rng = new XRng(202);
    const lines = Array.from({ length: 300 }, () => randomLine(rng).replace(/\n/g, ''));
    const text = lines.join('\n') + '\n';
    for (let trial = 0; trial < 500; trial++) {
      const split = new LineSplitter(1_000_000);
      const got: string[] = [];
      for (let i = 0; i < text.length; ) {
        const n = 1 + Math.floor(rng.next() * 97);
        got.push(...split.push(text.slice(i, i + n)));
        i += n;
      }
      expect(got).toEqual(lines);
    }
  });

  it('поток без перевода строки: буфер не растёт дальше предела', () => {
    const split = new LineSplitter(4096);
    for (let i = 0; i < 1000; i++) split.push('x'.repeat(100));
    // Хвост после выброса — не больше предела плюс один кусок
    expect(split.overflows).toBeGreaterThan(0);
    expect(split.push('\n').length).toBe(1);
  });
});

describe('склейка номеров: на любой последовательности номера только растут, ничего не теряется молча', () => {
  it('2 000 случайных последовательностей с перезагрузками, повторами и порчей', () => {
    const rng = new XRng(303);
    for (let trial = 0; trial < 2000; trial++) {
      const u = new SeqUnwrapper();
      let seq = Math.floor(rng.uniform(0, 70000));
      let inCount = 0;
      const out: number[] = [];
      const ids: number[] = [];
      for (let k = 0; k < 200; k++) {
        const r = rng.next();
        let s: number;
        if (r < 0.03) s = 0; // перезагрузка
        else if (r < 0.06) s = seq; // повтор
        else if (r < 0.09) s = Math.floor(rng.uniform(0, 100000)); // порча
        else if (r < 0.11) s = seq + Math.floor(rng.uniform(2, 400)); // разрыв
        else s = seq + 1;
        if (r >= 0.06 || r < 0.03) seq = s;
        inCount += 1;
        for (const o of u.push(s, inCount, Math.floor(rng.uniform(1, 300)))) {
          out.push(o.seq);
          ids.push(o.item);
        }
      }
      u.flush();
      for (let i = 1; i < out.length; i++) expect(out[i] as number).toBeGreaterThan(out[i - 1] as number);
      // Каждая входная строка либо выдана ровно один раз, либо посчитана как повтор или порча
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length + u.duplicates + u.corrupt).toBe(inCount);
    }
  });

  it('файл из случайных строк вперемешку с отсчётами: время только растёт', () => {
    const rng = new XRng(404);
    const head = ['# imu-csv v1', '# device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=fore_r', 'seq,fore_r_ax,fore_r_ay,fore_r_az,fore_r_gx,fore_r_gy,fore_r_gz'];
    const rows: string[] = [...head];
    for (let k = 0; k < 3000; k++) rows.push(rng.next() < 0.05 ? randomLine(rng) : `${k},0,0,8192,0,0,0`);
    const r = parseImuCsv(rows.join('\n'));
    for (let i = 1; i < r.frames.length; i++) expect((r.frames[i] as RawFrame).t).toBeGreaterThan((r.frames[i - 1] as RawFrame).t);
  });
});

describe('движок на случайных отсчётах: ни исключений, ни NaN в живом угле', () => {
  it('шум int16 на всех датчиках, случайные разрывы и пропавшие датчики — 60 с', () => {
    const rng = new XRng(505);
    for (const exercise of ['shoulder_flexion', 'elbow_flexion', 'forearm_rotation'] as const) {
      const engine = new SessionEngine({ steps: [{ exercise, side: 'right', reps: 0, durationSec: 1e9 }], autoAdvance: false });
      engine.start();
      let seq = 0;
      for (let k = 0; k < 6000; k++) {
        seq += rng.next() < 0.01 ? Math.floor(rng.uniform(2, 80)) : 1;
        const data: RawFrame['data'] = {};
        for (const p of ['trunk', 'upper_r', 'fore_r'] as Placement[]) {
          if (rng.next() < 0.03) continue;
          // Покой первые 4 с (чтобы калибровка прошла), дальше — что угодно, включая упор
          data[p] =
            k < 400
              ? Int16Array.from([-8192 + Math.floor(rng.normal(30)), Math.floor(rng.normal(30)), Math.floor(rng.normal(30)), 0, 0, 0])
              : Int16Array.from({ length: 6 }, () => (rng.next() < 0.02 ? pick(rng, [32767, -32768]) : Math.floor(rng.uniform(-32768, 32767))));
        }
        engine.process([{ seq, t: seq / 100, data }]);
        const a = engine.live.angle;
        if (a !== null) expect(Number.isFinite(a)).toBe(true);
      }
      engine.stop();
      const res = engine.result();
      for (const step of res.steps) for (const rep of step.summary.reps) expect(Number.isFinite(rep.rom)).toBe(true);
    }
  });

  it('любой порядок времени (назад, повтор, скачок на сутки) не роняет движок', () => {
    const rng = new XRng(606);
    const engine = new SessionEngine({ steps: [{ exercise: 'elbow_flexion', side: 'right', reps: 0, durationSec: 1e9 }], autoAdvance: false });
    engine.start();
    const still = (): RawFrame['data'] => Object.fromEntries((['trunk', 'upper_r', 'fore_r'] as Placement[]).map((p) => [p, Int16Array.from([-8192, 0, 0, 0, 0, 0])]));
    for (let k = 0; k < 2000; k++) {
      const seq = rng.next() < 0.05 ? Math.floor(rng.uniform(-100, 10_000_000)) : k;
      engine.process([{ seq, t: seq / 100, data: still() }]);
    }
    expect(PLACEMENTS.length).toBe(5);
    expect(() => engine.result()).not.toThrow();
  });
});

describe('разбор архива: на испорченном JSON — null, а не исключение', async () => {
  const data = await generateDemoWorkspace({ now: new Date('2026-09-27T12:00:00Z'), t: makeT('ru'), clinician: 'Тест' });
  const base = JSON.stringify({ format: 'neuromove-backup', version: 1, workspace: 'demo', data });
  it('150 случайных порч одного архива', () => {
    const rng = new XRng(707);
    let accepted = 0;
    for (let i = 0; i < 150; i++) {
      const chars = base.split('');
      const n = 1 + Math.floor(rng.next() * 5);
      for (let j = 0; j < n; j++) {
        const at = Math.floor(rng.next() * chars.length);
        chars[at] = pick(rng, ['"', '{', '}', ',', '0', '-', 'x', ':', ']', '[', 'null', 'NaN']);
      }
      const r = parseWorkspaceBackup(chars.join(''), 'demo');
      if (r) {
        accepted += 1;
        // Если архив принят, он целый: ссылки сеансов на пациентов не порваны
        const ids = new Set(r.patients.map((p) => p.id));
        for (const s of r.sessions) expect(ids.has(s.patientId)).toBe(true);
      }
    }
    expect(accepted).toBeLessThan(150);
  }, 30_000);
});
