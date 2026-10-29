import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { EXERCISES } from '../../core/exercises';
import { Goniometer } from '../../charts/Goniometer';
import { useI18n } from '../../i18n';
import type { SessionEngine } from '../../session/SessionEngine';
import type { EngineSnapshot } from '../../session/types';

/**
 * Экран для пациента — планшет разворачивают к ребёнку: крупная шкала и точки повторов.
 * Биологическая обратная связь без игр: ребёнок видит, как высоко поднялась рука.
 */
export function PatientView({ engine, snap, goal, onClose }: { engine: SessionEngine; snap: EngineSnapshot; goal: number | null; onClose: () => void }) {
  const { t } = useI18n();
  const step = snap.steps[snap.stepIndex];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!step) return null;
  const def = EXERCISES[step.exercise];
  const color = step.side === 'left' ? 'var(--left)' : 'var(--right)';
  const done = step.reps.length;
  const target = step.targetReps || Math.max(done, 1);
  const justDone = snap.phase === 'step_done';
  return createPortal(
    <div className="patient-view" role="dialog" aria-modal="true" aria-label={t('run.controls.patientView')}>
      <button type="button" className="patient-view__close" onClick={onClose} aria-label={t('run.controls.exitPatientView')}>
        <X />
      </button>
      <div className="patient-view__title">{t(`exercise.${step.exercise}.name`)}</div>
      <Goniometer
        live={engine.live}
        range={[def.gauge.min, def.gauge.max]}
        color={color}
        softColor={step.side === 'left' ? 'var(--left-soft)' : 'var(--right-soft)'}
        goal={goal}
        labels={{ current: '', previous: '', goal: t('run.goal'), other: '' }}
        size={520}
        simple
      />
      <div className="patient-view__reps" aria-label={`${t('run.patientReps')}: ${done} / ${target}`}>
        {Array.from({ length: target }, (_, i) => (
          <span key={i} className={i < done ? 'is-done' : ''} style={i < done ? { background: color } : undefined} />
        ))}
      </div>
      {justDone && <div className="patient-view__great">{t('run.patientGreat')}</div>}
    </div>,
    document.body,
  );
}
