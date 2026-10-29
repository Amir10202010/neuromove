// 2. Проблема. Не инфографика, а одна фраза, которая проявляется слово за словом при прокрутке,
// и одно сравнение: как прогресс описывают сегодня — и как его описывает NeuroMove.
// Цифра в сравнении — из истории демо-пациента P01; если истории нет, сравнения тоже нет.

import { useI18n } from '../../../i18n';
import { shownDelta } from '../../../session/story';
import { useAppStore } from '../../../state/appStore';
import type { PatientStory } from '../story';
import { ScrollWords } from '../Words';

export function Problem({ story }: { story: PatientStory | null }) {
  const { t } = useI18n();
  const ready = useAppStore((s) => s.status === 'ready');
  const delta = story ? shownDelta(story.last, story.first) : null;
  // Пока демо досчитывается (первое открытие, на медленном телефоне до 6 с), место под сравнение
  // занято невидимым блоком той же формы: когда придут цифры, страница ниже не съедет (CLS)
  const pending = !story && !ready;
  const show = pending || (delta !== null && delta >= 3);
  return (
    <section id="lp-problem" className="lp-problem lp-white" data-nav="white" aria-labelledby="lp-problem-title">
      <div className="lp-wrap">
        <h2 id="lp-problem-title" className="lp-label" tabIndex={-1}>
          {t('landing.problem.label')}
        </h2>
        <p className="lp-problem__text" data-progress="0.92 0.5">
          <ScrollWords text={t('landing.problem.text')} />
        </p>

        {show && (
          <div className="lp-contrast" data-reveal data-pending={pending || undefined} aria-hidden={pending || undefined}>
            <div className="lp-contrast__side is-eye">
              <p className="lp-label">{t('landing.problem.eyeLabel')}</p>
              <p className="lp-contrast__quote">{t('landing.problem.eyeQuote')}</p>
            </div>
            <div className="lp-contrast__side is-nm">
              <p className="lp-label">
                <span className="lp-dot" aria-hidden />
                NeuroMove
              </p>
              <p className="lp-contrast__quote">{t('landing.problem.nmQuote', { delta: delta ?? 10 })}</p>
            </div>
            <p className="lp-contrast__note">{t('landing.problem.note', { code: story?.code ?? '' })}</p>
          </div>
        )}
      </div>
    </section>
  );
}
