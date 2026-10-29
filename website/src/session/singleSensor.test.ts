// Проверка одним датчиком (22 октября 2026): тот же виртуальный пациент и то же зерно, что у полного
// комплекта, но в поток идёт только один датчик. Подъём руки по датчику плеча и поворот по датчику
// предплечья считаются теми же формулами — числа должны совпасть с полным комплектом.
//
// Сгибания в локте в этом режиме нет: одним датчиком на предплечье локоть считается только при
// неподвижном плече. На модели пациента ошибка равна отрыву плеча — 5° при лёгком поражении,
// 9–10° при среднем, 14° и 18–19° при тяжёлом (log/2026-10-22-один-датчик.md).

import { describe, expect, it } from 'vitest';
import { requiredPlacements } from '../state/sessionController';
import { SINGLE_SENSOR_EXERCISES, singleSensorSteps } from '../core/protocols';
import { buildProfile } from '../simulation/profiles';
import { runVirtualSession } from '../simulation/runVirtualSession';
import { SinglePlacementDevice } from '../devices/SinglePlacementDevice';
import { emptyStatus, type DeviceStatus, type NeuroMoveDevice, type RawFrame } from '../devices/types';

// Правая рука поражена
const profile = buildProfile({ left: 0.05, right: 0.4 });

function summary(r: ReturnType<typeof runVirtualSession>, exercise: string) {
  const s = r.steps.find((x) => x.summary.exercise === exercise)?.summary;
  if (!s) throw new Error(`нет шага ${exercise}`);
  return s;
}

describe('один датчик на плече: подъём руки', () => {
  const steps = singleSensorSteps('upper', 'right', SINGLE_SENSOR_EXERCISES.upper, 3);
  const full = runVirtualSession({ profile, steps, seed: 11 });
  const single = runVirtualSession({ profile, steps, seed: 11, singleSensor: 'upper_r' });

  it('оба шага пройдены, по 3 повтора', () => {
    expect(single.completed).toBe(true);
    for (const s of single.steps) expect(s.summary.reps.length).toBe(3);
  });

  it('размах тот же, что у полного комплекта', () => {
    for (const ex of SINGLE_SENSOR_EXERCISES.upper) {
      expect(Math.abs(summary(single, ex).rom - summary(full, ex).rom)).toBeLessThan(0.5);
    }
  });

  it('компенсации туловищем нет: датчика груди нет, и это не ноль, а пусто', () => {
    expect(summary(full, 'shoulder_flexion').trunk).not.toBeNull();
    expect(summary(single, 'shoulder_flexion').trunk).toBeNull();
  });
});

describe('один датчик на предплечье: поворот', () => {
  const steps = singleSensorSteps('fore', 'right', SINGLE_SENSOR_EXERCISES.fore, 3);
  const full = runVirtualSession({ profile, steps, seed: 23 });
  const single = runVirtualSession({ profile, steps, seed: 23, singleSensor: 'fore_r' });

  it('шаг пройден, 3 повтора, без потери датчика', () => {
    expect(single.completed).toBe(true);
    const s = single.steps[0];
    expect(s?.status).toBe('done');
    expect(s?.summary.reps.length).toBe(3);
    expect(s?.summary.flags).not.toContain('sensor_lost');
  });

  it('те же супинация и пронация, что у полного комплекта', () => {
    const a = summary(single, 'forearm_rotation');
    const b = summary(full, 'forearm_rotation');
    expect(Math.abs((a.supination ?? 0) - (b.supination ?? 0))).toBeLessThan(0.5);
    expect(Math.abs((a.pronation ?? 0) - (b.pronation ?? 0))).toBeLessThan(0.5);
  });

  it('сгибания в локте в режиме одного датчика нет', () => {
    expect(SINGLE_SENSOR_EXERCISES.fore).not.toContain('elbow_flexion');
    expect(SINGLE_SENSOR_EXERCISES.upper).not.toContain('elbow_flexion');
  });
});

describe('нужные датчики', () => {
  it('один датчик — только он', () => {
    const steps = singleSensorSteps('fore', 'left', SINGLE_SENSOR_EXERCISES.fore, 3);
    expect(requiredPlacements(steps, { placement: 'fore_l' })).toEqual(['fore_l']);
  });

  it('без режима одного датчика — как раньше: плечо и предплечье', () => {
    const steps = singleSensorSteps('fore', 'left', SINGLE_SENSOR_EXERCISES.fore, 3);
    expect(requiredPlacements(steps).sort()).toEqual(['fore_l', 'upper_l']);
  });

  it('движения выбираются только из тех, что видит сегмент', () => {
    expect(singleSensorSteps('upper', 'left', ['elbow_flexion', 'shoulder_flexion'], 3).map((s) => s.exercise)).toEqual(['shoulder_flexion']);
  });
});

// Устройство-заглушка: один датчик, названный прошивкой по проводке
class FakeDevice implements NeuroMoveDevice {
  readonly kind = 'usb' as const;
  status: DeviceStatus;
  private dataCb: ((f: readonly RawFrame[]) => void) | null = null;
  constructor(placements: ('upper_r' | 'fore_r' | 'trunk')[]) {
    this.status = {
      ...emptyStatus(),
      phase: 'streaming',
      sensors: placements.map((placement) => ({ placement, online: true, battery: null, lowBattery: false, link: 1 })),
      info: {
        id: 'NM-01',
        name: 'NM-01',
        kind: 'usb',
        firmware: '0.1',
        format: 'imu-csv v1',
        rateHz: 100,
        accRangeG: 4,
        gyroRangeDps: 1000,
        placements,
        simulated: false,
        accCal: { upper_r: { off: [1, 2, 3], scale: [1, 1, 1] } },
        moduleIds: { upper_r: '5A4C6311' },
      },
    };
  }
  connect = async () => {};
  disconnect = async () => {};
  start = async () => {};
  stop = async () => {};
  getStatus = () => this.status;
  onStatus = () => () => {};
  onData = (cb: (f: readonly RawFrame[]) => void) => {
    this.dataCb = cb;
    return () => {
      this.dataCb = null;
    };
  };
  emit(frame: RawFrame) {
    this.dataCb?.([frame]);
  }
}

describe('SinglePlacementDevice: датчик под местом, где он надет', () => {
  it('единственный датчик переименован вместе с поправками и отпечатком', () => {
    const inner = new FakeDevice(['upper_r']);
    const dev = new SinglePlacementDevice(inner, 'fore_l');
    const s = dev.getStatus();
    expect(s.sensors.map((x) => x.placement)).toEqual(['fore_l']);
    expect(s.info?.placements).toEqual(['fore_l']);
    expect(s.info?.accCal?.fore_l).toEqual({ off: [1, 2, 3], scale: [1, 1, 1] });
    expect(s.info?.accCal?.upper_r).toBeUndefined();
    expect(s.info?.moduleIds?.fore_l).toBe('5A4C6311');

    const got: RawFrame[] = [];
    dev.onData((fs) => got.push(...fs));
    const raw = new Int16Array([1, 2, 8192, 0, 0, 0]);
    inner.emit({ seq: 5, t: 0.05, data: { upper_r: raw } });
    expect(Object.keys(got[0]?.data ?? {})).toEqual(['fore_l']);
    expect(got[0]?.data.fore_l).toBe(raw);
  });

  it('несколько датчиков — ничего не трогает: это полный комплект', () => {
    const inner = new FakeDevice(['upper_r', 'fore_r', 'trunk']);
    const dev = new SinglePlacementDevice(inner, 'fore_l');
    expect(dev.getStatus().sensors.map((x) => x.placement)).toEqual(['upper_r', 'fore_r', 'trunk']);
  });

  it('датчик уже на нужном месте — ничего не трогает', () => {
    const inner = new FakeDevice(['upper_r']);
    const dev = new SinglePlacementDevice(inner, 'upper_r');
    expect(dev.getStatus()).toBe(inner.status);
  });
});
