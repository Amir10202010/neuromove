// 10. Финал. Весь экран — одна фраза и одна кнопка. Позади — шкала угломера, как на локте
// с первого экрана: пока секция поднимается, дуга заполняется до сегодняшнего угла P01
// (140° из 180°), и стрелка, как у часов, поворачивается следом — история страницы заканчивается там, где заканчивается курс в демо.

import { useI18n } from '../../../i18n';
import { DemoButton, SignInLink, type LandingActions } from '../actions';
import type { PatientStory } from '../story';
import { useCountUp, useInView } from '../motion';
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
  // Стрелка, дуга и число едут вместе от 0° до угла P01, когда шкала заметно показалась на экране,
  // и заново — при каждом возвращении к секции. Раньше всё шло за прокруткой, и к приходу читателя
  // стрелка уже стояла на месте: анимации не было видно (Амирхан, 8 ноября)
  const [art, inView] = useInView<SVGSVGElement>('-18%');
  const angle = useCountUp(last, 0, inView, 2400);
  const start = pt(0, R);
  const end = pt(180, R);
  // Число — в центре циферблата над осью стрелки; проявляется, когда дуга заполнилась
  const label = { x: C.x, y: C.y - 190 };
  return (
    <section className="lp-final lp-dark" data-nav="dark" data-progress="1 0.15" data-progress-edge="top" aria-labelledby="lp-final-title">
      <svg ref={art} className="lp-final__art" viewBox="0 0 1000 560" aria-hidden style={vars({ '--k': angle / 180 })}>
        {TICKS.map((v) => {
          const major = v % 30 === 0;
          const a = pt(v, R - (major ? 34 : 16));
          const b = pt(v, R);
          return <line key={v} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={major ? 'is-major' : undefined} />;
        })}
        <path className="lp-final__arc" pathLength={1} d={`M${start.x},${start.y}A${R},${R} 0 0 1 ${end.x},${end.y}`} />
        {/* Стрелка, как у часов: поворачивается вслед за дугой (--p), в конце слегка «дышит» */}
        <g transform={`rotate(${angle.toFixed(2)} ${C.x} ${C.y})`}>
          <g className="lp-final__sway" style={{ transformOrigin: `${C.x}px ${C.y}px` }}>
            <line className="lp-final__hand" x1={C.x + 46} y1={C.y} x2={C.x - (R - 58)} y2={C.y} />
            <circle className="lp-final__tip" cx={C.x - (R - 58)} cy={C.y} r={6} />
          </g>
        </g>
        <circle className="lp-final__hub" cx={C.x} cy={C.y} r={11} />
        <text className="lp-final__value" x={label.x} y={label.y} dy="0.35em" textAnchor="middle">
          {Math.round(angle)}°
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
