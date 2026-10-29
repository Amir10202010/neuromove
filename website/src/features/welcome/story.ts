// История демо-пациента P01 — одна на всю стартовую страницу.
//
// Цифры не вписаны руками: их считает та же функция, что и простой вид карточки пациента
// в приложении (session/story.ts). Поэтому страница показывает ровно то, что увидит врач:
// 127° → 140° (+13°), симметрия 78 → 84 %, наклон корпуса −4°. Если P01 в демо удалили
// или сеансов меньше двух — истории нет, и страница обходится без цифр.

import { useMemo } from 'react';
import { courseStory, type CourseStory } from '../../session/story';
import { useAppStore } from '../../state/appStore';
import { DEMO_PATIENT_ID } from '../demo/clinicDemo';

export type PatientStory = CourseStory;
export { trendOf, type Trend } from '../../session/story';

export function usePatientStory(): PatientStory | null {
  const patients = useAppStore((s) => s.patients);
  const sessions = useAppStore((s) => s.sessions);
  return useMemo(() => {
    const patient = patients.find((p) => p.id === DEMO_PATIENT_ID);
    return patient ? courseStory(sessions, patient) : null;
  }, [patients, sessions]);
}
