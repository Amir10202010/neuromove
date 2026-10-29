// Пустые состояния — рисунками из той же системы, а не безликой иконкой в квадрате:
// пустой экран объясняет, что здесь появится и что для этого сделать.
//  • baseline — пациент без сеансов: ребёнок на табурете, шкала подъёма пустая;
//  • patients — пациентов ещё нет: место на табурете ждёт (полупрозрачный силуэт);
//  • sessions — сеансов ещё нет: лист отчёта с пустой шкалой;
//  • device   — устройство не подключено: датчики на ремешках пунктиром;
//  • lost     — страница не найдена: стрелка ушла за шкалу.

import { frontParts, sideParts, SIDE } from './body';
import { arc, at } from './geometry';
import { FIG, Hair, InkLayer, SensorPod } from './Ink';

export type EmptyKind = 'baseline' | 'patients' | 'sessions' | 'device' | 'lost';

const REACH = SIDE.upper + SIDE.fore + SIDE.hand + SIDE.handW / 2;

function Scale({ s, r }: { s: { x: number; y: number }; r: number }) {
  return (
    <>
      <Hair d={arc(s, r, 0, 180)} dash="0.5 3.5" width={1.4} />
      {[0, 90, 180].map((v) => {
        const a = at(s, r - 5, v);
        const b = at(s, r + 5, v);
        return <Hair key={v} d={`M${a.x},${a.y}L${b.x},${b.y}`} />;
      })}
    </>
  );
}

export function EmptyArt({ kind, size = 132 }: { kind: EmptyKind; size?: number }) {
  if (kind === 'baseline') {
    const hip = { x: 64, y: 178 };
    const p = sideParts(hip, 0, { upper: 4, fore: 6 }, { legs: false });
    return (
      <svg viewBox="22 -30 200 232" width={size} height={Math.round((size * 232) / 200)} className="empty-art" aria-hidden>
        <Scale s={p.shoulder} r={REACH + 8} />
        <InkLayer d={p.stool} />
        <InkLayer d={p.body} />
        <InkLayer d={p.arm} />
        <SensorPod d={p.pods.upper} strap={p.straps.upper} c={p.podCenters.upper} state="off" />
        <SensorPod d={p.pods.fore} strap={p.straps.fore} c={p.podCenters.fore} state="off" />
      </svg>
    );
  }
  if (kind === 'patients') {
    const p = frontParts({ x: 120, y: 178 }, { right: { upper: 6, fore: 8 }, left: { upper: 6, fore: 8 } }, { legs: true });
    return (
      <svg viewBox="40 30 160 228" width={size} height={Math.round((size * 228) / 160)} className="empty-art" aria-hidden>
        <path d={p.body + p.arms.right + p.arms.left} fill={FIG.ghost} />
        <InkLayer d={p.stool} />
      </svg>
    );
  }
  if (kind === 'device') {
    const p = frontParts({ x: 120, y: 178 }, { right: { upper: 16, fore: 20 }, left: { upper: 16, fore: 20 } }, { legs: false });
    return (
      <svg viewBox="40 30 160 168" width={size} height={Math.round((size * 168) / 160)} className="empty-art" aria-hidden>
        <InkLayer d={p.stool} />
        <InkLayer d={p.body} />
        <InkLayer d={p.arms.right} />
        <InkLayer d={p.arms.left} />
        {(Object.keys(p.pods) as (keyof typeof p.pods)[]).map((k) => (
          <SensorPod key={k} d={p.pods[k].d} strap={p.pods[k].strap} c={p.pods[k].c} state="off" />
        ))}
      </svg>
    );
  }
  if (kind === 'lost') {
    const o = { x: 80, y: 92 };
    const r = 62;
    const tip = at(o, r + 26, 214);
    return (
      <svg viewBox="0 0 160 120" width={size} height={Math.round((size * 120) / 160)} className="empty-art" aria-hidden>
        <path d={arc(o, r, 0, 180)} fill="none" stroke="var(--fig-sector)" strokeWidth={12} />
        <Hair d={arc(o, r, 0, 180)} dash="0.5 3.5" width={1.4} />
        <Hair d={`M${o.x},${o.y}L${tip.x},${tip.y}`} color={FIG.ink} width={2} />
        <circle cx={tip.x} cy={tip.y} r={3.5} fill="var(--demo)" />
        <circle cx={o.x} cy={o.y} r={6} fill="var(--surface)" stroke={FIG.ink} strokeWidth={2} />
      </svg>
    );
  }
  // sessions — лист отчёта с пустой шкалой
  const o = { x: 62, y: 98 };
  return (
    <svg viewBox="0 0 132 140" width={size} height={Math.round((size * 140) / 132)} className="empty-art" aria-hidden>
      <InkLayer d="M24,10 L92,10 L110,28 L110,130 L24,130 Z" fill="var(--surface)" />
      <Hair d="M92,10 L92,28 L110,28" color={FIG.ink} width={1.5} />
      {[40, 52].map((y) => (
        <Hair key={y} d={`M36,${y}L${y === 40 ? 84 : 70},${y}`} color="var(--fig-muted)" width={2.5} />
      ))}
      <Hair d={arc(o, 30, 0, 180)} dash="0.5 3.5" width={1.4} />
      <circle cx={o.x} cy={o.y} r={3} fill={FIG.ink} />
      <Hair d={`M36,118L98,118`} color="var(--fig-muted)" width={1} dash="2 3" />
    </svg>
  );
}
