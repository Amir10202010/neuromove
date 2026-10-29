// Маленькая линия тренда: без осей, последняя точка подчёркнута.

export function Sparkline({ values, width = 96, height = 28, color = 'var(--brand-500)', ariaLabel }: { values: number[]; width?: number; height?: number; color?: string; ariaLabel?: string }) {
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length < 2) return <svg width={width} height={height} aria-hidden />;
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || 1;
  const pad = 3;
  const xs = (i: number) => pad + (i / (vs.length - 1)) * (width - pad * 2);
  const ys = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const d = vs.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join('');
  const last = vs[vs.length - 1] as number;
  return (
    <svg width={width} height={height} role={ariaLabel ? 'img' : undefined} aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
      <path d={d} fill="none" stroke="var(--muted-series)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs(vs.length - 1)} cy={ys(last)} r={3} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}
