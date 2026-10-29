// Статус одной фигурой — как в Linear: круг, который заполняется по ходу дела.
// Одна и та же геометрия у шагов теста, этапов сеанса, датчиков и шагов гида — человек
// один раз понимает «пустой круг — ещё не начали, сектор — идёт, галочка — готово»
// и дальше читает статус везде без подписи. Подпись всё равно есть рядом: цвет и форма
// не единственный носитель смысла.

export type RingState = 'todo' | 'wait' | 'active' | 'done' | 'skipped' | 'error' | 'paused';

export function StatusRing({ state, progress = 0.5, size = 16, className }: { state: RingState; progress?: number; size?: number; className?: string }) {
  const c = 8;
  const r = 6.25;
  const p = Math.max(0.08, Math.min(1, progress));
  // Сектор от «12 часов» по часовой стрелке
  const a = p * 2 * Math.PI;
  const ri = 3.6;
  const x = c + ri * Math.sin(a);
  const y = c - ri * Math.cos(a);
  const pie = p >= 0.999 ? `M${c},${c - ri}A${ri},${ri} 0 1 1 ${c - 0.01},${c - ri}Z` : `M${c},${c}L${c},${c - ri}A${ri},${ri} 0 ${a > Math.PI ? 1 : 0} 1 ${x.toFixed(2)},${y.toFixed(2)}Z`;
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={`ring ring--${state}${className ? ` ${className}` : ''}`} aria-hidden>
      {state === 'done' ? (
        <>
          <circle cx={c} cy={c} r={7} className="ring__fill" />
          <path d="M4.9 8.2l2.1 2.1 4.1-4.4" className="ring__check" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : state === 'error' ? (
        <>
          <circle cx={c} cy={c} r={7} className="ring__fill" />
          <path d="M8 4.6v4.2M8 11.2v.1" className="ring__check" strokeWidth={1.7} strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx={c} cy={c} r={r} fill="none" className="ring__track" strokeWidth={1.5} strokeDasharray={state === 'wait' ? '2.2 2.1' : undefined} />
          {state === 'active' && <path d={pie} className="ring__pie" />}
          {state === 'paused' && <path d="M6.5 5.6v4.8M9.5 5.6v4.8" className="ring__mark" strokeWidth={1.5} strokeLinecap="round" />}
          {state === 'skipped' && <path d="M5.4 8h5.2" className="ring__mark" strokeWidth={1.5} strokeLinecap="round" />}
        </>
      )}
    </svg>
  );
}
