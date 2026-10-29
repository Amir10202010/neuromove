// Фото первого экрана и шкала угла поверх руки: «каждый градус на счету» — на живой руке.
//
// Фото — концепт-изображение из версии страницы от 27 сентября (src/assets/README.md):
// модель и датчик ненастоящие, так и подписано на экране. Шкала нарисована в координатах
// самого фото (1536 × 1024) и растягивается так же, как оно: у картинки object-fit: cover
// и прижатие к верху, у SVG — preserveAspectRatio="xMidYMin slice". Поэтому линии лежат
// на руке при любой ширине экрана, а на телефоне вместе с фото сдвигаются к локтю (landing.css).
//
// 144° — не выдуманное число: это угол между осями плеча и предплечья, снятыми с фото.
// Оси посчитаны по пикселям, а не на глаз: край руки — там, где начинается стена (светлая,
// почти без цвета); ось — середина между краями, прямая по методу наименьших квадратов
// (предплечье — 26 вертикальных срезов, плечо — 19 срезов поперёк руки). Центр локтя —
// пересечение осей. Датчики — по цвету: корпус на предплечье и красная метка ремешка на плече.

import heroLarge from '../../assets/movement-study-1536.webp';
import heroSmall from '../../assets/movement-study-768.webp';
import { useCountUp } from './motion';

/** Центр локтя на фото — пересечение осей плеча и предплечья. */
const E = { x: 870, y: 680 };
/** Направления осей от локтя, градусы (0 — вправо, ось y вниз, как в SVG). */
const TO_SHOULDER = -50.9;
const TO_WRIST = 165.1;
/** Угол в локте между осями. */
export const HERO_ELBOW_ANGLE = Math.round(360 - (TO_WRIST - TO_SHOULDER));
const R = 124;

const at = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: E.x + r * Math.cos(a), y: E.y + r * Math.sin(a) };
};

// Деления шкалы через 10° — от оси плеча к оси предплечья, через верх
const TICKS: { a: number; major: boolean }[] = [];
for (let a = TO_SHOULDER; a >= TO_WRIST - 360 - 0.1; a -= 10) TICKS.push({ a, major: Math.round(TO_SHOULDER - a) % 30 === 0 });

const START = at(TO_SHOULDER, R);
const END = at(TO_WRIST, R);
/** Ось плеча — до плечевого сустава, ось предплечья — до середины запястья. */
const UPPER_END = at(TO_SHOULDER, 410);
const FORE_END = at(TO_WRIST, 430);
/** Подпись угла — над локтем, на стене, между заголовком и плечом. */
const LABEL = { x: 850, y: 400 };
/** Датчики на фото: красная метка ремешка на плече (на оси руки) и корпус на предплечье. */
const UPPER_SENSOR = { x: 1079, y: 423 };
const FORE_SENSOR = { x: 879, y: 651 };

interface Props {
  labels: { alt: string; angle: string; upper: string; fore: string; rate: string };
  /** Шкала «доезжает» до угла один раз, когда экран показался. */
  run: boolean;
}

export function HeroPhoto({ labels, run }: Props) {
  const value = useCountUp(HERO_ELBOW_ANGLE, 0, run, 1600);
  return (
    <div className="hp" data-run={run || undefined}>
      <img
        className="hp__img"
        src={heroLarge}
        srcSet={`${heroSmall} 768w, ${heroLarge} 1536w`}
        // Те же srcset и sizes — в подсказке предзагрузки (vite.config.ts, heroPreload): поменяли здесь — поменять там
        sizes="(max-width: 700px) 170vw, 100vw"
        width={1536}
        height={1024}
        alt={labels.alt}
        fetchPriority="high"
        decoding="async"
      />
      <svg className="hp__overlay" viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMin slice" aria-hidden>
        <defs>
          <filter id="hp-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity=".28" />
          </filter>
        </defs>
        <g filter="url(#hp-shadow)">
          <path className="hp__bone" d={`M${E.x},${E.y}L${UPPER_END.x},${UPPER_END.y}`} pathLength={1} />
          <path className="hp__bone" d={`M${E.x},${E.y}L${FORE_END.x},${FORE_END.y}`} pathLength={1} />
          <g className="hp__ticks">
            {TICKS.map(({ a, major }, i) => {
              const p = at(a, R + 10);
              const q = at(a, R + (major ? 30 : 20));
              return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} style={{ transitionDelay: `${500 + i * 45}ms` }} />;
            })}
          </g>
          <path className="hp__arc" d={`M${START.x},${START.y}A${R},${R} 0 0 0 ${END.x},${END.y}`} pathLength={1} />
          <circle className="hp__joint" cx={E.x} cy={E.y} r={8} />
          <g className="hp__callouts">
            <line x1={UPPER_SENSOR.x} y1={UPPER_SENSOR.y} x2={1186} y2={484} />
            <circle cx={UPPER_SENSOR.x} cy={UPPER_SENSOR.y} r={5} />
            <line x1={FORE_SENSOR.x} y1={FORE_SENSOR.y} x2={1186} y2={676} />
            <circle cx={FORE_SENSOR.x} cy={FORE_SENSOR.y} r={5} />
          </g>
        </g>
        <text className="hp__cap" x={LABEL.x} y={LABEL.y - 70} textAnchor="middle">
          {labels.angle}
        </text>
        <text className="hp__value" x={LABEL.x} y={LABEL.y} textAnchor="middle">
          {Math.round(value)}°
        </text>
        <g className="hp__callouts hp__callout-text">
          <text x={1198} y={490}>
            {labels.upper}
          </text>
          <text x={1198} y={682}>
            {labels.fore}
          </text>
          <text x={1198} y={708} className="hp__rate">
            {labels.rate}
          </text>
        </g>
      </svg>
    </div>
  );
}
