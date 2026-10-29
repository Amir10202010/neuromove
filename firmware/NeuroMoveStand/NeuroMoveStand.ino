// Прошивка стенда NeuroMove — способ А (прототип.md): ESP32 и до трёх MPU-6050
// на проводах, поток imu-csv v1 по USB в приложение (Chrome → «Датчики» → USB → «Подключить»).
//
// Как устроено — по файлам этой папки:
//   config.h     выводы, места датчиков, частота, скорость порта — менять здесь
//   imu_csv.h    строки формата: паспорт, поправки, заголовок, отсчёт
//   mpu6050.h    регистры датчика и настройка по контракту
//   scheduler.h  100 отсчётов в секунду без дрейфа; пропуск виден по номеру отсчёта
//   stand.h      какие датчики на месте, чтение, перезапуск шины при сбое
//   soft_i2c.h   программная шина I2C — третья, для третьего датчика
//   accel_cal.h  калибровка акселерометра в 6 положениях
//   этот файл    всё, что зависит от Arduino: Wire, выводы программной шины, Serial, память поправок, команды
//
// Команды — в мониторе порта (460 800 бод, «новая строка»):
//   help       список команд
//   scan       какие адреса отвечают на каждой шине I2C
//   info       паспорт сейчас и по одному отсчёту каждого датчика в g и °/с
//   cal        калибровка акселерометров в 6 положениях, около 2 минут
//   cal clear  забыть поправки
// Приложение команд не шлёт: оно только читает поток.

#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>
#include <driver/gpio.h>

#include "accel_cal.h"
#include "config.h"
#include "soft_i2c.h"
#include "stand.h"

// ── Шины I2C ────────────────────────────────────────────────────────────────

// Шина Arduino (TwoWire) под интерфейс стенда I2cBus
class WireBus : public I2cBus {
 public:
  explicit WireBus(TwoWire& wire) : wire_(wire) {}

  bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) override {
    wire_.beginTransmission(addr);
    wire_.write(reg);
    wire_.write(value);
    return wire_.endTransmission() == 0;
  }

  bool readRegs(uint8_t addr, uint8_t reg, uint8_t* out, uint8_t len) override {
    wire_.beginTransmission(addr);
    wire_.write(reg);
    // false — без «стоп» между записью номера регистра и чтением (повторный старт)
    if (wire_.endTransmission(false) != 0) return false;
    // (int, int) — эта перегрузка есть и в ядре 2.x, и в 3.x: без неоднозначности
    if (wire_.requestFrom((int)addr, (int)len) != len) return false;
    for (uint8_t i = 0; i < len; i++) out[i] = (uint8_t)wire_.read();
    return true;
  }

  // Только адрес, без данных: ответил ACK — кто-то есть
  bool probe(uint8_t addr) override {
    wire_.beginTransmission(addr);
    return wire_.endTransmission() == 0;
  }

 private:
  TwoWire& wire_;
};

static WireBus bus0(Wire);
static WireBus bus1(Wire1);

#if NM_BUS_COUNT > 2
// Выводы программной шины. Режим «открытый сток» со входом: вывод только прижимает линию к земле или
// отпускает её, а читать линию можно в любой момент — так и нужно для I2C. Вызовы ESP-IDF (gpio_set_level,
// gpio_get_level) — те же в ядре Arduino-ESP32 2.x и 3.x и быстрее digitalWrite
class EspPins : public I2cPins {
 public:
  EspPins(int sda, int scl) : sda_((gpio_num_t)sda), scl_((gpio_num_t)scl) {}

  void begin() {
    for (gpio_num_t pin : {sda_, scl_}) {
      pinMode(pin, OUTPUT_OPEN_DRAIN);
      gpio_set_direction(pin, GPIO_MODE_INPUT_OUTPUT_OD);
      // Внутренняя подтяжка ~45 кОм — запас на случай, когда датчика нет: линии не висят в воздухе.
      // Рабочая подтяжка — 4,7 кОм на плате GY-521
      gpio_set_pull_mode(pin, GPIO_PULLUP_ONLY);
      gpio_set_level(pin, 1);
    }
  }

  void scl(bool release) override { gpio_set_level(scl_, release ? 1 : 0); }
  void sda(bool release) override { gpio_set_level(sda_, release ? 1 : 0); }
  bool readScl() override { return gpio_get_level(scl_) != 0; }
  bool readSda() override { return gpio_get_level(sda_) != 0; }
  // Полтакта: на 100 кГц — 5 мкс. Вместе с вызовами выходит чуть медленнее 100 кГц, это можно
  void halfBit() override { delayMicroseconds(500000u / cfg::I2C_HZ); }

 private:
  gpio_num_t sda_, scl_;
};

static EspPins pins2(NM_BUS2_SDA, NM_BUS2_SCL);
static SoftI2c bus2(pins2);
#endif

// Выводы шины b
static int busSda(uint8_t b) {
#if NM_BUS_COUNT > 2
  if (b == 2) return NM_BUS2_SDA;
#endif
  return b == 0 ? NM_BUS0_SDA : NM_BUS1_SDA;
}

static int busScl(uint8_t b) {
#if NM_BUS_COUNT > 2
  if (b == 2) return NM_BUS2_SCL;
#endif
  return b == 0 ? NM_BUS0_SCL : NM_BUS1_SCL;
}

static I2cBus& busAt(uint8_t b) {
#if NM_BUS_COUNT > 2
  if (b == 2) return bus2;
#endif
  return b == 0 ? (I2cBus&)bus0 : (I2cBus&)bus1;
}

static void startBus(uint8_t b) {
#if NM_BUS_COUNT > 2
  if (b == 2) {
    pins2.begin();
    bus2.idle();
    return;
  }
#endif
  TwoWire& wire = b == 0 ? Wire : Wire1;
  wire.begin(busSda(b), busScl(b), cfg::I2C_HZ);
  wire.setTimeOut(cfg::I2C_TIMEOUT_MS);
}

// Перезапуск шины. Датчик, которого дёрнули посреди байта (рывок кабеля), может держать SDA
// внизу — тогда шина «висит». Девять тактов SCL дают ему досказать байт и отпустить линию,
// затем «стоп» и Wire заново (приём из спецификации I2C, NXP UM10204, раздел 3.1.16)
static void recoverBus(uint8_t b) {
  const int sda = busSda(b);
  const int scl = busScl(b);
  if (b < 2) (b == 0 ? Wire : Wire1).end();
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, OUTPUT_OPEN_DRAIN);
  for (int i = 0; i < 9; i++) {
    digitalWrite(scl, LOW);
    delayMicroseconds(5);
    digitalWrite(scl, HIGH);
    delayMicroseconds(5);
  }
  pinMode(sda, OUTPUT_OPEN_DRAIN);
  digitalWrite(sda, LOW);
  delayMicroseconds(5);
  digitalWrite(scl, HIGH);
  delayMicroseconds(5);
  digitalWrite(sda, HIGH);
  delayMicroseconds(5);
  startBus(b);
}

// ── Порт и стенд ────────────────────────────────────────────────────────────

static void writePort(const char* text, size_t len) {
  Serial.write((const uint8_t*)text, len);
}

static void waitMs(uint32_t ms) {
  delay(ms);
}

static StandIo makeIo() {
  StandIo io;
  for (uint8_t b = 0; b < StandIo::MAX_BUSES; b++) io.bus[b] = b < cfg::BUS_COUNT ? &busAt(b) : nullptr;
  io.write = writePort;
  io.delayMs = waitMs;
  io.recoverBus = recoverBus;
  return io;
}

static Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, makeIo());

// ── Поправки в памяти платы (NVS) ───────────────────────────────────────────
// Поправки хранятся по месту на шине вместе с отпечатком модуля, с которого сняты (mpu6050.h,
// fingerprint). Переставили модули местами — стенд увидит чужой отпечаток, поправки не применит
// и попросит `cal`. У копий чипа отпечатка нет: тогда подпишите модули маркером.

static Preferences prefs;

// Ключ — шина и адрес: «b0a68»
static void slotKey(uint8_t slot, char* key) {
  snprintf(key, 8, "b%ua%02x", (unsigned)cfg::SLOTS[slot].bus, (unsigned)cfg::SLOTS[slot].addr);
}

// Ключ отпечатка — «b0a68f»
static void fpKey(uint8_t slot, char* key) {
  snprintf(key, 9, "b%ua%02xf", (unsigned)cfg::SLOTS[slot].bus, (unsigned)cfg::SLOTS[slot].addr);
}

static void loadCalibration() {
  prefs.begin("nm-cal", true);
  for (uint8_t i = 0; i < cfg::SLOT_COUNT; i++) {
    char key[8];
    char keyF[9];
    slotKey(i, key);
    fpKey(i, keyF);
    imucsv::AccCal c;
    if (prefs.getBytesLength(key) == sizeof c && prefs.getBytes(key, &c, sizeof c) == sizeof c) {
      stand.setCalibration(i, c, prefs.getUInt(keyF, 0));
    }
  }
  prefs.end();
}

static void saveCalibration(uint8_t slot, const imucsv::AccCal& c, uint32_t fp) {
  char key[8];
  char keyF[9];
  slotKey(slot, key);
  fpKey(slot, keyF);
  prefs.begin("nm-cal", false);
  prefs.putBytes(key, &c, sizeof c);
  prefs.putUInt(keyF, fp);
  prefs.end();
}

static void clearCalibration() {
  prefs.begin("nm-cal", false);
  prefs.clear();
  prefs.end();
  for (uint8_t i = 0; i < cfg::SLOT_COUNT; i++) stand.clearCalibration(i);
}

// ── Сообщения и ввод ────────────────────────────────────────────────────────

static void say(const char* text) {
  Serial.print(text);
}

// Строка из порта; пусто — ничего не пришло. Хвост без перевода строки ждёт следующего вызова
static bool readLine(char* out, size_t cap) {
  static char buf[64];
  static size_t len = 0;
  while (Serial.available() > 0) {
    const char ch = (char)Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      buf[len] = '\0';
      strncpy(out, buf, cap - 1);
      out[cap - 1] = '\0';
      len = 0;
      return true;
    }
    if (len < sizeof buf - 1) buf[len++] = ch;
  }
  return false;
}

// Ждать Enter (пустую строку или любую). 'q' — отмена
static bool waitEnter() {
  char line[64];
  for (;;) {
    if (readLine(line, sizeof line)) return !(line[0] == 'q' && line[1] == '\0');
    delay(5);
  }
}

// ── Команды ─────────────────────────────────────────────────────────────────

static void cmdHelp() {
  say("# команды: help · scan · info · cal · cal clear. Монитор порта — 460800 бод, «новая строка»\n");
}

// Какие адреса отвечают на каждой шине — первое, что смотреть, если датчика «нет»
static void cmdScan() {
  char buf[96];
  for (uint8_t b = 0; b < cfg::BUS_COUNT; b++) {
    snprintf(buf, sizeof buf, "# шина %u (SDA %d, SCL %d%s):", (unsigned)b, busSda(b), busScl(b), b == 2 ? ", программная" : "");
    say(buf);
    uint8_t found = 0;
    for (uint8_t a = 0x08; a < 0x78; a++) {
      if (busAt(b).probe(a)) {
        snprintf(buf, sizeof buf, " 0x%02X", a);
        say(buf);
        found++;
      }
    }
    say(found ? "\n" : " никого — проверьте провода и питание\n");
  }
  say(cfg::BUS_COUNT > 2 ? "# у каждого датчика своя шина, адрес 0x68: AD0 никуда не подключается\n"
                         : "# 0x68 — датчик с AD0 на GND, 0x69 — с AD0 на 3V3\n");
}

// Паспорт и по отсчёту каждого датчика в понятных единицах: на столе |a| ≈ 1 g, поворот ≈ 0
static void cmdInfo() {
  stand.printPassport();
  char buf[200];
  for (uint8_t i = 0; i < stand.slotCount(); i++) {
    const char* name = imucsv::placeName(cfg::SLOTS[i].place);
    imucsv::Sample s;
    if (!stand.present(i)) {
      snprintf(buf, sizeof buf, "# %s: нет на шине %u по адресу 0x%02X\n", name, (unsigned)cfg::SLOTS[i].bus,
               (unsigned)cfg::SLOTS[i].addr);
    } else if (!stand.readSlot(i, &s)) {
      snprintf(buf, sizeof buf, "# %s: не прочитался\n", name);
    } else {
      const float g = acccal::ONE_G;
      const float dps = 32.8f;  // ±1000 °/с
      const float ax = s.ax / g, ay = s.ay / g, az = s.az / g;
      snprintf(buf, sizeof buf, "# %s: ускорение %.2f %.2f %.2f g, длина %.2f g; поворот %.1f %.1f %.1f °/с\n", name, ax,
               ay, az, sqrtf(ax * ax + ay * ay + az * az), s.gx / dps, s.gy / dps, s.gz / dps);
    }
    say(buf);
  }
  snprintf(buf, sizeof buf, "# пропущено строк из-за сбоев чтения: %lu\n", (unsigned long)stand.skipped());
  say(buf);
}

// Калибровка: шесть положений, в каждом — 1,5 с неподвижно. Все датчики сразу
static void cmdCalibrate() {
  stand.pause(millis());
  say("# калибровка акселерометров: 6 положений, около 2 минут. Удобнее в корпусах — у коробки шесть граней\n");
  say("# в каждом положении: положить ВСЕ датчики как сказано, не трогать стол, отправить пустую строку. q — отмена\n");
  static acccal::Calibrator cal[Stand::MAX_SLOTS];
  for (uint8_t i = 0; i < stand.slotCount(); i++) cal[i].reset();
  char buf[200];
  for (uint8_t p = 0; p < acccal::POSE_COUNT; p++) {
    const acccal::Pose pose = (acccal::Pose)p;
    for (;;) {
      snprintf(buf, sizeof buf, "# положение %u из 6: %s. Затем Enter\n", (unsigned)(p + 1), acccal::poseHint(pose));
      say(buf);
      if (!waitEnter()) {
        say("# калибровка отменена, прежние поправки остались\n");
        stand.resume(micros(), millis());
        return;
      }
      delay(500);  // рука отошла от стола
      for (uint8_t i = 0; i < stand.slotCount(); i++) cal[i].resetPose(pose);
      for (uint32_t k = 0; k < acccal::SAMPLES_PER_POSE; k++) {
        for (uint8_t i = 0; i < stand.slotCount(); i++) {
          imucsv::Sample s;
          if (stand.readSlot(i, &s)) cal[i].add(pose, s);
        }
        delay(10);
      }
      bool ok = true;
      for (uint8_t i = 0; i < stand.slotCount(); i++) {
        if (!stand.present(i)) continue;
        const acccal::Verdict v = cal[i].check(pose);
        if (v == acccal::OK) continue;
        ok = false;
        snprintf(buf, sizeof buf, "# %s: %s — повторим это положение\n", imucsv::placeName(cfg::SLOTS[i].place),
                 v == acccal::MOVED ? "двигался во время замера" : v == acccal::TOO_FEW ? "не прочитался" : "лежит не той гранью");
        say(buf);
      }
      if (ok) break;
    }
  }
  for (uint8_t i = 0; i < stand.slotCount(); i++) {
    if (!stand.present(i)) continue;
    imucsv::AccCal c;
    const char* name = imucsv::placeName(cfg::SLOTS[i].place);
    if (cal[i].result(&c)) {
      saveCalibration(i, c, stand.fingerprint(i));
      stand.setCalibration(i, c, stand.fingerprint(i));
      snprintf(buf, sizeof buf, "# %s: поправки сохранены — ноль %d %d %d, масштаб %u %u %u (× 10 000)\n", name, c.off[0],
               c.off[1], c.off[2], (unsigned)c.scale1e4[0], (unsigned)c.scale1e4[1], (unsigned)c.scale1e4[2]);
    } else {
      snprintf(buf, sizeof buf, "# %s: числа неправдоподобны (ноль дальше 0,2 g или масштаб вне 0,9–1,1) — датчик лучше заменить\n", name);
    }
    say(buf);
  }
  stand.resume(micros(), millis());
}

static void handleCommand(const char* line) {
  if (strcmp(line, "help") == 0) cmdHelp();
  else if (strcmp(line, "scan") == 0) cmdScan();
  else if (strcmp(line, "info") == 0) cmdInfo();
  else if (strcmp(line, "cal") == 0) cmdCalibrate();
  else if (strcmp(line, "cal clear") == 0) {
    clearCalibration();
    say("# поправки забыты\n");
  } else if (line[0] != '\0') {
    cmdHelp();
  }
}

// ── setup и loop ────────────────────────────────────────────────────────────

void setup() {
#if ARDUINO_USB_CDC_ON_BOOT
  // Поток через родной USB: без ноутбука строки выбрасываются, а не задерживают отсчёты
  Serial.begin(cfg::SERIAL_BAUD);
  Serial.setTxTimeoutMs(0);
#else
  // Поток через порт «COM» (UART): запас буфера на паспорт и несколько строк сразу
  Serial.setTxBufferSize(4096);
  Serial.begin(cfg::SERIAL_BAUD);
#endif
  delay(300);
  for (uint8_t b = 0; b < cfg::BUS_COUNT; b++) startBus(b);
  loadCalibration();
  const uint8_t n = stand.begin();
  char buf[120];
  snprintf(buf, sizeof buf, "# NeuroMove %s, прошивка %s: датчиков найдено %u из %u. help — команды\n", cfg::DEVICE,
           cfg::FIRMWARE, (unsigned)n, (unsigned)cfg::SLOT_COUNT);
  say(buf);
}

void loop() {
  char line[64];
  if (readLine(line, sizeof line)) handleCommand(line);
  const uint32_t now = micros();
  stand.tick(now, millis());
  // До следующего отсчёта больше 2 мс — отдать процессор на 1 мс, а не крутиться вхолостую
  if (stand.activeCount() == 0 || stand.untilNextUs(micros()) > 2000) delay(1);
}
