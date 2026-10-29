import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { parseImuCsv } from '../devices/contract';
import { csvCell, exportName, metricsCsv, rawCsv } from './export';
import { generateDemoWorkspace } from './seed/demo';

describe('CSV cells', () => {
  it('turns formula-like text into plain text for Excel', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1-1')).toBe("'-1-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('＝1+1')).toBe("'＝1+1");
    expect(csvCell('\t=1')).toBe("'\t=1");
    expect(csvCell('\n=1')).toBe(`"'\n=1"`);
  });
  it('leaves numbers and ordinary text alone', () => {
    expect(csvCell(-4.234)).toBe('-4.23');
    expect(csvCell(0)).toBe('0');
    expect(csvCell('P01')).toBe('P01');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });
});

describe('metrics CSV provenance', async () => {
  const data = await generateDemoWorkspace({ now: new Date('2026-09-27T12:00:00Z'), t: makeT('en'), clinician: 'Test operator' });
  const csv = metricsCsv(data.sessions, data.patients);
  const [head = '', ...rows] = csv.replace(/^\uFEFF/, '').trim().split('\n');
  const cols = head.split(',');
  it('marks every simulated row as demo with its source', () => {
    expect(cols.slice(-3)).toEqual(['demo', 'algorithm', 'source']);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = row.split(',');
      expect(cells[cols.indexOf('demo')]).toBe('yes');
      expect(cells[cols.indexOf('source')]).toBe('simulator');
    }
  });
});

describe('export file names', () => {
  it('puts DEMO into the name of every demo file', () => {
    expect(exportName(true, ['metrics', '2026-10-01'], 'csv')).toBe('neuromove-DEMO-metrics-2026-10-01.csv');
    expect(exportName(false, ['P07', '2026-10-01', 'raw'], 'csv')).toBe('neuromove-P07-2026-10-01-raw.csv');
  });
  it('keeps names safe for any file system', () => {
    expect(exportName(false, ['a/b c', '..'], 'json')).toBe('neuromove-a_b_c-_.json');
  });
  it('keeps the child name readable in any alphabet', () => {
    expect(exportName(true, ['Алихан', '2026-10-15', 'raw'], 'csv')).toBe('neuromove-DEMO-Алихан-2026-10-15-raw.csv');
    expect(exportName(false, ['Нұрислам Б.'], 'csv')).toBe('neuromove-Нұрислам_Б_.csv');
  });
});

describe('raw export keeps the calibration it was computed with', async () => {
  const data = await generateDemoWorkspace({ now: new Date('2026-09-27T12:00:00Z'), t: makeT('en'), clinician: 'Test operator' });
  it('writes cal_<place> into the passport and reads it back', () => {
    const s = { ...data.sessions[0]!, device: { ...data.sessions[0]!.device, accCal: { fore_r: { off: [12, -30, 45] as [number, number, number], scale: [1.0012, 0.9988, 1.0005] as [number, number, number] } } } };
    const frames = [{ seq: 0, t: 0, data: { fore_r: Int16Array.from([1, 2, 3, 4, 5, 6]) } }];
    const parsed = parseImuCsv(rawCsv(s, frames, 'P01'));
    expect(parsed.passport.extra.cal_fore_r).toBe('12,-30,45,10012,9988,10005');
    expect(parsed.frames).toHaveLength(1);
  });
  it('keeps the child name in the passport, a space turned into _', () => {
    const parsed = parseImuCsv(rawCsv(data.sessions[0]!, [{ seq: 0, t: 0, data: { fore_r: Int16Array.from([1, 2, 3, 4, 5, 6]) } }], 'Алихан С.'));
    expect(parsed.passport.extra.patient).toBe('Алихан_С.');
  });
  it('writes module fingerprints id_<place> and reads them back', () => {
    const s = { ...data.sessions[0]!, device: { ...data.sessions[0]!.device, moduleIds: { fore_r: '5A4C6333', trunk: 'none' } } };
    const parsed = parseImuCsv(rawCsv(s, [{ seq: 0, t: 0, data: { fore_r: Int16Array.from([1, 2, 3, 4, 5, 6]) } }], 'P01'));
    expect(parsed.passport.extra.id_fore_r).toBe('5A4C6333');
    expect(parsed.passport.extra.id_trunk).toBe('none');
  });
});
