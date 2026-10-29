// Уникальные идентификаторы записей. crypto.randomUUID есть не везде (file:// в старых браузерах),
// поэтому запасной вариант — время + случайное число.
export function newId(prefix = ''): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${rnd}` : rnd;
}
