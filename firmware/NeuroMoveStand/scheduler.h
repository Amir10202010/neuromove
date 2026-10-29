// Расписание отсчётов без дрейфа: rate_hz раз в секунду по часам платы (micros()).
//
// Номер отсчёта = сколько периодов прошло с первого отсчёта. Если плата не успела (шина
// подвисла, перезапуск датчика), пропущенные слоты не догоняются, но номер всё равно растёт:
// приложение видит пропуск, а время отсчёта seq / rate_hz остаётся честным.
//
// micros() — 32 бита, переполняется каждые ~71,6 минуты. Сравнение через разность без знака
// это переживает: (now − next) как число со знаком верно, пока опоздание меньше ~35 минут.
// После паузы (калибровка, долгий перезапуск шины) номер прыгает вперёд на прошедшее время —
// назад не идёт никогда: скачок назад приложение считает перезагрузкой платы.
#pragma once
#include <stdint.h>

class Scheduler {
 public:
  explicit Scheduler(uint32_t periodUs) : period_(periodUs), next_(0), seq_(0), started_(false) {}

  // Пора снимать отсчёт? true — пора, номер этого отсчёта в *seq
  bool due(uint32_t nowUs, uint32_t* seq) {
    if (!started_) {
      started_ = true;
      next_ = nowUs;
    }
    const int32_t late = (int32_t)(nowUs - next_);
    if (late < 0) return false;
    // Сколько слотов целиком проспали: их номера пропускаем
    const uint32_t missed = (uint32_t)late / period_;
    seq_ += missed;
    next_ += (missed + 1) * period_;
    *seq = seq_++;
    return true;
  }

  // После паузы, когда due() не вызывали (калибровка): номер прибавляет прошедшее время,
  // а расписание начинается от «сейчас». Без этого пауза дольше ~35 минут перевернула бы
  // сравнение со знаком, и поток замер бы до следующего оборота micros()
  void resume(uint32_t nowUs, uint32_t pausedMs) {
    if (!started_) return;
    seq_ += (uint32_t)((uint64_t)pausedMs * 1000u / period_);
    next_ = nowUs;
  }

  // Сколько микросекунд до следующего слота (0 — уже пора). Чтобы не крутить цикл вхолостую
  uint32_t untilNext(uint32_t nowUs) const {
    if (!started_) return 0;
    const int32_t left = (int32_t)(next_ - nowUs);
    return left > 0 ? (uint32_t)left : 0;
  }

 private:
  uint32_t period_;
  uint32_t next_;
  uint32_t seq_;
  bool started_;
};
