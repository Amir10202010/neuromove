// Expected values are independent of this implementation:
//  - distribution quantiles: published tables (t, F)
//  - error summary / Bland–Altman / repeated-measures BA: NumPy (scratch script, values pasted below)
//  - ICC: Shrout & Fleiss (1979) Table 2 data; values match psych::ICC (R):
//        ICC2 = 0.29 [0.019, 0.76], ICC3 = 0.71 [0.34, 0.95]

import { describe, expect, it } from 'vitest';
import {
  agreement,
  blandAltman,
  blandAltmanRepeated,
  drift,
  errorSummary,
  fQuantile,
  flagPairs,
  icc,
  rangeAgreement,
  sufficiency,
  tQuantile,
  type Pair,
} from './stats';

const IMU = [92.4, 88.1, 95.0, 90.2, 87.5, 93.3, 91.0, 89.9, 94.1, 90.8];
const REF = [90.0, 89.0, 92.0, 90.0, 86.0, 91.0, 90.0, 91.0, 92.0, 89.0];
const PAIRS: Pair[] = IMU.map((imu, i) => ({ imu, ref: REF[i] as number, id: `t${i + 1}` }));

describe('distribution quantiles (published tables)', () => {
  it.each([
    [1, 12.706204736],
    [5, 2.570581836],
    [9, 2.262157163],
    [29, 2.045229642],
    [1000, 1.962339081],
  ])('t(0.975, %i)', (df, q) => {
    expect(tQuantile(0.975, df)).toBeCloseTo(q, 6);
  });
  it('t is symmetric', () => {
    expect(tQuantile(0.025, 9)).toBeCloseTo(-2.262157163, 6);
    expect(tQuantile(0.5, 4)).toBe(0);
  });
  it('F(0.975; 5, 15) and F(0.975; 15, 5)', () => {
    expect(fQuantile(0.975, 5, 15)).toBeCloseTo(3.5764, 3);
    expect(fQuantile(0.975, 15, 5)).toBeCloseTo(6.4277, 3);
  });
});

describe('error summary (IMU − reference)', () => {
  const s = errorSummary(PAIRS);
  it('matches NumPy', () => {
    expect(s.n).toBe(10);
    expect(s.bias).toBeCloseTo(1.23, 12);
    expect(s.sd).toBeCloseTo(1.4095310488874575, 12);
    expect(s.mae).toBeCloseTo(1.63, 12);
    expect(s.rmse).toBeCloseTo(1.8168654325513482, 12);
    expect(s.medianAbs).toBeCloseTo(1.65, 12);
    expect(s.minSigned).toBeCloseTo(-1.1, 12);
    expect(s.maxSigned).toBeCloseTo(3.0, 12);
    expect(s.maxAbs).toBeCloseTo(3.0, 12);
    expect(s.meanImu).toBeCloseTo(91.23, 12);
    expect(s.meanRef).toBeCloseTo(90.0, 12);
  });
  it('bias CI uses t(0.975, n − 1)', () => {
    const half = 2.262157163 * (1.4095310488874575 / Math.sqrt(10));
    expect(s.biasCi?.[0]).toBeCloseTo(1.23 - half, 6);
    expect(s.biasCi?.[1]).toBeCloseTo(1.23 + half, 6);
  });
  it('signed and absolute error of one pair', () => {
    const one = errorSummary([{ imu: 82.4, ref: 85 }]);
    expect(one.bias).toBeCloseTo(-2.6, 12);
    expect(one.mae).toBeCloseTo(2.6, 12);
    expect(one.rmse).toBeCloseTo(2.6, 12);
    // n = 1: no spread, no CI — reported as null, not 0
    expect(one.sd).toBeNull();
    expect(one.biasCi).toBeNull();
  });
  it('empty input reports nothing instead of zeros', () => {
    const e = errorSummary([]);
    expect(e).toMatchObject({ n: 0, bias: null, sd: null, mae: null, rmse: null, medianAbs: null, maxAbs: null });
  });
  it('is not affected by floating-point accumulation order', () => {
    const many: Pair[] = Array.from({ length: 1000 }, (_, i) => ({ imu: 0.1 * (i % 7), ref: 0 }));
    const rev = [...many].reverse();
    expect(errorSummary(many).bias).toBeCloseTo(errorSummary(rev).bias as number, 12);
  });
});

describe('Bland–Altman', () => {
  it('standard limits = bias ± 1.96 SD (NumPy)', () => {
    const ba = blandAltman(PAIRS)!;
    expect(ba.method).toBe('standard');
    expect(ba.loa[0]).toBeCloseTo(-1.5326300909103832, 10);
    expect(ba.loa[1]).toBeCloseTo(3.9926300909103825, 10);
    expect(ba.points).toHaveLength(10);
    expect(ba.points[0]).toMatchObject({ mean: 91.2, id: 't1' });
    expect(ba.points[0]?.diff).toBeCloseTo(2.4, 10);
  });
  it('needs at least 3 pairs', () => {
    expect(blandAltman(PAIRS.slice(0, 2))).toBeNull();
  });
  it('repeated measures (Bland & Altman 2007) matches NumPy', () => {
    const groups: Record<string, number[]> = { A: [1.0, 2.0, 1.5], B: [-0.5, 0.5], C: [3.0, 2.0, 2.5, 3.5] };
    const pairs: Pair[] = Object.entries(groups).flatMap(([subject, ds]) => ds.map((d) => ({ imu: 90 + d, ref: 90, subject })));
    const ba = blandAltmanRepeated(pairs)!;
    expect(ba.method).toBe('repeated_measures');
    expect(ba.subjects).toBe(3);
    expect(ba.bias).toBeCloseTo(1.7222222222222223, 12);
    expect(ba.sd).toBeCloseTo(1.4243757067031695, 12);
    expect(ba.loa[1] - ba.loa[0]).toBeCloseTo(2 * 1.959963984540054 * 1.4243757067031695, 10);
    // agreement() picks the repeated-measures method for this structure
    expect(agreement(pairs)?.method).toBe('repeated_measures');
    // ...and the standard method for a single participant
    expect(agreement(PAIRS)?.method).toBe('standard');
  });
  it('detects a proportional bias', () => {
    const pairs: Pair[] = [10, 30, 50, 70, 90, 110].map((ref) => ({ imu: ref * 1.1, ref }));
    const ba = blandAltman(pairs)!;
    expect(ba.proportional!.slope).toBeGreaterThan(0);
    expect(ba.proportional!.slopeCi![0]).toBeGreaterThan(0);
  });
});

describe('ICC (Shrout & Fleiss 1979 data)', () => {
  const X = [
    [9, 2, 5, 8],
    [6, 1, 3, 2],
    [8, 4, 6, 8],
    [7, 1, 2, 6],
    [10, 5, 6, 9],
    [6, 2, 4, 7],
  ];
  const r = icc(X)!;
  it('ICC(A,1) = ICC(2,1) = 0.29, ICC(C,1) = ICC(3,1) = 0.71', () => {
    expect(r.agreement).toBeCloseTo(0.2897637795275592, 10);
    expect(r.consistency).toBeCloseTo(0.7148407148407154, 10);
  });
  it('confidence intervals match psych::ICC', () => {
    expect(r.agreementCi![0]).toBeCloseTo(0.019, 2);
    expect(r.agreementCi![1]).toBeCloseTo(0.76, 2);
    expect(r.consistencyCi![0]).toBeCloseTo(0.34, 2);
    expect(r.consistencyCi![1]).toBeCloseTo(0.95, 2);
  });
  it('SEM and MDC95', () => {
    expect(r.semConsistency).toBeCloseTo(Math.sqrt(r.mse), 12);
    expect(r.mdc95).toBeCloseTo(1.959963984540054 * Math.SQRT2 * r.semAgreement, 12);
  });
  it('rejects incomplete matrices', () => {
    expect(icc([[1, 2], [3]])).toBeNull();
    expect(icc([[1, 2]])).toBeNull();
    expect(icc([[1, NaN], [2, 3]])).toBeNull();
  });
});

describe('flags, ranges, drift, sufficiency', () => {
  it('flags but never removes pairs', () => {
    const pairs: Pair[] = [...PAIRS, { imu: 120, ref: 90, id: 'outlier' }];
    const flags = flagPairs(pairs, 5);
    expect(flags.get(10)).toEqual(expect.arrayContaining(['robust_outlier', 'above_review_threshold']));
    expect(pairs).toHaveLength(11);
  });
  it('bins by reference angle', () => {
    const bins = rangeAgreement([{ imu: 10, ref: 5 }, { imu: 40, ref: 35 }, { imu: 42, ref: 40 }], 30);
    expect(bins.map((b) => [b.from, b.summary.n])).toEqual([
      [0, 1],
      [30, 2],
    ]);
  });
  it('drift slope in degrees per trial', () => {
    expect(drift([0, 1, 2, 3])!.slope).toBeCloseTo(1, 12);
    expect(drift([1])).toBeNull();
  });
  it('sufficiency thresholds', () => {
    expect(sufficiency(0, 'summary')).toBe('none');
    expect(sufficiency(3, 'summary')).toBe('insufficient');
    expect(sufficiency(10, 'summary')).toBe('limited');
    expect(sufficiency(15, 'summary')).toBe('adequate');
    expect(sufficiency(9, 'bland_altman')).toBe('insufficient');
    expect(sufficiency(29, 'icc')).toBe('limited');
    expect(sufficiency(30, 'icc')).toBe('adequate');
  });
});
