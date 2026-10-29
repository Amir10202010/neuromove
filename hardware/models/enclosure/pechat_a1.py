"""Столы печати корпусов v3 для Bambu Lab A1 (27 октября 2026): готовые 3MF, Bambu Studio открывает их сразу.

Три стола, в порядке печати:
  A1-1-proba.3mf    — корпус датчика и крышка «П»: проба посадки, ~8 г
  A1-2-datchiki.3mf — ещё два корпуса датчика и крышки «ПР», «Г»
  A1-3-esp32.3mf    — корпус ESP32 и его крышка

Детали берутся из STL рядом (их пишет korpus_v3.py) уже в положении для печати: корпус — дном на столе,
крышка — надписью на столе. Здесь они только раскладываются по столу A1 (256 × 256 мм) с зазором
и проверяются: каждая на столе, внутри стола, не задевает соседей.

Запуск: pip install trimesh networkx lxml, потом python3 pechat_a1.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__))
BED = 256.0  # стол A1, мм
GAP = 12.0  # между деталями: сопло A1 обходит их без задевания, и деталь легко снять

PLATES = {
    "A1-1-proba.3mf": ["korpus-v3-datchik-korpus.stl", "korpus-v3-datchik-kryshka-P.stl"],
    "A1-2-datchiki.3mf": ["korpus-v3-datchik-korpus.stl", "korpus-v3-datchik-korpus.stl",
                          "korpus-v3-datchik-kryshka-PR.stl", "korpus-v3-datchik-kryshka-G.stl"],
    "A1-3-esp32.3mf": ["korpus-v3-esp32-korpus.stl", "korpus-v3-esp32-kryshka.stl"],
}


def layout(meshes: list[trimesh.Trimesh]) -> list[trimesh.Trimesh]:
    """Ряд по X, по центру стола; не влезло в ряд — следующий ряд."""
    placed, rows, row, width = [], [], [], 0.0
    for m in meshes:
        w = m.extents[0]
        if row and width + GAP + w > BED - 2 * GAP:
            rows.append((row, width))
            row, width = [], 0.0
        width += (GAP if row else 0.0) + w
        row.append(m)
    rows.append((row, width))
    depth = sum(max(m.extents[1] for m in r) for r, _ in rows) + GAP * (len(rows) - 1)
    y = BED / 2 + depth / 2
    for r, w in rows:
        h = max(m.extents[1] for m in r)
        x = BED / 2 - w / 2
        for m in r:
            mm = m.copy()
            lo = mm.bounds[0]
            mm.apply_translation([x - lo[0], (y - h / 2) - (lo[1] + mm.extents[1] / 2), -lo[2]])
            placed.append(mm)
            x += m.extents[0] + GAP
        y -= h + GAP
    return placed


def check(name: str, parts: list[trimesh.Trimesh], files: list[str]) -> bool:
    ok = True
    for p, f in zip(parts, files):
        lo, hi = p.bounds
        inside = lo[0] >= 0 and lo[1] >= 0 and hi[0] <= BED and hi[1] <= BED
        on_bed = abs(lo[2]) < 1e-6
        ok &= inside and on_bed and p.is_watertight
        print(f"  {'✓' if inside and on_bed and p.is_watertight else '✗'} {f}: {p.extents[0]:.1f} × {p.extents[1]:.1f} × {p.extents[2]:.1f} мм, "
              f"x {lo[0]:.0f}–{hi[0]:.0f}, y {lo[1]:.0f}–{hi[1]:.0f}, {p.volume / 1000:.2f} см³")
    # Соседи не задевают друг друга: прямоугольники на столе с зазором
    for i in range(len(parts)):
        for j in range(i + 1, len(parts)):
            a, b = parts[i].bounds, parts[j].bounds
            apart = a[1][0] + GAP / 2 <= b[0][0] or b[1][0] + GAP / 2 <= a[0][0] or a[1][1] + GAP / 2 <= b[0][1] or b[1][1] + GAP / 2 <= a[0][1]
            if not apart:
                print(f"  ✗ {files[i]} и {files[j]} ближе {GAP / 2:.0f} мм")
                ok = False
    return ok


def main() -> int:
    ok = True
    for name, files in PLATES.items():
        meshes = [trimesh.load_mesh(os.path.join(HERE, f)) for f in files]
        parts = layout(meshes)
        print(f"\n{name}: {len(parts)} деталей, всего {sum(p.volume for p in parts) / 1000:.1f} см³")
        ok &= check(name, parts, files)
        scene = trimesh.Scene()
        for k, (p, f) in enumerate(zip(parts, files)):
            scene.add_geometry(p, node_name=f"{k + 1}-{os.path.splitext(f)[0]}", geom_name=f"{k + 1}-{os.path.splitext(f)[0]}")
        path = os.path.join(HERE, name)
        scene.export(path, file_type="3mf")
        # Перечитать то, что записали: столько же деталей и тот же объём
        back = trimesh.load(path, force="scene")
        vol_in = sum(p.volume for p in parts)
        vol_out = sum(g.volume for g in back.dump())
        same = len(back.geometry) == len(parts) and abs(vol_in - vol_out) < 1e-3 * vol_in
        print(f"  {'✓' if same else '✗'} 3MF перечитан: {len(back.geometry)} деталей, {vol_out / 1000:.1f} см³")
        ok &= same
    print("\nВсе столы в порядке" if ok else "\nЕсть ошибки — не печатать")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
