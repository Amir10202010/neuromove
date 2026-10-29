import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Вызывает draw() на каждом кадре экрана, пока компонент на экране.
 * Живые графики читают данные прямо из движка — без перерисовки React.
 */
export function useAnimationFrame(draw: (now: number) => void, active = true) {
  const fn = useRef(draw);
  useLayoutEffect(() => {
    fn.current = draw;
  });
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (now: number) => {
      fn.current(now);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}
