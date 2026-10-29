// Программная шина I2C: третья шина для третьего датчика.
//
// Зачем. У ESP32 две аппаратные шины I2C (Wire и Wire1). У MPU-6050 два адреса: 0x68 (AD0 на GND)
// и 0x69 (AD0 на 3V3). С кабелем на 4 жилы (VCC, GND, SCL, SDA) провода к AD0 нет, и все три датчика
// отвечают на 0x68. Значит, каждому нужна своя шина, а третью шину ESP32 рисует программой:
// сама дёргает линии SCL и SDA по правилам I2C.
//
// Как по правилам (NXP UM10204, «I2C-bus specification», rev. 7.0, разделы 3.1.4–3.1.10):
//   • линию никто не тянет вверх — её отпускают, вверх её тянет резистор подтяжки (на GY-521 — свой);
//     вниз её прижимают. Поэтому здесь не «записать 1», а «отпустить»;
//   • данные на SDA меняются, только пока SCL внизу; пока SCL наверху, SDA читают;
//   • «старт» — SDA вниз при SCL наверху, «стоп» — SDA вверх при SCL наверху;
//   • после каждого байта — девятый такт: тот, кто принимал, прижимает SDA («понял», ACK)
//     или отпускает («не понял» или «хватит», NACK).
//
// Как и mpu6050.h, файл не знает про Arduino: линии и паузы — снаружи (I2cPins). На плате это выводы
// ESP32 (NeuroMoveStand.ino, EspPins), в проверке на компьютере — модель датчика, которая видит
// каждый фронт линий (test/host_test.cpp, PinMpu).
#pragma once
#include <stdint.h>

#include "mpu6050.h"

// Две линии шины глазами ведущего
class I2cPins {
 public:
  virtual ~I2cPins() {}
  // true — отпустить линию (вверх её поднимет подтяжка), false — прижать к земле
  virtual void scl(bool release) = 0;
  virtual void sda(bool release) = 0;
  virtual bool readScl() = 0;
  virtual bool readSda() = 0;
  // Пауза в половину такта: на 100 кГц — 5 мкс
  virtual void halfBit() = 0;
};

class SoftI2c : public I2cBus {
 public:
  // Сколько полутактов ждать, пока ведомый держит SCL внизу («растягивает такт»). MPU-6050 так
  // не делает, но обрыв или замыкание SCL на землю выглядит так же — и тогда транзакция не должна
  // висеть: 200 полутактов на 100 кГц — 1 мс
  static const uint16_t STRETCH_LIMIT = 200;

  explicit SoftI2c(I2cPins& pins) : p_(pins) {}

  // Отпустить обе линии — шина свободна
  void idle() {
    p_.sda(true);
    p_.scl(true);
  }

  bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) override {
    const bool ok = start() && byteOut((uint8_t)(addr << 1)) && byteOut(reg) && byteOut(value);
    stop();
    return ok;
  }

  bool readRegs(uint8_t addr, uint8_t reg, uint8_t* out, uint8_t len) override {
    // Номер регистра, затем повторный старт без «стоп» — как WireBus::readRegs
    bool ok = start() && byteOut((uint8_t)(addr << 1)) && byteOut(reg) && start() && byteOut((uint8_t)(addr << 1 | 1));
    for (uint8_t i = 0; ok && i < len; i++) ok = byteIn(&out[i], i + 1 < len);  // последний байт — NACK: хватит
    stop();
    return ok;
  }

  bool probe(uint8_t addr) override {
    const bool ok = start() && byteOut((uint8_t)(addr << 1));
    stop();
    return ok;
  }

 private:
  I2cPins& p_;

  // Отпустить SCL и дождаться, что линия правда наверху
  bool sclUp() {
    p_.scl(true);
    for (uint16_t i = 0; !p_.readScl(); i++) {
      if (i >= STRETCH_LIMIT) return false;
      p_.halfBit();
    }
    return true;
  }

  // Старт или повторный старт. Начинается при SCL внизу (повторный) или на свободной шине
  bool start() {
    p_.sda(true);
    p_.halfBit();
    if (!sclUp()) return false;
    // SDA внизу при отпущенной линии — её держит ведомый: шина занята, начинать нельзя
    if (!p_.readSda()) return false;
    p_.halfBit();
    p_.sda(false);
    p_.halfBit();
    p_.scl(false);
    return true;
  }

  // «Стоп». Сначала SCL вниз: после сбоя SCL может остаться наверху, и SDA вниз дала бы лишний «старт»
  void stop() {
    p_.scl(false);
    p_.halfBit();
    p_.sda(false);
    p_.halfBit();
    sclUp();
    p_.halfBit();
    p_.sda(true);
    p_.halfBit();
  }

  // Байт ведомому, старший бит первым. true — ведомый ответил ACK
  bool byteOut(uint8_t b) {
    for (uint8_t i = 0; i < 8; i++) {
      p_.sda((b & 0x80) != 0);
      b = (uint8_t)(b << 1);
      p_.halfBit();
      if (!sclUp()) return false;
      p_.halfBit();
      p_.scl(false);
    }
    p_.sda(true);  // отпустить SDA: девятый такт — ответ ведомого
    p_.halfBit();
    if (!sclUp()) return false;
    p_.halfBit();
    const bool ack = !p_.readSda();
    p_.scl(false);
    return ack;
  }

  // Байт от ведомого. ack = true — «ещё», false — «хватит» (последний байт)
  bool byteIn(uint8_t* out, bool ack) {
    uint8_t b = 0;
    p_.sda(true);
    for (uint8_t i = 0; i < 8; i++) {
      p_.halfBit();
      if (!sclUp()) return false;
      p_.halfBit();
      b = (uint8_t)(b << 1 | (p_.readSda() ? 1 : 0));
      p_.scl(false);
    }
    p_.sda(!ack);
    p_.halfBit();
    if (!sclUp()) return false;
    p_.halfBit();
    p_.scl(false);
    p_.sda(true);
    *out = b;
    return true;
  }
};
