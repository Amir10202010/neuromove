import { describe, expect, it } from 'vitest';
import { captureWindow, summarizeGonio } from './goniometerCheck';

describe('goniometer check summary', () => {
  it('computes error, MAE, bias, RMSE, SD and limits of agreement', () => {
    // Ошибки: +2, −1, +3, 0
    const rows = [
      { gonio: 0, device: 2, spread: 0.3 },
      { gonio: 30, device: 29, spread: 0.3 },
      { gonio: 90, device: 93, spread: 0.3 },
      { gonio: 120, device: 120, spread: 0.3 },
    ];
    const s = summarizeGonio(rows);
    expect(s.n).toBe(4);
    expect(s.bias).toBeCloseTo(1, 10);
    expect(s.mae).toBeCloseTo(1.5, 10);
    expect(s.rmse).toBeCloseTo(Math.sqrt(14 / 4), 10);
    expect(s.maxAbs).toBe(3);
    const sd = Math.sqrt((1 + 4 + 4 + 1) / 3);
    expect(s.sd).toBeCloseTo(sd, 10);
    expect(s.limits?.[0]).toBeCloseTo(1 - 1.96 * sd, 10);
    expect(s.limits?.[1]).toBeCloseTo(1 + 1.96 * sd, 10);
    expect(s.passed).toBe(true);
  });

  it('fails above the threshold and needs 3 rows for limits', () => {
    const s = summarizeGonio([
      { gonio: 90, device: 97, spread: 0 },
      { gonio: 60, device: 54, spread: 0 },
    ]);
    expect(s.mae).toBeCloseTo(6.5, 10);
    expect(s.passed).toBe(false);
    expect(s.limits).toBeNull();
  });

  it('is empty without rows; capture takes the median', () => {
    expect(summarizeGonio([]).n).toBe(0);
    expect(captureWindow([])).toBeNull();
    expect(captureWindow([10, 11, 50])?.device).toBe(11);
  });
});
