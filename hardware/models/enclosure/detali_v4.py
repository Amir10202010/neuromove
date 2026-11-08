"""Подробные модели деталей для корпусов v4 — по размерам из документации на детали, а не бруски.

GY-521: плата с отверстиями, MPU-6050 (QFN 4 × 4), стабилизатор, резисторы и конденсаторы 0603, светодиод,
восемь угловых штырьков 0,64 мм с изгибом и пайкой, колодка DuPont 4 пин с гнёздами и окошками защёлок.
ESP32 DevKit HW-394: чёрная плата, модуль ESP-32D (N4: 4 МБ флеш, без PSRAM; экран 16 × 17,6 мм, антенна-меандр), полое гнездо USB-C с язычком,
CP2102, AMS1117, кнопки EN/BOOT, светодиоды, два ряда по 15 штырьков. Макетная плата на 170 точек с сеткой дырок.
Провода — изогнутые жилы 1,3 мм; провода «папа–папа» от колодок кабелей к дыркам макетной платы; ремешок 5 см.

Твёрдые детали — тела build123d: ими же проверяется, что подробные модели не задевают корпус и крышку.
Провода, сетка дырок и ремешки — сетки trimesh, только для картинки.

Запуск: python detali_v4.py — проверка подробных моделей против корпусов.
"""

from __future__ import annotations

import math
import os
import sys

import numpy as np
import trimesh
from build123d import Align, Box, BuildSketch, Cylinder, Locations, Location, Part, Plane, Pos, Rot, SlotCenterToCenter, Text, extrude

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import korpus_v4 as k  # noqa: E402

PITCH = 2.54
GOLD, TIN, BLACK, STEEL = "#d4a72c", "#c8ccd0", "#141416", "#b9bec4"
WIRE = {"VCC": "#d7322e", "GND": "#1e1e20", "SCL": "#f2c230", "SDA": "#2e9e4a"}
ORDER = ("VCC", "GND", "SCL", "SDA")

# Элемент сцены: (тело build123d или сетка trimesh, цвет, металл 0–1, шероховатость 0–1)


def blk(x0, x1, y0, y1, z0, z1) -> Part:
    return k.block(x0, x1, y0, y1, z0, z1)


def to_mesh(obj, tol: float = 0.02) -> trimesh.Trimesh:
    if isinstance(obj, trimesh.Trimesh):
        return obj
    v, t = obj.tessellate(tol, 0.15)
    return trimesh.Trimesh(np.array([(p.X, p.Y, p.Z) for p in v]), np.array(t), process=False)


# ── Провода: трубка по сглаженной ломаной ──────────────────────────────────────────────────────


def smooth(points, n: int = 4) -> np.ndarray:
    """Сглаживание Чайкина: углы ломаной становятся дугами, концы остаются на месте."""
    p = np.asarray(points, float)
    for _ in range(n):
        q = [p[0]]
        for a, b in zip(p[:-1], p[1:]):
            q += [0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b]
        q.append(p[-1])
        p = np.array(q)
    return p


def tube(points, d: float, seg: int = 14) -> trimesh.Trimesh:
    p = np.asarray(points, float)
    t = np.gradient(p, axis=0)
    t /= np.linalg.norm(t, axis=1)[:, None] + 1e-12
    ref = np.array([0, 0, 1.0]) if abs(t[0][2]) < 0.9 else np.array([1.0, 0, 0])
    n0 = np.cross(t[0], ref)
    n0 /= np.linalg.norm(n0)
    normals = [n0]
    for i in range(1, len(p)):  # перенос рамки без скручивания
        n = normals[-1] - np.dot(normals[-1], t[i]) * t[i]
        normals.append(n / (np.linalg.norm(n) + 1e-12))
    verts, faces = [], []
    ang = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    for i, (c, ti, ni) in enumerate(zip(p, t, normals)):
        bi = np.cross(ti, ni)
        for a in ang:
            verts.append(c + d / 2 * (math.cos(a) * ni + math.sin(a) * bi))
    for i in range(len(p) - 1):
        for j in range(seg):
            a, b = i * seg + j, i * seg + (j + 1) % seg
            c, e = a + seg, b + seg
            faces += [[a, b, e], [a, e, c]]
    cap0, cap1 = len(verts), len(verts) + 1
    verts += [p[0], p[-1]]
    last = (len(p) - 1) * seg
    for j in range(seg):
        faces.append([cap0, (j + 1) % seg, j])
        faces.append([cap1, last + j, last + (j + 1) % seg])
    return trimesh.Trimesh(np.array(verts), np.array(faces), process=False)


def band(path_yz, x_width: float, thick: float, x0: float = 0.0) -> trimesh.Trimesh:
    """Ремешок: лента шириной x_width вдоль X, идёт по кривой в плоскости YZ."""
    p = smooth(path_yz, 4)
    t = np.gradient(p, axis=0)
    t /= np.linalg.norm(t, axis=1)[:, None]
    nrm = np.stack([-t[:, 1], t[:, 0]], axis=1)  # нормаль в плоскости YZ
    verts = []
    for (y, z), (ny, nz) in zip(p, nrm):
        for sx in (-1, 1):
            for sn in (-1, 1):
                verts.append((x0 + sx * x_width / 2, y + sn * ny * thick / 2, z + sn * nz * thick / 2))
    faces = []
    quad = [(0, 1, 3, 2), (2, 3, 1, 0)]
    for i in range(len(p) - 1):
        a, b = 4 * i, 4 * (i + 1)
        for u, v in ((0, 1), (1, 3), (3, 2), (2, 0)):
            faces += [[a + u, a + v, b + v], [a + u, b + v, b + u]]
    n = len(p) - 1
    faces += [[0, 2, 3], [0, 3, 1], [4 * n, 4 * n + 1, 4 * n + 3], [4 * n, 4 * n + 3, 4 * n + 2]]
    m = trimesh.Trimesh(np.array(verts), np.array(faces), process=False)
    m.fix_normals()
    return m


# ── GY-521 ─────────────────────────────────────────────────────────────────────────────────────


def gy521(p: k.Sensor, g: k.Gy521 = k.Gy521()) -> tuple[dict[str, Part], list]:
    x_e, x_far = p.x_edge(g.board_l), p.x_far
    bz, top = p.ped_top, p.ped_top + p.board_t
    pz = top + g.pin_z
    hw = g.board_w / 2
    xs = x_e - g.plastic_off
    xh = x_e + 1.27  # ряд отверстий выводов
    pin_ys = [(i - 3.5) * PITCH for i in range(8)]
    pcb = blk(x_e, x_far, -hw, hw, bz, top)
    for y in (-(hw - 2.6), hw - 2.6):
        pcb = pcb - Pos(x_far - 2.6, y, bz + 0.8) * Cylinder(1.5, 2.0)
    for y in pin_ys:
        pcb = pcb - Pos(xh, y, bz + 0.8) * Cylinder(0.5, 2.0)
    pads = None
    for y in pin_ys:
        for z in (top + 0.02, bz - 0.02):
            pd = Pos(xh, y, z) * Cylinder(0.85, 0.04)
            pads = pd if pads is None else pads + pd
    for y in (-(hw - 2.6), hw - 2.6):
        pads = pads + Pos(x_far - 2.6, y, top + 0.02) * (Cylinder(2.3, 0.04) - Cylinder(1.5, 0.1))
    cx = x_far - g.board_l / 2 + 0.6
    chip = blk(cx - 2, cx + 2, -2, 2, top, top + 0.9)
    smd_caps, smd_res, leads = None, None, None
    for (x, y, rot) in ((x_e + 5.2, -5.5, 0), (x_e + 5.2, -2.6, 0), (cx + 3.6, 3.2, 90), (cx - 3.6, -3.2, 90), (x_far - 4.8, 6.0, 0)):
        c = Pos(x, y, top + 0.4) * Rot(0, 0, rot) * Box(1.6, 0.8, 0.8)
        smd_caps = c if smd_caps is None else smd_caps + c
    for (x, y, rot) in ((x_e + 5.2, 2.6, 0), (x_e + 5.2, 5.5, 0), (x_far - 4.8, -6.0, 0), (x_far - 4.8, 3.4, 0)):
        c = Pos(x, y, top + 0.25) * Rot(0, 0, rot) * Box(1.6, 0.8, 0.5)
        smd_res = c if smd_res is None else smd_res + c
    reg = blk(x_e + 7.0, x_e + 8.6, 6.0, 8.9, top, top + 1.1)
    for dy in (-0.95, 0, 0.95):
        ld = blk(x_e + 6.6, x_e + 7.0, 7.45 + dy - 0.2, 7.45 + dy + 0.2, top, top + 0.15)
        leads = ld if leads is None else leads + ld
    led = blk(x_far - 3.2, x_far - 2.4, -1.0, 0.6, top, top + 0.6)
    plastic = blk(xs, xs + p.plastic_d, -4 * PITCH, 4 * PITCH, top, top + p.plastic)
    pins = None
    for y in pin_ys:
        horiz = blk(xs - 6.0 + 0.3, xh + 0.32, y - 0.32, y + 0.32, pz - 0.32, pz + 0.32)
        tip = Pos(xs - 6.0 + 0.3, y, pz) * Rot(0, 90, 0) * Cylinder(0.32, 0.6)
        leg = blk(xh - 0.32, xh + 0.32, y - 0.32, y + 0.32, bz - g.tail + 0.5, pz + 0.32)
        pn = horiz + leg + tip
        pins = pn if pins is None else pins + pn
    solder = None
    for y in pin_ys:
        s = Pos(xh, y, bz - 0.5) * Cylinder(0.85, 1.0) + Pos(xh, y, top + 0.25) * Cylinder(0.7, 0.5)
        solder = s if solder is None else solder + s
    # Колодка DuPont 4 пин на штырьках VCC GND SCL SDA
    hx1, hx0 = xs, xs - p.housing_len
    y0 = 0.0  # колодка на VCC GND SCL SDA — со стороны +Y
    housing = blk(hx0, hx1, y0 + 0.03, y0 + 4 * PITCH - 0.03, pz - g.housing_h / 2, pz + g.housing_h / 2)
    latches = None
    for i in range(4):
        y = pin_ys[7 - i]
        housing = housing - blk(hx1 - 6.4, hx1 + 0.1, y - 0.55, y + 0.55, pz - 0.55, pz + 0.55)
        housing = housing - blk(hx0 + 3.0, hx0 + 6.0, y - 0.6, y + 0.6, pz + g.housing_h / 2 - 0.35, pz + g.housing_h / 2 + 0.1)
        lt = blk(hx0 + 3.2, hx0 + 5.8, y - 0.45, y + 0.45, pz + g.housing_h / 2 - 0.36, pz + g.housing_h / 2 - 0.25)
        latches = lt if latches is None else latches + lt
    solids = {"плата GY-521": pcb, "MPU-6050": chip, "конденсаторы": smd_caps, "резисторы": smd_res, "стабилизатор": reg,
              "светодиод": led, "пластик штырьков": plastic, "штырьки": pins, "пайка": solder, "колодка DuPont": housing}
    look = [(pcb, "#1d56b8", 0.0, 0.45), (pads, GOLD, 0.9, 0.3), (chip, "#1a1a1c", 0.0, 0.5), (smd_caps, "#b8935e", 0.0, 0.6),
            (smd_res, "#202022", 0.0, 0.5), (reg, "#1a1a1c", 0.0, 0.5), (leads, TIN, 0.9, 0.3), (led, "#f2f0e0", 0.0, 0.2),
            (plastic, BLACK, 0.0, 0.6), (pins, GOLD, 0.9, 0.25), (solder, TIN, 0.9, 0.25), (housing, "#18181a", 0.0, 0.55),
            (latches, STEEL, 0.9, 0.3)]
    return solids, look


def gy521_cable(p: k.Sensor, g: k.Gy521 = k.Gy521(), drop: float = 26.0) -> list:
    """Четыре жилы: из колодки через паз торца −X, снаружи сходятся в плоскую ленту и уходят вниз-вбок."""
    xs = p.x_edge(g.board_l) - g.plastic_off
    x0 = xs - p.housing_len
    pz = p.board_top + g.pin_z
    xw = -p.length / 2
    out = []
    for i, name in enumerate(ORDER):
        y = (3.5 - i) * PITCH
        yr = p.cable_y + (i - 1.5) * 1.32
        pts = [(x0 + 0.5, y, pz), (x0 - 1.0, y, pz), (xw + 1.0, y + 0.3 * (yr - y), pz), (xw - 3.0, yr, pz),
               (xw - 9.0, yr, pz - 1.0), (xw - 16.0, yr - 3.0, pz - 7.0), (xw - 20.0, yr - 6.0, pz - drop)]
        out.append((tube(smooth(pts), 1.3), WIRE[name], 0.0, 0.55))
    return out


def sensor_strap(p: k.Sensor, r: float = 42.0) -> trimesh.Trimesh:
    """Ремешок 5 см сквозь туннель и вокруг руки (радиус r)."""
    zc = p.bottom + p.tunnel_h / 2
    half = p.width / 2
    pts = []
    for s in (-1, 1):
        side = [(s * (half + r * math.sin(t)), zc - r * (1 - math.cos(t))) for t in np.linspace(0, 1.25, 14)]
        pts = side[::-1] + pts if s < 0 else pts + side
    pts = [q for q in pts]
    mid = [(y, zc) for y in np.linspace(-half, half, 6)]
    path = pts[:14] + mid + pts[14:]
    return band(path, p.strap - 0.6, 1.8)


# ── ESP32 DevKit на макетной плате ─────────────────────────────────────────────────────────────


def esp32(h: k.Hub) -> tuple[dict[str, Part], list]:
    xu = h.x_usb_end
    xa = xu - h.pcb[0]
    py0, py1 = h.pcb_y
    yc = h.pcb_yc
    pz, top = h.pcb_z, h.pcb_top
    col = h.col_x[:15]
    y_e = h.row_y[h.row_e]
    y_h = py0 + h.pin_row_off
    pcb = blk(xa, xu, py0, py1, pz, top)
    for x in col:
        for y in (y_e, y_h):
            pcb = pcb - Pos(x, y, pz + 0.8) * Cylinder(0.5, 2.0)
    for x, y in ((xa + 2.0, py0 + 2.0), (xa + 2.0, py1 - 2.0), (xu - 2.0, py0 + 2.0), (xu - 2.0, py1 - 2.0)):
        pcb = pcb - Pos(x, y, pz + 0.8) * Cylinder(0.9, 2.0)
    # Модуль ESP-32D (того же размера, что WROOM-32): плата 25,5 × 18 × 0,8, экран 17,6 × 16 × 2,4, антенна у торца
    mt = top + 0.8
    mod_pcb = blk(xa, xa + 25.5, yc - 9.0, yc + 9.0, top, mt)
    can = blk(xa + 7.2, xa + 24.8, yc - 8.0, yc + 8.0, mt, mt + 2.4)
    with BuildSketch(Plane.XY.offset(mt + 2.4 - 0.05)) as sk:
        with Locations(Location((xa + 16.0, yc), 90)):
            Text("ESP-32D", font_size=2.2, font_path=k.FONT, align=(Align.CENTER, Align.CENTER))
    label = extrude(sk.sketch, amount=0.1)
    ant = None
    zz = [(yc - 7.5 + i * 1.5) for i in range(11)]
    for i, y in enumerate(zz):
        seg = blk(xa + 1.0, xa + 5.6, y - 0.25, y + 0.25, mt, mt + 0.03)
        ant = seg if ant is None else ant + seg
        if i < len(zz) - 1:
            x = xa + 5.6 if i % 2 == 0 else xa + 1.0
            ant = ant + blk(x - 0.25, x + 0.25, y, y + 1.5, mt, mt + 0.03)
    castell = None
    for i in range(18):
        x = xa + 7.5 + i * 1.0
        for y in (yc - 9.0, yc + 9.0):
            c = blk(x - 0.3, x + 0.3, y - 0.35, y + 0.35, top, mt + 0.02)
            castell = c if castell is None else castell + c
    # Гнездо USB-C: овальный стакан с полостью и язычком
    ul, uw, uh = h.usb
    x1 = xu + h.usb_out
    with BuildSketch(Plane.YZ.offset(x1 - ul)) as sk:
        with Locations((h.usb_yc, h.usb_zc)):
            SlotCenterToCenter(uw - uh, uh)
    shell = extrude(sk.sketch, amount=ul)
    with BuildSketch(Plane.YZ.offset(x1 - 6.2)) as sk:
        with Locations((h.usb_yc, h.usb_zc)):
            SlotCenterToCenter(uw - 0.6 - (uh - 0.6), uh - 0.6)
    shell = shell - extrude(sk.sketch, amount=6.3)
    tongue = blk(x1 - 6.2, x1 - 0.8, h.usb_yc - 3.3, h.usb_yc + 3.3, h.usb_zc - 0.35, h.usb_zc + 0.35)
    contacts = None
    for i in range(12):
        y = h.usb_yc - 2.75 + i * 0.5
        c = blk(x1 - 4.6, x1 - 1.0, y - 0.12, y + 0.12, h.usb_zc + 0.35, h.usb_zc + 0.38)
        contacts = c if contacts is None else contacts + c
    # Микросхемы, кнопки, светодиоды
    cp = blk(xu - 17.0, xu - 12.0, yc - 6.5, yc - 1.5, top, top + 0.9)
    ams = blk(xu - 24.0, xu - 17.5, yc + 2.0, yc + 5.5, top, top + 1.6) + blk(xu - 23.0, xu - 18.5, yc + 5.5, yc + 7.0, top, top + 0.2)
    buttons, caps = None, None
    for y in (py0 + 3.0, py1 - 3.0):
        b = blk(xu - 6.3, xu - 2.3, y - 1.75, y + 1.75, top, top + 1.5)
        s = Pos(xu - 4.3, y, top + 1.5 + 0.3) * Cylinder(0.8, 0.6)
        buttons = b if buttons is None else buttons + b
        caps = s if caps is None else caps + s
    leds = blk(xu - 9.5, xu - 8.7, py1 - 4.0, py1 - 3.2, top, top + 0.6) + blk(xu - 9.5, xu - 8.7, py0 + 3.2, py0 + 4.0, top, top + 0.6)
    passives = None
    for x, y in ((xu - 11.0, yc + 1.0), (xu - 11.0, yc + 3.0), (xu - 20.0, yc - 5.0), (xu - 26.5, yc - 3.0), (xu - 26.5, yc + 4.0), (xu - 14.5, yc + 4.0)):
        c = blk(x - 0.8, x + 0.8, y - 0.4, y + 0.4, top, top + 0.7)
        passives = c if passives is None else passives + c
    # Штырьки: пластик под платой, по 15 штырьков в ряду
    header = blk(col[0] - 1.27, col[-1] + 1.27, y_e - 1.27, y_e + 1.27, pz - h.header, pz) + \
        blk(col[0] - 1.27, col[-1] + 1.27, y_h - 1.27, y_h + 1.27, pz - h.header, pz)
    pins, solder = None, None
    for x in col:
        for y, low in ((y_e, h.bb_top - 5.0), (y_h, pz - h.header - 6.0)):
            pn = blk(x - 0.32, x + 0.32, y - 0.32, y + 0.32, low, top + 1.4)
            pins = pn if pins is None else pins + pn
            s = Pos(x, y, top + 0.3) * Cylinder(0.85, 0.6)
            solder = s if solder is None else solder + s
    solids = {"плата ESP32": pcb, "модуль ESP-32D": mod_pcb + can, "гнездо USB-C": shell + tongue, "CP2102": cp, "AMS1117": ams,
              "кнопки EN и BOOT": buttons + caps, "светодиоды": leds, "мелкие детали": passives, "пластик штырьков": header, "штырьки ESP32": pins}
    look = [(pcb, "#18181b", 0.0, 0.5), (mod_pcb, "#13336e", 0.0, 0.45), (can, STEEL, 0.95, 0.28), (label, "#7d838a", 0.6, 0.5),
            (ant, GOLD, 0.9, 0.3), (castell, GOLD, 0.9, 0.3), (shell, STEEL, 0.95, 0.25), (tongue, "#141414", 0.0, 0.5),
            (contacts, GOLD, 0.9, 0.3), (cp, "#1a1a1c", 0.0, 0.5), (ams, "#1a1a1c", 0.0, 0.5), (buttons, STEEL, 0.9, 0.3),
            (caps, "#222", 0.0, 0.6), (leds, "#ff4b3e", 0.0, 0.2), (passives, "#b8935e", 0.0, 0.6), (header, BLACK, 0.0, 0.6),
            (pins, GOLD, 0.9, 0.25), (solder, TIN, 0.9, 0.25)]
    return solids, look


def breadboard(h: k.Hub) -> tuple[Part, trimesh.Trimesh]:
    bx0, bx1 = h.bb_x
    by0, by1 = h.bb_y
    body = blk(bx0, bx1, by0, by1, h.floor_t, h.bb_top)
    holes = []
    rows = list(h.row_y) + [h.row_y[4] - 7.62 - i * PITCH for i in range(5)]
    for x in h.col_x:
        for y in rows:
            holes.append(trimesh.creation.box((1.0, 1.0, 0.04), trimesh.transformations.translation_matrix((x, y, h.bb_top + 0.015))))
    trench = trimesh.creation.box((bx1 - bx0 - 3.0, 1.6, 0.04), trimesh.transformations.translation_matrix(((bx0 + bx1) / 2, h.row_y[4] - 3.81, h.bb_top + 0.015)))
    return body, trimesh.util.concatenate(holes + [trench])


# Провода «папа–папа»: (кабель, жила) → (столбец, ряд) на макетной плате — как JUMPERS в korpus_v4
ROUTE = {(n.split()[1], n.split()[0]): (c, r) for c, r, n in k.JUMPERS}


WIRE_LEN = 100.0  # провод «папа–папа» 10 см; на деле бывает чуть короче — тогда петля меньше


def _plen(pts) -> float:
    p = np.asarray(pts, float)
    return float(np.sum(np.linalg.norm(np.diff(p, axis=0), axis=1)))


def wire_route(h: k.Hub, ys: float, yl: float, zl: float, zo: float, yv: float, xv: float, z_h: float, length: float = WIRE_LEN) -> tuple[list, int]:
    """Жила «папа–папа» длиной ровно length, без петель: из провода «папа» в колодке на полке — дугой к стороне
    висящего края ESP32 (на сколько нужно, чтобы длина сошлась), вдоль неё к концу с USB-C, по торцу к стенке −Y,
    обратно над рядами a–c макетной платы по своей дорожке (yl, zl) и вниз в свой провод «папа»."""
    xs = -h.cav_l / 2 + 0.6 + 27.5  # конец провода «папа», вставленного в колодку
    x_max = h.cav_l / 2 - 3.2
    sgn = 1.0 if yl > 0 else -1.0  # ряды a–c — со стороны sgn; дуга — к висящему краю, с другой стороны
    y_max = -sgn * (h.cav_w / 2 - 3.0)
    top = h.jumper_top

    def build(x_t: float, y_b: float) -> list:
        return [(xs - 0.5, ys, z_h), (xs + 1.0, ys, z_h), (xs + 4.0, y_b, zo), (x_t - 3.0, y_b, zo), (x_t, y_b + sgn * 3.0, zo),
                (x_t, yl - sgn * 3.0, (zo + zl) / 2), (x_t - 3.0, yl, zl), (xv, yl, zl), (xv, yv, top + 1.6), (xv, yv, top + 0.3)]

    if _plen(build(x_max, ys)) >= length:
        lo, hi = max(xs, xv) + 7.0, x_max
        for _ in range(40):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if _plen(build(mid, ys)) < length else (lo, mid)
        return build(hi, ys), 0
    lo, hi = ys, y_max
    if _plen(build(x_max, y_max)) < length:
        return build(x_max, y_max), 1  # длиннее любого ровного пути: такой провод нужен короче
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if _plen(build(x_max, mid)) < length else (lo, mid)
    return build(x_max, hi), 0


def hub_wiring(h: k.Hub) -> tuple[dict[str, Part], list]:
    """Колодки кабелей «мама» лежат на полке у стенки −X (их приматывают изолентой); в них — провода «папа»,
    вторые концы — в дырках макетной платы. Провода «папа–папа» по 10 см не приматываются: лежат жгутом над ESP32."""
    zc = h.chan_bot + h.wire_d / 2 + 0.02
    x_in = -h.cav_l / 2 + 0.6
    housings, males_h, males_v, tips = None, None, None, None
    look, routes, wires = [], {}, []
    for cable, yc in zip(("П", "ПР", "Г"), h.chan_ys):
        hs = blk(x_in, x_in + 14.0, yc - 2 * PITCH + 0.03, yc + 2 * PITCH - 0.03, zc - 1.27, zc + 1.27)
        housings = hs if housings is None else housings + hs
        for i, name in enumerate(ORDER):
            y = yc + (i - 1.5) * PITCH
            mh = blk(x_in + 14.0, x_in + 27.5, y - 1.24, y + 1.24, zc - 1.24, zc + 1.24)
            males_h = mh if males_h is None else males_h + mh
            c, r = ROUTE[(cable, name)]
            xv, yv = h.col_x[c - 1], h.row_y[r]
            mv = blk(xv - 1.24, xv + 1.24, yv - 1.24, yv + 1.24, h.bb_top, h.jumper_top)
            males_v = mv if males_v is None else males_v + mv
            tp = blk(xv - 0.32, xv + 0.32, yv - 0.32, yv + 0.32, h.bb_top - 3.0, h.bb_top)
            tips = tp if tips is None else tips + tp
            wires.append((xv, y, yv, name, cable))
    # Обратные дорожки над рядами a–c, в два слоя: ближе к краю макетной платы — к дальним (по X) проводам
    sgn = 1.0 if h.row_y[0] > 0 else -1.0
    y_in, y_out = h.row_y[2] - sgn * 1.6, h.row_y[0] + sgn * 1.6
    wires.sort(key=lambda w: -w[0])
    for k_, (xv, y, yv, name, cable) in enumerate(wires):
        yl = y_in + (y_out - y_in) * (k_ // 2) / max(1, (len(wires) - 1) // 2)
        zl = h.jumper_top + 1.8 + (k_ % 2) * 1.45
        zo = zc + (k_ % 2) * 1.3  # туда — в два слоя, жилы не ложатся друг на друга
        pts, folds = wire_route(h, y, yl, zl, zo, yv, xv, zc)
        routes[f"{name} {cable}"] = (pts, folds)
        look.append((tube(smooth(pts, 3), 1.3), WIRE[name], 0.0, 0.55))
    look += [(housings, "#18181a", 0.0, 0.55), (males_h, "#232326", 0.0, 0.55), (males_v, "#232326", 0.0, 0.55), (tips, GOLD, 0.9, 0.3)]
    hub_wiring.routes = routes
    return {"колодки кабелей": housings, "провода «папа» в колодках": males_h, "провода «папа» в макетной плате": males_v}, look


def tape(h: k.Hub) -> trimesh.Trimesh:
    """Изолента поперёк колодок кабелей «мама» и полки — только они приматываются."""
    zc = h.chan_bot + h.wire_d / 2 + 0.02
    x = -h.cav_l / 2 + 7.5
    top = zc + 1.27 + 0.15
    y0, y1 = -h.cav_w / 2 + 1.0, h.cav_w / 2 - 1.0
    ys = np.linspace(y0, y1, 40)
    span = (h.chan_ys[0] - 2 * PITCH, h.chan_ys[-1] + 2 * PITCH)
    pts = [(y, top if span[0] <= y <= span[1] else h.shelf_top + 0.15) for y in ys]
    m = band(pts, 6.0, 0.25)
    m.apply_transform(trimesh.transformations.translation_matrix((x, 0, 0)))
    return m


def hub_ribbons(h: k.Hub, out: float = 34.0) -> list:
    zc = h.chan_bot + h.wire_d / 2 + 0.02
    x_in = -h.cav_l / 2 + 0.6
    xw = -h.length / 2
    look = []
    for yc in h.chan_ys:
        for i, name in enumerate(ORDER):
            y = yc + (i - 1.5) * PITCH
            yr = yc + (i - 1.5) * 1.32
            pts = [(x_in + 0.5, y, zc), (x_in - 0.5, y, zc), (xw + 0.8, yr, zc), (xw - 4.0, yr, zc), (xw - 12.0, yr, zc + 2.0),
                   (xw - out, yr * 1.2, zc + 9.0)]
            look.append((tube(smooth(pts), 1.3), WIRE[name], 0.0, 0.55))
    return look


def usb_cable(h: k.Hub) -> list:
    metal, over = k.usb_plug(h)
    x0 = h.x_usb_end + h.usb_out + 20.0
    pts = [(x0 - 1.0, h.usb_yc, h.usb_zc), (x0 + 6.0, h.usb_yc, h.usb_zc), (x0 + 14.0, h.usb_yc, h.usb_zc - 6.0), (x0 + 16.0, h.usb_yc, h.usb_zc - 26.0)]
    boot = Pos(x0 + 2.5, h.usb_yc, h.usb_zc) * Rot(0, 90, 0) * Cylinder(2.6, 5.0)
    return [(metal, STEEL, 0.95, 0.25), (over, "#2a2a2c", 0.0, 0.5), (boot, "#2a2a2c", 0.0, 0.5), (tube(smooth(pts), 3.6), "#2a2a2c", 0.0, 0.6)]


def hub_belt(h: k.Hub) -> trimesh.Trimesh:
    """Ремень 5 см: под плитой, вверх сквозь прорезь, через наружную планку и наружу."""
    pt = h.plate[2]
    s0, s1 = h.slot_y - h.slot[1] / 2, h.slot_y + h.slot[1] / 2
    edge = h.plate[1] / 2
    half = [(-1.2, 0.0), (s0 + 0.4, -1.1), (h.slot_y, pt * 0.5), (s1, pt + 0.95), (edge - 0.3, pt + 0.95), (edge + 2.0, -0.5), (edge + 25.0, -1.4)]
    path = [(-y, z) for y, z in half[::-1]] + half
    return band(path, 48.0, 1.9)


# ── Проверка: подробные модели против корпусов ─────────────────────────────────────────────────


def main() -> int:
    p, hp, box, lids, hbox, hlid, hinlay = k.build(k.arg("--usb-vystup", k.Hub().usb_out))
    r = k.Report("Подробные модели деталей против корпусов v4")
    for vname, g in (("номинал 20 × 15", k.Gy521()), ("плата 15,4 × 20,4, пластик за краем 1,5 мм", k.Gy521(board_l=15.4, board_w=20.4, plastic_off=1.5)),
                     ("плата 14,6 × 19,6, хвосты 1,5", k.Gy521(board_l=14.6, board_w=19.6, plastic_off=0.5, tail=1.5))):
        solids, _ = gy521(p, g)
        bad = [n for n, s in solids.items() if k.ov(s, box) > 1e-3 or any(k.ov(s, l) > 1e-3 for l, _ in lids.values())]
        r.check(not bad, f"GY-521 ({vname}): штырьки, пайка, детали, колодка не задевают корпус и крышки" + (f" — {bad}" if bad else ""))
    solids, _ = esp32(hp)
    bad = [n for n, s in solids.items() if k.ov(s, hbox) > 1e-3 or (n != "плата ESP32" and k.ov(s, hlid) > 1e-3)]
    r.check(not bad, "ESP32 DevKit: модуль, гнездо USB-C, кнопки, микросхемы, штырьки не задевают корпус и крышку" + (f" — {bad}" if bad else ""))
    bbody, _ = breadboard(hp)
    r.check(k.ov(bbody, hbox) < 1e-3, "макетная плата на месте")
    wiring, _ = hub_wiring(hp)
    for n, s in wiring.items():
        hits = [m for m, o in (("корпус", hbox), ("крышку", hlid)) if k.ov(s, o) > 1e-3]
        hits += [m for m, o in solids.items() if m != "плата ESP32" and k.ov(s, o) > 1e-3]
        r.check(not hits, f"{n} не задевают корпус, крышку и ESP32" + (f" — задевают {hits}" if hits else ""))
    r.check(k.ov(wiring["провода «папа» в колодках"], wiring["провода «папа» в макетной плате"]) < 1e-3,
            "провода «папа» в колодках и в макетной плате не упираются друг в друга")
    routes = hub_wiring.routes
    fit = [n for n, (pts, f) in routes.items() if f == 0 and abs(_plen(pts) - WIRE_LEN) <= 1.0]
    short = {n: _plen(pts) for n, (pts, f) in routes.items() if f == 1}
    r.check(len(fit) + len(short) == 12 and all(v <= WIRE_LEN for v in short.values()),
            f"{len(fit)} из 12 проводов «папа–папа» ложатся ровным жгутом ровно на {WIRE_LEN / 10:.0f} см")
    if short:
        r.note("короче нужны (3V3 и GND — у самого USB-C): " + ", ".join(f"{n} — {v / 10:.1f} см" for n, v in sorted(short.items())))
    out_pts = []
    z_min = hp.pcb_top + 3.2 + 0.6  # над модулем ESP32
    for n, (pts, _) in routes.items():
        for x, y, z in pts[1:-2]:
            if not (-hp.cav_l / 2 + 0.7 <= x <= hp.cav_l / 2 - 0.7 and -hp.cav_w / 2 + 0.7 <= y <= hp.cav_w / 2 - 0.7
                    and z_min <= z <= hp.height - 0.8 and (abs(y) < 18.3 or z < 30.3)):
                out_pts.append(n)
                break
    r.check(not out_pts, "жилы не выходят за стенки, не задевают бортик крышки и лежат над ESP32" + (f": {out_pts}" if out_pts else ""))
    folds = sorted({f for _, f in routes.values()})
    zmax = max(z for pts, _ in routes.values() for _, _, z in pts)
    r.note(f"верх проводов {zmax:.1f} мм, под крышкой {hp.height:.0f} мм; петель нет ни у одной жилы")
    ok = r.print()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
