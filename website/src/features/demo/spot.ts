// Цели гида. Экран помечает свои блоки и кнопки атрибутом data-guide, а гид по шагу знает,
// какой блок подсветить (look) и на какую настоящую кнопку показать (press). Кнопку гид
// не дублирует: человек нажимает ту же кнопку, что и в работе, — и запоминает, где она.

import type { GuideStep } from '../../state/appStore';

/** Блоки, на которые смотреть. */
export type LookId = 'course' | 'plan' | 'sensors' | 'live' | 'calibration' | 'session' | 'group';
/** Кнопки, которые нажать. */
export type PressId = 'start-test' | 'wear' | 'begin';

/**
 * Что подсвечено на каждом шаге. look — первый найденный блок из списка (калибровка идёт
 * на месте теста); press — кнопка, которую нужно нажать; нет press — в подсказке «Далее».
 */
export const STEP_TARGETS: Record<GuideStep, { look: LookId[]; press?: PressId }> = {
  patient: { look: ['course'] },
  start: { look: [], press: 'start-test' },
  setup: { look: ['plan'], press: 'wear' },
  connect: { look: ['sensors'], press: 'begin' },
  test: { look: ['live', 'calibration'] },
  result: { look: ['session'] },
  progress: { look: ['course'] },
  analytics: { look: ['group'] },
};

export function findTarget(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-guide="${id}"]`);
}
