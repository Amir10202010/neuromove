import { History } from 'lucide-react';
import { useState } from 'react';
import { navigate } from '../../app/router';
import { useI18n } from '../../i18n';
import { currentClinician, useAppStore } from '../../state/appStore';
import { clearRecovery, readRecovery, sessionFromRecovery, type RecoveryRecord } from '../../state/sessionController';
import { useSessionStore } from '../../state/sessionStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

/**
 * Страница закрылась или перезагрузилась посреди теста. Предлагаем:
 * продолжить (переподключить датчики и повторить калибровку), сохранить собранное или удалить.
 */
export function RecoveryDialog() {
  const { t, f } = useI18n();
  const [rec, setRec] = useState<RecoveryRecord | null>(() => readRecovery());
  const patients = useAppStore((s) => s.patients);
  const sessions = useAppStore((s) => s.sessions);
  const saveSession = useAppStore((s) => s.saveSession);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const toast = useAppStore((s) => s.toast);
  const start = useSessionStore((s) => s.start);
  const controller = useSessionStore((s) => s.controller);

  if (!rec || controller) return null;
  const patient = patients.find((p) => p.id === rec.setup.patientId);
  const close = () => {
    clearRecovery();
    setRec(null);
  };
  if (!patient) {
    clearRecovery();
    return null;
  }
  const done = rec.resume.completed.length;
  const total = rec.setup.steps.length;

  return (
    <Modal
      open
      onClose={() => setRec(null)}
      title={
        <span className="row" style={{ gap: 8 }}>
          <History size={20} aria-hidden />
          {t('recovery.title')}
        </span>
      }
      description={t('recovery.text', { patient: rec.patientCode, time: f.dateTime(rec.savedAt), done, total })}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('recovery.discard')}
          </Button>
          <Button
            disabled={done === 0}
            onClick={() => {
              const s = sessionFromRecovery(rec, currentClinician());
              saveSession(s);
              close();
              toast('good', t('recovery.saved'));
              navigate({ name: 'session', id: s.id, complete: false });
            }}
          >
            {t('recovery.save')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setWorkspace(rec.setup.workspace);
              const history = sessions.filter((s) => s.patientId === patient.id);
              start({ ...rec.setup }, patient, history, rec);
              clearRecovery();
              setRec(null);
              navigate({ name: 'sessionRun' });
            }}
          >
            {t('recovery.resume')}
          </Button>
        </>
      }
    >
      <p className="secondary">{t('recovery.resumeHint')}</p>
    </Modal>
  );
}
