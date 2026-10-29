// Живой график угла за последние секунды — на <canvas>: 100 точек в секунду
// без тормозов. Повторы подсвечены заливкой, шкала совпадает с угломером.

import { useRef } from 'react';
import { useAnimationFrame } from '../hooks/useAnimationFrame';
import { useWidth } from '../hooks/useSize';
import type { LiveSeries } from '../session/LiveSeries';

interface Props {
  series: LiveSeries;
  /** Какой ряд рисовать: угол движения или наклон туловища. */
  channel: 'angle' | 'trunk';
  range: [number, number];
  color: string;
  height?: number;
  windowSec?: number;
  gridStep?: number;
  /** Порог (например, 12° для наклона туловища) — тонкая линия. */
  threshold?: number | null;
  secLabel: string;
  ariaLabel: string;
}

export function LiveTrace({ series, channel, range, color, height = 160, windowSec = 12, gridStep = 30, threshold, secLabel, ariaLabel }: Props) {
  const [box, width] = useWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const styles = useRef<{ key: string; grid: string; text: string; surface: string; line: string } | null>(null);

  useAnimationFrame(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(100, width);
    const H = height;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (!styles.current || styles.current.key !== color) {
      // Canvas не понимает var(--…): берём настоящие значения цветов из CSS
      const cs = getComputedStyle(cv);
      const resolve = (c: string) => {
        const m = /^var\((--[\w-]+)\)$/.exec(c.trim());
        return m ? cs.getPropertyValue(m[1] as string).trim() || '#0e1621' : c;
      };
      styles.current = {
        key: color,
        grid: cs.getPropertyValue('--grid').trim() || '#e8ebef',
        text: cs.getPropertyValue('--text-3').trim() || '#6f7a8a',
        surface: cs.getPropertyValue('--surface').trim() || '#fff',
        line: resolve(color),
      };
    }
    const st = styles.current;
    const lineColor = st.line;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const left = 38;
    const right = 10;
    const top = 8;
    const bottom = 20;
    const pw = W - left - right;
    const ph = H - top - bottom;
    const yOf = (v: number) => top + (1 - (v - range[0]) / (range[1] - range[0])) * ph;
    const tEnd = series.lastT;
    const tStart = tEnd - windowSec;
    const xOf = (t: number) => left + ((t - tStart) / windowSec) * pw;

    // Сетка и подписи
    ctx.font = '11px Inter Variable, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (let v = Math.ceil(range[0] / gridStep) * gridStep; v <= range[1]; v += gridStep) {
      const yy = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = st.grid;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(W - right, yy);
      ctx.stroke();
      ctx.fillStyle = st.text;
      ctx.textAlign = 'right';
      ctx.fillText(`${v}°`, left - 6, yy);
    }
    ctx.textAlign = 'center';
    for (let s = 0; s <= windowSec; s += windowSec / 4) {
      const xx = left + (s / windowSec) * pw;
      ctx.fillStyle = st.text;
      ctx.fillText(s === windowSec ? '0' : `−${windowSec - s} ${secLabel}`, xx, H - 8);
    }
    if (threshold !== null && threshold !== undefined) {
      const yy = Math.round(yOf(threshold)) + 0.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = st.text;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(W - right, yy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const n = series.size;
    if (n < 2) return;
    const data = channel === 'angle' ? series.angle : series.trunk;
    const clampY = (v: number) => yOf(Math.max(range[0], Math.min(range[1], v)));

    // Заливка под кривой там, где идёт повтор
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = lineColor;
    let inRun = false;
    const base = yOf(Math.max(range[0], Math.min(range[1], 0)));
    for (let i = 0; i < n; i++) {
      const k = series.index(i);
      const t = series.t[k] as number;
      if (t < tStart) continue;
      const v = data[k] as number;
      const rep = series.inRep[k] === 1 && Number.isFinite(v);
      const xx = xOf(t);
      if (rep && !inRun) {
        ctx.beginPath();
        ctx.moveTo(xx, base);
        inRun = true;
      }
      if (rep) ctx.lineTo(xx, clampY(v));
      if ((!rep || i === n - 1) && inRun) {
        ctx.lineTo(xx, base);
        ctx.closePath();
        ctx.fill();
        inRun = false;
      }
    }
    ctx.globalAlpha = 1;

    // Сама кривая
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let started = false;
    let lastX = 0;
    let lastY = 0;
    for (let i = 0; i < n; i++) {
      const k = series.index(i);
      const t = series.t[k] as number;
      const v = data[k] as number;
      if (t < tStart || !Number.isFinite(v)) {
        started = false;
        continue;
      }
      const xx = xOf(t);
      const yy = clampY(v);
      if (!started) {
        ctx.moveTo(xx, yy);
        started = true;
      } else ctx.lineTo(xx, yy);
      lastX = xx;
      lastY = yy;
    }
    ctx.stroke();
    if (started) {
      ctx.fillStyle = st.surface;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  return (
    <div ref={box} className="live-trace">
      <canvas ref={canvas} role="img" aria-label={ariaLabel} />
    </div>
  );
}
