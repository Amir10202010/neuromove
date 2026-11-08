"""Сечения собранных корпусов v4 — как чертёж, в SVG: видно защёлку в пазу, колодку и провода, окно USB-C.

Запуск: python razrez_v4.py → korpus-v4-razrez-*.svg рядом с этим файлом.
"""

from __future__ import annotations

import os
import sys

from build123d import Face, Plane, Pos, Rectangle

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import korpus_v4 as k  # noqa: E402

COL = {"box": "#d9d6cf", "lid": "#bcb8af", "acc": k.ACCENT, "pcb": "#1f4fa8", "blk": "#1d1d1f", "met": "#9aa0a6", "wire": "#d63b3b", "bb": "#f5f5f5"}


def faces_on(part, plane: Plane):
    """Сечение тела плоскостью: список граней в координатах плоскости."""
    big = plane * Rectangle(400, 400)
    try:
        sec = part & big
    except Exception:
        return []
    out = []
    for f in sec.faces():
        loc = plane.to_local_coords(f)
        out.append(loc)
    return out


def svg(layers: list[tuple[object, str]], plane: Plane, window: tuple[float, float, float, float], title: str, path: str, scale: float = 14.0,
        notes: list[tuple[float, float, str]] = ()) -> None:
    x0, y0, x1, y1 = window
    W, H = (x1 - x0) * scale, (y1 - y0) * scale
    Wv = max(W, 16 + 10.5 * len(title))
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wv:.0f} {H + 60:.0f}" width="{Wv:.0f}" height="{H + 60:.0f}" '
             f'style="background:#fbfaf7;font-family:Segoe UI,system-ui,sans-serif">',
             f'<text x="16" y="30" font-size="20" font-weight="600" fill="#1d211f">{title}</text>',
             f'<g transform="translate(0,60)">']
    for part, color in layers:
        for f in faces_on(part, plane):
            for w in [f.outer_wire()] + list(f.inner_wires()):
                pts = [v for v in w.positions(_ts(w))]
                d = " ".join(f"{(p.X - x0) * scale:.1f},{(y1 - p.Y) * scale:.1f}" for p in pts)
                parts.append(f'<polygon points="{d}" fill="{color}" stroke="#444" stroke-width="0.6" fill-rule="evenodd"/>')
    for x, y, text in notes:
        parts.append(f'<text x="{(x - x0) * scale:.0f}" y="{(y1 - y) * scale:.0f}" font-size="14" fill="#1d211f">{text}</text>')
    # Масштабная линейка 5 мм
    parts.append(f'<line x1="16" y1="{H - 16:.0f}" x2="{16 + 5 * scale:.0f}" y2="{H - 16:.0f}" stroke="#1d211f" stroke-width="2"/>'
                 f'<text x="16" y="{H - 22:.0f}" font-size="12">5 мм</text>')
    parts.append("</g></svg>")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(parts))
    print(path)


def _ts(w, n: int = 160):
    return [i / n for i in range(n + 1)]


def main() -> None:
    p, hp, box, lids, hbox, hlid, hinlay = k.build(k.arg("--usb-vystup", k.Hub().usb_out))
    lid, inlay = lids["П"]
    g = k.gy521_parts(p)
    wires = k.gy521_wires(p, out=6.0)
    sensor_layers = [(box, COL["box"]), (lid, COL["lid"]), (inlay, COL["acc"]), (g["плата"], COL["pcb"]), (g["чип MPU-6050"], COL["blk"]),
                     (g["детали на плате до 1,9 мм"], "#3b6fc4"), (g["пластик штырьков"], COL["blk"]), (g["штырьки"], "#c9a227"),
                     (g["хвосты с пайкой"], "#c9a227"), (g["колодка DuPont 4 пин"], "#333")] + [(w, COL["wire"]) for w in wires]
    # 1. Поперёк датчика через защёлку (x = 0): выступы в пазах, туннель ремешка
    pl = Plane(origin=(0, 0, 0), x_dir=(0, 1, 0), z_dir=(1, 0, 0))
    svg(sensor_layers, pl, (-16, -1, 16, 19), "Датчик поперёк, через защёлку: выступ 0,8 мм в пазу 1,0 мм, внизу туннель ремешка",
        os.path.join(HERE, "korpus-v4-razrez-datchik-poperek.svg"), scale=22)
    # 2. Вдоль датчика через провод SCL (y = −3,81): колодка, хвосты, площадка, язычок крышки
    pl = Plane(origin=(0, p.wire_ys[2], 0), x_dir=(1, 0, 0), z_dir=(0, -1, 0))
    svg(sensor_layers, pl, (-27, -1, 22, 19), "Датчик вдоль, через жилу: колодка упирается в стенку, язычок прижимает жилы, хвосты в колодце",
        os.path.join(HERE, "korpus-v4-razrez-datchik-vdol.svg"), scale=18)
    # 3. ESP32: вдоль через ось USB-C
    hparts = k.hub_parts(hp)
    metal, over = k.usb_plug(hp)
    hub_layers = [(hbox, COL["box"]), (hlid, COL["lid"]), (hinlay, COL["acc"]), (hparts["макетная плата"], COL["bb"]), (hparts["плата ESP32"], COL["pcb"]),
                  (hparts["модуль ESP32"], "#c9c9c9"), (hparts["гнездо USB-C"], COL["met"]), (hparts["детали платы"], "#2c4a73"),
                  (hparts["штырьки в макетной плате"], COL["blk"]), (metal, "#7d8389"), (over, "#2b2b2d")]
    pl = Plane(origin=(0, hp.usb_yc, 0), x_dir=(1, 0, 0), z_dir=(0, -1, 0))
    svg(hub_layers, pl, (12, -1, 42, 34), "ESP32 вдоль через USB-C: гнездо в окне стенки, штекер входит до упора, карман под корпус штекера",
        os.path.join(HERE, "korpus-v4-razrez-esp32-usb.svg"), scale=20)
    # 4. Окно USB-C снаружи — вид на стенку +X
    pl = Plane(origin=(hp.cav_l / 2 + 0.65, 0, 0), x_dir=(0, 1, 0), z_dir=(1, 0, 0))
    svg([(hbox, COL["box"]), (hlid, COL["lid"]), (hparts["гнездо USB-C"], COL["met"])], pl, (-14, 10, 4, 24),
        "Окно USB-C 9,6 × 4,0 мм вокруг гнезда 8,94 × 3,26 мм (сечение по окну, вид снаружи)", os.path.join(HERE, "korpus-v4-razrez-esp32-okno.svg"), scale=30)
    # 5. ESP32 поперёк через защёлку
    pl = Plane(origin=(0, 0, 0), x_dir=(0, 1, 0), z_dir=(1, 0, 0))
    svg(hub_layers + [(j, COL["blk"]) for j in k.hub_jumpers(hp).values()], pl, (-32, -1, 32, 34),
        "ESP32 поперёк через защёлку: макетная плата, висящий край ESP32, провода «папа» в рядах a–c", os.path.join(HERE, "korpus-v4-razrez-esp32-poperek.svg"), scale=12)


if __name__ == "__main__":
    main()
