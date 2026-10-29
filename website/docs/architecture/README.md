# NeuroMove — архитектура

Состояние на 1 октября 2026. Всё, что ниже без пометки, **есть в коде** — у каждой диаграммы указаны
файлы. Помеченное **ПРЕДЛОЖЕНИЕ** — план, которого в коде нет.

Диаграммы — Mermaid: GitHub рисует их прямо в этом файле. Синтаксис проверен рендером Mermaid 11
в Chrome (см. `docs/TEST_REPORT.md`).

| # | Диаграмма | Что показывает |
|---|---|---|
| 1 | Контекст | кто пользуется и с чем связано приложение |
| 2 | Модули | слои кода и направление зависимостей |
| 3 | Поток данных | от сырых чисел датчика до отчёта |
| 4 | Граница с устройством | интерфейс `NeuroMoveDevice`, реализации, путь байтов с USB |
| 5 | Состояния | контроллер теста, движок сеанса, связь с устройством |
| 6 | Последовательности | живой тест, обрыв связи, загрузка архива, повтор записи, проверка точности на стенде |
| 7 | Данные | сущности IndexedDB и связи |
| 8 | Развёртывание | три способа запуска |
| 9 | Границы доверия | откуда приходят чужие данные и куда уходят наши |
| 10 | ПРЕДЛОЖЕНИЕ: сервер | как добавить учётные записи и синхронизацию |

---

## 1. Контекст

```mermaid
flowchart LR
  doc["Врач-реабилитолог<br/>инструктор ЛФК"]
  res["Исследователь"]
  fam["Семья ребёнка"]
  subgraph pc["Компьютер или планшет клиники"]
    app["NeuroMove<br/>веб-приложение в браузере"]
    idb[("IndexedDB<br/>этого браузера")]
  end
  sim["Симулятор датчиков<br/>(внутри приложения, только демо)"]
  hw["Датчики IMU<br/>ESP32 по USB или блоки по Bluetooth<br/>(нет железа, код по контракту)"]
  file["Файл записи imu-csv v1"]
  out["Выгрузки: PDF через печать,<br/>CSV метрик и сырых данных, архив JSON"]

  doc --> app
  res --> app
  app --> idb
  sim --> app
  hw -. "Web Serial / Web Bluetooth" .-> app
  file --> app
  app --> out
  out --> fam
  out --> res
```

Сервера нет: приложение — статические файлы, данные — в браузере компьютера клиники.
Семья видит не приложение, а распечатанный «Отчёт для семьи».

## 2. Модули

```mermaid
flowchart TB
  features["features/ — экраны<br/>welcome, overview, patients, session, report, analytics, settings, demo"]
  ui["ui/, layout/, charts/ — кнопки, каркас, свои SVG и canvas"]
  state["state/ — appStore (Zustand), sessionController, deviceMonitor"]
  session["session/ — SessionEngine, сравнения, наблюдения, черновик заключения"]
  core["core/ — фильтр ориентации, углы, повторы, SPARC, метрики, протоколы, проверка точности"]
  devices["devices/ — NeuroMoveDevice: Simulator, Serial, Ble, Replay; контракт imu-csv v1,<br/>LineSplitter, SeqUnwrapper, withMarks"]
  simulation["simulation/ — виртуальный пациент, модель тела, модель MPU-6050, запись станка"]
  data["data/ — модели, IndexedDB, демо-данные, выгрузка, разбор архива"]
  i18n["i18n/ — ru, kk, en"]

  features --> ui
  features --> state
  features --> i18n
  state --> session
  state --> devices
  state --> data
  session --> core
  devices --> simulation
  simulation --> core
  data --> session
```

Правило: `core/`, `devices/`, `session/`, `simulation/` не знают про React — их можно перенести в Node
или в лабораторию на Python один в один (тесты Vitest гоняют их без браузера).

## 3. Поток данных

```mermaid
flowchart LR
  raw["RawFrame<br/>seq, t, int16 ×6 на датчик"]
  pipe["MotionPipeline<br/>core/pipeline.ts"]
  ori["Ориентация «верха»<br/>комплементарный фильтр 98/2<br/>core/orientation.ts"]
  ang["Углы сегментов и суставов<br/>от позы калибровки"]
  reps["Повторы<br/>гистерезис, два порога<br/>core/reps.ts"]
  met["Метрики шага<br/>медиана ROM, SPARC, наклон туловища<br/>core/metrics.ts, core/sparc.ts"]
  step["StepResult"]
  sess["Session<br/>data/models.ts"]
  store[("IndexedDB<br/>sessions, raw")]
  alerts["Наблюдения<br/>session/alerts.ts"]
  report["Отчёт, динамика, аналитика"]

  raw --> pipe --> ori --> ang --> reps --> met --> step --> sess
  sess --> store
  raw -- "кусками по 1000 отсчётов" --> store
  sess --> alerts --> store
  store --> report
```

Углы и метрики считает приложение, а не устройство: прошивке достаточно отдавать сырые числа.
Те же функции строят демо-историю: виртуальный пациент «выполняет» тест, модель выдаёт сырые числа,
движок считает метрики (`data/seed/demo.ts`).

## 4. Граница с устройством

```mermaid
classDiagram
  class NeuroMoveDevice {
    <<interface>>
    +kind DeviceKind
    +connect() Promise
    +disconnect() Promise
    +start() Promise
    +stop() Promise
    +getStatus() DeviceStatus
    +onStatus(cb) Unsubscribe
    +onData(cb) Unsubscribe
  }
  class SimulatorDevice {
    100 Гц, сбои: обрыв, потери, разряд, утомление
    simulated = true
  }
  class SerialDevice {
    Web Serial 460800 бод
    паспорт и строки imu-csv v1
    не проверен на железе
  }
  class BleDevice {
    Web Bluetooth, пакет 18 байт
    UUID — после прошивки
    не проверен на железе
  }
  class ReplayDevice {
    проигрывает CSV imu-csv v1
    simulated = паспорт demo=yes или симулятор
  }
  NeuroMoveDevice <|.. SimulatorDevice
  NeuroMoveDevice <|.. SerialDevice
  NeuroMoveDevice <|.. BleDevice
  NeuroMoveDevice <|.. ReplayDevice
```

Контракт с железом — `devices/contract.ts` и `софт.md`, раздел 1. Новое железо —
ещё один класс с этим интерфейсом; экраны, движок и отчёты не меняются.

Путь байтов с USB до отсчёта. По ту сторону кабеля — прошивка стенда
([`firmware/`](../../../firmware/README.md)): 100 раз в секунду 14 байт с каждого MPU-6050
и строка imu-csv v1; паспорт повторяется каждые 2 с.

```mermaid
flowchart LR
  port["Порт Web Serial<br/>байты"] --> dec["TextDecoderStream<br/>текст кусками"]
  dec --> split["LineSplitter<br/>строки; хвост без \n дольше 4096 знаков — мусор"]
  split --> parse["ImuCsvParser<br/>паспорт, заголовок, int16, ошибки строк"]
  parse --> unwrap["SeqUnwrapper<br/>seq только растёт; при отскоке — разрыв<br/>длиной в реально прошедшее время"]
  unwrap --> batch["пачка RawFrame раз в 40 мс"]
```

## 5. Состояния

### 5.1. Контроллер теста — `state/sessionController.ts`

```mermaid
stateDiagram-v2
  [*] --> connect: «Надеть датчики»
  connect --> test: датчики на связи, «Начать тест»
  test --> saving: движок закончил все шаги
  test --> done: «Завершить и сохранить» (досрочно)
  saving --> done: Session записан
  connect --> [*]: «Отменить сеанс»
  done --> [*]: переход в отчёт
  note right of test
    раз в 2 с — запись восстановления в localStorage:
    закрыли вкладку → «Сеанс был прерван»
  end note
```

### 5.2. Движок сеанса — `session/SessionEngine.ts`

```mermaid
stateDiagram-v2
  [*] --> ready
  ready --> calibrating: start()
  calibrating --> calibrating: пациент двигался — заново
  calibrating --> positioning: шаг с установкой (поворот предплечья)
  calibrating --> recording: шаг без установки
  positioning --> recording: поза принята
  recording --> step_done: повторы набраны или время вышло
  step_done --> positioning: следующий шаг с установкой
  step_done --> recording: следующий шаг
  step_done --> finished: шагов больше нет
  recording --> paused: pause()
  positioning --> paused: pause()
  paused --> recording: resume()
  recording --> interrupted: связь пропала
  positioning --> interrupted: связь пропала
  interrupted --> recording: связь вернулась и resume()
  recording --> calibrating: recalibrate()
  recording --> finished: stop()
  paused --> finished: stop()
  interrupted --> finished: stop()
  finished --> [*]
```

Прерванный повтор не засчитывается: при паузе и обрыве детектор повторов сбрасывается.

### 5.3. Связь с устройством — `devices/types.ts`

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> requesting: окно выбора порта (USB, Bluetooth)
  idle --> searching: симулятор
  idle --> connected: файл записи — сразу
  requesting --> connecting
  searching --> connecting
  requesting --> error: пользователь закрыл окно
  connecting --> connected: паспорт прочитан
  connected --> streaming: start()
  streaming --> reconnecting: обрыв
  reconnecting --> streaming: восстановлено
  reconnecting --> error: 5 попыток не помогли
  streaming --> connected: stop()
  connected --> idle: disconnect()
  error --> idle: disconnect()
```

## 6. Последовательности

### 6.1. Живой тест и сохранение

```mermaid
sequenceDiagram
  actor U as Специалист
  participant S as SessionSetupPage
  participant C as SessionController
  participant D as Устройство
  participant E as SessionEngine
  participant A as appStore
  participant DB as IndexedDB
  U->>S: пациент, протокол, «Надеть датчики»
  S->>C: start(setup)
  C->>D: connect(), start()
  D-->>C: статус streaming, датчики на связи
  U->>C: «Начать тест» (beginTest)
  C->>E: start()
  loop симулятор: пачка из 4 отсчётов каждые 40 мс (100 Гц)
    D-->>E: RawFrame[]
    E->>E: углы, повторы, метрики
  end
  E-->>C: finished
  C->>C: buildSession()
  C-->>A: Session + сырые отсчёты
  A->>A: смоделированное в клинику? — отказ
  A->>A: evaluateSession(): наблюдения, цели
  A->>DB: put(sessions), put(alerts), putRaw()
  A-->>U: отчёт #/sessions/:id?complete=1
```

### 6.2. Обрыв связи

```mermaid
sequenceDiagram
  participant D as Устройство
  participant E as SessionEngine
  participant O as InterruptionOverlay
  actor U as Специалист
  D-->>E: статус reconnecting
  E->>E: recording → interrupted, текущий повтор выброшен
  E-->>O: «Связь с устройством потеряна»
  D->>D: до 5 попыток переподключения
  D-->>E: статус streaming
  E-->>O: «Связь восстановлена»
  U->>O: «Продолжить»
  O->>E: resume()
  E->>E: interrupted → recording
```

### 6.3. Загрузка архива JSON

```mermaid
sequenceDiagram
  actor U as Специалист
  participant P as SettingsPage
  participant B as parseWorkspaceBackup
  participant A as appStore
  participant DB as IndexedDB
  U->>P: файл .json
  P->>P: больше 50 МБ? — отказ
  P->>U: подтверждение: пространство будет заменено
  U->>P: «Восстановить»
  P->>A: importBackup(text)
  A->>B: разбор и проверка
  B->>B: формат, версия, пространство, типы полей,<br/>код пациента [A-Z0-9-]{1,12}, длина текстов,<br/>ссылки на пациента и сеанс, симуляция в клинике
  B-->>A: данные или null
  A->>A: id совпадают с другим пространством? — отказ
  A->>DB: replaceWorkspace() одной транзакцией
```

### 6.4. Повтор записи в пространстве клиники

```mermaid
sequenceDiagram
  actor U as Специалист
  participant S as SessionSetupPage
  participant K as contract.ts
  U->>S: источник «Запись CSV», файл
  S->>S: больше 64 МБ? — «не похоже на запись одного сеанса»
  S->>K: parseImuCsv()
  K-->>S: паспорт, отсчёты, ошибки строк
  S->>K: isSimulatedRecording(паспорт)
  alt demo=yes или устройство-симулятор
    S-->>U: «Это запись из демо… загрузить нельзя», старт недоступен
  else настоящая запись
    S-->>U: «Сеанс сохранится с пометкой «Запись из файла»…»
  end
```

### 6.5. Проверка точности на стенде

```mermaid
sequenceDiagram
  actor T as Команда у стенда
  participant A as AccuracyCheck
  participant D as Устройство (USB)
  participant V as core/validation.ts
  T->>A: «Начать запись»
  A->>D: onData — копить отсчёты (до 15 мин)
  T->>T: 3 с неподвижно, рука вдоль тела
  loop каждый угол станка: 0°, 30°, 60°, 90°, 120°
    T->>A: вписать угол, «Отметка» — пока рука неподвижна
    A->>A: отметка на последнем отсчёте
  end
  T->>A: «Остановить»
  A->>A: imu-csv v1 + паспорт kind=bench + строки # mark
  A-->>T: файл на диск (сырые данные проверки)
  T->>A: «Посчитать»
  A->>V: validateRecording(отсчёты, отметки, движение, сторона, порог 5°)
  V->>V: калибровка → угол каждого отсчёта → медиана ±0.5 с у отметки
  V-->>A: ошибки, MAE, максимум, смещение, пределы согласия, прошло или нет
```

## 7. Данные — IndexedDB `neuromove`, версия 1

```mermaid
erDiagram
  PATIENT ||--o{ SESSION : "patientId"
  PATIENT ||--o{ NOTE : "patientId"
  PATIENT ||--o{ ALERT : "patientId"
  SESSION |o--o{ NOTE : "sessionId"
  SESSION |o--o{ ALERT : "sessionId"
  SESSION ||--o{ RAW_CHUNK : "sessionId"
  PATIENT {
    string id PK
    string workspace "demo или clinic, индекс"
    string code "P07, без ФИО"
    int birthYear
    string cpForm
    int gmfcs
    int macs
    string affectedSide
    json goals "встроены в запись"
  }
  SESSION {
    string id PK
    string workspace "индекс"
    string patientId "индекс"
    string startedAt
    string protocolId
    json steps "метрики по шагам"
    json events
    json quality
    json device "kind, name, simulated"
    bool demo
    string algorithmVersion
  }
  NOTE {
    string id PK
    string workspace
    string patientId
    string sessionId
    string kind "clinical или summary"
    string text
  }
  ALERT {
    string id PK
    string workspace
    string patientId
    string sessionId
    string kind
    bool acknowledged
  }
  RAW_CHUNK {
    string key PK "sessionId:index"
    string sessionId "индекс"
    bytes data "Int16Array"
  }
```

Ещё хранилище `meta` (ключ — значение): настройки, профиль специалиста, служебная запись демо
и снимок демо для мгновенного сброса. Схема и индексы — `data/db.ts`; проверка архива —
`data/backup.ts`.

**Миграции.** Версия базы — 1. Новая версия: поднять `DB_VERSION` и дописать ветку в `upgrade(db, oldVersion)`
— только добавлять хранилища и индексы, ничего не удалять. Перед обновлением — архив JSON
из «Настроек». Откат: старая версия приложения не откроет базу новой версии; восстановление —
архив JSON в чистом браузере.

## 8. Развёртывание

```mermaid
flowchart TB
  subgraph a["А. Сайт — npm run build → dist/"]
    gh["GitHub Pages или любой статический хостинг<br/>https: Web Serial и Web Bluetooth доступны"]
  end
  subgraph b["Б. Один файл — npm run build:demo → demo/NeuroMove.html"]
    disk["двойной щелчок, file://<br/>без интернета; navigator.serial есть,<br/>с настоящим портом не проверено"]
  end
  subgraph c["В. Разработка — npm run dev"]
    local["http://localhost:5173<br/>Web Serial доступен"]
  end
  csp["Политика CSP в А и Б:<br/>connect-src 'none', свои скрипты"]
  csp --- a
  csp --- b
```

Chrome считает страницу с диска защищённым контекстом: `isSecureContext === true`, `navigator.serial`
и `navigator.bluetooth` есть (проверено 1 октября в Chrome через Playwright). Подключение настоящего
порта с диска не проверено — железа нет. Подробности и порядок выпуска — `docs/DEPLOYMENT.md`.

## 9. Границы доверия

```mermaid
flowchart LR
  subgraph browser["Песочница браузера, origin приложения"]
    app["NeuroMove"]
    idb[("IndexedDB")]
    ls[("localStorage<br/>запись восстановления")]
    ss[("sessionStorage<br/>шаг гида")]
  end
  f1["Файл архива JSON"] -- "чужие данные:<br/>размер, схема, шаблоны" --> app
  f2["Файл записи CSV"] -- "чужие данные:<br/>размер, int16, паспорт demo" --> app
  dev["Поток с датчика"] -- "чужие байты:<br/>разбор по контракту, seq" --> app
  app --> idb
  app --> ls
  app --> ss
  app -- "CSV: ячейки-формулы<br/>обезврежены" --> xl["Excel / таблицы"]
  app -- "PDF через печать" --> paper["Бумага, карта пациента"]
  app -. "CSP connect-src 'none':<br/>сеть закрыта" .-x net["Интернет"]
```

Что не закрыто — `docs/SECURITY_PRIVACY.md`: нет пароля и шифрования на диске; на GitHub Pages все
проекты одного аккаунта делят один origin, а значит, и IndexedDB.

## 10. ПРЕДЛОЖЕНИЕ: сервер

Этого нет в коде. Порядок и условия — `docs/ROADMAP.md`.

```mermaid
flowchart LR
  app["NeuroMove в браузере"] -- "https, вход по паролю и коду" --> api["API<br/>проверка прав на сервере"]
  api --> db[("База в Казахстане<br/>(ст. 12 закона № 94-V)")]
  api --> audit[("Журнал доступа")]
  app -- "офлайн-очередь" --> idb[("IndexedDB")]
  idb -. "синхронизация, когда есть сеть" .-> api
```

Условия до начала: где можно хранить данные детей (юрист центра), кто владелец данных, роли
(врач, инструктор, исследователь), срок хранения. Реализация хранилища — новый класс с интерфейсом
`DataStorage` (`data/db.ts`); экраны не меняются.
