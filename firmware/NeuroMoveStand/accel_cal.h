// Калибровка акселерометра в 6 положениях (прототип.md, раздел 5, риск 2).
//
// Заводской ноль акселерометра MPU-6050 — до ±50 мг по X и Y и до ±80 мг по Z (datasheet
// PS-MPU-6000A-00, rev. 3.4, раздел 6.2). Для угла наклона это до ~3° ошибки — больше половины
// допуска 5°. Лечится один раз для каждого датчика: его кладут на стол шестью гранями вниз.
// В каждом положении одна ось смотрит строго вверх или вниз и видит +1 g или −1 g
// (датчик в покое меряет опору стола, поэтому ось «вверх» показывает +1 g), две другие — около нуля.
//
//   ноль оси    = (среднее при +1 g + среднее при −1 g) / 2
//   масштаб оси = (среднее при +1 g − среднее при −1 g) / 2 / 8192
//
// Поправки плата хранит и печатает в паспорте (# cal_fore_r=…). Поток остаётся сырым:
// поправки применяет приложение, поэтому любую старую запись можно пересчитать.
#pragma once
#include <math.h>
#include <stdint.h>

#include "imu_csv.h"

namespace acccal {

// ±4 g: 8192 единицы на 1 g
const int32_t ONE_G = 8192;
// Сколько отсчётов на положение: 1,5 с при 100 Гц
const uint32_t SAMPLES_PER_POSE = 150;

// Шесть положений — в том порядке, в каком их просит прошивка
enum Pose : uint8_t { Z_UP = 0, Z_DOWN, X_UP, X_DOWN, Y_UP, Y_DOWN, POSE_COUNT };

// Какая ось смотрит вверх или вниз: 0 — X, 1 — Y, 2 — Z
inline uint8_t poseAxis(Pose p) {
  return (p == X_UP || p == X_DOWN) ? 0 : (p == Y_UP || p == Y_DOWN) ? 1 : 2;
}

// +1 — ось вверх (видит +1 g), −1 — вниз
inline int poseSign(Pose p) {
  return (p == Z_UP || p == X_UP || p == Y_UP) ? 1 : -1;
}

// Подсказка человеку — какой гранью положить датчик (стрелки X и Y напечатаны на GY-521)
inline const char* poseHint(Pose p) {
  switch (p) {
    case Z_UP: return "плашмя, чипом вверх";
    case Z_DOWN: return "плашмя, чипом вниз";
    case X_UP: return "на торец, стрелка X смотрит вверх";
    case X_DOWN: return "на торец, стрелка X смотрит вниз";
    case Y_UP: return "на бок, стрелка Y смотрит вверх";
    case Y_DOWN: return "на бок, стрелка Y смотрит вниз";
    default: return "";
  }
}

// Почему положение не принято
enum Verdict : uint8_t { OK = 0, TOO_FEW, WRONG_FACE, MOVED };

// Накопитель одного датчика: суммы по каждому положению
class Calibrator {
 public:
  Calibrator() { reset(); }

  void reset() {
    for (uint8_t p = 0; p < POSE_COUNT; p++) resetPose((Pose)p);
  }

  void resetPose(Pose p) {
    n_[p] = 0;
    for (uint8_t a = 0; a < 3; a++) sum_[p][a] = sumSq_[p][a] = 0;
  }

  void add(Pose p, const imucsv::Sample& s) {
    const int32_t v[3] = {s.ax, s.ay, s.az};
    for (uint8_t a = 0; a < 3; a++) {
      sum_[p][a] += v[a];
      sumSq_[p][a] += (int64_t)v[a] * v[a];
    }
    n_[p]++;
  }

  // Среднее по оси в положении, единицы датчика
  double mean(Pose p, uint8_t axis) const {
    return n_[p] ? (double)sum_[p][axis] / n_[p] : 0.0;
  }

  // Разброс по оси (стандартное отклонение) — двигали ли датчик
  double spread(Pose p, uint8_t axis) const {
    if (n_[p] < 2) return 0.0;
    const double m = mean(p, axis);
    const double var = (double)sumSq_[p][axis] / n_[p] - m * m;
    return var > 0 ? sqrt(var) : 0.0;
  }

  // Принять ли положение: нужная ось видит 0,8–1,2 g с нужным знаком, две другие — меньше 0,25 g,
  // и за время замера датчик не двигали (разброс меньше 0,03 g)
  Verdict check(Pose p) const {
    if (n_[p] < SAMPLES_PER_POSE) return TOO_FEW;
    const uint8_t axis = poseAxis(p);
    const double up = poseSign(p) * mean(p, axis);
    if (up < 0.8 * ONE_G || up > 1.2 * ONE_G) return WRONG_FACE;
    for (uint8_t a = 0; a < 3; a++) {
      if (a != axis && fabs(mean(p, a)) > 0.25 * ONE_G) return WRONG_FACE;
      if (spread(p, a) > 0.03 * ONE_G) return MOVED;
    }
    return OK;
  }

  // Поправки. false — не все положения сняты или числа неправдоподобны (ноль дальше 0,2 g,
  // масштаб вне 0,9–1,1): такой датчик лучше заменить, чем «чинить» поправками
  bool result(imucsv::AccCal* out) const {
    const Pose plus[3] = {X_UP, Y_UP, Z_UP};
    const Pose minus[3] = {X_DOWN, Y_DOWN, Z_DOWN};
    for (uint8_t a = 0; a < 3; a++) {
      if (check(plus[a]) != OK || check(minus[a]) != OK) return false;
      const double hi = mean(plus[a], a);
      const double lo = mean(minus[a], a);
      const double off = (hi + lo) / 2.0;
      const double scale = (hi - lo) / 2.0 / ONE_G;
      if (fabs(off) > 0.2 * ONE_G || scale < 0.9 || scale > 1.1) return false;
      out->off[a] = (int16_t)lround(off);
      out->scale1e4[a] = (uint16_t)lround(scale * 10000.0);
    }
    return true;
  }

 private:
  int64_t sum_[POSE_COUNT][3];
  int64_t sumSq_[POSE_COUNT][3];
  uint32_t n_[POSE_COUNT];
};

}  // namespace acccal
