// Выгрузка: метрики в CSV (открывается в Excel), сырые данные в imu-csv v1, архив в JSON.
// Имён нет нигде — только коды пациентов (софт.md, «Приватность»).

import { accCalToPassport, moduleIdsToPassport, serializeImuCsv } from '../devices/contract';
import type { Placement, RawFrame } from '../devices/types';
import type { Patient, Session } from './models';

/**
 * Ячейка CSV. Строка, которая начинается с `=`, `+`, `-`, `@` (или их широких вариантов `＝＋－＠`),
 * табуляции или перевода строки, в Excel и LibreOffice становится формулой: `=HYPERLINK(…)`
 * из чужого архива отправил бы данные по ссылке (OWASP, «CSV Injection»). Такой строке ставим
 * впереди апостроф — ячейка остаётся текстом. Числа не трогаем: `-4.2` — это число, а не формула.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  let s = typeof v === 'number' ? String(Math.round(v * 100) / 100) : v;
  if (typeof v === 'string' && /^[=+\-@\t\r\n＝＋－＠]/.test(s)) s = `'${s}`;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Одна строка на «сеанс × движение × сторона». `demo` и `source` (simulator, replay, usb, ble) —
 * в каждой строке: строку, скопированную в чужую таблицу, нельзя принять за настоящий замер.
 * Новые столбцы — только в конец, чтобы не сломать чтение в лаборатории на Python.
 */
export function metricsCsv(sessions: readonly Session[], patients: readonly Patient[]): string {
  const head = [
    'session_id', 'patient', 'date', 'protocol', 'exercise', 'side', 'status', 'reps', 'rom_median_deg', 'rom_best_deg',
    'supination_deg', 'pronation_deg', 'sparc', 'trunk_deg', 'cv_pct', 'peak_velocity_dps', 'rep_duration_s', 'flags',
    'quality_pct', 'demo', 'algorithm', 'source',
  ];
  const code = (id: string) => patients.find((p) => p.id === id)?.code ?? '';
  const rows = [head.join(',')];
  for (const s of [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    for (const st of s.steps) {
      const m = st.summary;
      rows.push(
        [
          s.id, code(s.patientId), s.startedAt, s.protocolId, m.exercise, m.side, st.status, m.reps.length, m.rom, m.romBest,
          m.supination, m.pronation, m.sparc, m.trunk, m.cv, m.peakVelocity, m.repDuration, m.flags.join(' '),
          s.quality.percent, s.demo ? 'yes' : 'no', s.algorithmVersion, s.device.kind,
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  // BOM — чтобы Excel сразу открыл кириллицу правильно
  return '﻿' + rows.join('\n') + '\n';
}

export function rawCsv(session: Session, frames: readonly RawFrame[], patientCode: string): string {
  const placements = [...new Set(frames.flatMap((f) => Object.keys(f.data) as Placement[]))];
  const order: Placement[] = ['trunk', 'upper_l', 'upper_r', 'fore_l', 'fore_r'];
  return serializeImuCsv(
    {
      device: session.device.name.replace(/\s+/g, '_'),
      firmware: session.device.firmware,
      rateHz: session.device.rateHz,
      accG: 4,
      gyroDps: 1000,
      sensors: order.filter((p) => placements.includes(p)),
      extra: {
        // Паспорт — пары «ключ=значение» через пробел: пробел и «=» в имени заменяем, иначе пара развалится
        patient: patientCode.replace(/[\s=]+/g, '_'),
        session: session.id,
        date: session.startedAt,
        protocol: session.protocolId,
        algo: session.algorithmVersion,
        demo: session.demo ? 'yes' : 'no',
        ...accCalToPassport(session.device.accCal),
        ...moduleIdsToPassport(session.device.moduleIds),
      },
    },
    frames,
  );
}

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Имя файла выгрузки. У демо в имени `DEMO`: файл, лежащий на диске отдельно от приложения,
 * нельзя спутать с выгрузкой настоящих пациентов. Части имени — только латиница, цифры и дефис.
 */
export function exportName(demo: boolean, parts: readonly string[], ext: 'csv' | 'json'): string {
  // Буквы любого алфавита остаются: «Алихан» в имени файла читается, а не превращается в «_»
  const safe = parts.map((p) => p.replace(/[^\p{L}\p{N}-]+/gu, '_'));
  return ['neuromove', ...(demo ? ['DEMO'] : []), ...safe].join('-') + `.${ext}`;
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
