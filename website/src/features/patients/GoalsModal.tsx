import { Plus, Target, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EXERCISE_IDS, type ExerciseId } from '../../core/exercises';
import type { Goal, Patient } from '../../data/models';
import type { Side } from '../../devices/types';
import { useI18n } from '../../i18n';
import { newId } from '../../lib/ids';
import { useAppStore } from '../../state/appStore';
import { focusSide } from '../../session/compare';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

export function GoalsModal(props: { open: boolean; onClose: () => void; patient: Patient }) {
  if (!props.open) return null;
  return <GoalsDialog key={props.patient.id} onClose={props.onClose} patient={props.patient} />;
}

function GoalsDialog({ onClose, patient }: { onClose: () => void; patient: Patient }) {
  const { t } = useI18n();
  const saveGoals = useAppStore((s) => s.saveGoals);
  const toast = useAppStore((s) => s.toast);
  // Редактируем копию: пока не нажали «Сохранить», карточка пациента не меняется
  const [goals, setGoals] = useState<Goal[]>(() => patient.goals.map((g) => ({ ...g })));
  const [error, setError] = useState(false);

  const update = (id: string, patch: Partial<Goal>) => setGoals((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch, achievedAt: null } : g)));

  const add = () =>
    setGoals((gs) => [
      ...gs,
      {
        id: newId('g'),
        exercise: 'shoulder_flexion',
        side: focusSide(patient.affectedSide),
        targetRom: 140,
        dueDate: new Date(Date.now() + 28 * 86400000).toISOString(),
        createdAt: new Date().toISOString(),
        achievedAt: null,
      },
    ]);

  const submit = () => {
    if (goals.some((g) => !(g.targetRom >= 10 && g.targetRom <= 180))) {
      setError(true);
      return;
    }
    saveGoals(patient.id, goals);
    toast('good', t('goals.saved'));
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t('goals.editTitle', { code: patient.code })}
      description={t('goals.hint')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {goals.length === 0 && (
        <div className="empty empty--compact">
          <div className="empty__icon">
            <Target />
          </div>
          <div className="empty__title">{t('profile.noGoals')}</div>
        </div>
      )}
      {goals.map((g) => (
        <div key={g.id} className="goal-edit">
          <label className="field">
            <span className="field__label">{t('goals.exercise')}</span>
            <select className="select" value={g.exercise} onChange={(e) => update(g.id, { exercise: e.target.value as ExerciseId })}>
              {EXERCISE_IDS.map((ex) => (
                <option key={ex} value={ex}>
                  {t(`exercise.${ex}.name`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{t('goals.side')}</span>
            <select className="select" value={g.side} onChange={(e) => update(g.id, { side: e.target.value as Side })}>
              <option value="left">{t('side.left')}</option>
              <option value="right">{t('side.right')}</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">{t('goals.target')}</span>
            <input className="input num" type="number" min={10} max={180} value={g.targetRom} onChange={(e) => update(g.id, { targetRom: Number(e.target.value) })} aria-invalid={error && !(g.targetRom >= 10 && g.targetRom <= 180) ? true : undefined} />
          </label>
          <label className="field">
            <span className="field__label">{t('goals.due')}</span>
            <input className="input" type="date" value={g.dueDate ? g.dueDate.slice(0, 10) : ''} onChange={(e) => update(g.id, { dueDate: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null })} />
          </label>
          <Button variant="ghost" iconOnly icon={<Trash2 />} aria-label={t('goals.remove')} title={t('goals.remove')} onClick={() => setGoals((gs) => gs.filter((x) => x.id !== g.id))} className="goal-edit__remove" />
        </div>
      ))}
      {error && <div className="field__error">{t('goals.invalid')}</div>}
      <div>
        <Button icon={<Plus />} onClick={add}>
          {t('profile.addGoal')}
        </Button>
      </div>
    </Modal>
  );
}
