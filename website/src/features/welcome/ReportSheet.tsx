// Отчёт на стартовой странице — лист, который откроет родитель или врач.
//
// Главный вывод одной фразой; рука на шкале угла — бледная, как в начале курса, яркая — как
// сейчас, между ними прибавка, ромб — цель врача (тот же смысл, что у рисунка в «Отчёте для
// семьи», RaiseProgress); три показателя словами и «что дальше». Все цифры — из истории
// демо-пациента P01 (story.ts); слова «выше», «меньше», «без изменений» — по порогам,
// как в «Отчёте для семьи», а не на глаз.
//
// 18 октября полоска «начало → сейчас → цель» заменена шкалой угла: родителю «144°» без руки
// на шкале ничего не говорит. Рука и число идут от начала курса к «сейчас» вместе с прокруткой
// (progress от секции «Семьям»), а не по таймеру — как у Apple.

import { useI18n } from '../../i18n';
import { shownDelta, shownTrend, TREND_THRESHOLD } from '../../session/story';
import { useAppStore } from '../../state/appStore';
import { LogoMark } from '../../ui/Logo';
import { armLabel } from '../common/text';
import { trendOf, type PatientStory, type Trend } from './story';

/**
 * Невидимый лист той же формы, пока демо досчитывается: место занято заранее, и когда придут
 * настоящие цифры, страница ниже не съедет. Числа здесь — только для длины строк, на экран не попадают.
 */
const GHOST: PatientStory = {
  code: '',
  side: 'right',
  first: 100,
  last: 110,
  delta: 10,
  symWas: 80,
  symNow: 90,
  pairNow: null,
  trunkWas: 10,
  trunkNow: 10,
  goal: { target: 150, due: '2026-11-14', reached: false },
  sessions: 9,
};

/** Шкала угла сбоку: плечо, 0° — рука вниз, 90° — вперёд, 180° — вверх. */
const DIAL = { x: 66, y: 152, r: 132 };
const RAD = Math.PI / 180;
const at = (deg: number, r: number = DIAL.r) => ({ x: DIAL.x + r * Math.sin(deg * RAD), y: DIAL.y + r * Math.cos(deg * RAD) });
const f1 = (n: number) => n.toFixed(1);

function sector(from: number, to: number): string {
  const a = at(from);
  const b = at(to);
  return `M${DIAL.x},${DIAL.y}L${f1(a.x)},${f1(a.y)}A${DIAL.r},${DIAL.r} 0 0 0 ${f1(b.x)},${f1(b.y)}Z`;
}

function RaiseDial({ was, now, goal, labels }: { was: number; now: number; goal: number | null; labels: { was: string; now: string; nowLabel: string; goal: string } }) {
  // Шкала — сплошная дуга от «рука вниз» до «рука вверх» с делениями через 10°
  const down = at(0);
  const up = at(180);
  const ticks: string[] = [`M${f1(down.x)},${f1(down.y)}A${DIAL.r},${DIAL.r} 0 0 0 ${f1(up.x)},${f1(up.y)}`];
  for (let v = 0; v <= 180; v += 10) {
    const major = v % 90 === 0;
    const a = at(v, DIAL.r - (major ? 9 : 5));
    const b = at(v, DIAL.r + (major ? 3 : 0));
    ticks.push(`M${f1(a.x)},${f1(a.y)}L${f1(b.x)},${f1(b.y)}`);
  }
  const reach = DIAL.r - 14;
  const wasEnd = at(was, reach);
  const nowEnd = at(now, reach);
  const elbow = at(now, reach * 0.48);
  const g = goal !== null ? at(goal, DIAL.r) : null;
  // Число «сейчас» — внутри шкалы, в свободном месте под поднятой рукой
  const value = at(62, DIAL.r * 0.56);
  return (
    <div className="dial" aria-hidden>
      <div className="dial__art">
        <svg className="dial__svg" viewBox="0 0 260 300">
          <path className="dial__ticks" d={ticks.join('')} />
          <path className="dial__gain" d={sector(was, now)} />
          {/* Тело — как на рисунках хронофотографии: голова, позвоночник, плечо */}
          <circle className="dial__body" cx={DIAL.x - 2} cy={DIAL.y - 52} r={17} />
          <path className="dial__body" d={`M${DIAL.x - 2},${DIAL.y - 30}L${DIAL.x - 6},${DIAL.y + 104}`} />
          <path className="dial__was" d={`M${DIAL.x},${DIAL.y}L${f1(wasEnd.x)},${f1(wasEnd.y)}`} />
          <path className="dial__arm" d={`M${DIAL.x},${DIAL.y}L${f1(elbow.x)},${f1(elbow.y)}L${f1(nowEnd.x)},${f1(nowEnd.y)}`} />
          <circle className="dial__joint" cx={DIAL.x} cy={DIAL.y} r={4} />
          <circle className="dial__hand" cx={f1(nowEnd.x)} cy={f1(nowEnd.y)} r={5} />
          {g && <rect className="dial__goal" x={-5} y={-5} width={10} height={10} transform={`translate(${f1(g.x)} ${f1(g.y)}) rotate(45)`} />}
        </svg>
        <span className="dial__now" style={{ left: `${(value.x / 260) * 100}%`, top: `${(value.y / 300) * 100}%` }}>
          {labels.now}
          <small>{labels.nowLabel}</small>
        </span>
      </div>
      <ul className="dial__legend">
        <li>
          <span className="dial__key dial__key--was" />
          {labels.was}
        </li>
        {goal !== null && (
          <li>
            <span className="dial__key dial__key--goal" />
            {labels.goal}
          </li>
        )}
      </ul>
    </div>
  );
}

/** Плавный разгон и торможение: рука трогается и останавливается мягко. */
const smooth = (x: number) => x * x * (3 - 2 * x);

export function ReportSheet({ story: real, progress = 1 }: { story: PatientStory | null; progress?: number }) {
  const { t, f } = useI18n();
  const ready = useAppStore((s) => s.status === 'ready');
  const story = real ?? GHOST;
  // Рука доходит до «сейчас» к 85 % пути листа — последние кадры прокрутки она уже стоит
  const now = real ? story.first + (story.last - story.first) * smooth(Math.min(1, progress / 0.85)) : story.last;

  if (!real && ready) {
    return (
      <article className="rs">
        <p className="rs__headline">{t('family.noData')}</p>
      </article>
    );
  }

  const arm = armLabel(t, story.side);
  // Как в «Отчёте для семьи»: меньше 3° — «примерно как в начале курса»
  const delta = shownDelta(story.last, story.first);
  const headlineKey = delta >= 3 ? 'landing.report.headlineUp' : delta <= -3 ? 'landing.report.headlineDown' : 'landing.report.headlineSame';
  const headline = t(headlineKey, { arm, armLower: arm.toLowerCase(), value: Math.round(story.last), delta: Math.abs(delta) });

  const word = (tr: Trend | null, up: 'higher' | 'more', down: 'lower' | 'less') =>
    tr === 'up' ? t(`landing.report.${up}`) : tr === 'down' ? t(`landing.report.${down}`) : tr === 'same' ? t('landing.report.same') : '–';
  // Слова — по той разнице, что видна на листе (session/story.ts, shownTrend)
  const raise = trendOf(delta, 0, TREND_THRESHOLD.rom);
  const sym = shownTrend(story.symNow, story.symWas, TREND_THRESHOLD.symmetry);
  const trunk = shownTrend(story.trunkNow, story.trunkWas, TREND_THRESHOLD.trunk);

  let next: string;
  if (story.goal?.reached) next = t('landing.report.nextReached', { goal: story.goal.target });
  else if (story.goal) next = t('landing.report.next', { goal: story.goal.target, date: story.goal.due ? f.dateEnd(story.goal.due) : '–' });
  else next = t('landing.report.nextNone');

  return (
    <article className={real ? 'rs' : 'rs rs--ghost'} aria-hidden={real ? undefined : true}>
      <header className="rs__head">
        <LogoMark size={28} />
        <div>
          <div className="rs__title">{t('landing.report.sheetTitle')}</div>
          <div className="rs__sub">
            {story.code} · {f.date(new Date())}
          </div>
        </div>
        <span className="rs__tag">{t('landing.report.demoTag')}</span>
      </header>

      <p className="rs__headline">{headline}</p>

      <div className="rs__body">
        <RaiseDial
          was={story.first}
          now={now}
          goal={story.goal?.target ?? null}
          labels={{
            was: `${t('landing.report.start')} ${f.deg(story.first)}`,
            now: f.deg(now),
            nowLabel: t('landing.report.now'),
            goal: `${t('landing.report.goal')} ${story.goal ? f.deg(story.goal.target) : ''}`,
          }}
        />
        <dl className="rs__kpis">
          <div>
            <dt>{t('landing.report.raise')}</dt>
            <dd className="rs__word">{word(raise, 'higher', 'lower')}</dd>
            <dd className="rs__detail">
              {f.deltaDeg(delta)} · {t('landing.report.was', { value: f.deg(story.first) })}
            </dd>
          </div>
          <div>
            <dt>{t('landing.report.symmetry')}</dt>
            <dd className="rs__word">{word(sym, 'higher', 'lower')}</dd>
            <dd className="rs__detail">
              {t('landing.report.symValue', { value: story.symNow === null ? '–' : Math.round(story.symNow) })}
              {story.symWas !== null && ` · ${t('landing.report.was', { value: f.pct(story.symWas) })}`}
            </dd>
          </div>
          <div>
            <dt>{t('landing.report.trunk')}</dt>
            <dd className="rs__word">{word(trunk, 'more', 'less')}</dd>
            <dd className="rs__detail">
              {f.deg(story.trunkNow)}
              {story.trunkWas !== null && ` · ${t('landing.report.was', { value: f.deg(story.trunkWas) })}`}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rs__next">
        <div className="rs__next-label">{t('landing.report.nextLabel')}</div>
        <p>{next}</p>
      </div>

      <footer className="rs__foot">
        <span>{t('common.sessionsCount', { count: story.sessions })}</span>
        <span>{t('landing.report.footer')}</span>
      </footer>
    </article>
  );
}
