// Как идут дела у пациентов — одной строкой на человека, словами.
// Для простого вида «Обзора» и «Аналитики»: код, рука, «127° → 140°», изменение за курс
// и слово («Выше», «Без изменений», «Ниже»). Над строками — подписи колонок: без них
// «127° → 140°» — просто два числа. Если есть откат к прошлому сеансу или плато —
// короткая строка под ним, по тем же правилам, что наблюдения после сеанса.

import { ChevronRight, TriangleAlert } from 'lucide-react';
import { href } from '../../website/router';
import type { Patient, Session } from '../../data/models';
import { useI18n } from '../../i18n';
import { ALERT_RULES } from '../../session/alerts';
import { patientTrend, TREND_THRESHOLD, trendOf, type PatientTrend } from '../../session/story';
import { armLabel } from './text';

/** Тенденции всех пациентов по коду; пациенты без замеров — в конце. */
export function groupTrends(all: readonly Session[], patients: readonly Patient[]): PatientTrend[] {
  return patients
    .map((p) => patientTrend(all, p))
    .sort((a, b) => Number(a.count === 0) - Number(b.count === 0) || a.patient.code.localeCompare(b.patient.code));
}

export function GroupList({ trends, limit }: { trends: readonly PatientTrend[]; limit?: number }) {
  const { t, f } = useI18n();
  const shown = limit ? trends.slice(0, limit) : trends;
  return (
    <>
      <div className="glist__head">
        <span>{t('group.cols.who')}</span>
        <span>{t('group.cols.values')}</span>
        <span>{t('group.cols.change')}</span>
      </div>
      <ul className="glist">
        {shown.map((r) => {
          const tr = r.course === null ? null : trendOf(r.course, 0, TREND_THRESHOLD.rom);
          const word = tr === 'up' ? t('simple.higher') : tr === 'down' ? t('simple.lower') : tr === 'same' ? t('simple.same') : null;
          let values: string;
          if (r.count === 0 || r.last === null) values = t('group.none');
          else if (r.count === 1) values = `${f.deg(r.last)} · ${t('group.first')}`;
          else values = `${f.deg(r.first)} → ${f.deg(r.last)}`;
          const note = r.drop !== null ? t('group.drop', { delta: f.deltaDeg(r.drop) }) : r.plateau ? t('group.plateau', { n: ALERT_RULES.plateauSessions }) : null;
          return (
            <li key={r.patient.id}>
              <a className="glist__row" href={href({ name: 'patient', id: r.patient.id, tab: 'overview' })}>
                <span className="glist__who">
                  <strong>{r.patient.code}</strong>
                  <span className="glist__arm">{armLabel(t, r.side)}</span>
                </span>
                <span className="glist__values num">{values}</span>
                <span className="glist__change">
                  {r.course !== null && <span className="num">{f.deltaDeg(r.course)}</span>}
                  {word && <span className={`glist__word${tr === 'down' ? ' is-down' : ''}`}>{word}</span>}
                </span>
                <ChevronRight className="glist__chevron" aria-hidden />
                {note && (
                  <span className={`glist__note${r.drop !== null ? ' is-warn' : ''}`}>
                    {r.drop !== null && <TriangleAlert size={14} aria-hidden />}
                    {note}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Одна фраза о группе: у скольких рука поднимается выше; сколько с откатом и на плато. */
export function groupHeadline(trends: readonly PatientTrend[]) {
  const measured = trends.filter((r) => r.course !== null);
  return {
    n: measured.length,
    up: measured.filter((r) => (r.course as number) >= TREND_THRESHOLD.rom).length,
    drops: trends.filter((r) => r.drop !== null).length,
    plateaus: trends.filter((r) => r.drop === null && r.plateau).length,
  };
}
