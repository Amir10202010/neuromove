// Стенд: какие датчики на месте, чтение по расписанию, строки в порт, перезапуск шины при сбоях.
//
// Не знает про Arduino: шины, порт и паузы приходят снаружи (StandIo). На плате это Wire, Wire1,
// программная шина (soft_i2c.h), Serial и delay(); в проверке на компьютере — поддельные датчики и строка в памяти
// (test/host_test.cpp). Поэтому всё поведение стенда проверено до того, как появилось железо.
//
// Правила потока:
//   • строка отсчёта уходит, только если ответили все датчики потока — иначе номер отсчёта
//     пропускается, и приложение честно видит пропуск;
//   • паспорт и заголовок повторяются каждые 2 с и сразу после смены набора датчиков;
//   • сообщения человеку — строки «#» без знака «=»: приложение их пропускает.
#pragma once
#include <stdint.h>
#include <stdio.h>

#include "config.h"
#include "imu_csv.h"
#include "mpu6050.h"
#include "scheduler.h"

// Всё, что стенду нужно от платы
struct StandIo {
  static const uint8_t MAX_BUSES = 3;
  I2cBus* bus[MAX_BUSES];  // шины 0…cfg::BUS_COUNT − 1
  // Отправить текст в порт
  void (*write)(const char* text, size_t len);
  void (*delayMs)(uint32_t ms);
  // Перезапуск шины: на плате — 9 тактов SCL, чтобы застрявший датчик отпустил SDA, и Wire заново
  void (*recoverBus)(uint8_t bus);
};

class Stand {
 public:
  static const uint8_t MAX_SLOTS = 5;

  Stand(const cfg::Slot* slots, uint8_t count, const StandIo& io)
      : slots_(slots), count_(count > MAX_SLOTS ? MAX_SLOTS : count), io_(io), sched_(1000000u / cfg::RATE_HZ) {
    for (uint8_t i = 0; i < MAX_SLOTS; i++) {
      state_[i] = State();
    }
  }

  // Найти и настроить датчики. Возвращает, сколько нашлось
  uint8_t begin() {
    for (uint8_t i = 0; i < count_; i++) tryAttach(i);
    needPassport_ = true;
    return activeCount();
  }

  // Поправки акселерометра из памяти платы — попадут в паспорт, если принадлежат этому модулю.
  // calFp — отпечаток модуля, для которого их сняли (0 — неизвестен)
  void setCalibration(uint8_t slot, const imucsv::AccCal& c, uint32_t calFp) {
    if (slot >= count_) return;
    state_[slot].hasCal = true;
    state_[slot].cal = c;
    state_[slot].calFp = calFp;
    needPassport_ = true;
  }

  // Отпечаток модуля на месте slot (0 — нет датчика или отпечаток недоступен)
  uint32_t fingerprint(uint8_t slot) const { return slot < count_ && state_[slot].present ? state_[slot].fp : 0; }

  // Поправки этого места сняты с другого модуля — в поток не идут
  bool calibrationForeign(uint8_t slot) const { return slot < count_ && foreign(state_[slot]); }

  void clearCalibration(uint8_t slot) {
    if (slot >= count_) return;
    state_[slot].hasCal = false;
    needPassport_ = true;
  }

  // Шаг основного цикла. nowUs — micros(), nowMs — millis()
  void tick(uint32_t nowUs, uint32_t nowMs) {
    if (paused_) return;
    if (activeCount() == 0) {
      // Ни одного датчика: не шлём строк вовсе, ищем снова каждые 2 с
      if (!started_ || nowMs - lastScanMs_ >= cfg::PASSPORT_EVERY_MS) {
        started_ = true;
        lastScanMs_ = nowMs;
        if (rescan()) {
          needPassport_ = true;  // датчики появились — следующий шаг начнётся с паспорта
        } else {
          say("# нет ни одного датчика: проверьте питание 3V3, GND, SDA, SCL и вывод AD0. Ищу снова каждые 2 с\n");
        }
      }
      return;
    }
    if (!started_ || nowMs - lastPassportMs_ >= cfg::PASSPORT_EVERY_MS) needPassport_ = true;
    started_ = true;
    if (nowMs - lastScanMs_ >= cfg::RESCAN_EVERY_MS) {
      lastScanMs_ = nowMs;
      if (rescan()) needPassport_ = true;
    }
    if (needPassport_) {
      printPassport();
      lastPassportMs_ = nowMs;
      needPassport_ = false;
    }

    uint32_t seq = 0;
    if (!sched_.due(nowUs, &seq)) return;

    imucsv::Sample samples[MAX_SLOTS];
    uint8_t k = 0;
    bool complete = true;
    for (uint8_t i = 0; i < count_; i++) {
      if (!state_[i].present) continue;
      if (mpu::read(bus(i), slots_[i].addr, &samples[k])) {
        state_[i].fails = 0;
        state_[i].recoveries = 0;
        k++;
      } else {
        complete = false;
        onReadFail(i);
      }
    }
    if (!complete) {
      skipped_++;
      return;
    }
    char line[ROW_CAP];
    const size_t len = imucsv::row(line, sizeof line, seq, samples, k);
    if (len) io_.write(line, len);
  }

  // Паспорт, свои пары, поправки, предупреждения и заголовок — подряд, перед строками отсчётов
  void printPassport() {
    imucsv::Place places[MAX_SLOTS];
    const uint8_t n = activePlaces(places);
    char buf[TEXT_CAP];
    size_t len = imucsv::passport(buf, sizeof buf, cfg::DEVICE, cfg::FIRMWARE, cfg::RATE_HZ, cfg::ACC_G, cfg::GYRO_DPS,
                                  places, n);
    if (len) io_.write(buf, len);
    const int m = snprintf(buf, sizeof buf, "# board=%s i2c_hz=%lu arm=%s\n", NM_BOARD_NAME,
                           (unsigned long)cfg::I2C_HZ, leftArm() ? "left" : "right");
    if (m > 0 && (size_t)m < sizeof buf) io_.write(buf, (size_t)m);
    // Отпечатки модулей одной строкой: приложение хранит их с сеансом — видно, каким модулем снят замер
    size_t idLen = 0;
    for (uint8_t i = 0; i < count_; i++) {
      if (!state_[i].present) continue;
      const int w = mpu::fingerprintUsable(state_[i].fp)
                        ? snprintf(buf + idLen, sizeof buf - idLen, "%s id_%s=%08lX", idLen ? "" : "#", imucsv::placeName(slots_[i].place), (unsigned long)state_[i].fp)
                        : snprintf(buf + idLen, sizeof buf - idLen, "%s id_%s=none", idLen ? "" : "#", imucsv::placeName(slots_[i].place));
      if (w > 0 && (size_t)w < sizeof buf - idLen) idLen += (size_t)w;
    }
    if (idLen && idLen + 1 < sizeof buf) {
      buf[idLen++] = '\n';
      io_.write(buf, idLen);
    }
    for (uint8_t i = 0; i < count_; i++) {
      if (!state_[i].present) continue;
      if (state_[i].hasCal && !foreign(state_[i])) {
        len = imucsv::calibration(buf, sizeof buf, slots_[i].place, state_[i].cal);
        if (len) io_.write(buf, len);
      } else if (state_[i].hasCal) {
        const int w = snprintf(buf, sizeof buf, "# внимание: поправки %s сняты с другого модуля (отпечаток %08lX, сейчас %08lX) — не применяю; выполните cal\n",
                               imucsv::placeName(slots_[i].place), (unsigned long)state_[i].calFp, (unsigned long)state_[i].fp);
        if (w > 0 && (size_t)w < sizeof buf) io_.write(buf, (size_t)w);
      }
      if (state_[i].whoami != mpu::WHO_AM_I_GENUINE) {
        const int w = snprintf(buf, sizeof buf, "# внимание: %s отвечает WHO_AM_I 0x%02X, а не 0x68 — копия чипа; регистры те же\n",
                               imucsv::placeName(slots_[i].place), state_[i].whoami);
        if (w > 0 && (size_t)w < sizeof buf) io_.write(buf, (size_t)w);
      }
    }
    len = imucsv::header(buf, sizeof buf, places, n);
    if (len) io_.write(buf, len);
  }

  // Калибровка и проверка: поток на паузе, отсчёты берёт тот, кто вызывает readSlot
  void pause(uint32_t nowMs) {
    paused_ = true;
    pausedAtMs_ = nowMs;
  }

  void resume(uint32_t nowUs, uint32_t nowMs) {
    if (!paused_) return;
    paused_ = false;
    sched_.resume(nowUs, nowMs - pausedAtMs_);
    needPassport_ = true;
  }

  bool readSlot(uint8_t slot, imucsv::Sample* s) {
    if (slot >= count_ || !state_[slot].present) return false;
    return mpu::read(bus(slot), slots_[slot].addr, s);
  }

  bool present(uint8_t slot) const { return slot < count_ && state_[slot].present; }
  uint8_t whoami(uint8_t slot) const { return slot < count_ ? state_[slot].whoami : 0; }
  uint8_t slotCount() const { return count_; }
  // Сколько строк отсчётов пропущено из-за сбоя чтения — для команды info
  uint32_t skipped() const { return skipped_; }
  // Сколько микросекунд до следующего отсчёта — основной цикл отдыхает, если больше 2 мс
  uint32_t untilNextUs(uint32_t nowUs) const { return sched_.untilNext(nowUs); }

  uint8_t activeCount() const {
    uint8_t n = 0;
    for (uint8_t i = 0; i < count_; i++) n += state_[i].present ? 1 : 0;
    return n;
  }

 private:
  // Строка отсчёта: номер + 5 датчиков × 6 чисел до 7 знаков — меньше 256
  static const size_t ROW_CAP = 256;
  // Паспорт или заголовок пяти датчиков — меньше 512
  static const size_t TEXT_CAP = 512;

  struct State {
    bool present;
    uint8_t whoami;
    uint8_t fails;
    uint8_t recoveries;
    uint32_t fp;
    bool hasCal;
    imucsv::AccCal cal;
    uint32_t calFp;
    State() : present(false), whoami(0), fails(0), recoveries(0), fp(0), hasCal(false), cal(), calFp(0) {}
  };

  // Поправки чужие, только если оба отпечатка настоящие и не совпадают. Отпечатка нет (копия чипа,
  // старые поправки) — проверить нечем, поправки применяются, а паспорт говорит id_<место>=none
  static bool foreign(const State& st) {
    return st.hasCal && mpu::fingerprintUsable(st.fp) && mpu::fingerprintUsable(st.calFp) && st.fp != st.calFp;
  }

  I2cBus& bus(uint8_t slot) { return *io_.bus[slots_[slot].bus]; }

  void say(const char* text) {
    size_t n = 0;
    while (text[n]) n++;
    io_.write(text, n);
  }

  bool leftArm() const {
    for (uint8_t i = 0; i < count_; i++) {
      if (slots_[i].place == imucsv::UPPER_L || slots_[i].place == imucsv::FORE_L) return true;
    }
    return false;
  }

  uint8_t activePlaces(imucsv::Place* out) const {
    uint8_t n = 0;
    for (uint8_t i = 0; i < count_; i++) {
      if (state_[i].present) out[n++] = slots_[i].place;
    }
    return n;
  }

  // Ответил на WHO_AM_I и настроился — в поток
  bool tryAttach(uint8_t i) {
    uint8_t id = 0;
    if (!mpu::whoAmI(bus(i), slots_[i].addr, &id) || !mpu::looksLikeImu(id)) return false;
    if (!mpu::configure(bus(i), slots_[i].addr, io_.delayMs)) {
      char buf[160];
      const int n = snprintf(buf, sizeof buf, "# %s: ответил, но не настроился (диапазоны не записались) — в поток не беру\n",
                             imucsv::placeName(slots_[i].place));
      if (n > 0 && (size_t)n < sizeof buf) io_.write(buf, (size_t)n);
      return false;
    }
    uint32_t fp = 0;
    state_[i].present = true;
    state_[i].fp = mpu::fingerprint(bus(i), slots_[i].addr, &fp) ? fp : 0;
    state_[i].whoami = id;
    state_[i].fails = 0;
    state_[i].recoveries = 0;
    return true;
  }

  // Поискать датчики, которых нет в потоке. Сколько вернулось
  uint8_t rescan() {
    uint8_t added = 0;
    for (uint8_t i = 0; i < count_; i++) {
      if (!state_[i].present && tryAttach(i)) added++;
    }
    return added;
  }

  void onReadFail(uint8_t i) {
    State& st = state_[i];
    if (++st.fails < cfg::FAILS_BEFORE_RECOVERY) return;
    st.fails = 0;
    const uint8_t b = slots_[i].bus;
    char buf[160];
    int n = snprintf(buf, sizeof buf, "# %s: %u чтений подряд без ответа — перезапускаю шину %u\n",
                     imucsv::placeName(slots_[i].place), (unsigned)cfg::FAILS_BEFORE_RECOVERY, (unsigned)b);
    if (n > 0 && (size_t)n < sizeof buf) io_.write(buf, (size_t)n);
    io_.recoverBus(b);
    // После перезапуска шины датчики на ней — с заводскими настройками: настраиваем снова.
    // Не настроился — не спешим: следующий перезапуск только после новых 10 неудач подряд,
    // иначе сбой на десятую долю секунды выкинул бы датчик из потока
    for (uint8_t j = 0; j < count_; j++) {
      if (slots_[j].bus == b && state_[j].present) mpu::configure(bus(j), slots_[j].addr, io_.delayMs);
    }
    if (++st.recoveries >= cfg::RECOVERIES_BEFORE_DROP) {
      st.present = false;
      st.recoveries = 0;
      needPassport_ = true;
      n = snprintf(buf, sizeof buf, "# %s: не отвечает после %u перезапусков — убираю из потока; вернётся сам, когда ответит\n",
                   imucsv::placeName(slots_[i].place), (unsigned)cfg::RECOVERIES_BEFORE_DROP);
      if (n > 0 && (size_t)n < sizeof buf) io_.write(buf, (size_t)n);
    }
  }

  const cfg::Slot* slots_;
  uint8_t count_;
  StandIo io_;
  Scheduler sched_;
  State state_[MAX_SLOTS];
  bool started_ = false;
  bool paused_ = false;
  bool needPassport_ = true;
  uint32_t lastPassportMs_ = 0;
  uint32_t lastScanMs_ = 0;
  uint32_t pausedAtMs_ = 0;
  uint32_t skipped_ = 0;
};
