// Подсказка гида у самого элемента: всё, кроме нужного блока и кнопки, приглушено,
// рядом с целью — карточка «что это и что нажать». Человек не ищет, куда смотреть:
// светлым остаётся только то, о чём говорит шаг, а кнопка — та же, что в работе.
//
// Затемнение — SVG с маской: светлые «окна» над блоком и кнопкой могут перекрываться
// (кнопка внутри блока), маска это переживает. Затемнение не ловит щелчки: по экрану
// можно ходить, гид заметит, что вы ушли с шага.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { findTarget, type LookId, type PressId } from './spot';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Targets {
  look: Box | null;
  /** Какой из блоков шага найден на экране (калибровка идёт на месте теста). */
  lookId: LookId | null;
  press: Box | null;
  /** Кнопка пока недоступна (датчики ещё выходят на связь). */
  pressDisabled: boolean;
  vw: number;
  vh: number;
}

function measure(el: HTMLElement | null, pad: number): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
const sameBox = (a: Box | null, b: Box | null) => (!a && !b) || (!!a && !!b && near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h));

/** Где сейчас цели шага на экране: следим каждый кадр, перерисовываем, только если сдвинулись. */
export function useTargets(look: LookId[], press: PressId | undefined, active: boolean): Targets {
  const [state, setState] = useState<Targets>({ look: null, lookId: null, press: null, pressDisabled: false, vw: 0, vh: 0 });
  const key = look.join(',');
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let prev: Targets | null = null;
    const ids = key ? (key.split(',') as LookId[]) : [];
    const tick = () => {
      const lookIdx = ids.findIndex((id) => findTarget(id) !== null);
      const lookEl = lookIdx >= 0 ? findTarget(ids[lookIdx] as LookId) : null;
      const pressEl = press ? findTarget(press) : null;
      const next: Targets = {
        look: measure(lookEl, 8),
        lookId: lookIdx >= 0 ? (ids[lookIdx] as LookId) : null,
        press: measure(pressEl, 5),
        pressDisabled: pressEl ? pressEl.hasAttribute('disabled') || pressEl.getAttribute('aria-disabled') === 'true' : false,
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
      if (!prev || !sameBox(prev.look, next.look) || prev.lookId !== next.lookId || !sameBox(prev.press, next.press) || prev.pressDisabled !== next.pressDisabled || prev.vw !== next.vw || prev.vh !== next.vh) {
        prev = next;
        setState(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, press, active]);
  return state;
}

export type Side = 'below' | 'above' | 'right' | 'left' | 'dock';

/** Пересекаются ли два прямоугольника. */
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Куда поставить карточку: под целью, над ней, справа или слева — первое место, где карточка
 * целиком на экране и не закрывает подсвеченный блок; не нашлось — в правый верхний угол.
 * Если кнопка лежит внутри подсвеченного блока, карточка встаёт снаружи блока, а стрелка
 * всё равно смотрит на кнопку: план сеанса не закрыт, и видно, что нажать.
 */
export function placeCard(target: Box | null, avoid: Box | null, w: number, h: number, vw: number, vh: number): { x: number; y: number; side: Side } {
  const G = 14;
  const M = 12;
  const TOP = 46; // под полосой «Демо»
  const fits = (x: number, y: number) => x >= M && y >= TOP && x + w <= vw - M && y + h <= vh - M;
  const hits = (x: number, y: number) => !!avoid && overlap({ x, y, w, h }, avoid);
  if (target) {
    // Вокруг чего ставить: кнопка внутри блока — вокруг блока целиком
    const around =
      avoid && overlap(target, avoid)
        ? {
            x: Math.min(target.x, avoid.x),
            y: Math.min(target.y, avoid.y),
            w: Math.max(target.x + target.w, avoid.x + avoid.w) - Math.min(target.x, avoid.x),
            h: Math.max(target.y + target.h, avoid.y + avoid.h) - Math.min(target.y, avoid.y),
          }
        : target;
    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;
    const clampX = (x: number) => Math.min(Math.max(x, M), vw - M - w);
    const clampY = (y: number) => Math.min(Math.max(y, TOP), vh - M - h);
    const cands: { side: Side; x: number; y: number }[] = [
      { side: 'below', x: clampX(cx - w / 2), y: around.y + around.h + G },
      { side: 'above', x: clampX(cx - w / 2), y: around.y - G - h },
      { side: 'right', x: around.x + around.w + G, y: clampY(cy - h / 2) },
      { side: 'left', x: around.x - G - w, y: clampY(cy - h / 2) },
    ];
    const free = cands.find((c) => fits(c.x, c.y) && !hits(c.x, c.y)) ?? cands.find((c) => fits(c.x, c.y));
    if (free) return free;
  }
  return { side: 'dock', x: vw - w - 20, y: TOP + 10 };
}

/** Затемнение с «окнами» над блоком и кнопкой и тонкой рамкой вокруг блока. */
export function Scrim({ holes, frame }: { holes: Box[]; frame: Box | null }) {
  const id = `coach-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg className="coach-scrim" aria-hidden>
      <defs>
        <mask id={id}>
          <rect width="100%" height="100%" fill="#fff" />
          {holes.map((b, i) => (
            <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={14} fill="#000" />
          ))}
        </mask>
      </defs>
      <rect className="coach-scrim__shade" width="100%" height="100%" mask={`url(#${id})`} />
      {frame && <rect className="coach-scrim__frame" x={frame.x} y={frame.y} width={frame.w} height={frame.h} rx={14} />}
    </svg>
  );
}

/** Кольцо вокруг кнопки, которую нужно нажать: пульсирует трижды и остаётся. */
export function PressRing({ box }: { box: Box }) {
  return <span className="coach-ring" aria-hidden style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />;
}

/**
 * Карточка подсказки. На компьютере — у цели со стрелкой к ней, на телефоне — внизу экрана.
 * Положение считается после того, как известен размер карточки: до этого она невидима.
 */
export function CoachCard({
  anchor,
  avoid,
  vw,
  vh,
  label,
  children,
  className,
}: {
  anchor: Box | null;
  avoid: Box | null;
  vw: number;
  vh: number;
  label: string;
  /** Содержимое; функция получает сторону, с которой встала карточка, — для стрелки «нажмите». */
  children: ReactNode | ((side: Side) => ReactNode);
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setSize((s) => (s && near(s.w, el.offsetWidth) && near(s.h, el.offsetHeight) ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const mobile = vw > 0 && vw < 721;
  const pos = !mobile && size && vw ? placeCard(anchor, avoid, size.w, size.h, vw, vh) : null;
  // Стрелка — на ребре карточки против центра цели
  let arrow: { left?: number; top?: number } | null = null;
  if (pos && anchor && size && pos.side !== 'dock') {
    if (pos.side === 'below' || pos.side === 'above') arrow = { left: Math.min(Math.max(anchor.x + anchor.w / 2 - pos.x, 18), size.w - 18) };
    else arrow = { top: Math.min(Math.max(anchor.y + anchor.h / 2 - pos.y, 18), size.h - 18) };
  }
  const side = mobile ? 'dock' : (pos?.side ?? 'dock');
  return (
    <aside
      ref={ref}
      className={`coach coach--${side}${mobile ? ' coach--mobile' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      style={mobile ? undefined : pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden', left: 0, top: 0 }}
    >
      {arrow && <span className="coach__arrow" aria-hidden style={arrow} />}
      {typeof children === 'function' ? children(side) : children}
    </aside>
  );
}
