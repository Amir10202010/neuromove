import { describe, expect, it } from 'vitest';
import { niceDomain, niceTicks } from './scale';

describe('деления осей', () => {
  it('на оси 100–180° — пять делений по 20°', () => {
    expect(niceTicks(100, 180, 4)).toEqual([100, 120, 140, 160, 180]);
  });
  it('область значений охватывает данные с запасом', () => {
    const [lo, hi] = niceDomain([119, 166], 0.12, 4, [150]);
    expect(lo).toBeLessThanOrEqual(113);
    expect(hi).toBeGreaterThanOrEqual(171);
  });
  it('проценты 0–100 — деления по 20–25', () => {
    const t = niceTicks(0, 100, 4);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(100);
    expect(t.length).toBeGreaterThanOrEqual(3);
  });
});
