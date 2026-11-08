// 2. Проблема. Одна фраза, которая проявляется слово за словом при прокрутке, и одно сравнение
// тихой строкой в две колонки: как прогресс описывают сегодня (словами) — и как его показывает
// NeuroMove (градусами).
// Цифры — из истории демо-пациента P01; если истории нет, сравнения тоже нет.
//
// 8 ноября 2026: сравнение было двумя цитатами на линиях и выглядело сыро (Амирхан) — потом плашка и огромная цифра — тоже не то; теперь строка в масштабе обычного текста.

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
  const shown = delta ?? 10;
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
          <div className="lp-vs" data-reveal data-pending={pending || undefined} aria-hidden={pending || undefined}>
            <div className="is-eye">
              <p className="lp-vs__key">{t('landing.problem.eyeLabel')}</p>
              <p className="lp-vs__val">{t('landing.problem.eyeQuote')}</p>
            </div>
            <div className="is-nm">
              <p className="lp-vs__key">
                <span className="lp-dot" aria-hidden />
                NeuroMove
              </p>
              <p className="lp-vs__val">
                <b>+{shown}°</b> {t('landing.problem.nmSub')}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
