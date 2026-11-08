// Labels of every enum of the Functional Progression System in Russian, Kazakh and English.
// Typed as complete records: a missing translation is a build error. Kazakh terminology should be
// reviewed by a native-speaking rehabilitation professional before clinical use.

import type { Locale } from '../../data/models';
import type {
  ActivityStatus,
  Barrier,
  Completion,
  GoalCategory,
  GoalMeasurementKind,
  GoalStatus,
  IncidentCategory,
  IncidentType,
  InformationSource,
  InstrumentId,
  ModuleType,
  MovementDomain,
  ProgramStatus,
  ReviewDecision,
  StudyStatus,
  Timepoint,
  ObservationResponse,
  EvaluationDomain,
} from '../../rehab/model';

export interface Labels {
  goalCategory: Record<GoalCategory, string>;
  goalStatus: Record<GoalStatus, string>;
  measurement: Record<GoalMeasurementKind, string>;
  activityStatus: Record<ActivityStatus, string>;
  domain: Record<MovementDomain, string>;
  module: Record<ModuleType, string>;
  programStatus: Record<ProgramStatus, string>;
  completion: Record<Completion, string>;
  barrier: Record<Barrier, string>;
  fatigue: Record<0 | 1 | 2 | 3, string>;
  discomfort: Record<'none' | 'some' | 'pain', string>;
  decision: Record<ReviewDecision, string>;
  response: Record<ObservationResponse, string>;
  instrument: Record<InstrumentId, string>;
  timepoint: Record<Timepoint, string>;
  incidentCategory: Record<IncidentCategory, string>;
  incidentType: Record<IncidentType, string>;
  source: Record<InformationSource, string>;
  studyStatus: Record<StudyStatus, string>;
  evalDomain: Record<EvaluationDomain, string>;
  setting: Record<'clinic' | 'home', string>;
}

const en: Labels = {
  goalCategory: { reaching: 'Reaching', object_manipulation: 'Object manipulation', bilateral_hand_use: 'Using both hands', maintaining_position: 'Maintaining a position', movement_coordination: 'Movement coordination', functional_mobility: 'Functional mobility', balance: 'Balance activities', daily_activity: 'Daily activity', other: 'Other' },
  goalStatus: { not_started: 'Not started', in_progress: 'In progress', needs_review: 'Needs review', achieved: 'Achieved', paused: 'Paused' },
  measurement: { gas: 'Goal Attainment Scaling', copm: 'COPM', observation: 'Professional observation', caregiver_report: 'Caregiver report', imu: 'IMU movement measurement', other: 'Other' },
  activityStatus: { draft: 'Draft', experimental: 'Experimental', clinician_approved: 'Clinician-approved' },
  domain: { upper_limb_range: 'Upper-limb range', reaching: 'Reaching', grasp_release: 'Grasp and release', bimanual: 'Bimanual use', posture_trunk: 'Posture and trunk', mobility: 'Mobility', balance: 'Balance', coordination: 'Coordination', other: 'Other' },
  module: { assessment: 'Initial assessment', supervised: 'Supervised practice', home: 'Home practice', review: 'Progress review', reassessment: 'Reassessment' },
  programStatus: { active: 'Active', paused: 'Paused', completed: 'Completed' },
  completion: { completed: 'Done', partial: 'Partly done', not_completed: 'Not done', stopped: 'Stopped' },
  barrier: { time: 'No time today', child_tired: 'Child was tired', child_unwell: 'Child was unwell', child_declined: 'Child did not want to', unclear_instructions: 'Instructions were unclear', equipment: 'Equipment missing', other: 'Something else' },
  fatigue: { 0: 'Not tired', 1: 'A little tired', 2: 'Quite tired', 3: 'Very tired' },
  discomfort: { none: 'No discomfort', some: 'Some discomfort', pain: 'Pain' },
  decision: { continue: 'Continue the program', modify_program: 'Modify the program (new version)', pause_program: 'Pause the program', reassess: 'Reassess', refer: 'Refer / consult', noted: 'Noted' },
  response: { agree: 'Relevant', disagree: 'Disagree', not_relevant: 'Not relevant', needs_more_data: 'Needs more data' },
  instrument: { gas: 'Goal Attainment Scaling (GAS)', copm: 'Canadian Occupational Performance Measure (COPM)', gmfm66: 'GMFM-66', gmfm88: 'GMFM-88', other: 'Other instrument' },
  timepoint: { baseline: 'Baseline', interim: 'Interim', follow_up: 'Follow-up', discharge: 'Discharge' },
  incidentCategory: { safety: 'Safety', deviation: 'Protocol deviation', technical: 'Technical' },
  incidentType: { pain: 'Pain', discomfort: 'Discomfort', fatigue: 'Fatigue', unusual_response: 'Unusual response', fall_or_injury: 'Fall or injury', session_stopped: 'Session stopped', protocol_deviation: 'Protocol deviation', sensor_failure: 'Sensor failure', software_failure: 'Software failure', other: 'Other' },
  source: { instrument: 'Assessment instrument', imu: 'IMU measurement', reported: 'Reported', professional: 'Professional' },
  studyStatus: { planning: 'Planning', approved: 'Ethics approved', recruiting: 'Recruiting', active: 'Active', closed: 'Closed' },
  evalDomain: { feasibility: 'Feasibility', usability: 'Usability', engagement: 'Engagement', measurement_quality: 'Measurement quality', longitudinal: 'Longitudinal observation' },
  setting: { clinic: 'Clinic', home: 'Home' },
};

const ru: Labels = {
  goalCategory: { reaching: 'Дотягивание', object_manipulation: 'Действия с предметами', bilateral_hand_use: 'Работа двумя руками', maintaining_position: 'Удержание позы', movement_coordination: 'Координация движений', functional_mobility: 'Функциональная мобильность', balance: 'Равновесие', daily_activity: 'Повседневное действие', other: 'Другое' },
  goalStatus: { not_started: 'Не начата', in_progress: 'В работе', needs_review: 'Нужен пересмотр', achieved: 'Достигнута', paused: 'Приостановлена' },
  measurement: { gas: 'Шкала достижения целей (GAS)', copm: 'COPM', observation: 'Наблюдение специалиста', caregiver_report: 'Отчёт семьи', imu: 'Измерение движения IMU', other: 'Другое' },
  activityStatus: { draft: 'Черновик', experimental: 'Экспериментальное', clinician_approved: 'Одобрено специалистом' },
  domain: { upper_limb_range: 'Объём движений руки', reaching: 'Дотягивание', grasp_release: 'Захват и отпускание', bimanual: 'Двуручные действия', posture_trunk: 'Поза и туловище', mobility: 'Мобильность', balance: 'Равновесие', coordination: 'Координация', other: 'Другое' },
  module: { assessment: 'Первичная оценка', supervised: 'Занятия со специалистом', home: 'Занятия дома', review: 'Обзор прогресса', reassessment: 'Повторная оценка' },
  programStatus: { active: 'Действует', paused: 'Приостановлена', completed: 'Завершена' },
  completion: { completed: 'Сделали', partial: 'Сделали частично', not_completed: 'Не сделали', stopped: 'Остановили' },
  barrier: { time: 'Сегодня не было времени', child_tired: 'Ребёнок устал', child_unwell: 'Ребёнок плохо себя чувствовал', child_declined: 'Ребёнок не захотел', unclear_instructions: 'Непонятно, как делать', equipment: 'Нет нужных предметов', other: 'Другое' },
  fatigue: { 0: 'Не устал', 1: 'Немного устал', 2: 'Довольно устал', 3: 'Очень устал' },
  discomfort: { none: 'Без неприятных ощущений', some: 'Было неприятно', pain: 'Было больно' },
  decision: { continue: 'Продолжить программу', modify_program: 'Изменить программу (новая версия)', pause_program: 'Приостановить программу', reassess: 'Провести повторную оценку', refer: 'Консультация / направление', noted: 'Принято к сведению' },
  response: { agree: 'Актуально', disagree: 'Не согласен', not_relevant: 'Не относится', needs_more_data: 'Нужно больше данных' },
  instrument: { gas: 'Шкала достижения целей (GAS)', copm: 'Канадская оценка выполнения деятельности (COPM)', gmfm66: 'GMFM-66', gmfm88: 'GMFM-88', other: 'Другой инструмент' },
  timepoint: { baseline: 'Исходная', interim: 'Промежуточная', follow_up: 'Повторная', discharge: 'При выписке' },
  incidentCategory: { safety: 'Безопасность', deviation: 'Отклонение от протокола', technical: 'Техническое' },
  incidentType: { pain: 'Боль', discomfort: 'Дискомфорт', fatigue: 'Утомление', unusual_response: 'Необычная реакция', fall_or_injury: 'Падение или травма', session_stopped: 'Занятие остановлено', protocol_deviation: 'Отклонение от протокола', sensor_failure: 'Сбой датчика', software_failure: 'Сбой программы', other: 'Другое' },
  source: { instrument: 'Инструмент оценки', imu: 'Измерение IMU', reported: 'Со слов семьи / ребёнка', professional: 'Специалист' },
  studyStatus: { planning: 'Подготовка', approved: 'Одобрено этическим комитетом', recruiting: 'Набор', active: 'Идёт', closed: 'Закрыто' },
  evalDomain: { feasibility: 'Выполнимость', usability: 'Удобство', engagement: 'Вовлечённость', measurement_quality: 'Качество измерений', longitudinal: 'Динамика во времени' },
  setting: { clinic: 'Клиника', home: 'Дом' },
};

const kk: Labels = {
  goalCategory: { reaching: 'Қол созу', object_manipulation: 'Заттармен әрекет', bilateral_hand_use: 'Екі қолмен жұмыс', maintaining_position: 'Қалыпты ұстау', movement_coordination: 'Қимыл үйлесімі', functional_mobility: 'Функционалдық қозғалғыштық', balance: 'Тепе-теңдік', daily_activity: 'Күнделікті әрекет', other: 'Басқа' },
  goalStatus: { not_started: 'Басталмаған', in_progress: 'Орындалуда', needs_review: 'Қайта қарау керек', achieved: 'Қол жеткізілді', paused: 'Тоқтатылған' },
  measurement: { gas: 'Мақсатқа жету шкаласы (GAS)', copm: 'COPM', observation: 'Маман бақылауы', caregiver_report: 'Отбасы есебі', imu: 'IMU қимыл өлшемі', other: 'Басқа' },
  activityStatus: { draft: 'Жоба', experimental: 'Тәжірибелік', clinician_approved: 'Маман мақұлдаған' },
  domain: { upper_limb_range: 'Қол қимылының көлемі', reaching: 'Қол созу', grasp_release: 'Ұстау және жіберу', bimanual: 'Екі қолмен әрекет', posture_trunk: 'Дене қалпы', mobility: 'Қозғалғыштық', balance: 'Тепе-теңдік', coordination: 'Үйлесім', other: 'Басқа' },
  module: { assessment: 'Алғашқы бағалау', supervised: 'Маманмен сабақ', home: 'Үйдегі сабақ', review: 'Прогресті шолу', reassessment: 'Қайта бағалау' },
  programStatus: { active: 'Белсенді', paused: 'Тоқтатылған', completed: 'Аяқталған' },
  completion: { completed: 'Орындадық', partial: 'Жартылай орындадық', not_completed: 'Орындамадық', stopped: 'Тоқтаттық' },
  barrier: { time: 'Бүгін уақыт болмады', child_tired: 'Бала шаршады', child_unwell: 'Баланың көңіл-күйі нашар болды', child_declined: 'Бала қаламады', unclear_instructions: 'Қалай жасау керегі түсініксіз', equipment: 'Қажетті заттар жоқ', other: 'Басқа' },
  fatigue: { 0: 'Шаршаған жоқ', 1: 'Сәл шаршады', 2: 'Біршама шаршады', 3: 'Қатты шаршады' },
  discomfort: { none: 'Жайсыздық болмады', some: 'Жайсыз болды', pain: 'Ауырды' },
  decision: { continue: 'Бағдарламаны жалғастыру', modify_program: 'Бағдарламаны өзгерту (жаңа нұсқа)', pause_program: 'Бағдарламаны тоқтата тұру', reassess: 'Қайта бағалау', refer: 'Кеңес / жолдама', noted: 'Назарға алынды' },
  response: { agree: 'Өзекті', disagree: 'Келіспеймін', not_relevant: 'Қатысы жоқ', needs_more_data: 'Көбірек дерек керек' },
  instrument: { gas: 'Мақсатқа жету шкаласы (GAS)', copm: 'Канадалық іс-әрекетті орындау өлшемі (COPM)', gmfm66: 'GMFM-66', gmfm88: 'GMFM-88', other: 'Басқа құрал' },
  timepoint: { baseline: 'Бастапқы', interim: 'Аралық', follow_up: 'Қайталама', discharge: 'Шығарар кезде' },
  incidentCategory: { safety: 'Қауіпсіздік', deviation: 'Хаттамадан ауытқу', technical: 'Техникалық' },
  incidentType: { pain: 'Ауырсыну', discomfort: 'Жайсыздық', fatigue: 'Шаршау', unusual_response: 'Әдеттен тыс реакция', fall_or_injury: 'Құлау немесе жарақат', session_stopped: 'Сабақ тоқтатылды', protocol_deviation: 'Хаттамадан ауытқу', sensor_failure: 'Датчик ақауы', software_failure: 'Бағдарлама ақауы', other: 'Басқа' },
  source: { instrument: 'Бағалау құралы', imu: 'IMU өлшемі', reported: 'Отбасы / бала айтуынша', professional: 'Маман' },
  studyStatus: { planning: 'Дайындық', approved: 'Этика комитеті мақұлдаған', recruiting: 'Қатысушыларды жинау', active: 'Жүріп жатыр', closed: 'Жабылған' },
  evalDomain: { feasibility: 'Орындалуы', usability: 'Ыңғайлылығы', engagement: 'Қатысуы', measurement_quality: 'Өлшем сапасы', longitudinal: 'Уақыт бойынша өзгеріс' },
  setting: { clinic: 'Клиника', home: 'Үй' },
};

export const LABELS: Record<Locale, Labels> = { en, ru, kk };
