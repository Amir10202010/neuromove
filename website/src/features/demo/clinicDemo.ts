// «Начать демо для клиники»: одна кнопка — и всё готово к показу.
// Сбрасываем демо в исходное состояние, открываем пациента P01 и включаем гид.

import { navigate } from '../../app/router';
import { PROTOCOLS, resolveSteps } from '../../core/protocols';
import { useAppStore } from '../../state/appStore';
import { useSessionStore } from '../../state/sessionStore';

export const DEMO_PATIENT_ID = 'demo-p01';

export async function startClinicDemo(): Promise<void> {
  const app = useAppStore.getState();
  await useSessionStore.getState().clear();
  app.setWorkspace('demo');
  // Показ всегда начинается с простого вида — даже если в прошлый раз открывали подробности
  app.setDetails(false);
  await app.resetDemo();
  app.startGuide();
  navigate({ name: 'patient', id: DEMO_PATIENT_ID, tab: 'overview' });
}

/** Шаг гида «Протокол»: сеанс для P01 с быстрой проверкой на симуляторе. */
export function startDemoSession(): boolean {
  const app = useAppStore.getState();
  const patient = app.patients.find((p) => p.id === DEMO_PATIENT_ID);
  if (!patient) return false;
  const history = app.sessions.filter((s) => s.patientId === patient.id);
  useSessionStore.getState().start(
    {
      workspace: 'demo',
      patientId: patient.id,
      protocolId: 'upper_quick',
      steps: resolveSteps(PROTOCOLS.upper_quick, patient.affectedSide),
      deviceKind: 'simulator',
      scenario: 'normal',
      autoAdvance: true,
    },
    patient,
    history,
  );
  navigate({ name: 'sessionRun' });
  return true;
}
