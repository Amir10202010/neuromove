// Сцены: тело сбоку и спереди из общих частей (body.ts) в общем стиле (Ink.tsx).
// Конкретные рисунки — картинки к цифрам, живая фигурка, схема датчиков — собираются из них
// и добавляют своё: шкалы, дуги, подписи.
//
// Человек — как на референсе стиля: мальчик или девочка по полу пациента (look.tsx), кожа, тёмные волосы, белая футболка, тёмные шорты, белые
// носки и кроссовки. Датчики — настоящие (светлый корпус на чёрном ремешке, body.ts).
// Рука, которую измеряем, остаётся цветом стороны: рукав — цветом, кожа — с оттенком стороны.
//
// Порядок слоёв задан здесь один раз: SideFigure и FrontFigure рисуют всё, а живая фигурка
// (StickFigure) каждый кадр переставляет контуры тех же слоёв по ключам data-k (applyLayers).

import type { ReactNode } from 'react';
import { frontParts, sideParts, type ArmPose, type FrontParts, type FrontPodKey, type FrontPose, type PodShape, type SideParts } from './body';
import { FIG, Hair, InkLayer, SensorPod, type PodState } from './Ink';
import { useLook } from './look';

export const SIDE_COLOR = {
  left: { main: 'var(--left)', soft: 'var(--left-soft)' },
  right: { main: 'var(--right)', soft: 'var(--right-soft)' },
} as const;

/**
 * Атрибуты <svg>. Размер на экране задаёт CSS контейнера (.mfig и правила вроде
 * «.fig__pic .mfig { height: 100% }»), поэтому без инлайн-стилей: раньше инлайн «height: auto»
 * перебивал CSS, и рисунок вылезал из своей рамки. size — ширина, если контейнер её не задаёт.
 * Пустая подпись — картинка повторяет числа рядом, читалке экрана она не нужна.
 */
export function svgAttrs(vb: [number, number, number, number], size: number | undefined, label: string, className = 'mfig') {
  const w = size ?? vb[2];
  return {
    viewBox: vb.join(' '),
    width: w,
    height: +((w * vb[3]) / vb[2]).toFixed(1),
    ...(label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const }),
    className,
  };
}

/**
 * Как выглядит рука: fill — цвет стороны (рука измеряется) или FIG.fill (обычная).
 * Измеряемая — рукав и контур руки цветом стороны, кожа своего цвета (подкрашенная кожа
 * у синей стороны становится серой и выглядит нездоровой); обычная — кожа и белый рукав.
 */
export function armLook(fill: string, far = false) {
  const measured = fill !== FIG.fill;
  return {
    skin: far ? FIG.skinFar : FIG.skin,
    sleeve: measured ? fill : far ? FIG.shirtFar : FIG.shirt,
    ink: measured ? fill : FIG.ink,
  };
}

/** Слои рисунка по ключам — для живой фигурки. Значение светодиода — «x,y». */
export type LayerMap = Record<string, string>;

function podLayers(k: string, q: PodShape, out: LayerMap) {
  out[`${k}:d`] = q.d;
  out[`${k}:base`] = q.base;
  out[`${k}:strap`] = q.strap;
  out[`${k}:mark`] = q.mark;
  out[`${k}:led`] = `${q.c.x.toFixed(2)},${q.c.y.toFixed(2)}`;
}

export function sideLayers(p: SideParts): LayerMap {
  const out: LayerMap = {
    far: p.far,
    farSleeve: p.farSleeve,
    body: p.body,
    shirt: p.shirt,
    shorts: p.shorts,
    hair: p.hair,
    hairBack: p.hairBack,
    lashes: p.lashes,
    lines: p.lines,
    face: p.face,
    arm: p.arm,
    sleeve: p.sleeve,
  };
  for (const k of ['upper', 'fore', 'trunk'] as const) {
    podLayers(k, { d: p.pods[k], base: p.bases[k], strap: p.straps[k], mark: p.marks[k], c: p.podCenters[k] }, out);
  }
  return out;
}

export function frontLayers(p: FrontParts): LayerMap {
  const out: LayerMap = {
    body: p.body,
    shirt: p.shirt,
    hair: p.hair,
    hairBack: p.hairBack,
    lashes: p.lashes,
    lines: p.lines,
    face: p.face,
    armR: p.arms.right,
    armL: p.arms.left,
    sleeveR: p.sleeves.right,
    sleeveL: p.sleeves.left,
  };
  for (const k of Object.keys(p.pods) as FrontPodKey[]) podLayers(k, p.pods[k], out);
  return out;
}

/** Переставить контуры слоёв внутри root по ключам data-k — без перерисовки React. */
export function applyLayers(root: Element | null, map: LayerMap) {
  if (!root) return;
  root.querySelectorAll('[data-k]').forEach((el) => {
    const v = map[el.getAttribute('data-k') as string];
    if (v === undefined) return;
    if (el.tagName === 'circle') {
      const [x, y] = v.split(',');
      el.setAttribute('cx', x as string);
      el.setAttribute('cy', y as string);
    } else el.setAttribute('d', v);
  });
}

/** Голова и одежда поверх силуэта — общий порядок для обоих видов. */
function Dressed({ p, face }: { p: SideParts | FrontParts; face: boolean }) {
  const girl = useLook() === 'girl';
  return (
    <>
      <InkLayer k="body" d={p.body} fill={FIG.skin} />
      <InkLayer k="shorts" d={p.shorts} fill={FIG.shorts} />
      {p.socks && <InkLayer d={p.socks} fill={FIG.shoe} />}
      {p.shoes && <InkLayer d={p.shoes} fill={FIG.shoe} />}
      <InkLayer k="shirt" d={p.shirt} fill={FIG.shirt} />
      <InkLayer k="hair" d={p.hair} fill={FIG.hair} />
      <Hair k="lines" d={p.lines} color={FIG.ink} width={1} opacity={0.55} />
      {face && <path data-k="face" d={p.face} fill={FIG.hair} className="fig-face" />}
      {face && girl && <path data-k="lashes" d={p.lashes} fill={FIG.hair} className="fig-face" />}
    </>
  );
}

export type SidePods = { upper?: PodState; fore?: PodState; trunk?: PodState; led?: boolean; trunkLed?: boolean };

/** Человек сбоку целиком — по готовым частям. Слои подписаны ключами для живой фигурки. */
export function SideFigure({
  p,
  nearFill,
  farFill = FIG.fill,
  ghost,
  pods,
  face = true,
  between,
}: {
  p: SideParts;
  nearFill: string;
  farFill?: string;
  /** Контур руки «как было» — бледной тенью под рукой. */
  ghost?: string;
  pods?: SidePods | null;
  /** Лицо — на рисунках крупнее значка. */
  face?: boolean;
  /** Что лежит между телом и ближней рукой (дуга наклона корпуса). */
  between?: ReactNode;
}) {
  const girl = useLook() === 'girl';
  const near = armLook(nearFill);
  const far = armLook(farFill, true);
  const led = pods?.led ?? true;
  return (
    <>
      {p.floor && <path d={p.floor} fill={FIG.floor} />}
      {/* Дальняя рука — по ту сторону табурета: сиденье её заслоняет */}
      {p.far && (
        <>
          <InkLayer k="far" d={p.far} fill={far.skin} ink={far.ink} />
          <InkLayer k="farSleeve" d={p.farSleeve} fill={far.sleeve} ink={far.ink} />
        </>
      )}
      <InkLayer d={p.stool} fill={FIG.fill} />
      {girl && <InkLayer k="hairBack" d={p.hairBack} fill={FIG.hair} />}
      <Dressed p={p} face={face} />
      {pods?.trunk && (
        <SensorPod
          k="trunk"
          d={p.pods.trunk}
          strap={p.straps.trunk}
          base={p.bases.trunk}
          c={p.podCenters.trunk}
          state={pods.trunk}
          led={pods.trunkLed ?? led}
          ledR={1.1}
        />
      )}
      {between}
      {ghost && <path d={ghost} fill={FIG.ghost} />}
      <InkLayer k="arm" d={p.arm} fill={near.skin} ink={near.ink} />
      <InkLayer k="sleeve" d={p.sleeve} fill={near.sleeve} ink={near.ink} />
      {(['upper', 'fore'] as const).map((k) =>
        pods?.[k] ? (
          <SensorPod
            key={k}
            k={k}
            d={p.pods[k]}
            strap={p.straps[k]}
            base={p.bases[k]}
            mark={p.marks[k]}
            c={p.podCenters[k]}
            state={pods[k]}
            led={led}
          />
        ) : null,
      )}
    </>
  );
}

/** Человек спереди целиком. Руки — под футболкой: плечо продолжает линию плеч. */
export function FrontFigure({
  p,
  fills = { right: FIG.fill, left: FIG.fill },
  pods,
  face = true,
  ledR,
  pulseR,
  podTitle,
}: {
  p: FrontParts;
  fills?: { right: string; left: string };
  pods?: Partial<Record<FrontPodKey, PodState>> | null;
  face?: boolean;
  ledR?: number;
  pulseR?: number;
  /** Подсказка к датчику (схема датчиков). */
  podTitle?: (k: FrontPodKey) => string | undefined;
}) {
  const girl = useLook() === 'girl';
  const r = armLook(fills.right);
  const l = armLook(fills.left);
  return (
    <>
      {p.floor && <path d={p.floor} fill={FIG.floor} />}
      <InkLayer d={p.stool} fill={FIG.fill} />
      {girl && <InkLayer k="hairBack" d={p.hairBack} fill={FIG.hair} />}
      <InkLayer k="armR" d={p.arms.right} fill={r.skin} ink={r.ink} />
      <InkLayer k="sleeveR" d={p.sleeves.right} fill={r.sleeve} ink={r.ink} />
      <InkLayer k="armL" d={p.arms.left} fill={l.skin} ink={l.ink} />
      <InkLayer k="sleeveL" d={p.sleeves.left} fill={l.sleeve} ink={l.ink} />
      <Dressed p={p} face={face} />
      {pods &&
        (Object.keys(p.pods) as FrontPodKey[]).map((k) => {
          const st = pods[k];
          if (!st) return null;
          const q = p.pods[k];
          const title = podTitle?.(k);
          return (
            <g key={k}>
              <SensorPod k={k} d={q.d} strap={q.strap} base={q.base} mark={q.mark} c={q.c} state={st} ledR={ledR} pulseR={pulseR} />
              {title && <title>{title}</title>}
            </g>
          );
        })}
    </>
  );
}

/**
 * Тело сбоку: табурет, дальняя рука (за корпусом), корпус, «призрак» прошлого положения,
 * ближняя рука цветом стороны, датчики. under — то, что лежит под телом (секторы шкалы),
 * over — поверх (дуги, подписи).
 */
export function SideScene({
  hip,
  lean = 0,
  near,
  nearFill,
  far = null,
  farFill = FIG.fill,
  ghost = null,
  legs = false,
  pods,
  face = true,
  under,
  over,
}: {
  hip: { x: number; y: number };
  lean?: number;
  near: ArmPose;
  nearFill: string;
  far?: ArmPose | null;
  farFill?: string;
  ghost?: ArmPose | null;
  legs?: boolean;
  /** Какие датчики показать и в каком состоянии; без светодиода — для картинок в отчётах. */
  pods?: SidePods | null;
  face?: boolean;
  under?: (p: SideParts) => ReactNode;
  over?: (p: SideParts) => ReactNode;
}) {
  const p = sideParts(hip, lean, near, { legs, far });
  const g = ghost ? sideParts(hip, lean, ghost, { legs: false }) : null;
  return (
    <>
      {under?.(p)}
      <SideFigure p={p} nearFill={nearFill} farFill={farFill} ghost={g?.arm} pods={pods} face={face} />
      {over?.(p)}
    </>
  );
}

/** Тело спереди: правая рука пациента — слева от зрителя. */
export function FrontScene({
  center,
  pose,
  fills,
  legs = false,
  pods,
  face = true,
  under,
  over,
}: {
  center: { x: number; y: number };
  pose: FrontPose;
  fills: { right: string; left: string };
  legs?: boolean;
  pods?: Partial<Record<FrontPodKey, PodState>> | null;
  face?: boolean;
  under?: (p: FrontParts) => ReactNode;
  over?: (p: FrontParts) => ReactNode;
}) {
  const p = frontParts(center, pose, { legs });
  return (
    <>
      {under?.(p)}
      <FrontFigure p={p} fills={fills} pods={pods} face={face} />
      {over?.(p)}
    </>
  );
}
