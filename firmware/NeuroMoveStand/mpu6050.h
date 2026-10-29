// MPU-6050: регистры и настройка по контракту. Шина — абстрактная (I2cBus): на плате это Wire
// или Wire1, в проверке на компьютере — поддельный датчик (test/host_test.cpp). Поэтому файл
// не зависит от Arduino.
//
// Номера и биты регистров — MPU-6000/MPU-6050 Register Map and Descriptions, rev. 4.2.
#pragma once
#include <stdint.h>

#include "imu_csv.h"

// Шина I2C глазами датчика: записать регистр, прочитать несколько подряд
class I2cBus {
 public:
  virtual ~I2cBus() {}
  // Записать один регистр. false — датчик не ответил (нет на шине, обрыв провода)
  virtual bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) = 0;
  // Прочитать len регистров подряд начиная с reg (датчик сам сдвигает номер регистра)
  virtual bool readRegs(uint8_t addr, uint8_t reg, uint8_t* out, uint8_t len) = 0;
  // Отвечает ли кто-нибудь по адресу — для команды scan. Шины на плате спрашивают один адрес;
  // здесь, для поддельных шин проверки, — чтение WHO_AM_I
  virtual bool probe(uint8_t addr) {
    uint8_t id = 0;
    return readRegs(addr, 0x75, &id, 1);
  }
};

namespace mpu {

const uint8_t REG_SELF_TEST_X = 0x0D;  // 0x0D–0x10: заводские значения самопроверки
const uint8_t REG_SMPLRT_DIV = 0x19;
const uint8_t REG_CONFIG = 0x1A;
const uint8_t REG_GYRO_CONFIG = 0x1B;
const uint8_t REG_ACCEL_CONFIG = 0x1C;
const uint8_t REG_ACCEL_XOUT_H = 0x3B;
const uint8_t REG_PWR_MGMT_1 = 0x6B;
const uint8_t REG_WHO_AM_I = 0x75;

// Сброс всех регистров (PWR_MGMT_1, бит 7). После него датчик молчит около 100 мс
const uint8_t RESET = 0x80;
// Проснуться и тактироваться от гироскопа X: стабильнее встроенного генератора (так советует документация)
const uint8_t CLOCK_PLL_X = 0x01;
// Внутренняя частота 1 кГц (при включённом фильтре делитель 0): плата читает раз в 10 мс
// и всегда получает отсчёт не старше 1 мс
const uint8_t RATE_DIV_1KHZ = 0x00;
// Фильтр датчика DLPF_CFG = 3: полоса около 44 Гц у акселерометра и 42 Гц у гироскопа — меньше
// половины от 100 отсчётов в секунду, поэтому быстрая дрожь не «заворачивается» в медленную
const uint8_t DLPF_44HZ = 0x03;
// FS_SEL = 2: гироскоп ±1000 °/с — 32,8 единицы на 1 °/с (контракт, софт.md)
const uint8_t GYRO_1000DPS = 0x10;
// AFS_SEL = 1: акселерометр ±4 g — 8192 единицы на 1 g (контракт, софт.md)
const uint8_t ACCEL_4G = 0x08;
// Биты диапазона в GYRO_CONFIG и ACCEL_CONFIG — 3 и 4
const uint8_t RANGE_MASK = 0x18;

// Настоящий MPU-6050 отвечает на WHO_AM_I числом 0x68. Модули GY-521 бывают с копиями чипа —
// 0x70, 0x72, 0x98. Регистры у них те же, поэтому такой датчик не отбрасываем, а пишем
// предупреждение в монитор порта: если углы странные — подозреваемый первый
const uint8_t WHO_AM_I_GENUINE = 0x68;

inline bool whoAmI(I2cBus& bus, uint8_t addr, uint8_t* id) {
  return bus.readRegs(addr, REG_WHO_AM_I, id, 1);
}

// Отпечаток модуля: заводские значения самопроверки, регистры 0x0D–0x10 (RM-MPU-6000A-00 rev 4.0,
// раздел 4.1). У каждого чипа свои и после сброса не меняются. Серийного номера у MPU-6050 нет — это
// лучшее, что есть: по 30 битам видно, что на месте датчика стоит другой модуль, и поправки калибровки
// чужого модуля не применятся. У копий чипа бывают нули — тогда отпечатком пользоваться нельзя.
inline bool fingerprint(I2cBus& bus, uint8_t addr, uint32_t* fp) {
  uint8_t b[4];
  if (!bus.readRegs(addr, REG_SELF_TEST_X, b, 4)) return false;
  *fp = ((uint32_t)b[0] << 24) | ((uint32_t)b[1] << 16) | ((uint32_t)b[2] << 8) | (uint32_t)b[3];
  return true;
}

// Отпечатком можно пользоваться: не пустой (копия чипа) и не «висящая линия»
inline bool fingerprintUsable(uint32_t fp) {
  return fp != 0 && fp != 0xFFFFFFFFu;
}

// Ответ на WHO_AM_I похож на датчик: не пустая шина (0x00) и не висящая линия (0xFF)
inline bool looksLikeImu(uint8_t id) {
  return id != 0x00 && id != 0xFF;
}

// Сброс и настройка по контракту. delayMs — пауза: на плате delay(), в проверке — пустая функция.
// Возвращает false, если датчик не ответил или диапазоны не записались — тогда числа были бы
// в чужом масштабе, и такой датчик в поток не пускаем.
inline bool configure(I2cBus& bus, uint8_t addr, void (*delayMs)(uint32_t)) {
  if (!bus.writeReg(addr, REG_PWR_MGMT_1, RESET)) return false;
  delayMs(100);
  if (!bus.writeReg(addr, REG_PWR_MGMT_1, CLOCK_PLL_X)) return false;
  if (!bus.writeReg(addr, REG_SMPLRT_DIV, RATE_DIV_1KHZ)) return false;
  if (!bus.writeReg(addr, REG_CONFIG, DLPF_44HZ)) return false;
  if (!bus.writeReg(addr, REG_GYRO_CONFIG, GYRO_1000DPS)) return false;
  if (!bus.writeReg(addr, REG_ACCEL_CONFIG, ACCEL_4G)) return false;
  delayMs(50);  // фильтр и гироскоп выходят на режим
  uint8_t g = 0, a = 0;
  if (!bus.readRegs(addr, REG_GYRO_CONFIG, &g, 1)) return false;
  if (!bus.readRegs(addr, REG_ACCEL_CONFIG, &a, 1)) return false;
  return (g & RANGE_MASK) == GYRO_1000DPS && (a & RANGE_MASK) == ACCEL_4G;
}

// Число из двух байт: старший первым, со знаком
inline int16_t be16(const uint8_t* b) {
  return (int16_t)(uint16_t)(((uint16_t)b[0] << 8) | b[1]);
}

// 14 байт начиная с 0x3B: ускорение X, Y, Z, температура, поворот X, Y, Z. Температуру не берём
inline imucsv::Sample decode(const uint8_t r[14]) {
  imucsv::Sample s;
  s.ax = be16(r + 0);
  s.ay = be16(r + 2);
  s.az = be16(r + 4);
  s.gx = be16(r + 8);
  s.gy = be16(r + 10);
  s.gz = be16(r + 12);
  return s;
}

// Один отсчёт одним чтением: все 14 байт за раз, чтобы оси были из одного момента
inline bool read(I2cBus& bus, uint8_t addr, imucsv::Sample* s) {
  uint8_t r[14];
  if (!bus.readRegs(addr, REG_ACCEL_XOUT_H, r, 14)) return false;
  *s = decode(r);
  return true;
}

}  // namespace mpu
