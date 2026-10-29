// 10. Финал. Весь экран — одна фраза и одна кнопка. Позади — шкала угломера, как на локте
// с первого экрана: пока секция поднимается, дуга заполняется до сегодняшнего угла P01
// (140° из 180°) — история страницы заканчивается там, где заканчивается курс в демо.

import { useI18n } from '../../../i18n';
import { DemoButton, SignInLink, type LandingActions } from '../actions';
import type { PatientStory } from '../story';
import { vars } from '../Words';

const TICKS: number[] = [];
for (let v = 0; v <= 180; v += 5) TICKS.push(v);
const C = { x: 500, y: 520 };
const R = 460;
/** Точка шкалы: 0° — влево, 90° — вверх, 180° — вправо, как у полукруглого угломера. */
const pt = (v: number, r: number) => {
  const a = ((180 - v) * Math.PI) / 180;
  return { x: C.x + r * Math.cos(a), y: C.y - r * Math.sin(a) };
};

export function FinalCta({ actions, story }: { actions: LandingActions; story: PatientStory | null }) {
  const { t } = useI18n();
  const last = story?.last ?? 140;
  const fill = last / 180;
  const start = pt(0, R);
  const end = pt(180, R);
  // Число у конца дуги — там, где заканчивается курс P01; проявляется, когда дуга заполнилась
  const label = pt(last, R - 76);
  return (
    <section className="lp-final lp-dark" data-nav="dark" data-progress="1 0.15" data-progress-edge="top" aria-labelledby="lp-final-title">
      <svg className="lp-final__art" viewBox="0 0 1000 560" aria-hidden style={vars({ '--fill': fill })}>
        {TICKS.map((v) => {
          const major = v % 30 === 0;
          const a = pt(v, R - (major ? 34 : 16));
          const b = pt(v, R);
          return <line key={v} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={major ? 'is-major' : undefined} />;
        })}
        <path className="lp-final__arc" pathLength={1} d={`M${start.x},${start.y}A${R},${R} 0 0 1 ${end.x},${end.y}`} />
        <text className="lp-final__value" x={label.x} y={label.y} dy="0.35em" textAnchor="middle">
          {Math.round(last)}°
        </text>
      </svg>

      <div className="lp-wrap lp-final__inner">
        <h2 id="lp-final-title" className="lp-d1" data-reveal>
          {t('landing.final.title')}
        </h2>
        <p className="lp-lead" data-reveal style={vars({ '--d': '150ms' })}>
          {t('landing.final.text')}
        </p>
        <div className="lp-final__cta" data-reveal style={vars({ '--d': '300ms' })}>
          <DemoButton actions={actions} label={t('landing.final.cta')} />
        </div>
        <div className="lp-final__links" data-reveal style={vars({ '--d': '450ms' })}>
          <button type="button" className="lp-link" onClick={actions.explore}>
            {t('landing.final.explore')}
          </button>
          <SignInLink actions={actions} />
        </div>
      </div>
    </section>
  );
}
