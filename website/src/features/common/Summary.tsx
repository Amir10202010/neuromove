// Простой вид: главное сверху карточки пациента и отчёта о сеансе — фразой и картинками.
//
// CourseSummary  — о курсе: фраза и три картинки с цифрами — подъём руки (было → сейчас → цель),
//                  правая и левая рядом, помощь корпусом. Картинка показывает, что значит число:
//                  «145°» — это рука почти вверх, а не абстрактная цифра.
// SessionSummary — о сеансе: одна фраза и по строке на движение — схема обеих рук, главная рука,
//                  другая рука, изменение к прошлому сеансу; внизу — только неполная запись и пометки.
// Цифры и пороги — из session/story.ts, одни и те же для приложения и стартовой страницы.

import { ArrowDown, ArrowUp, Minus, TriangleAlert } from 'lucide-react';
import { href } from '../../website/router';
import { ArmsCompare, RaiseProgress, TrunkLean } from '../../charts/MoveFigures';
import type { Patient, Session } from '../../data/models';
import { useI18n } from '../../i18n';
import { focusSide, otherSide, stepOf } from '../../session/compare';
import { courseStory, sessionStory, shownDelta, shownTrend, TREND_THRESHOLD, trendOf, type Trend } from '../../session/story';
import { LinkButton } from '../../ui/Button';
import { Delta } from '../../ui/Delta';
import { armLabel, exName } from './text';

/**
 * Изменение одной меткой: стрелка — куда сдвинулось, цвет — к лучшему ли, текст — «было …».
 * better: 'up' — рост хорош (подъём, симметрия), 'down' — снижение хорошо (помощь корпусом).
 */
function TrendChip({ trend, better, was }: { trend: Trend | null; better: 'up' | 'down'; was: string | null }) {
  const { t } = useI18n();
  if (trend === null || was === null) return null;
  const good = trend === 'same' ? null : (trend === 'up') === (better === 'up');
  const Icon = trend === 'up' ? ArrowUp : trend === 'down' ? ArrowDown : Minus;
  const word = trend === 'same' ? t('simple.same') : better === 'up' ? t(trend === 'up' ? 'simple.higher' : 'simple.lower') : t(trend === 'up' ? 'simple.more' : 'simple.less');
  return (
    <span className={`tchip ${good === null ? 'is-same' : good ? 'is-good' : 'is-bad'}`}>
      <Icon aria-hidden />
      <span className="sr-only">{word}, </span>
      {t('simple.was', { value: was })}
    </span>
  );
}

export function CourseSummary({ patient, all, latest }: { patient: Patient; all: readonly Session[]; latest: Session }) {
  const { t, f } = useI18n();
  const story = courseStory(all, patient);
  const side = focusSide(patient.affectedSide);
  const arm = armLabel(t, side);

  const footer = (
    <div className="sumcard__foot">
      <span>
        {t('simple.latest')} · {f.dateTime(latest.startedAt)}
      </span>
      <LinkButton href={href({ name: 'session', id: latest.id, complete: false })} size="sm">
        {t('profile.openReport')}
      </LinkButton>
    </div>
  );

  if (!story) {
    // Один сеанс — это исходный уровень: сравнивать пока не с чем
    const base = stepOf(latest, 'shoulder_flexion', side)?.rom;
    return (
      <section data-guide="course" className="card sumcard" aria-labelledby="sumcard-course">
        <div className="sumcard__body">
          <h2 id="sumcard-course" className="sumcard__label">
            {t('simple.main')}
          </h2>
          <p className="sumcard__headline">{base !== undefined ? t('simple.course.baseline', { arm, value: Math.round(base) }) : t('simple.course.none')}</p>
        </div>
        {footer}
      </section>
    );
  }

  // Разница — по показанным числам: «127° → 146°» и «+19°» сходятся на глаз
  const delta = shownDelta(story.last, story.first);
  const key = delta >= TREND_THRESHOLD.rom ? 'up' : delta <= -TREND_THRESHOLD.rom ? 'down' : 'same';
  const headline = t(`simple.course.${key}`, { arm, value: Math.round(story.last), delta: Math.abs(delta) });

  const other = otherSide(side);
  const sideWord = (s: typeof side) => t(s === 'left' ? 'simple.fig.picLeft' : 'simple.fig.picRight');
  const pairNote = patient.affectedSide === 'both' ? t('simple.fig.pairBoth') : t(side === 'right' ? 'simple.fig.pairRight' : 'simple.fig.pairLeft');

  return (
    <section data-guide="course" className="card sumcard" aria-labelledby="sumcard-course">
      <div className="sumcard__body">
        <h2 id="sumcard-course" className="sumcard__label">
          {t('simple.main')}
        </h2>
        <p className="sumcard__headline">{headline}</p>

        <div className="figs">
          <figure className="fig">
            <div className="fig__pic">
              <RaiseProgress
                was={story.first}
                now={story.last}
                goal={story.goal?.target}
                side={side}
                labels={{ was: t('simple.fig.picWas'), goal: t('simple.fig.picGoal') }}
                ariaLabel={t('simple.fig.raiseAria', { arm, now: Math.round(story.last), was: Math.round(story.first) })}
              />
            </div>
            <figcaption className="fig__cap">
              <span className="fig__title">{t('simple.raise')}</span>
              <span className="fig__value">
                {f.deg(story.last)}
                {/* Для подъёма — та же округлённая разница, что во фразе сверху */}
                <TrendChip trend={trendOf(delta, 0, TREND_THRESHOLD.rom)} better="up" was={f.deg(story.first)} />
              </span>
              <span className="fig__note">{story.goal ? t('simple.fig.goal', { value: f.deg(story.goal.target) }) : t('simple.fig.noGoal')}</span>
            </figcaption>
          </figure>

          {story.symNow !== null && story.pairNow && (
            <figure className="fig">
              <div className="fig__pic">
                <ArmsCompare
                  exercise="shoulder_flexion"
                  main={{ side, value: story.pairNow.main }}
                  other={{ side: other, value: story.pairNow.other }}
                  labels={{ main: `${sideWord(side)} ${f.deg(story.pairNow.main)}`, other: `${sideWord(other)} ${f.deg(story.pairNow.other)}` }}
                  ariaLabel={t('simple.fig.pairAria', { main: Math.round(story.pairNow.main), other: Math.round(story.pairNow.other) })}
                />
              </div>
              <figcaption className="fig__cap">
                <span className="fig__title">{t('simple.fig.pair')}</span>
                <span className="fig__value">
                  {f.pct(story.symNow)}
                  <TrendChip trend={shownTrend(story.symNow, story.symWas, TREND_THRESHOLD.symmetry)} better="up" was={story.symWas !== null ? f.pct(story.symWas) : null} />
                </span>
                <span className="fig__note">{pairNote}</span>
              </figcaption>
            </figure>
          )}

          {story.trunkNow !== null && (
            <figure className="fig">
              <div className="fig__pic">
                <TrunkLean now={story.trunkNow} side={side} label={f.deg(story.trunkNow)} ariaLabel={t('simple.fig.trunkAria', { value: Math.round(story.trunkNow) })} />
              </div>
              <figcaption className="fig__cap">
                <span className="fig__title">{t('simple.trunk')}</span>
                <span className="fig__value">
                  {f.deg(story.trunkNow)}
                  <TrendChip trend={shownTrend(story.trunkNow, story.trunkWas, TREND_THRESHOLD.trunk)} better="down" was={story.trunkWas !== null ? f.deg(story.trunkWas) : null} />
                </span>
                <span className="fig__note">{t('simple.fig.trunkNote')}</span>
              </figcaption>
            </figure>
          )}
        </div>
      </div>
      {footer}
    </section>
  );
}

export function SessionSummary({ session, patient, all }: { session: Session; patient: Patient; all: readonly Session[] }) {
  const { t, f } = useI18n();
  const story = sessionStory(all, session, patient);
  const arm = armLabel(t, story.side);
  const lead = story.lead;

  let headline: string;
  // Поражённая рука не измерена, а другая — да: так и говорим, а не «нет замеров»
  const otherOnly = !lead ? story.rows.find((r) => r.other !== null) : undefined;
  if (otherOnly && otherOnly.other !== null) {
    headline = t('simple.session.otherOnly', {
      exercise: exName(t, otherOnly.exercise),
      otherLower: armLabel(t, otherSide(story.side)).toLowerCase(),
      value: Math.round(otherOnly.other),
      arm: armLabel(t, story.side),
      armLower: armLabel(t, story.side).toLowerCase(),
    });
  } else if (!lead || lead.main === null) headline = t('simple.session.none');
  else {
    const params = { exercise: exName(t, lead.exercise), armLower: arm.toLowerCase(), value: Math.round(lead.main) };
    if (lead.prev === null) headline = t('simple.session.first', params);
    else {
      const d = Math.round(lead.main - lead.prev);
      const key = d >= TREND_THRESHOLD.rom ? 'up' : d <= -TREND_THRESHOLD.rom ? 'down' : 'same';
      headline = t(`simple.session.${key}`, { ...params, delta: Math.abs(d) });
    }
  }

  const other = otherSide(story.side);
  const otherArm = armLabel(t, other);
  const quality = session.quality.percent;
  const flags = story.rows.flatMap((r) => r.flags.map((fl) => `${exName(t, r.exercise)} · ${armLabel(t, fl.side).toLowerCase()}: ${t(`report.flags.${fl.flag}`)}`));

  return (
    <section data-guide="session" className="card sumcard" aria-labelledby="sumcard-session">
      <div className="sumcard__body">
        {/* Кто пациент — специалист уже знает: он пришёл сюда из его карточки */}
        <h2 id="sumcard-session" className="sumcard__label">
          {t('simple.main')}
        </h2>
        <p className="sumcard__headline">{headline}</p>

        {story.rows.length > 0 && (
          <div className="table-wrap">
            {/* Только на телефоне: шапки таблицы там нет — говорим, чья рука крупным числом */}
            <p className="moves__legend">{t('simple.moves.legend', { arm: arm.toLowerCase() })}</p>
            <table className="moves">
              <thead>
                <tr>
                  <th>{t('simple.moves.exercise')}</th>
                  <th className="num">
                    <span className={`side-key side-key--${story.side}`} aria-hidden /> {arm}
                  </th>
                  <th className="num">
                    <span className={`side-key side-key--${other}`} aria-hidden /> {otherArm}
                  </th>
                  <th className="num">{t('simple.moves.vsPrev')}</th>
                </tr>
              </thead>
              <tbody>
                {story.rows.map((r) => (
                  <tr key={r.exercise}>
                    <td>
                      <span className="moves__move">
                        {/* Схема движения по настоящим углам обеих рук: «121°» в локте видно глазами */}
                        <span className="moves__pic">
                          <ArmsCompare
                            exercise={r.exercise}
                            main={{ side: story.side, value: r.main, sup: r.split.main?.sup, pro: r.split.main?.pro }}
                            other={{ side: other, value: r.other, sup: r.split.other?.sup, pro: r.split.other?.pro }}
                            ariaLabel=""
                          />
                        </span>
                        {exName(t, r.exercise)}
                      </span>
                    </td>
                    <td className="num moves__main">{f.deg(r.main)}</td>
                    <td className="num moves__other">
                      {/* На телефоне шапки таблицы нет — подпись стороны стоит у числа */}
                      <span className="moves__lbl">{otherArm.toLowerCase()} </span>
                      {f.deg(r.other)}
                    </td>
                    <td className="num moves__chg">
                      {r.main === null || r.prev === null ? (
                        <span className="muted">–</span>
                      ) : Math.abs(r.main - r.prev) < TREND_THRESHOLD.rom ? (
                        <span className="muted">{t('simple.moves.same')}</span>
                      ) : (
                        <Delta value={r.main - r.prev} threshold={TREND_THRESHOLD.rom} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Внизу — только то, что требует внимания: неполная запись и нарушенные условия замера.
          Полная запись — обычное дело, о ней не пишем; длительность и повторы — в подробностях */}
      {(quality < 95 || flags.length > 0) && (
        <div className="sumcard__foot sumcard__foot--notes">
          {quality < 95 && (
            <span className="sumcard__note is-warn">
              <TriangleAlert size={16} aria-hidden />
              {t('simple.quality.low', { value: f.pct(quality, 1) })}
            </span>
          )}
          {flags.map((fl) => (
            <span key={fl} className="sumcard__note is-warn">
              <TriangleAlert size={16} aria-hidden />
              {fl}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
