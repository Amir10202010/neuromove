// Настройки стенда NeuroMove: выводы шин I2C, места датчиков, частота, скорость порта.
// Всё, что может понадобиться поменять на стенде, — здесь; остальные файлы трогать не нужно.
//
// Контракт с приложением — софт.md, раздел 1: формат imu-csv v1, 100 отсчётов
// в секунду, акселерометр ±4 g, гироскоп ±1000 °/с, фильтр датчика ~44 Гц, порт 460 800 бод.
#pragma once
#include <stdint.h>

#include "imu_csv.h"

namespace cfg {

// Паспорт устройства: имя и версия прошивки попадают в каждую запись
static const char DEVICE[] = "NM-01";
static const char FIRMWARE[] = "0.1";

// Скорость порта. Была 921 600; 12 октября 2026 на маке с купленной платой (USB-UART CH340C,
// встроенный драйвер macOS) на 921 600 приходили одни каракули, на 460 800 — чистый текст.
// Запас есть: строка трёх датчиков до 137 байт, 100 строк в секунду — 30% порта 460 800
// (test/host_test.cpp, «пропускная способность порта»). Менять вместе с BAUD в website/src/devices/SerialDevice.ts
static const uint32_t SERIAL_BAUD = 460800;
static const uint16_t RATE_HZ = 100;
static const uint8_t ACC_G = 4;
static const uint16_t GYRO_DPS = 1000;

// Шина I2C на кабеле до 50 см — 100 кГц (прототип.md, риск 3).
// На макетке с короткими проводами можно 400000: чтение трёх датчиков станет вчетверо быстрее
static const uint32_t I2C_HZ = 100000;
// Сколько ждать зависшую транзакцию I2C. По умолчанию у Wire 50 мс (Arduino-ESP32 2.0.17 и 3.3.12,
// Wire.cpp): датчик, держащий шину, тогда останавливал бы строки всех датчиков на 1,75 с. Обычное чтение
// 14 байт на 100 кГц — 1,56 мс, 10 мс — шестикратный запас (test/host_test.cpp, «время цикла»)
static const uint16_t I2C_TIMEOUT_MS = 10;

// Паспорт и заголовок повторяются каждые 2 с: приложение ждёт их 6 с после открытия порта
// (SerialDevice.ts) и увидит, даже если плата при этом не перезагрузилась
static const uint32_t PASSPORT_EVERY_MS = 2000;

// Датчика нет на месте — ищем его снова раз в столько миллисекунд (разъём отошёл и вернулся)
static const uint32_t RESCAN_EVERY_MS = 5000;

// Сбои чтения: столько неудач подряд — перезапуск шины; столько перезапусков без единого
// удачного чтения — датчик убираем из потока до тех пор, пока он снова не ответит
static const uint8_t FAILS_BEFORE_RECOVERY = 10;
static const uint8_t RECOVERIES_BEFORE_DROP = 3;

}  // namespace cfg

// Рука стенда — правая. Для левой раскомментировать строку ниже (или собрать с -DNM_LEFT_ARM)
// #define NM_LEFT_ARM

// Разводка шин I2C. С 27 октября 2026 по умолчанию — три шины, по датчику на шину, у всех адрес 0x68,
// AD0 никуда не подключается. Так к каждому датчику идёт кабель на 4 жилы: VCC, GND, SCL, SDA.
//   Шина 0 — Wire, аппаратная: плечо.
//   Шина 1 — Wire1, аппаратная: предплечье.
//   Шина 2 — программная (soft_i2c.h): туловище. Аппаратных шин у ESP32 только две.
// Прежняя разводка — две шины: плечо и предплечье на шине 0 (у предплечья AD0 → 3V3, адрес 0x69),
// туловище на шине 1. Для неё раскомментировать строку ниже (или собрать с -DNM_TWO_BUSES)
// #define NM_TWO_BUSES
#ifdef NM_TWO_BUSES
#define NM_BUS_COUNT 2
#else
#define NM_BUS_COUNT 3
#endif

#if defined(NM_BOARD_ESP32) || defined(CONFIG_IDF_TARGET_ESP32)
// Классический ESP32 DevKit — плата стенда, куплена 9 октября. Шина 0 на стандартных 21 и 22
// (железо.md, раздел 5)
#define NM_BOARD_NAME "esp32"
#define NM_BUS0_SDA 21
#define NM_BUS0_SCL 22
#ifdef NM_TWO_BUSES
#define NM_BUS1_SDA 32
#define NM_BUS1_SCL 33
#else
// Все выводы трёх шин — в правом ряду платы, рядом с 3V3 и GND: в корпусе v3 этот ряд воткнут в макетную
// плату (../hardware/models/enclosure/ПЕЧАТЬ-v3.md). 16 и 17 — на плате HW-394 подписаны D16 и D17, на других платах RX2 и TX2;
// у модуля WROOM-32 они свободны и не влияют на загрузку
#define NM_BUS1_SDA 19
#define NM_BUS1_SCL 18
#define NM_BUS2_SDA 16
#define NM_BUS2_SCL 17
#endif
#else
// ESP32-S3 N16R8 — если стенд соберут на S3. Не годятся: 0, 3, 45, 46 — выводы режима загрузки; 19, 20 — USB;
// 26–37 — флеш и PSRAM модуля N16R8; 43, 44 — порт «COM», по нему данные идут в ноутбук
#define NM_BOARD_NAME "esp32s3"
#define NM_BUS0_SDA 8
#define NM_BUS0_SCL 9
#define NM_BUS1_SDA 4
#define NM_BUS1_SCL 5
#define NM_BUS2_SDA 6
#define NM_BUS2_SCL 7
#endif

namespace cfg {

static const uint8_t BUS_COUNT = NM_BUS_COUNT;

// Место датчика на шине: какая шина и какой адрес
struct Slot {
  imucsv::Place place;  // место на теле — имя столбцов в CSV
  uint8_t bus;          // 0, 1 или 2
  uint8_t addr;         // 0x68 (AD0 → GND или никуда) или 0x69 (AD0 → 3V3)
};

// Порядок здесь — порядок столбцов в строке отсчёта. Датчика, которого нет, в потоке нет.
// Первый этап стенда (прототип.md, раздел 6) — только плечо и предплечье: это нормально.
// Поправки калибровки в памяти платы хранятся по шине и адресу; после смены разводки чужие поправки
// стенд узнаёт по отпечатку модуля, не применяет и просит cal
#ifdef NM_TWO_BUSES
#ifdef NM_LEFT_ARM
static const Slot SLOTS[] = {
    {imucsv::TRUNK, 1, 0x68},
    {imucsv::UPPER_L, 0, 0x68},
    {imucsv::FORE_L, 0, 0x69},
};
#else
static const Slot SLOTS[] = {
    {imucsv::TRUNK, 1, 0x68},
    {imucsv::UPPER_R, 0, 0x68},
    {imucsv::FORE_R, 0, 0x69},
};
#endif
#else
#ifdef NM_LEFT_ARM
static const Slot SLOTS[] = {
    {imucsv::TRUNK, 2, 0x68},
    {imucsv::UPPER_L, 0, 0x68},
    {imucsv::FORE_L, 1, 0x68},
};
#else
static const Slot SLOTS[] = {
    {imucsv::TRUNK, 2, 0x68},
    {imucsv::UPPER_R, 0, 0x68},
    {imucsv::FORE_R, 1, 0x68},
};
#endif
#endif
static const uint8_t SLOT_COUNT = sizeof(SLOTS) / sizeof(SLOTS[0]);

}  // namespace cfg
