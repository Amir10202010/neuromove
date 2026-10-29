// Семьям. Что меняется для семьи — лист отчёта, который откроет родитель: главный вывод одной
// фразой, рука на шкале угла (как было и как сейчас), три показателя словами и «что дальше».
//
// До 18 октября здесь были две секции: «Отчёт» (лист) и «Семьям» (планшет с экраном для ребёнка
// и три строки текста). Слиты в одну по просьбе Амирхана сократить страницу.
//
// Движение — как карточки на страницах Apple: лист поднимается снизу и чуть растёт, пока подходит
// к середине экрана, и вместе с прокруткой рука на шкале идёт от «начала курса» к «сейчас».
// Прогресс sp (0…1): 0 — верх листа на 95 % высоты экрана, 1 — на 40 %.

import type { CSSProperties } from 'react';
import { useI18n } from '../../../i18n';
import { useScrollProgress } from '../motion';
import { ReportSheet } from '../ReportSheet';
import type { PatientStory } from '../story';

export function Families({ story }: { story: PatientStory | null }) {
  const { t } = useI18n();
  const [sheet, sp] = useScrollProgress<HTMLDivElement>(0.95, 0.4);
  return (
    <section id="lp-families" className="lp-families lp-white" data-nav="white" aria-labelledby="lp-families-title">
      <div className="lp-wrap lp-families__grid">
        <div className="lp-families__copy">
          <p className="lp-label" data-reveal>
            {t('landing.families.label')}
          </p>
          <h2 id="lp-families-title" className="lp-d2" data-reveal tabIndex={-1}>
            {t('landing.families.title')}
          </h2>
          <p className="lp-lead" data-reveal>
            {t('landing.families.text')}
          </p>
        </div>
        <div ref={sheet} className="lp-families__sheet" style={{ '--sp': sp } as CSSProperties}>
          <ReportSheet story={story} progress={sp} />
        </div>
      </div>
    </section>
  );
}
