// Движение на стартовой странице — без библиотек анимации, по образцу страниц-презентаций Apple
// (замеры apple.com 18 октября: docs/REFERENCE_STUDY.md, раздел «Движение Apple»).
//
//  • data-reveal            — блок проявляется, когда впервые дошёл до ~82 % высоты экрана:
//                             прозрачность 0 → 1 и подъём на 30 px, как текст у Apple;
//  • data-progress="s e"    — CSS-переменная --p от 0 до 1, пока блок проходит экран:
//                             0 — верх блока на высоте s·экрана, 1 — низ блока на высоте e·экрана
//                             (с data-progress-edge="top" — тоже верх блока);
//  • data-nav="dark|white"   — цвет секции под верхней панелью: панель подстраивается.
//
// Всё считается в одном обработчике прокрутки, не чаще раза за кадр: сначала все чтения
// размеров, потом все записи — без лишних перерасчётов раскладки.

import { useEffect, useRef, useState, type RefObject } from 'react';

/** Пользователь попросил систему уменьшить движение — анимации сводятся к простому показу. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Виден ли блок (с запасом margin сверху и снизу). Живые рисунки работают, только пока
 * их видно: ушли за экран — кадры не считаются.
 */
export function useInView<T extends Element>(margin = '160px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.isIntersecting);
      },
      { rootMargin: `${margin} 0px ${margin} 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, inView];
}

interface ProgressItem {
  node: HTMLElement;
  start: number;
  end: number;
  byTop: boolean;
  last: number;
}

/** Появление блоков, прогресс сцен и цвет верхней панели — для всей страницы сразу. */
export function useLandingScroll(root: RefObject<HTMLElement | null>, nav: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const page = root.current;
    if (!page) return;

    // Появление: один раз, когда блок впервые показался. Отметка — data-in, а не класс:
    // React не трогает атрибуты, которых нет в разметке, и отметка переживёт перерисовку.
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = '';
          reveal.unobserve(e.target);
        }
      },
      // У Apple блок оживает, когда его верх доходит до ~80 % высоты экрана — не раньше,
      // чтобы появление было видно, а не случилось за краем
      { rootMargin: '0px 0px -18% 0px', threshold: 0 },
    );
    const watch = (root: ParentNode) => root.querySelectorAll('[data-reveal]:not([data-in])').forEach((n) => reveal.observe(n));
    watch(page);
    // Блоки, которые появляются позже — когда загрузились демо-данные (сравнение «на глаз / NeuroMove»
    // в «Сегодня»), — тоже ждут показа. Раньше их никто не замечал, и они оставались прозрачными навсегда
    const added = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          if (n.matches('[data-reveal]:not([data-in])')) reveal.observe(n);
          watch(n);
        }
      }
    });
    added.observe(page, { childList: true, subtree: true });

    const items: ProgressItem[] = [...page.querySelectorAll<HTMLElement>('[data-progress]')].map((node) => {
      const [start = 1, end = 0] = (node.dataset.progress ?? '').split(' ').map(Number);
      return { node, start, end, byTop: node.dataset.progressEdge === 'top', last: -1 };
    });
    const sections = [...page.querySelectorAll<HTMLElement>('[data-nav]')];

    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      const bar = nav.current;
      const barMid = (bar?.offsetHeight ?? 64) / 2;

      // 1. Чтения. Секция под панелью — последняя подходящая: поздние секции
      //    наезжают на ранние (первый экран «уезжает» под следующую секцию).
      let theme = sections[0]?.dataset.nav ?? 'dark';
      for (const s of sections) {
        const r = s.getBoundingClientRect();
        if (r.top <= barMid && r.bottom > barMid) theme = s.dataset.nav ?? theme;
      }
      const values = items.map((it) => {
        const r = it.node.getBoundingClientRect();
        const span = (it.start - it.end) * vh + (it.byTop ? 0 : r.height);
        const v = span > 0 ? (it.start * vh - r.top) / span : 1;
        return Math.min(1, Math.max(0, v));
      });

      // 2. Записи
      bar?.setAttribute('data-theme', theme);
      bar?.setAttribute('data-scrolled', window.scrollY > 8 ? 'true' : 'false');
      items.forEach((it, i) => {
        const v = values[i] as number;
        if (Math.abs(v - it.last) < 0.0005) return;
        it.last = v;
        it.node.style.setProperty('--p', v.toFixed(4));
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      reveal.disconnect();
      added.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [root, nav]);
}

/**
 * Прокрутка шагов сцены как непрерывное число s от 0 до числа шагов: целая часть — шаг,
 * пересекающий линию чтения, дробная — сколько от него пройдено. Линия чтения на компьютере —
 * середина экрана, на телефоне ниже (верх экрана занят закреплённой картинкой). onChange
 * вызывается в кадре прокрутки, только пока сцена видна, — сцена двигается вместе с прокруткой,
 * как разборные модели на страницах Apple, а не по таймеру.
 */
export function useStepProgress(container: RefObject<HTMLElement | null>, onChange: (s: number) => void): void {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  useEffect(() => {
    const box = container.current;
    if (!box) return;
    const steps = [...box.querySelectorAll<HTMLElement>('[data-step]')];
    if (!steps.length) return;
    const narrow = window.matchMedia('(max-width: 959px)');
    let frame = 0;
    let last = -1;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * (narrow.matches ? 0.78 : 0.5);
      let s = 0;
      for (let i = 0; i < steps.length; i++) {
        const r = steps[i]!.getBoundingClientRect();
        if (r.bottom <= line && i < steps.length - 1) continue;
        s = i + Math.min(0.999, Math.max(0, (line - r.top) / Math.max(1, r.height)));
        break;
      }
      if (Math.abs(s - last) < 0.0005) return;
      last = s;
      cb.current(s);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    let on = false;
    const io = new IntersectionObserver(
      ([e]) => {
        const visible = !!e?.isIntersecting;
        if (visible === on) return;
        on = visible;
        if (on) {
          window.addEventListener('scroll', schedule, { passive: true });
          window.addEventListener('resize', schedule);
          update();
        } else {
          window.removeEventListener('scroll', schedule);
          window.removeEventListener('resize', schedule);
        }
      },
      { rootMargin: '50% 0px 50% 0px' },
    );
    io.observe(box);
    update();
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [container]);
}

/**
 * Прогресс блока по прокрутке числом 0…1 — для того, что CSS-переменной не нарисовать (число на
 * шкале). 0 — верх блока на высоте start·экрана, 1 — на высоте end·экрана. Значение округлено
 * до 0,005: React перерисовывает блок не чаще, чем это заметно глазу. «Уменьшить движение» — 1.
 */
export function useScrollProgress<T extends HTMLElement>(start: number, end: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [reduced] = useState(prefersReducedMotion);
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      const top = el.getBoundingClientRect().top;
      const v = Math.min(1, Math.max(0, (start * vh - top) / ((start - end) * vh)));
      setP(Math.round(v * 200) / 200);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          window.addEventListener('scroll', schedule, { passive: true });
          window.addEventListener('resize', schedule);
          update();
        } else {
          window.removeEventListener('scroll', schedule);
          window.removeEventListener('resize', schedule);
          update();
        }
      },
      { rootMargin: '20% 0px 20% 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [start, end, reduced]);
  return [ref, reduced ? 1 : p];
}

/**
 * Число, которое «доезжает» от from до to, когда блок впервые показался: 127° → 140°.
 * При «уменьшить движение» сразу показывает итог.
 */
export function useCountUp(to: number, from: number, run: boolean, ms = 1400): number {
  const [reduced] = useState(prefersReducedMotion);
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (!run || reduced) return;
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - k) ** 3;
      setValue(from + (to - from) * eased);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, from, run, ms, reduced]);
  if (reduced) return to;
  if (!run) return from;
  return value ?? from;
}
