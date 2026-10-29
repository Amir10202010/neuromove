// Отчёт для семьи: простыми словами, крупно, без таблиц. Цифры — только главные.
// Главная цифра — с картинкой: родитель видит, что «145°» — это рука почти вверх,
// а серый сектор и цветной — сколько было в начале курса и на сколько выше теперь.
// Выводы о лечении — за врачом: так и написано в отчёте.

import { ArrowLeft, Printer } from 'lucide-react';
import { href } from '../../app/router';
import { RaiseProgress } from '../../charts/MoveFigures';
import type { Session } from '../../data/models';
import { useI18n } from '../../i18n';
import { useWorkspaceData } from '../../state/appStore';
import { focusSide, metricSeries, patientSessions, sessionSymmetry, stepOf } from '../../session/compare';
import { shownDelta } from '../../session/story';
import { Button, LinkButton } from '../../ui/Button';
import { LogoMark } from '../../ui/Logo';
import { armLabel } from '../common/text';

export function FamilyReportPage({ id }: { id: string }) {
  const { t, f } = useI18n();
  const { patients, sessions } = useWorkspaceData();
  const patient = patients.find((p) => p.id === id);
  if (!patient) {
    return (
      <div className="print-page">
        <div className="print-toolbar">
          <LinkButton href={href({ name: 'patients' })} icon={<ArrowLeft />}>
            {t('common.back')}
          </LinkButton>
        </div>
        <p style={{ padding: 24 }}>{t('profile.notFound')}</p>
      </div>
    );
  }
  const list = patientSessions(sessions, patient.id);
  const focus = focusSide(patient.affectedSide);
  const flexSeries = metricSeries(sessions, patient, 'shoulder_flexion', focus, 'rom');
  const first = list[0] as Session | undefined;
  const last = list[list.length - 1] as Session | undefined;
  const firstFlex = flexSeries[0];
  const lastFlex = flexSeries[flexSeries.length - 1];
  // Разница показанных чисел, как в карточке пациента: 144° и «было 127°» — это 17°, а не 18°
  const delta = firstFlex && lastFlex ? shownDelta(lastFlex.value, firstFlex.value) : 0;
  const symNow = last ? sessionSymmetry(last, 'shoulder_flexion', patient.affectedSide) : null;
  const symWas = first ? sessionSymmetry(first, 'shoulder_flexion', patient.affectedSide) : null;
  const sparcNow = last ? stepOf(last, 'shoulder_flexion', focus)?.sparc : undefined;
  const sparcWas = first ? stepOf(first, 'shoulder_flexion', focus)?.sparc : undefined;
  const trunkNow = last ? stepOf(last, 'shoulder_flexion', focus)?.trunk : undefined;
  const trunkWas = first ? stepOf(first, 'shoulder_flexion', focus)?.trunk : undefined;
  const goal = patient.goals.find((g) => g.exercise === 'shoulder_flexion' && g.side === focus);
  const arm = armLabel(t, focus);

  return (
    <div className="print-page">
      <div className="print-toolbar">
        <LinkButton href={href({ name: 'patient', id: patient.id, tab: 'overview' })} icon={<ArrowLeft />}>
          {patient.code}
        </LinkButton>
        <span className="spacer" />
        <Button variant="primary" icon={<Printer />} onClick={() => window.print()}>
          {t('report.printButton')}
        </Button>
      </div>

      <article className="sheet family">
        {patient.workspace === 'demo' && (
          <div className="sheet__watermark" aria-hidden>
            {t('report.printDemoWatermark')}
          </div>
        )}
        <header className="sheet__head">
          <div className="row" style={{ gap: 10 }}>
            <LogoMark size={30} />
            <div>
              <h1 className="family__title">{t('family.title')}</h1>
              <div className="sheet__muted">
                {t('family.subtitle', { code: patient.code })} · {f.date(new Date())}
              </div>
            </div>
          </div>
        </header>

        <p className="family__intro">{t('family.intro')}</p>

        {list.length < 2 || !firstFlex || !lastFlex ? (
          <p className="family__big">{t('family.noData')}</p>
        ) : (
          <>
            <section className="family__block family__raise">
              <RaiseProgress
                was={firstFlex.value}
                now={lastFlex.value}
                goal={goal?.targetRom}
                side={focus}
                labels={{ was: t('simple.fig.picWas'), goal: t('simple.fig.picGoal') }}
                ariaLabel={t('simple.fig.raiseAria', { arm, now: Math.round(lastFlex.value), was: Math.round(firstFlex.value) })}
              />
              <div>
                <p className="family__big">
                  {t('family.raiseNow', { arm, value: Math.round(lastFlex.value) })}{' '}
                  {Math.abs(delta) < 3
                    ? t('family.raiseSame', { date: f.date(firstFlex.date) })
                    : delta > 0
                      ? t('family.raiseChange', { delta: Math.round(delta), date: f.date(firstFlex.date) })
                      : t('family.raiseChangeDown', { delta: Math.round(-delta), date: f.date(firstFlex.date) })}
                </p>
                <p className="sheet__muted family__scale">{t('family.scale')}</p>
              </div>
            </section>

            {symNow !== null && patient.affectedSide !== 'both' && (
              <section className="family__block">
                <p>
                  {t('family.symmetryNow', { arm: arm.toLowerCase(), value: Math.round(symNow) })}
                  {symWas !== null && ` ${t('family.symmetryWas', { value: Math.round(symWas) })}`}
                </p>
              </section>
            )}

            {(sparcNow !== undefined && sparcWas !== undefined && sparcNow - sparcWas > 0.15) || (trunkNow != null && trunkWas != null && trunkWas - trunkNow >= 2) ? (
              <section className="family__block">
                <ul className="family__list">
                  {sparcNow !== undefined && sparcWas !== undefined && sparcNow - sparcWas > 0.15 && <li>{t('family.smoother')}</li>}
                  {trunkNow != null && trunkWas != null && trunkWas - trunkNow >= 2 && <li>{t('family.lessTrunk')}</li>}
                </ul>
              </section>
            ) : null}

            {goal && (
              <section className="family__block">
                <p>{goal.achievedAt || lastFlex.value >= goal.targetRom ? t('family.goalReached', { value: goal.targetRom }) : t('family.goalLine', { value: goal.targetRom, date: goal.dueDate ? f.dateEnd(goal.dueDate) : '–' })}</p>
              </section>
            )}
            <p className="sheet__muted">{t('family.sessionsDone', { count: list.length })}</p>
          </>
        )}

        <section className="family__explain">
          <h2>{t('family.whatIsIt')}</h2>
          <p>{t('family.whatIsItText')}</p>
        </section>
        <footer className="sheet__foot">
          <p>{t('app.disclaimer')}</p>
        </footer>
      </article>
    </div>
  );
}
