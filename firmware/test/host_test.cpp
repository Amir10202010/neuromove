// Проверка прошивки на компьютере, без платы: формат, регистры, расписание, калибровка и стенд
// целиком на поддельных MPU-6050. Запуск — test/run.sh (нужен только компилятор C++).
//
// Эталон вывода — test/golden.csv. Его же разбирает приложение (app,
// src/devices/firmware.test.ts): так прошивка и приложение проверены одной и той же строкой байт.
// Обновить эталон после намеренной правки формата: UPDATE_GOLDEN=1 test/run.sh

#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include <algorithm>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "../NeuroMoveStand/accel_cal.h"
#include "../NeuroMoveStand/config.h"
#include "../NeuroMoveStand/imu_csv.h"
#include "../NeuroMoveStand/mpu6050.h"
#include "../NeuroMoveStand/scheduler.h"
#include "../NeuroMoveStand/soft_i2c.h"
#include "../NeuroMoveStand/stand.h"

// ── Мини-проверки ───────────────────────────────────────────────────────────

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                    \
  do {                                                                 \
    checks++;                                                          \
    if (!(cond)) {                                                     \
      failures++;                                                      \
      fprintf(stderr, "  ✗ %s:%d  %s\n", __FILE__, __LINE__, #cond);   \
    }                                                                  \
  } while (0)

#define CHECK_EQ_STR(a, b)                                                                              \
  do {                                                                                                 \
    checks++;                                                                                          \
    const std::string _a = (a), _b = (b);                                                              \
    if (_a != _b) {                                                                                    \
      failures++;                                                                                      \
      fprintf(stderr, "  ✗ %s:%d\n    было:  [%s]\n    ждали: [%s]\n", __FILE__, __LINE__, _a.c_str(), _b.c_str()); \
    }                                                                                                  \
  } while (0)

static bool contains(const std::string& s, const std::string& what) {
  return s.find(what) != std::string::npos;
}

static int countOf(const std::string& s, const std::string& what) {
  int n = 0;
  for (size_t p = s.find(what); p != std::string::npos; p = s.find(what, p + what.size())) n++;
  return n;
}

// ── Поддельный MPU-6050 и шина ──────────────────────────────────────────────

struct FakeMpu {
  uint8_t regs[128] = {0};
  uint8_t whoami = 0x68;
  bool dead = false;               // не отвечает: провод отошёл
  bool hangs = false;              // держит SDA: каждая транзакция с ним ждёт таймаут Wire
  bool ignoresRange = false;       // «копия», которая не записывает диапазоны
  int index = 0;                   // для разных чисел у разных датчиков
  // Заводские значения самопроверки (0x0D–0x10): у каждого чипа свои, сброс их не трогает
  uint8_t trim[4] = {0x5A, 0x4C, 0x63, 0x15};
  uint32_t reads = 0;
  imucsv::Sample (*gen)(const FakeMpu&) = nullptr;  // свой генератор отсчётов

  void reset() {
    for (int i = 0; i < 128; i++) regs[i] = 0;
    regs[mpu::REG_PWR_MGMT_1] = 0x40;  // после сброса датчик спит (документация, PWR_MGMT_1)
  }
};

// Детерминированные отсчёты с отрицательными числами: эталон должен их пережить
static imucsv::Sample counterSample(const FakeMpu& m) {
  const int c = (int)m.reads;
  imucsv::Sample s;
  s.ax = (int16_t)(-8192 + c);
  s.ay = (int16_t)(100 * m.index - c);
  s.az = (int16_t)(50 - 3 * m.index);
  s.gx = (int16_t)(c % 7 - 3);
  s.gy = (int16_t)(-c);
  s.gz = (int16_t)(1000 * m.index);
  return s;
}

// ── Время на шине: модель, а не железо ──────────────────────────────────────
// I2C 100 кГц: бит — 10 мкс, байт с подтверждением — 9 бит. Чтение регистров: старт, адрес на запись,
// номер регистра, повторный старт, адрес на чтение, len байт, стоп. Датчик не ответил на адрес (NACK) —
// транзакция обрывается сразу. Шина зависла (датчик держит SDA) — Wire ждёт свой таймаут.
struct BusClock {
  bool on = false;
  uint64_t us = 0;
  uint32_t hangLeft = 0;   // столько ближайших транзакций зависнут
  uint32_t hangUs = cfg::I2C_TIMEOUT_MS * 1000u;  // таймаут Wire, его ставит прошивка (config.h)
  std::vector<std::pair<uint64_t, int> > reads;  // начало чтения 14 байт и индекс датчика
};
static BusClock clk;

static uint32_t readCostUs(uint8_t len) {
  return (1 + 9 + 9 + 1 + 9 + 9u * len + 1) * 10;
}

class FakeBus : public I2cBus {
 public:
  std::map<uint8_t, FakeMpu*> devices;
  int recoveries = 0;

  // Время транзакции: false — зависла и вернула ошибку по таймауту
  bool spend(bool present, uint32_t costUs, bool hangs = false) {
    if (!clk.on) return true;
    if (hangs) {
      clk.us += clk.hangUs;
      return false;
    }
    if (clk.hangLeft) {
      clk.hangLeft--;
      clk.us += clk.hangUs;
      return false;
    }
    clk.us += present ? costUs : 110;  // нет ответа на адрес — обрыв после первого байта
    return true;
  }

  bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) override {
    FakeMpu* m = find(addr);
    if (!spend(m != nullptr, (1 + 9 + 9 + 9 + 1) * 10, m && m->hangs)) return false;
    if (!m) return false;
    if (reg == mpu::REG_PWR_MGMT_1 && (value & mpu::RESET)) {
      m->reset();
      return true;
    }
    if (m->ignoresRange && (reg == mpu::REG_GYRO_CONFIG || reg == mpu::REG_ACCEL_CONFIG)) return true;
    m->regs[reg & 0x7F] = value;
    return true;
  }

  bool readRegs(uint8_t addr, uint8_t reg, uint8_t* out, uint8_t len) override {
    FakeMpu* m = find(addr);
    if (clk.on && m && reg == mpu::REG_ACCEL_XOUT_H && len == 14) clk.reads.push_back(std::make_pair(clk.us, m->index));
    if (!spend(m != nullptr, readCostUs(len), m && m->hangs)) return false;
    if (!m) return false;
    if (reg == mpu::REG_WHO_AM_I && len == 1) {
      out[0] = m->whoami;
      return true;
    }
    if (reg == mpu::REG_SELF_TEST_X && len == 4) {
      for (int i = 0; i < 4; i++) out[i] = m->trim[i];
      return true;
    }
    if (reg == mpu::REG_ACCEL_XOUT_H && len == 14) {
      const imucsv::Sample s = m->gen ? m->gen(*m) : counterSample(*m);
      m->reads++;
      const int16_t v[7] = {s.ax, s.ay, s.az, 0, s.gx, s.gy, s.gz};
      for (int i = 0; i < 7; i++) {
        out[2 * i] = (uint8_t)(((uint16_t)v[i]) >> 8);
        out[2 * i + 1] = (uint8_t)(((uint16_t)v[i]) & 0xFF);
      }
      return true;
    }
    for (uint8_t i = 0; i < len; i++) out[i] = m->regs[(reg + i) & 0x7F];
    return true;
  }

 private:
  FakeMpu* find(uint8_t addr) {
    std::map<uint8_t, FakeMpu*>::iterator it = devices.find(addr);
    if (it == devices.end() || it->second->dead) return nullptr;
    return it->second;
  }
};

// ── Порт и плата для стенда ─────────────────────────────────────────────────

static std::string out;
static FakeBus fakeBuses[StandIo::MAX_BUSES];

static void writeOut(const char* text, size_t len) {
  out.append(text, len);
}
static void noDelay(uint32_t) {}
static void recover(uint8_t b) {
  fakeBuses[b].recoveries++;
}

static StandIo fakeIo() {
  StandIo io;
  for (uint8_t b = 0; b < StandIo::MAX_BUSES; b++) io.bus[b] = b < cfg::BUS_COUNT ? &fakeBuses[b] : nullptr;
  io.write = writeOut;
  io.delayMs = noDelay;
  io.recoverBus = recover;
  return io;
}

// Шина и адрес места slot из config.h: 0 — туловище, 1 — плечо, 2 — предплечье. Проверки не знают
// разводку заранее и идут для обеих: три шины (по умолчанию) и две (NM_TWO_BUSES)
static FakeBus& busOf(uint8_t slot) {
  return fakeBuses[cfg::SLOTS[slot].bus];
}
static uint8_t addrOf(uint8_t slot) {
  return cfg::SLOTS[slot].addr;
}
static int totalRecoveries() {
  int n = 0;
  for (uint8_t b = 0; b < StandIo::MAX_BUSES; b++) n += fakeBuses[b].recoveries;
  return n;
}

// Три датчика стенда на своих местах (config.h)
struct Rig {
  FakeMpu trunk, upper, fore;
  Rig() {
    trunk.index = 0;
    upper.index = 1;
    fore.index = 2;
    // Разные чипы — разные заводские значения
    trunk.trim[3] = 0x11;
    upper.trim[3] = 0x22;
    fore.trim[3] = 0x33;
    for (uint8_t b = 0; b < StandIo::MAX_BUSES; b++) {
      fakeBuses[b].devices.clear();
      fakeBuses[b].recoveries = 0;
    }
    busOf(0).devices[addrOf(0)] = &trunk;
    busOf(1).devices[addrOf(1)] = &upper;
    busOf(2).devices[addrOf(2)] = &fore;
    out.clear();
  }
};

// Прогон: шаг цикла каждые stepUs микросекунд
static void run(Stand& stand, uint32_t fromUs, uint32_t toUs, uint32_t stepUs = 1000) {
  for (uint32_t t = fromUs; t <= toUs; t += stepUs) stand.tick(t, t / 1000);
}

// Строки отсчётов (без «#» и заголовка)
static int dataRows(const std::string& s) {
  std::istringstream in(s);
  std::string line;
  int n = 0;
  while (std::getline(in, line)) {
    if (!line.empty() && line[0] >= '0' && line[0] <= '9') n++;
  }
  return n;
}

// ── Проверки ────────────────────────────────────────────────────────────────

static void testFormat() {
  fprintf(stderr, "формат imu-csv v1\n");
  char buf[512];
  const imucsv::Place places[3] = {imucsv::TRUNK, imucsv::UPPER_R, imucsv::FORE_R};
  imucsv::passport(buf, sizeof buf, "NM-01", "0.1", 100, 4, 1000, places, 3);
  CHECK_EQ_STR(buf, "# imu-csv v1\n# device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=trunk,upper_r,fore_r\n");
  imucsv::header(buf, sizeof buf, places + 1, 1);
  CHECK_EQ_STR(buf, "seq,upper_r_ax,upper_r_ay,upper_r_az,upper_r_gx,upper_r_gy,upper_r_gz\n");
  const imucsv::Sample s[2] = {{-32768, 32767, 0, -1, 2, -3}, {8192, -8192, 4, 5, -6, 7}};
  imucsv::row(buf, sizeof buf, 4294967295u, s, 2);
  CHECK_EQ_STR(buf, "4294967295,-32768,32767,0,-1,2,-3,8192,-8192,4,5,-6,7\n");
  imucsv::AccCal c = {{12, -30, 45}, {10012, 9988, 10005}};
  imucsv::calibration(buf, sizeof buf, imucsv::FORE_R, c);
  CHECK_EQ_STR(buf, "# cal_fore_r=12,-30,45,10012,9988,10005\n");
  char tiny[8];
  CHECK(imucsv::row(tiny, sizeof tiny, 12345, s, 2) == 0);   // не влезло — строку не шлём
  CHECK(imucsv::header(tiny, sizeof tiny, places, 3) == 0);
}

static void testRegisters() {
  fprintf(stderr, "регистры MPU-6050\n");
  const uint8_t raw[14] = {0x80, 0x00, 0x7F, 0xFF, 0xFF, 0xFE, 0x12, 0x34, 0x00, 0x01, 0xFF, 0xFF, 0x20, 0x00};
  const imucsv::Sample s = mpu::decode(raw);
  CHECK(s.ax == -32768 && s.ay == 32767 && s.az == -2);
  CHECK(s.gx == 1 && s.gy == -1 && s.gz == 8192);

  Rig rig;
  CHECK(mpu::configure(busOf(2), addrOf(2), noDelay));
  CHECK(rig.fore.regs[mpu::REG_PWR_MGMT_1] == mpu::CLOCK_PLL_X);
  CHECK(rig.fore.regs[mpu::REG_SMPLRT_DIV] == 0x00);
  CHECK(rig.fore.regs[mpu::REG_CONFIG] == 0x03);        // фильтр ~44 Гц
  CHECK(rig.fore.regs[mpu::REG_GYRO_CONFIG] == 0x10);   // ±1000 °/с
  CHECK(rig.fore.regs[mpu::REG_ACCEL_CONFIG] == 0x08);  // ±4 g
  rig.upper.ignoresRange = true;
  CHECK(!mpu::configure(busOf(1), addrOf(1), noDelay));  // диапазон не записался — датчик не берём
  CHECK(!mpu::configure(busOf(1), 0x6A, noDelay));       // по адресу никого
  uint8_t id = 0;
  CHECK(mpu::whoAmI(busOf(0), addrOf(0), &id) && id == 0x68);
  CHECK(mpu::looksLikeImu(0x72) && !mpu::looksLikeImu(0xFF) && !mpu::looksLikeImu(0x00));
}

static void testScheduler() {
  fprintf(stderr, "расписание 100 Гц\n");
  Scheduler s(10000);
  uint32_t seq = 99;
  CHECK(s.due(0, &seq) && seq == 0);
  CHECK(!s.due(5000, &seq));
  CHECK(s.due(10000, &seq) && seq == 1);
  CHECK(s.due(20400, &seq) && seq == 2);                 // опоздание меньше периода — без пропуска
  CHECK(s.due(55000, &seq) && seq == 5);                 // проспали слоты 3 и 4 — номер их пропустил
  CHECK(!s.due(55500, &seq));
  CHECK(s.due(60000, &seq) && seq == 6);
  CHECK(s.untilNext(61000) == 9000);

  // micros() переполняется каждые ~71,6 минуты — расписание идёт дальше без скачков
  Scheduler w(10000);
  uint32_t t = 0xFFFFFFFFu - 15000u;
  CHECK(w.due(t, &seq) && seq == 0);
  t += 10000;
  CHECK(w.due(t, &seq) && seq == 1);
  t += 10000;                                           // перешли через 2^32
  CHECK(w.due(t, &seq) && seq == 2);
  CHECK(!w.due(t + 5000, &seq));

  // Пауза в час (калибровку забыли закончить): номер прибавляет прошедшее время, поток не замирает
  Scheduler p(10000);
  CHECK(p.due(1000, &seq) && seq == 0);
  p.resume(1000u + 3600000000u, 3600000u);
  CHECK(p.due(1000u + 3600000000u, &seq) && seq == 1 + 360000);
}

static void testStandStream() {
  fprintf(stderr, "стенд: три датчика, паспорт, строки, поправки\n");
  Rig rig;
  Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
  CHECK(stand.begin() == 3);
  imucsv::AccCal c = {{12, -30, 45}, {10012, 9988, 10005}};
  stand.setCalibration(2, c, stand.fingerprint(2));  // предплечье: поправки сняты с этого же модуля
  run(stand, 0, 25000);                              // 25 мс — три отсчёта
  CHECK(contains(out, "# imu-csv v1\n# device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=trunk,upper_r,fore_r\n"));
  CHECK(contains(out, "# board=esp32s3 i2c_hz=100000 arm=right\n"));
  CHECK(contains(out, "# cal_fore_r=12,-30,45,10012,9988,10005\n"));
  CHECK(contains(out, "# id_trunk=5A4C6311 id_upper_r=5A4C6322 id_fore_r=5A4C6333\n"));
  CHECK(dataRows(out) == 3);

  // Эталон: тот же вывод байт в байт. Его же разбирает приложение
  const char* golden = "test/golden.csv";
  if (getenv("UPDATE_GOLDEN")) {
    std::ofstream(golden, std::ios::binary) << out;
    fprintf(stderr, "  эталон записан: %s\n", golden);
  } else {
    std::ifstream in(golden, std::ios::binary);
    std::stringstream ss;
    ss << in.rdbuf();
    CHECK_EQ_STR(out, ss.str());
  }

  // Паспорт повторяется каждые 2 с — приложение подхватит поток с любого места
  out.clear();
  run(stand, 26000, 4100000, 2000);
  CHECK(countOf(out, "# imu-csv v1\n") == 2);
  CHECK(countOf(out, "seq,trunk_ax") == 2);
  CHECK(dataRows(out) >= 405 && dataRows(out) <= 409);
}

static void testMissingAndClone() {
  fprintf(stderr, "стенд: датчика нет, датчик-копия\n");
  {
    Rig rig;
    busOf(0).devices.erase(addrOf(0));  // кабель груди не подключён — первый этап стенда
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    CHECK(stand.begin() == 2);
    run(stand, 0, 15000);
    CHECK(contains(out, "sensors=upper_r,fore_r\n"));
    CHECK(contains(out, "\nseq,upper_r_ax,upper_r_ay,upper_r_az,upper_r_gx,upper_r_gy,upper_r_gz,fore_r_ax,"));
    CHECK(!contains(out, "trunk"));
  }
  {
    Rig rig;
    rig.fore.whoami = 0x72;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    CHECK(stand.begin() == 3);
    run(stand, 0, 5000);
    CHECK(contains(out, "# внимание: fore_r отвечает WHO_AM_I 0x72, а не 0x68"));
    CHECK(dataRows(out) == 1);
  }
  {
    Rig rig;
    for (uint8_t b = 0; b < StandIo::MAX_BUSES; b++) fakeBuses[b].devices.clear();
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    CHECK(stand.begin() == 0);
    run(stand, 0, 30000);
    CHECK(contains(out, "# нет ни одного датчика"));
    CHECK(dataRows(out) == 0);
    // Подключили — через 2 с стенд сам находит датчики и начинает с паспорта
    busOf(1).devices[addrOf(1)] = &rig.upper;
    out.clear();
    run(stand, 2000000, 2100000);
    CHECK(contains(out, "sensors=upper_r\n"));
    CHECK(dataRows(out) >= 9);
  }
}

// Номер отсчёта первой строки и последней — пропуски видны по разнице
static void seqRange(const std::string& s, long* first, long* last, int* rows) {
  std::istringstream in(s);
  std::string line;
  *first = -1;
  *last = -1;
  *rows = 0;
  while (std::getline(in, line)) {
    if (line.empty() || line[0] < '0' || line[0] > '9') continue;
    const long seq = atol(line.c_str());
    if (*first < 0) *first = seq;
    *last = seq;
    (*rows)++;
  }
}

static void testFailures() {
  fprintf(stderr, "стенд: провод отошёл и вернулся\n");
  Rig rig;
  Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
  CHECK(stand.begin() == 3);
  run(stand, 0, 95000);  // 10 отсчётов: 0…9
  out.clear();

  // Предплечье молчит 12 отсчётов: строки пропущены, после 10 неудач — перезапуск его шины, и только её
  rig.fore.dead = true;
  run(stand, 100000, 215000);
  CHECK(dataRows(out) == 0);
  CHECK(busOf(2).recoveries == 1 && totalRecoveries() == 1);
  char msg[160];
  snprintf(msg, sizeof msg, "# fore_r: 10 чтений подряд без ответа — перезапускаю шину %u\n", (unsigned)cfg::SLOTS[2].bus);
  CHECK(contains(out, msg));
  rig.fore.dead = false;
  out.clear();
  run(stand, 220000, 255000);
  long first = 0, last = 0;
  int rows = 0;
  seqRange(out, &first, &last, &rows);
  CHECK(first == 22 && last == 25 && rows == 4);  // номера 10…21 пропущены — приложение это видит
  CHECK(stand.skipped() == 12);

  // Молчит долго: после трёх перезапусков — вон из потока, паспорт без него, строки идут дальше
  rig.fore.dead = true;
  out.clear();
  run(stand, 260000, 700000);
  CHECK(busOf(2).recoveries == 1 + 3);
  CHECK(contains(out, "# fore_r: не отвечает после 3 перезапусков — убираю из потока"));
  CHECK(contains(out, "sensors=trunk,upper_r\n"));
  CHECK(dataRows(out) > 10);

  // Вернулся — через 5 с стенд находит его сам
  rig.fore.dead = false;
  out.clear();
  run(stand, 700000, 5800000, 2000);
  CHECK(contains(out, "sensors=trunk,upper_r,fore_r\n"));
}

static void testCalibration() {
  fprintf(stderr, "калибровка в 6 положениях\n");
  // Датчик с известным нулём и масштабом: ноль X +400 (≈ 0,05 g), Y −250, Z +600; масштаб 1,02 / 0,99 / 1,005
  const double off[3] = {400, -250, 600};
  const double scale[3] = {1.02, 0.99, 1.005};
  acccal::Calibrator cal;
  for (uint8_t p = 0; p < acccal::POSE_COUNT; p++) {
    const acccal::Pose pose = (acccal::Pose)p;
    for (uint32_t k = 0; k < acccal::SAMPLES_PER_POSE; k++) {
      double g[3] = {0, 0, 0};
      g[acccal::poseAxis(pose)] = acccal::poseSign(pose);
      imucsv::Sample s;
      const double noise = ((int)(k % 5) - 2) * 3.0;  // шум ±6 единиц
      s.ax = (int16_t)lround(off[0] + g[0] * scale[0] * acccal::ONE_G + noise);
      s.ay = (int16_t)lround(off[1] + g[1] * scale[1] * acccal::ONE_G - noise);
      s.az = (int16_t)lround(off[2] + g[2] * scale[2] * acccal::ONE_G + noise);
      s.gx = s.gy = s.gz = 0;
      cal.add(pose, s);
    }
    CHECK(cal.check(pose) == acccal::OK);
  }
  imucsv::AccCal r;
  CHECK(cal.result(&r));
  CHECK(abs(r.off[0] - 400) <= 1 && abs(r.off[1] + 250) <= 1 && abs(r.off[2] - 600) <= 1);
  CHECK(abs((int)r.scale1e4[0] - 10200) <= 1 && abs((int)r.scale1e4[1] - 9900) <= 1 && abs((int)r.scale1e4[2] - 10050) <= 1);

  // Не той гранью: в положении «X вверх» ось X видит −1 g
  acccal::Calibrator wrong;
  for (uint32_t k = 0; k < acccal::SAMPLES_PER_POSE; k++) {
    imucsv::Sample s = {-8192, 0, 0, 0, 0, 0};
    wrong.add(acccal::X_UP, s);
  }
  CHECK(wrong.check(acccal::X_UP) == acccal::WRONG_FACE);
  // Двигали во время замера
  acccal::Calibrator moved;
  for (uint32_t k = 0; k < acccal::SAMPLES_PER_POSE; k++) {
    imucsv::Sample s = {0, 0, (int16_t)(8192 + (k % 2 ? 900 : -900)), 0, 0, 0};
    moved.add(acccal::Z_UP, s);
  }
  CHECK(moved.check(acccal::Z_UP) == acccal::MOVED);
  // Мало отсчётов — результата нет
  acccal::Calibrator few;
  CHECK(!few.result(&r));
}

// Поправки привязаны к модулю: переставили модуль — чужие поправки не применяются
static void testModuleFingerprint() {
  fprintf(stderr, "поправки калибровки привязаны к модулю\n");
  imucsv::AccCal c = {{12, -30, 45}, {10012, 9988, 10005}};
  {
    Rig rig;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    CHECK(stand.fingerprint(2) == 0x5A4C6333u);
    // Поправки сняты с модуля предплечья, а на его место поставили модуль плеча
    stand.setCalibration(2, c, 0x5A4C6322u);
    CHECK(stand.calibrationForeign(2));
    run(stand, 0, 25000);
    CHECK(!contains(out, "# cal_fore_r="));
    CHECK(contains(out, "# внимание: поправки fore_r сняты с другого модуля (отпечаток 5A4C6322, сейчас 5A4C6333) — не применяю; выполните cal\n"));
  }
  {
    // Свои поправки — применяются
    Rig rig;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    stand.setCalibration(2, c, 0x5A4C6333u);
    CHECK(!stand.calibrationForeign(2));
    run(stand, 0, 25000);
    CHECK(contains(out, "# cal_fore_r=12,-30,45,10012,9988,10005\n"));
  }
  {
    // Копия чипа без заводских значений: проверить нечем — поправки применяются, в паспорте id=none
    Rig rig;
    for (int i = 0; i < 4; i++) rig.fore.trim[i] = 0;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    stand.setCalibration(2, c, 0x5A4C6322u);
    CHECK(!stand.calibrationForeign(2));
    run(stand, 0, 25000);
    CHECK(contains(out, " id_fore_r=none\n"));
    CHECK(contains(out, "# cal_fore_r=12,-30,45,10012,9988,10005\n"));
  }
  {
    // Модуль отвалился и на его место вернулся другой: при повторном поиске отпечаток обновляется
    Rig rig;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    stand.setCalibration(2, c, 0x5A4C6333u);
    run(stand, 0, 25000);
    rig.fore.dead = true;
    run(stand, 26000, 3000000, 1000);  // три перезапуска шины — датчик убран
    CHECK(!stand.present(2));
    rig.fore.dead = false;
    rig.fore.trim[3] = 0x44;  // другой модуль
    out.clear();
    run(stand, 3001000, 9000000, 2000);  // повторный поиск каждые 5 с
    CHECK(stand.present(2));
    CHECK(stand.fingerprint(2) == 0x5A4C6344u);
    CHECK(stand.calibrationForeign(2));
    CHECK(!contains(out, "# cal_fore_r="));
  }
}

// Основной цикл платы на модельных часах: tick, затем delay(1), если до отсчёта больше 2 мс
static void runClock(Stand& stand, uint64_t untilUs) {
  while (clk.us < untilUs) {
    const uint32_t now = (uint32_t)clk.us;
    stand.tick(now, now / 1000);
    clk.us += stand.untilNextUs((uint32_t)clk.us) > 2000 ? 1000 : 20;
  }
}

// Номера строк отсчётов по порядку
static std::vector<long> rowSeqs(const std::string& s) {
  std::istringstream in(s);
  std::string line;
  std::vector<long> v;
  while (std::getline(in, line)) {
    if (!line.empty() && line[0] >= '0' && line[0] <= '9') v.push_back(atol(line.c_str()));
  }
  return v;
}

// Время: сколько занимает цикл на шине 100 кГц, насколько датчики читаются не одновременно,
// что делает зависшая шина. Модель стоимости транзакций — выше (BusClock); на плате не мерено
static void testTiming() {
  fprintf(stderr, "время цикла на модельной шине 100 кГц\n");
  clk = BusClock();
  clk.on = true;
  {
    Rig rig;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    const uint64_t t0 = clk.us;
    out.clear();
    clk.reads.clear();
    runClock(stand, t0 + 10000000);  // 10 с
    const std::vector<long> seqs = rowSeqs(out);
    // 10 с на 100 Гц — 1000 строк ±1, номера подряд
    CHECK(seqs.size() >= 999 && seqs.size() <= 1001);
    bool consecutive = true;
    for (size_t i = 1; i < seqs.size(); i++) consecutive = consecutive && seqs[i] == seqs[i - 1] + 1;
    CHECK(consecutive);
    // Занятость шины: три чтения по 156 бит — 4,68 мс из 10 мс
    const uint32_t busy = 3 * readCostUs(14);
    CHECK(busy == 4680);
    // Сдвиг чтения внутри цикла: первый датчик — сразу у начала слота, следующие — через 1,56 мс
    double worstFirst = 0, worstLast = 0;
    for (size_t k = 0; k + 2 < clk.reads.size(); k += 3) {
      const double first = (double)(clk.reads[k].first - clk.reads[0].first) - 10000.0 * (k / 3);
      const double last = (double)(clk.reads[k + 2].first - clk.reads[k].first);
      if (first > worstFirst) worstFirst = first;
      if (last > worstLast) worstLast = last;
    }
    fprintf(stderr, "  строк за 10 с: %zu; шина занята %u мкс из 10 000; первый датчик позже слота до %.0f мкс; третий позже первого на %.0f мкс\n",
            seqs.size(), busy, worstFirst, worstLast);
    CHECK(worstFirst <= 40);
    CHECK(worstLast == 2 * readCostUs(14));
  }
  {
    // Одно зависание шины (таймаут 10 мс): цикл пропал, следующий слот проспан — номер прыгает на 2
    Rig rig;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    const uint64_t t0 = clk.us;
    out.clear();
    runClock(stand, t0 + 1000000);
    clk.hangLeft = 1;
    runClock(stand, t0 + 2000000);
    const std::vector<long> seqs = rowSeqs(out);
    long worstGap = 0;
    for (size_t i = 1; i < seqs.size(); i++) worstGap = std::max(worstGap, seqs[i] - seqs[i - 1]);
    fprintf(stderr, "  одно зависание шины: худший разрыв номеров %ld (приложение помечает разрыв от 0,3 с — от 30)\n", worstGap);
    CHECK(worstGap >= 2 && worstGap <= 3);
  }
  {
    // Шина зависает на каждом чтении предплечья (датчик держит SDA): все строки стоят, пока датчик
    // не выкинут после 3 перезапусков по 10 неудач. Сколько секунд теряется у всех датчиков
    Rig rig;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    const uint64_t t0 = clk.us;
    out.clear();
    runClock(stand, t0 + 1000000);
    const uint64_t tFail = clk.us;
    rig.fore.hangs = true;
    uint64_t droppedAt = 0;
    while (clk.us < tFail + 6000000) {
      const uint32_t now = (uint32_t)clk.us;
      stand.tick(now, now / 1000);
      if (!droppedAt && !stand.present(2)) droppedAt = clk.us;
      clk.us += stand.untilNextUs((uint32_t)clk.us) > 2000 ? 1000 : 20;
    }
    const std::vector<long> seqs = rowSeqs(out);
    long worstGap = 0;
    for (size_t i = 1; i < seqs.size(); i++) worstGap = std::max(worstGap, seqs[i] - seqs[i - 1]);
    fprintf(stderr, "  шина зависает на каждом чтении предплечья: датчик убран через %.2f с; потеряно у всех датчиков %ld отсчётов подряд\n",
            droppedAt ? (double)(droppedAt - tFail) / 1e6 : -1.0, worstGap - 1);
    CHECK(droppedAt > 0);
    // С таймаутом 10 мс датчик убран меньше чем за 0,6 с; у Wire по умолчанию (50 мс) было 1,75 с
    CHECK(droppedAt - tFail < 600000);
    CHECK(worstGap - 1 <= 60);
  }
  {
    // То же с таймаутом Wire по умолчанию — для сравнения, ради чего стоит setTimeOut
    Rig rig;
    clk.hangUs = 50000;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    const uint64_t tFail = clk.us;
    rig.fore.hangs = true;
    uint64_t droppedAt = 0;
    while (clk.us < tFail + 6000000 && !droppedAt) {
      const uint32_t now = (uint32_t)clk.us;
      stand.tick(now, now / 1000);
      if (!stand.present(2)) droppedAt = clk.us;
      clk.us += stand.untilNextUs((uint32_t)clk.us) > 2000 ? 1000 : 20;
    }
    fprintf(stderr, "  для сравнения, таймаут Wire по умолчанию 50 мс: датчик убран через %.2f с\n", (double)(droppedAt - tFail) / 1e6);
    CHECK(droppedAt - tFail > 1000000);
    clk.hangUs = cfg::I2C_TIMEOUT_MS * 1000u;
  }
  clk = BusClock();
}

// Образцы протокола для приложения: прошивка сама пишет крайние случаи, приложение разбирает их
// тем же кодом, что USB-порт (website/src/devices/firmware.test.ts). Поменяли формат — расходятся оба
static void fixture(const char* name, const std::string& text) {
#ifdef NM_TWO_BUSES
  // Образцы записаны для разводки по умолчанию: в строке перезапуска стоит номер шины
  (void)name;
  (void)text;
  return;
#endif
  const std::string path = std::string("test/fixtures/") + name;
  if (getenv("UPDATE_GOLDEN")) {
    std::ofstream(path.c_str(), std::ios::binary) << text;
    return;
  }
  std::ifstream in(path.c_str(), std::ios::binary);
  std::stringstream ss;
  ss << in.rdbuf();
  CHECK_EQ_STR(text, ss.str());
}

static void testFixtures() {
  fprintf(stderr, "образцы протокола: выпал и вернулся, чужие поправки, перезагрузка, копия чипа\n");
  imucsv::AccCal c = {{12, -30, 45}, {10012, 9988, 10005}};
  {
    // Предплечье отвечает 3 отсчёта, молчит до исключения из потока, через 5 с возвращается
    Rig rig;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    run(stand, 0, 25000);
    rig.fore.dead = true;
    run(stand, 30000, 400000);
    rig.fore.dead = false;
    run(stand, 5400000, 5425000);
    CHECK(stand.present(2));
    fixture("drop-and-return.csv", out);
  }
  {
    Rig rig;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    stand.setCalibration(2, c, 0x5A4C6322u);  // поправки сняты с модуля плеча
    run(stand, 0, 25000);
    fixture("foreign-calibration.csv", out);
  }
  {
    // Плата перезагрузилась посреди записи: второй экземпляр стенда начинает с нуля
    Rig rig;
    Stand first(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    first.begin();
    run(first, 0, 45000);
    std::string both = out;
    out.clear();
    Stand second(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    second.begin();
    run(second, 0, 25000);
    both += out;
    fixture("reboot.csv", both);
  }
  {
    Rig rig;
    rig.fore.whoami = 0x72;
    for (int i = 0; i < 4; i++) rig.fore.trim[i] = 0;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, fakeIo());
    stand.begin();
    run(stand, 0, 25000);
    fixture("clone-chip.csv", out);
  }
}

// ── Программная шина на модели линий ────────────────────────────────────────
// PinMpu видит каждый фронт SCL и SDA и отвечает как ведомый I2C (NXP UM10204, раздел 3.1): ловит «старт»
// и «стоп», принимает адрес и байты по фронту SCL вверх, сам меняет SDA только при SCL внизу, подтверждает
// свой адрес и принятые байты, отдаёт регистры подряд, пока ведущий подтверждает. Линия — монтажное «И»:
// внизу, если её прижал хоть кто-то. Регистры — как у MPU-6050: номер сдвигается сам

struct PinMpu : public I2cPins {
  uint8_t addr = 0x68;
  uint8_t regs[128] = {0};
  bool sclM = true, sdaM = true;  // что делает ведущий: true — отпустил
  bool sdaS = true;               // что делает ведомый
  bool holdSda = false;           // SDA замкнута на землю (или датчик завис посреди байта)
  bool holdScl = false;           // SCL замкнута на землю
  bool absent = false;            // провода нет: никто не отвечает
  uint32_t halfBits = 0;          // полутакты — время транзакции
  uint32_t starts = 0, stops = 0;

  enum Phase { IDLE, ADDR, ADDR_ACK, WR, WR_ACK, RD, RD_ACK };
  Phase ph = IDLE;
  int bit = 0;
  uint8_t shift = 0;
  bool rw = false, first = false, masterAck = false;
  uint8_t ptr = 0, outByte = 0;

  PinMpu() { regs[mpu::REG_WHO_AM_I] = 0x68; }

  bool sclLine() const { return sclM && !holdScl; }
  bool sdaLine() const { return sdaM && sdaS && !holdSda; }

  void scl(bool release) override {
    const bool was = sclLine();
    sclM = release;
    if (!was && sclLine()) rise();
    if (was && !sclLine()) fall();
  }
  void sda(bool release) override {
    const bool was = sdaLine();
    sdaM = release;
    if (sclLine() && was && !sdaLine()) onStart();
    if (sclLine() && !was && sdaLine()) onStop();
  }
  bool readScl() override { return sclLine(); }
  bool readSda() override { return sdaLine(); }
  void halfBit() override { halfBits++; }

  void onStart() {
    starts++;
    ph = absent ? IDLE : ADDR;
    bit = 0;
    shift = 0;
    sdaS = true;
  }
  void onStop() {
    stops++;
    ph = IDLE;
    sdaS = true;
  }
  void load() {
    outByte = regs[ptr & 0x7F];
    bit = 0;
    sdaS = (outByte & 0x80) != 0;
  }
  // SCL вверх: ведомый читает бит, ведущий — ответ
  void rise() {
    if (ph == ADDR || ph == WR) {
      shift = (uint8_t)(shift << 1 | (sdaLine() ? 1 : 0));
      bit++;
    } else if (ph == RD_ACK) {
      masterAck = !sdaLine();
    }
  }
  // SCL вниз: ведомый готовит следующий бит или ответ
  void fall() {
    switch (ph) {
      case ADDR:
        if (bit == 8) {
          rw = shift & 1;
          if ((shift >> 1) == addr) {
            ph = ADDR_ACK;
            sdaS = false;
          } else {
            ph = IDLE;
          }
        }
        break;
      case ADDR_ACK:
        sdaS = true;
        if (rw) {
          ph = RD;
          load();
        } else {
          ph = WR;
          bit = 0;
          shift = 0;
          first = true;
        }
        break;
      case WR:
        if (bit == 8) {
          if (first) ptr = shift;
          else regs[ptr++ & 0x7F] = shift;
          first = false;
          ph = WR_ACK;
          sdaS = false;
        }
        break;
      case WR_ACK:
        sdaS = true;
        ph = WR;
        bit = 0;
        shift = 0;
        break;
      case RD:
        if (++bit == 8) {
          sdaS = true;  // девятый такт — ответ ведущего
          ph = RD_ACK;
        } else {
          sdaS = ((outByte << bit) & 0x80) != 0;
        }
        break;
      case RD_ACK:
        ptr++;
        if (masterAck) {
          ph = RD;
          load();
        } else {
          ph = IDLE;  // «хватит» — ждём «стоп»
          sdaS = true;
        }
        break;
      case IDLE:
        break;
    }
  }
};

static void testSoftI2c() {
  fprintf(stderr, "программная шина I2C на модели линий\n");
  {
    PinMpu m;
    SoftI2c bus(m);
    bus.idle();
    uint8_t id = 0;
    CHECK(mpu::whoAmI(bus, 0x68, &id) && id == 0x68);
    CHECK(bus.probe(0x68) && !bus.probe(0x69));
    CHECK(!mpu::whoAmI(bus, 0x69, &id));  // чужой адрес — NACK, транзакция обрывается
    CHECK(m.sclLine() && m.sdaLine());    // после любой транзакции шина свободна
    // Четыре транзакции — четыре «стопа»; «стартов» на один больше: удачное чтение WHO_AM_I — с повторным стартом
    CHECK(m.stops == 4 && m.starts == 5);
    CHECK(bus.writeReg(0x68, 0x1C, 0x08) && m.regs[0x1C] == 0x08);
    for (int i = 0; i < 14; i++) m.regs[0x3B + i] = (uint8_t)(0xA5 ^ (i * 37));
    uint8_t raw[14] = {0};
    m.halfBits = 0;
    CHECK(bus.readRegs(0x68, 0x3B, raw, 14));
    bool same = true;
    for (int i = 0; i < 14; i++) same = same && raw[i] == (uint8_t)(0xA5 ^ (i * 37));
    CHECK(same);
    // Время чтения 14 байт: полутакт на 100 кГц — 5 мкс. Аппаратная шина тратит 1 560 мкс (BusClock)
    const uint32_t us = m.halfBits * (500000u / cfg::I2C_HZ);
    fprintf(stderr, "  чтение 14 байт программной шиной: %u полутактов — %u мкс без учёта вызовов (аппаратная — %u мкс)\n",
            (unsigned)m.halfBits, (unsigned)us, (unsigned)readCostUs(14));
    CHECK(us <= 2000);
  }
  {
    // Настройка датчика целиком тем же кодом, что на аппаратной шине
    PinMpu m;
    SoftI2c bus(m);
    bus.idle();
    CHECK(mpu::configure(bus, 0x68, noDelay));
    CHECK(m.regs[mpu::REG_PWR_MGMT_1] == mpu::CLOCK_PLL_X && m.regs[mpu::REG_CONFIG] == 0x03);
    CHECK(m.regs[mpu::REG_GYRO_CONFIG] == 0x10 && m.regs[mpu::REG_ACCEL_CONFIG] == 0x08);
  }
  {
    // Обрывы: провода нет; SDA замкнута на землю; SCL замкнута на землю — ошибка, а не зависание
    PinMpu m;
    SoftI2c bus(m);
    bus.idle();
    m.absent = true;
    uint8_t id = 0;
    CHECK(!mpu::whoAmI(bus, 0x68, &id));
    m.absent = false;
    m.holdSda = true;
    m.halfBits = 0;
    CHECK(!mpu::whoAmI(bus, 0x68, &id));
    CHECK(m.halfBits < 20);  // шина занята — даже не начали
    m.holdSda = false;
    m.holdScl = true;
    m.halfBits = 0;
    CHECK(!mpu::whoAmI(bus, 0x68, &id));
    CHECK(m.halfBits <= 3 * SoftI2c::STRETCH_LIMIT + 20);  // ждём не дольше нескольких миллисекунд
    m.holdScl = false;
    CHECK(mpu::whoAmI(bus, 0x68, &id) && id == 0x68);  // замыкание ушло — шина снова работает
  }
#ifndef NM_TWO_BUSES
  {
    // Стенд целиком: плечо и предплечье на поддельных аппаратных шинах, туловище — на программной шине
    // поверх модели линий. Каждый датчик на 0x68
    Rig rig;
    PinMpu trunkPins;
    for (int i = 0; i < 14; i++) trunkPins.regs[0x3B + i] = 0;
    trunkPins.regs[0x3B] = 0xE0;  // ax = −8192 (−1 g), остальное 0
    SoftI2c soft(trunkPins);
    soft.idle();
    StandIo io = fakeIo();
    io.bus[cfg::SLOTS[0].bus] = &soft;
    Stand stand(cfg::SLOTS, cfg::SLOT_COUNT, io);
    CHECK(stand.begin() == 3);
    CHECK(addrOf(0) == 0x68 && addrOf(1) == 0x68 && addrOf(2) == 0x68);
    CHECK(cfg::SLOTS[0].bus != cfg::SLOTS[1].bus && cfg::SLOTS[1].bus != cfg::SLOTS[2].bus && cfg::SLOTS[0].bus != cfg::SLOTS[2].bus);
    run(stand, 0, 25000);
    CHECK(contains(out, "sensors=trunk,upper_r,fore_r\n"));
    CHECK(dataRows(out) == 3);
    imucsv::Sample s;
    CHECK(stand.readSlot(0, &s) && s.ax == -8192 && s.ay == 0 && s.gz == 0);
    // Провод груди выдернули — туловище уходит из потока, рука пишется дальше
    trunkPins.absent = true;
    out.clear();
    run(stand, 30000, 700000);
    CHECK(contains(out, "sensors=upper_r,fore_r\n"));
    CHECK(fakeBuses[cfg::SLOTS[0].bus].recoveries == 3);  // три перезапуска своей шины, затем вон из потока
    CHECK(totalRecoveries() == 3);                         // шины руки не трогали
  }
#endif
}

// Самая длинная строка отсчёта и нагрузка на порт (скорость — cfg::SERIAL_BAUD, 460 800 бод)
static void testThroughput() {
  fprintf(stderr, "пропускная способность порта\n");
  imucsv::Sample worst[5];
  for (int i = 0; i < 5; i++) {
    worst[i].ax = worst[i].ay = worst[i].az = -32768;
    worst[i].gx = worst[i].gy = worst[i].gz = -32768;
  }
  char line[256];
  const size_t three = imucsv::row(line, sizeof line, 4294967295u, worst, 3);
  const size_t five = imucsv::row(line, sizeof line, 4294967295u, worst, 5);
  // 8N1: 10 бит на байт; на 460 800 бод — 46 080 байт/с
  const double cap = cfg::SERIAL_BAUD / 10.0;
  fprintf(stderr, "  худшая строка: 3 датчика — %zu байт, 5 — %zu; на 100 Гц это %.1f%% и %.1f%% порта\n", three, five,
          100.0 * three * 100 / cap, 100.0 * five * 100 / cap);
  CHECK(three > 0 && three < 256 && five > 0 && five < 256);
  CHECK(five * 100 < cap / 2);  // запас больше чем вдвое даже для пяти датчиков в худшем случае
}

int main() {
  testFormat();
  testRegisters();
  testScheduler();
  testStandStream();
  testMissingAndClone();
  testFailures();
  testCalibration();
  testModuleFingerprint();
  testTiming();
  testThroughput();
  testSoftI2c();
  testFixtures();
  if (failures) {
    fprintf(stderr, "НЕ ПРОШЛО: %d из %d проверок\n", failures, checks);
    return 1;
  }
  fprintf(stderr, "все %d проверок прошли\n", checks);
  return 0;
}
