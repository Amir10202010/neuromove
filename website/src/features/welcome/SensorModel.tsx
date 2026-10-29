// Разборная модель датчика для сцены «Как это работает» — из версии страницы от 27 сентября.
// Три слоя: корпус, плата с датчиком движения, основание с ремешком. Где стоит каждый слой,
// решает прокрутка: переменные --a, --b, --c (0…1) у обёртки — сколько пройдено переходов
// «надеть → двигаться», «двигаться → измерить», «измерить → увидеть» (landing.css):
// надеть — датчик собран, двигаться — слои расходятся и идёт сигнал, измерить — «камера»
// на плате, увидеть — модель уходит в тень, поверх — отчёт. Это схема-концепт, а не чертёж.
// 18 октября фон сцены стал чисто чёрным: серые тона корпуса и подписей — нейтральные, без зелени;
// зелёной осталась только плата — она и в жизни зелёная.

interface Labels {
  enclosure: string;
  board: string;
  boardSub: string;
  strap: string;
}

export function SensorModel({ labels, ariaLabel }: { labels: Labels; ariaLabel: string }) {
  return (
    <svg className="sm" viewBox="0 0 640 620" role="img" aria-label={ariaLabel}>
      <defs>
        <pattern id="sm-grid" width="44" height="44" patternUnits="userSpaceOnUse">
          <path d="M44 0H0V44" fill="none" stroke="#fff" strokeOpacity=".045" />
        </pattern>
        <linearGradient id="sm-face" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#e8e5da" />
          <stop offset="1" stopColor="#aeb1a8" />
        </linearGradient>
      </defs>
      <rect width="640" height="620" fill="url(#sm-grid)" />
      <g className="sm__guides" fill="none" stroke="#b4b4ba" strokeOpacity=".25" strokeDasharray="3 6">
        <path d="M183 187v294M453 187v294M318 82v451" />
        <ellipse cx="318" cy="464" rx="180" ry="77" />
      </g>
      <g className="sm__layer sm__base">
        <path d="M178 377q-18-10 0-22l119-68q20-11 39 0l124 70q19 12 0 23l-121 71q-20 12-40 0z" fill="#2b2b2e" stroke="#5c5c62" />
        <path d="M162 365v21q0 9 16 19l121 70q20 11 40 0l121-72q15-9 15-20v-21" fill="none" stroke="#75757b" />
        <path d="M211 383l96 54q11 7 23 0l93-53" fill="none" stroke="#a6a6ac" strokeOpacity=".5" />
      </g>
      <g className="sm__layer sm__board">
        <path d="M187 276q-17-10 0-20l111-64q20-11 39 0l111 63q17 11 0 22l-111 64q-19 11-39 0z" fill="#3e4a43" stroke="#94a39a" />
        <g fill="none" stroke="#a6b5ab" strokeWidth="1" opacity=".7">
          <path d="M214 263l91 53 35-21M267 229l86 49 55-29M232 249l73 41 39-23M299 211l57 32-18 11" />
          <path d="M365 310l45-26-22-13M236 282l29-17M281 309l22-13" />
        </g>
        <path d="M275 263l39-23 45 25-40 23z" fill="#141a17" stroke="#c9d3cb" />
        <path d="M294 263l20-12 23 13-21 12z" fill="#93a598" />
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M${227 + i * 17} ${270 + i * 10}l9-5 10 6-9 5z`} fill="#d7c3a2" />
        ))}
        {/* Датчик движения «на связи»: кольцо пульсирует, пока идут данные */}
        <circle className="sm__sense" cx="317" cy="264" r="34" fill="none" stroke="#e0714f" strokeWidth="1.6" />
      </g>
      <g className="sm__layer sm__top">
        <path d="M176 174q-18-11 0-23l119-68q20-11 40 0l125 70q18 11 0 23l-124 72q-20 11-40 0z" fill="url(#sm-face)" />
        <path d="M160 162v22q0 11 17 21l120 69q20 11 39 0l124-71q15-10 15-21v-19q0 12-15 21l-124 71q-19 11-39 0l-120-69q-17-10-17-23" fill="#838a84" />
        <path d="M298 168l17-10 20 12-17 10" fill="none" stroke="#666f69" strokeWidth="3" />
        <path d="M367 204l26-15" stroke="#b7452c" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g className="sm__labels" aria-hidden>
        <g fill="none" stroke="#a9a9b0" strokeWidth=".8">
          <path d="M419 127h81v-29h46" />
          <path d="M432 268h82v-8h32" />
          <path d="M418 427h85v27h43" />
          <circle cx="419" cy="127" r="3" />
          <circle cx="432" cy="268" r="3" />
          <circle cx="418" cy="427" r="3" />
        </g>
        <text x="506" y="88">{labels.enclosure}</text>
        <text x="496" y="247">{labels.board}</text>
        <text x="496" y="262" className="sm__sub">
          {labels.boardSub}
        </text>
        <text x="500" y="476">{labels.strap}</text>
      </g>
    </svg>
  );
}

/** Три оси движения — угловая скорость, как её видит датчик. Иллюстрация, не запись пациента. */
export function SignalLines() {
  const path = (row: number) =>
    Array.from({ length: 241 }, (_, i) => {
      const envelope = Math.sin((i / 240) * Math.PI * 4) ** 2;
      const y = 24 + row * 36 - Math.sin((i / 240) * Math.PI * 12 + row) * envelope * (10 + row * 3) - Math.sin(i * 1.7 + row) * 1.2;
      return `${i ? 'L' : 'M'}${i * 2.5},${y.toFixed(2)}`;
    }).join(' ');
  return (
    <svg className="sm-signal" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden>
      {[0, 1, 2].map((row) => (
        <path key={row} d={path(row)} fill="none" stroke={['#dc6440', '#a1a1a8', '#c6c6cc'][row]} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
