import { useEffect, useState } from 'react';

/**
 * Текущее время, которое обновляется раз в intervalMs.
 * Экраны, где важно «сколько дней назад», не вызывают Date.now() прямо при отрисовке.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
