// Формат imu-csv v1 — контракт с приложением NeuroMove (софт.md, раздел 1;
// разбор в приложении — website/src/devices/contract.ts). Только текст: файл не знает
// ни про Arduino, ни про датчики, поэтому проверяется на компьютере (test/host_test.cpp).
//
//   # imu-csv v1
//   # device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=trunk,upper_r,fore_r
//   # board=esp32s3 i2c_hz=100000 arm=right        ← свои пары: приложение хранит их как есть
//   # cal_fore_r=12,-30,45,10012,9988,10005         ← поправки акселерометра, если откалиброван
//   seq,trunk_ax,trunk_ay,trunk_az,trunk_gx,trunk_gy,trunk_gz,upper_r_ax,…,fore_r_gz
//   0,152,-40,8174,12,-35,7,…
//
// Строка «#» без знака «=» — просто сообщение человеку: приложение её пропускает.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

namespace imucsv {

// Номера мест — те же, что в пакете Bluetooth (софт.md): 0 — туловище, 1 — плечо Л, 2 — плечо П,
// 3 — предплечье Л, 4 — предплечье П
enum Place : uint8_t { TRUNK = 0, UPPER_L = 1, UPPER_R = 2, FORE_L = 3, FORE_R = 4 };

inline const char* placeName(Place p) {
  static const char* const NAMES[] = {"trunk", "upper_l", "upper_r", "fore_l", "fore_r"};
  return p <= FORE_R ? NAMES[p] : "unknown";
}

// Один отсчёт одного датчика — числа прямо из регистров MPU-6050, без пересчёта
struct Sample {
  int16_t ax, ay, az, gx, gy, gz;
};

// Поправки акселерометра из калибровки в 6 положениях (accel_cal.h). Плата их только хранит
// и печатает в паспорте; поток остаётся сырым, поправки применяет приложение.
//   off — ноль оси в единицах датчика; scale1e4 — масштаб оси × 10 000 (10 000 = ровно 1)
struct AccCal {
  int16_t off[3];
  uint16_t scale1e4[3];
};

// Все функции ниже пишут в buf строку (или строки) с '\n' на конце и возвращают длину.
// 0 — не хватило места в buf: такую строку не отправляем.

namespace detail {
// Учесть n знаков, только что дописанных snprintf; false — места не хватило
inline bool append(size_t cap, size_t* len, int n) {
  if (n < 0 || *len + (size_t)n >= cap) return false;
  *len += (size_t)n;
  return true;
}
}  // namespace detail

// Две обязательные строки паспорта: формат и устройство
inline size_t passport(char* buf, size_t cap, const char* device, const char* firmware, unsigned rateHz, unsigned accG,
                       unsigned gyroDps, const Place* places, size_t count) {
  size_t len = 0;
  if (!detail::append(cap, &len,
                      snprintf(buf, cap, "# imu-csv v1\n# device=%s fw=%s rate_hz=%u acc_g=%u gyro_dps=%u sensors=",
                               device, firmware, rateHz, accG, gyroDps)))
    return 0;
  for (size_t i = 0; i < count; i++) {
    if (!detail::append(cap, &len, snprintf(buf + len, cap - len, "%s%s", i ? "," : "", placeName(places[i]))))
      return 0;
  }
  if (!detail::append(cap, &len, snprintf(buf + len, cap - len, "\n"))) return 0;
  return len;
}

// Строка поправок одного датчика: # cal_fore_r=12,-30,45,10012,9988,10005
inline size_t calibration(char* buf, size_t cap, Place place, const AccCal& c) {
  size_t len = 0;
  if (!detail::append(cap, &len,
                      snprintf(buf, cap, "# cal_%s=%d,%d,%d,%u,%u,%u\n", placeName(place), c.off[0], c.off[1], c.off[2],
                               (unsigned)c.scale1e4[0], (unsigned)c.scale1e4[1], (unsigned)c.scale1e4[2])))
    return 0;
  return len;
}

// Заголовок столбцов: seq, затем по 6 столбцов на датчик в порядке паспорта
inline size_t header(char* buf, size_t cap, const Place* places, size_t count) {
  static const char* const AXES[] = {"ax", "ay", "az", "gx", "gy", "gz"};
  size_t len = 0;
  if (!detail::append(cap, &len, snprintf(buf, cap, "seq"))) return 0;
  for (size_t i = 0; i < count; i++) {
    for (size_t a = 0; a < 6; a++) {
      if (!detail::append(cap, &len, snprintf(buf + len, cap - len, ",%s_%s", placeName(places[i]), AXES[a])))
        return 0;
    }
  }
  if (!detail::append(cap, &len, snprintf(buf + len, cap - len, "\n"))) return 0;
  return len;
}

// Строка отсчёта: номер и по 6 целых чисел на датчик
inline size_t row(char* buf, size_t cap, uint32_t seq, const Sample* samples, size_t count) {
  size_t len = 0;
  if (!detail::append(cap, &len, snprintf(buf, cap, "%lu", (unsigned long)seq))) return 0;
  for (size_t i = 0; i < count; i++) {
    const Sample& s = samples[i];
    if (!detail::append(cap, &len,
                        snprintf(buf + len, cap - len, ",%d,%d,%d,%d,%d,%d", s.ax, s.ay, s.az, s.gx, s.gy, s.gz)))
      return 0;
  }
  if (!detail::append(cap, &len, snprintf(buf + len, cap - len, "\n"))) return 0;
  return len;
}

}  // namespace imucsv
