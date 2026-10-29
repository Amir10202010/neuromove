import { useLayoutEffect, useRef, useState } from 'react';

/** Ширина контейнера — графики подстраиваются под экран. */
export function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth((prev) => (Math.abs(w - prev) > 0.5 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}
