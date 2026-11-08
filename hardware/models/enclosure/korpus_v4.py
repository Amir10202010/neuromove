"""Корпуса NeuroMove, версия 4 (8 ноября 2026): защёлка по образцу сокомандника, датчик-«галька», ESP32 с точным USB-C.

Почему четвёртая версия (что показала печать v3):
  • крышки датчика и ESP32 не держались. Сокомандник поправил корпус ESP32 в Fusion
    (korpus-v3-esp32-*.step, 3 ноября), и его крышка защёлкивается чётко. Разбор его файлов против v3
    (сравнение тел, срезы — раздел «Что поменял сокомандник» в ПЕЧАТЬ-v4.md):
      – паз защёлки в стенке корпуса углублён с 0,5 до 1,0 мм;
      – выступ на балке крышки выходит за бортик на 0,75 мм вместо 0,55: натяг 0,5 мм вместо 0,3;
      – бортик крышки отодвинут от стенки −Y и от торцов ещё на 0,1 мм: зазор 0,35 вместо 0,25;
      – ушки с прорезями заменены сплошной плитой 66,4 × 61,1 × 3 мм, прорези ремня 50,5 мм;
      – дверца проводов утоплена на 0,2 мм, штыри крышки короче на 0,1 мм.
    Здесь это стало параметрами защёлки Snap и применено к обоим корпусам;
  • датчик со штырьками и проводами не помещался по высоте: площадка под платой требовала, чтобы хвосты
    выводов точно попали в узкую канавку, а над гнёздами оставалось 0,3 мм. Теперь под хвостами — открытый
    колодец на всю ширину (хвосты до 3,5 мм, где бы ни стояли), над колодкой провода 1,5 мм воздуха;
  • вырез USB-C был 13 мм шириной и открыт до верха. Теперь — овальное окно 9,6 × 4,0 мм ровно напротив
    разъёма (сам разъём 8,94 × 3,26), снаружи — неглубокий карман под корпус штекера.

Дизайн — как у лендинга: белый матовый корпус-галька, крупные скругления, знак «nm» на крышке, точка знака и
короткая черта — киноварь #b7452c (отдельной деталью-вкладышем: на AMS печатается вторым цветом, без AMS
остаётся аккуратной выемкой). Ремешок датчика проходит под ним сквозь скрытый туннель, как на референсе.

Запуск (Python с build123d — на этом компьютере в ~/.cache/neuromove-cad-venv):
    python korpus_v4.py                 — модели, проверки, STL рядом с этим файлом
    python korpus_v4.py --usb-vystup 1.4 — насколько USB-C выступает за край платы ESP32, мм (по умолчанию 1.0)
    python korpus_v4.py --step          — то же и STEP для правки в Fusion
    python korpus_v4.py --3mf           — то же и столы печати в print-ready/

Оси: X — вдоль кости (у ESP32 — вдоль платы, USB-C в +X), Y — поперёк, Z — вверх, к крышке. Ноль Z — дно.
"""

from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass, field

from build123d import (
    Align,
    Axis,
    Box,
    BuildSketch,
    Circle,
    Cylinder,
    Location,
    Locations,
    Mode,
    Part,
    Plane,
    Polygon,
    Pos,
    Rectangle,
    RectangleRounded,
    Rot,
    SlotCenterToCenter,
    Text,
    chamfer,
    export_step,
    export_stl,
    extrude,
    fillet,
)

HERE = os.path.dirname(os.path.abspath(__file__))
PITCH = 2.54


def _font(*names: str) -> str:
    for n in names:
        if os.path.exists(n):
            return n
    return names[-1]


FONT = _font("C:/Windows/Fonts/segoeuib.ttf", "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
ACCENT = "#b7452c"  # киноварь лендинга (--lp-accent)


# ── Защёлка ────────────────────────────────────────────────────────────────────────────────────


@dataclass
class Snap:
    """Гибкая балка в бортике крышки, на ней выступ; в стенке корпуса — паз. Числа — по файлам сокомандника."""

    beam_len: float = 22.0
    beam_t: float = 1.3
    fit: float = 0.30  # зазор бортика и длинной стенки (v3: 0,25; у сокомандника 0,25 и 0,35)
    end_fit: float = 0.35  # зазор бортика и торцов (у сокомандника 0,35)
    interference: float = 0.50  # на столько выступ заходит за стенку (v3: 0,30; у сокомандника 0,50)
    groove: float = 1.0  # глубина паза от грани стенки (v3: 0,5; у сокомандника 1,0)
    bump_len: float = 4.0
    groove_len: float = 5.0
    lead_deg: float = 45.0  # нижний скос от вертикали — заход
    ret_deg: float = 55.0  # верхний скос от вертикали — удержание
    crest: float = 0.2
    slit: float = 0.6  # прорезь между балкой и пластиной крышки
    zclear: float = 0.2  # запас паза по высоте
    end_len: float = 0.0  # третья балка — на торце +X (0 — нет)

    @property
    def out(self) -> float:
        return self.fit + self.interference

    @property
    def lead_dz(self) -> float:
        return self.out / math.tan(math.radians(self.lead_deg))

    @property
    def ret_dz(self) -> float:
        return self.out / math.tan(math.radians(self.ret_deg))

    @property
    def bump_h(self) -> float:
        return self.lead_dz + self.crest + self.ret_dz

    def bump_top(self, top_z: float) -> float:
        return top_z - self.slit - 0.15

    def strain(self) -> float:
        """Растяжение пластика в балке, защемлённой с концов, при прогибе на натяг: ε = 12·δ·t / L²."""
        return 12 * self.interference * self.beam_t / self.beam_len ** 2


# ── Общие детали ───────────────────────────────────────────────────────────────────────────────


def block(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> Part:
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0))


def rod_x(x0: float, x1: float, y: float, z: float, d: float) -> Part:
    return Pos((x0 + x1) / 2, y, z) * Rot(0, 90, 0) * Cylinder(d / 2, abs(x1 - x0))


def rprism(L: float, W: float, r: float, z0: float, h: float) -> Part:
    with BuildSketch(Plane.XY.offset(z0)) as sk:
        RectangleRounded(L, W, r)
    return extrude(sk.sketch, amount=h)


def try_fillet(part: Part, edges, r: float) -> Part:
    try:
        out = fillet(edges, r)
        return out if out.is_valid else part
    except Exception:
        return part


def try_chamfer(part: Part, edges, d: float) -> Part:
    try:
        out = chamfer(edges, d)
        return out if out.is_valid else part
    except Exception:
        return part


def body_shell(L: float, W: float, r: float, H: float, foot: float = 0.8, seam: float = 0.45) -> Part:
    """Корпус-«галька» без полости: скруглённые углы, фаска по низу (печатается на столе), фаска по шву."""
    b = rprism(L, W, r, 0, H)
    b = try_chamfer(b, b.edges().group_by(Axis.Z)[0], foot)
    b = try_chamfer(b, b.edges().group_by(Axis.Z)[-1], seam)
    return b


def lid_plate(L: float, W: float, r: float, H: float, t: float, round_top: float, seam: float = 0.45) -> Part:
    """Пластина крышки: верхняя кромка скруглена (печатается верхом на столе — радиус меньше толщины),
    нижняя — фаска шва: вместе с фаской корпуса шов выглядит задуманной канавкой."""
    p = rprism(L, W, r, H, t)
    p = try_fillet(p, p.edges().group_by(Axis.Z)[-1], round_top)
    p = try_chamfer(p, p.edges().group_by(Axis.Z)[0], seam)
    return p


def lid_rim(inner_len: float, inner_wid: float, s: Snap, lip: float, top_z: float, r_cav: float,
            cutouts: list[tuple[float, float, float]] = ()) -> Part:
    """Бортик крышки с двумя гибкими балками на длинных сторонах. Как в v3, но зазор у торцов свой (end_fit)
    и выступ — по защёлке сокомандника. cutouts — вырезы в рамке (x, y, ширина) на торцах."""
    outer_l = inner_len - 2 * s.end_fit
    outer_w = inner_wid - 2 * s.fit
    r_out = max(0.3, r_cav - s.fit)
    with BuildSketch(Plane.XY.offset(top_z - lip)) as sk:
        RectangleRounded(outer_l, outer_w, r_out)
        RectangleRounded(outer_l - 2 * s.beam_t, outer_w - 2 * s.beam_t, max(0.2, r_out - s.beam_t), mode=Mode.SUBTRACT)
        for x, y, w in cutouts:
            with Locations((x, y)):
                Rectangle(4 * s.beam_t, w, mode=Mode.SUBTRACT)
    frame = extrude(sk.sketch, amount=lip + 0.01)
    for sy in (-1, 1):
        frame = frame - Pos(0, sy * (outer_w / 2 - s.beam_t / 2), top_z - s.slit / 2 + 0.01) * Box(s.beam_len, s.beam_t + 0.2, s.slit + 0.02)
    if s.end_len:
        frame = frame - Pos(outer_l / 2 - s.beam_t / 2, 0, top_z - s.slit / 2 + 0.01) * Box(s.beam_t + 0.2, s.end_len, s.slit + 0.02)
    zt = s.bump_top(top_z)
    zb = zt - s.bump_h
    assert zb > top_z - lip + 0.1, "выступ защёлки ниже бортика — увеличить lip"
    for sy in (-1, 1):
        y0 = sy * outer_w / 2
        pts = [(y0 - sy * 0.05, zb), (y0 + sy * s.out, zb + s.lead_dz), (y0 + sy * s.out, zb + s.lead_dz + s.crest), (y0 - sy * 0.05, zt)]
        with BuildSketch(Plane.YZ) as sk2:
            Polygon(*pts, align=None)
        frame = frame + extrude(sk2.sketch, amount=s.bump_len / 2, both=True)
    if s.end_len:
        x0 = outer_l / 2
        pts = [(x0 - 0.05, zb), (x0 + s.out, zb + s.lead_dz), (x0 + s.out, zb + s.lead_dz + s.crest), (x0 - 0.05, zt)]
        with BuildSketch(Plane.XZ) as sk3:
            Polygon(*pts, align=None)
        frame = frame + extrude(sk3.sketch, amount=s.bump_len / 2, both=True)
    return frame


def snap_grooves(inner_wid: float, s: Snap, top_z: float, inner_len: float = 0.0) -> Part:
    zt = s.bump_top(top_z) + s.zclear
    zb = s.bump_top(top_z) - s.bump_h - s.zclear
    g = None
    for sy in (-1, 1):
        y = sy * (inner_wid / 2 + s.groove / 2 - 0.01)
        part = Pos(0, y, (zb + zt) / 2) * Box(s.groove_len, s.groove + 0.02, zt - zb)
        g = part if g is None else g + part
    if s.end_len and inner_len:
        g = g + Pos(inner_len / 2 + s.groove / 2 - 0.01, 0, (zb + zt) / 2) * Box(s.groove + 0.02, s.groove_len, zt - zb)
    return g


# ── Знак «nm» лендинга ─────────────────────────────────────────────────────────────────────────


def _bez(p0, p1, p2, p3, n=10):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
    return out


# Путь знака из website/src/ui/Logo.tsx, viewBox 68 × 40, штрих 3,25, точка (36, 21) r 3,25
_LOGO = [
    [(4, 33), (4, 7)],
    _bez((4, 18), (4, 3), (24, 3), (24, 18)) + [(24, 27)] + _bez((24, 27), (24, 37), (36, 37), (36, 27))[1:] + [(36, 17)]
    + _bez((36, 17), (36, 3), (50, 3), (50, 17))[1:] + [(50, 33)],
    _bez((50, 17), (50, 3), (64, 3), (64, 17)) + [(64, 33)],
]


def logo_cut(width: float, cx: float, cy: float, z_top: float, depth: float) -> tuple[Part, Part]:
    """Знак «nm», утопленный в верхнюю грань. Возвращает (выемка штриха, выемка точки) — точку заполняет вкладыш."""
    s = width / 68
    w = 3.25 * s
    T = lambda p: (cx + (p[0] - 34) * s, cy + (20 - p[1]) * s)  # noqa: E731
    with BuildSketch(Plane.XY.offset(z_top - depth)) as sk:
        for pl in _LOGO:
            pts = [T(p) for p in pl]
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                L = math.hypot(x1 - x0, y1 - y0)
                if L < 1e-6:
                    continue
                with Locations(Location(((x0 + x1) / 2, (y0 + y1) / 2), math.degrees(math.atan2(y1 - y0, x1 - x0)))):
                    Rectangle(L, w)
            for p in pts:
                with Locations(p):
                    Circle(w / 2)
    stroke = extrude(sk.sketch, amount=depth + 0.5)
    dot = Pos(*T((36, 21)), z_top - depth) * Cylinder(3.25 * s, depth, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return stroke, dot


def dash(x: float, y: float, length: float, w: float, z_top: float, depth: float) -> Part:
    """Короткая черта киноварью, как на референсе: со стороны +X датчика — куда смотрит ось X."""
    with BuildSketch(Plane.XY.offset(z_top - depth)) as sk:
        with Locations((x, y)):
            SlotCenterToCenter(length - w, w)
    return extrude(sk.sketch, amount=depth)


def text_cut(text: str, size: float, x: float, y: float, z_top: float, depth: float) -> Part:
    with BuildSketch(Plane.XY.offset(z_top - depth)) as sk:
        with Locations(Location((x, y))):
            Text(text, font_size=size, font_path=FONT, align=(Align.CENTER, Align.CENTER))
    return extrude(sk.sketch, amount=depth + 0.5)


# ── Датчик GY-521 ──────────────────────────────────────────────────────────────────────────────


@dataclass
class Sensor:
    """Датчик-«галька»: GY-521 с угловыми штырьками, на четыре штырька (VCC GND SCL SDA) надета колодка
    кабеля DuPont 4 пин. Штырьки смотрят в −X, к кабелю. Ремешок — в туннеле под дном, поперёк (по Y)."""

    # Плата и всё на ней — замер Амирхана 27 октября и разброс у продавцов
    # Замер Амирхана 8 ноября: плата 20 × 15 мм, со штырьками 22 мм поперёк ряда; по высоте 7 мм — хвосты снизу 1 мм,
    # штырьки сверху 4 мм над платой. На столе плата лежит на хвостах с наклоном 3,8° (atan 1/15)
    board_l: float = 15.0  # поперёк ряда выводов, по X
    board_l_min: float = 14.6
    board_l_max: float = 15.4
    board_w_max: float = 20.4  # вдоль ряда, по Y: замер 20,0
    board_t: float = 1.6
    tail_max: float = 1.5  # хвосты выводов с пайкой под платой: замер 1,0, запас на каплю припоя
    tail_clear: float = 0.4
    pin_z: float = 2.7  # ось углового штырька над платой: верх колодки на штырьке — 4 мм над платой, как в замере
    plastic: float = 4.0  # штырьки с пластиком поднимаются над платой на 4 мм (замер)
    plastic_d: float = 2.54  # пластик штырьков поперёк ряда
    plastic_off_max: float = 1.5  # пластик торцом за краем платы: замер 22 − 15 − 6 = 1 мм, разброс 0,5–1,5
    pins: int = 8  # VCC GND SCL SDA XDA XCL AD0 INT
    cable_pins: int = 4  # колодка на VCC, GND, SCL, SDA — выводы 0–3
    housing_len: float = 14.0  # колодка DuPont
    housing_h: float = 2.6
    housing_slack: float = 0.4  # колодка может отъехать к стенке; дальше — стенка, не штырьки
    wire_d: float = 1.4
    squeeze: float = 0.3
    tongue_clear: float = 0.35
    far_gap: float = 0.1  # дальний край платы прижат к стенке +X
    top_clear: float = 1.5  # воздух над колодкой и пластиком штырьков (в v3 было 0,3 — провода не входили)
    hold_gap: float = 0.15  # прижимная планка крышки над платой
    # Корпус
    wall: float = 2.6
    r_out: float = 4.5  # туннель под ремешок 5 см почти во всю длину — скругление скромнее
    bottom: float = 1.2  # под туннелем
    tunnel_h: float = 3.6  # потолок туннеля — мост 51 мм, провиснет на 0,2–0,4: ремешку 3 мм хватит
    floor_t: float = 1.2  # над туннелем — дно полости
    lid_t: float = 2.0
    lip: float = 2.6
    strap: float = 50.0  # ремешки у всех датчиков 5 см; туннель на 1 мм шире
    # Сильнее, чем у сокомандника: выступ 8 мм вместо 4, удерживающий скос 60° вместо 45–52°
    snap: Snap = field(default_factory=lambda: Snap(beam_len=24.0, beam_t=1.3, bump_len=8.0, groove_len=9.0, ret_deg=60.0))

    @property
    def row_half(self) -> float:
        return self.pins * PITCH / 2

    @property
    def floor_z(self) -> float:
        return self.bottom + self.tunnel_h + self.floor_t

    @property
    def ped_top(self) -> float:
        return self.floor_z + self.tail_max + self.tail_clear

    @property
    def board_top(self) -> float:
        return self.ped_top + self.board_t

    @property
    def pin_zc(self) -> float:
        return self.board_top + self.pin_z

    @property
    def housing_top(self) -> float:
        return max(self.pin_zc + self.housing_h / 2, self.board_top + self.plastic)

    @property
    def height(self) -> float:
        return self.housing_top + self.top_clear

    @property
    def cav_l(self) -> float:
        return self.far_gap + self.board_l_max + self.plastic_off_max + self.housing_len + self.housing_slack

    @property
    def cav_w(self) -> float:
        # Бортик крышки (зазор + балка) — снаружи от ряда штырьков: корпус ниже
        return round(2 * (self.row_half + 0.4 + self.snap.fit + self.snap.beam_t), 2)

    @property
    def r_cav(self) -> float:
        # Углы платы 21,6 мм подходят к стенке +X вплотную — скругление полости маленькое (снаружи — 6,5)
        return 1.2

    @property
    def tunnel_w(self) -> float:
        return self.strap + 1.0

    @property
    def r_body(self) -> float:
        # Туннель выходит на прямой участок боковой грани: скругление не больше, чем позволяет длина
        return min(self.r_out, (self.length - self.tunnel_w - 1.0) / 2)

    @property
    def length(self) -> float:
        return max(self.cav_l + 2 * self.wall, self.tunnel_w + 2 * self.r_out + 1.0)

    @property
    def width(self) -> float:
        return self.cav_w + 2 * self.wall

    @property
    def end_wall(self) -> float:
        return (self.length - self.cav_l) / 2

    @property
    def x_far(self) -> float:
        return self.cav_l / 2 - self.far_gap

    def x_edge(self, board_l: float | None = None) -> float:
        return self.x_far - (self.board_l if board_l is None else board_l)

    @property
    def ped_x0(self) -> float:
        # Площадка — дальше хвостов любой платы 15,6–16,4 с пайкой (хвост в 1,27 мм от края, пайка ±1)
        return self.x_edge(self.board_l_min) + 3.0

    @property
    def shelf_x1(self) -> float:
        return self.x_edge(self.board_l_max) - 1.0

    @property
    def cable_y(self) -> float:
        # VCC, GND, SCL, SDA — в углу платы со стороны +Y (штырьки смотрят в −X, вид сверху): фото 8 ноября
        return -((self.cable_pins - 1) / 2 - (self.pins - 1) / 2) * PITCH

    @property
    def wire_ys(self) -> list[float]:
        return [((self.pins - 1) / 2 - i) * PITCH for i in range(self.cable_pins)]

    @property
    def slot_w(self) -> float:
        return (self.cable_pins - 1) * PITCH + self.wire_d + 0.8

    @property
    def slot_bot(self) -> float:
        return self.pin_zc - self.wire_d / 2 - 0.15

    @property
    def tongue_bot(self) -> float:
        return self.pin_zc + self.wire_d / 2 - self.squeeze


def sensor_box(p: Sensor) -> Part:
    L, W, H = p.length, p.width, p.height
    cx = p.cav_l / 2
    cy = p.cav_w / 2
    body = body_shell(L, W, p.r_body, H)
    # Туннель ремешка под дном: насквозь по Y, со скруглёнными углами
    with BuildSketch(Plane.XZ) as sk:
        with Locations((0, p.bottom + p.tunnel_h / 2)):
            RectangleRounded(p.tunnel_w, p.tunnel_h, 1.0)
    body = body - extrude(sk.sketch, amount=W, both=True)
    body = body - rprism(p.cav_l, p.cav_w, p.r_cav, p.floor_z, H)
    # Площадка под платой — от колодца хвостов до стенки +X; упоры по бокам платы
    body = body + block(p.ped_x0, cx + 0.01, -cy - 0.01, cy + 0.01, p.floor_z - 0.01, p.ped_top)
    for s in (-1, 1):
        y_in = s * (p.board_w_max / 2 + 0.15)
        body = body + block(p.ped_x0 + 0.5, cx + 0.01, min(y_in, s * (cy + 0.01)), max(y_in, s * (cy + 0.01)), p.ped_top - 0.01, p.board_top - 0.3)
    # Полка под колодкой: колодка не провисает, хвостам не мешает
    body = body + block(-cx - 0.01, p.shelf_x1, -cy - 0.01, cy + 0.01, p.floor_z - 0.01, p.board_top - 0.5)
    # Паз проводов в торце −X, открыт сверху; скруглённое дно
    with BuildSketch(Plane.YZ.offset(-L / 2 - 1)) as sk:
        with Locations((p.cable_y, (p.slot_bot + H + 2) / 2)):
            RectangleRounded(p.slot_w, H + 2 - p.slot_bot, 0.6)
    body = body - extrude(sk.sketch, amount=p.end_wall + 2)
    body = body - snap_grooves(p.cav_w, p.snap, H)
    # Выемка под ноготь на торце +X
    body = body - Pos(L / 2 + 0.5 - 1.0, 0, H) * Rot(0, 90, 0) * Cylinder(4.5, 1.0 + 1.0)
    return body


def sensor_lid(p: Sensor, label: str = "", dash_to_cable: bool = False) -> tuple[Part, Part]:
    """Крышка в собранном положении и вкладыш киноварью (точка знака и черта оси X).
    Язычок в пазу −X прижимает провода — крышка встаёт только одной стороной."""
    L, W, H = p.length, p.width, p.height
    plate = lid_plate(L, W, p.r_body, H, p.lid_t, 1.4)
    rim = lid_rim(p.cav_l, p.cav_w, p.snap, p.lip, H, p.r_cav, [(-p.cav_l / 2, 0, 2 * (p.row_half + 0.45))])
    tw = p.slot_w - 2 * p.tongue_clear
    tongue = block(-L / 2 + 0.2, -p.cav_l / 2 + 0.01, p.cable_y - tw / 2, p.cable_y + tw / 2, p.tongue_bot, H + 0.01)
    # Прижимная планка над дальним краем платы — плата не поднимется, клей не нужен
    bar = block(p.x_far - 1.3, p.x_far - 0.25, -8.5, 8.5, p.board_top + p.hold_gap, H + 0.01)
    lid = plate + rim + tongue + bar
    top = H + p.lid_t
    stroke, dot = logo_cut(17.0, -1.0, 1.2, top, 0.6)
    dx = -1 if dash_to_cable else 1
    d = dash(dx * (L / 2 - 8.5), -(W / 2 - 5.2), 6.0, 1.4, top, 0.6)
    inlay = dot + d
    cut = stroke + inlay
    if label:
        cut = cut + text_cut(label, 3.6, -dx * (L / 2 - 8.0), -(W / 2 - 5.2), top, 0.5)
    return lid - cut, inlay


# Плата GY-521 и всё на ней — для проверок и картинок. Разброс — как у продавцов


@dataclass
class Gy521:
    board_l: float = 15.0
    board_w: float = 20.0
    tail: float = 1.0
    plastic_off: float = 1.0
    pin_z: float = 2.7
    housing_h: float = 2.54


def gy521_parts(p: Sensor, g: Gy521 = Gy521(), housing_shift: float = 0.0) -> dict[str, Part]:
    x_e = p.x_edge(g.board_l)
    bz = p.ped_top
    top = bz + p.board_t
    pz = top + g.pin_z
    hw = g.board_w / 2
    xs = x_e - g.plastic_off
    parts = {
        "плата": block(x_e, p.x_far, -hw, hw, bz, top),
        "чип MPU-6050": block(p.x_far - g.board_l / 2 - 2, p.x_far - g.board_l / 2 + 2, -2, 2, top, top + 0.9),
        "детали на плате до 1,9 мм": block(x_e + 3.0, p.x_far - 1.6, -hw + 1.8, hw - 1.8, top, top + 1.9),
        "пластик штырьков": block(xs, xs + p.plastic_d, -p.row_half, p.row_half, top, top + p.plastic),
        "штырьки": block(xs - 6.0, xs, -p.row_half + 0.95, p.row_half - 0.95, pz - 0.32, pz + 0.32),
        "хвосты с пайкой": block(x_e + 1.27 - 0.9, x_e + 1.27 + 0.9, -p.row_half + 0.3, p.row_half - 0.3, bz - g.tail, bz),
    }
    y1 = p.row_half
    hx = xs + housing_shift
    parts["колодка DuPont 4 пин"] = block(hx - p.housing_len, hx, y1 - p.cable_pins * PITCH + 0.02, y1 - 0.02, pz - g.housing_h / 2, pz + g.housing_h / 2)
    return parts


def gy521_wires(p: Sensor, g: Gy521 = Gy521(), out: float = 10.0, d: float | None = None) -> list[Part]:
    x_e = p.x_edge(g.board_l)
    x0 = x_e - g.plastic_off - p.housing_len + 0.01
    pz = p.board_top + g.pin_z
    return [rod_x(x0, -(p.length / 2 + out), y, pz, d or p.wire_d) for y in p.wire_ys]


# ── ESP32 на макетной плате ────────────────────────────────────────────────────────────────────


@dataclass
class Hub:
    """ESP32 DevKit (30 выводов, USB-C) одним рядом в макетной плате на 170 точек — как в v3 и ПЕЧАТЬ-v3.md:
    ряд с 3V3, GND, D21, D22 — в ряд e, D23 — в столбец 1, 3V3 — в 15; второй ряд висит.

    Новое: ESP32 стоит торцом в стенку +X, разъём USB-C входит в окно стенки — окно задаёт и место разъёма.
    Висящий край лежит на опорах с бортиком: бортик ставит плату по Y. Палец крышки у антенны
    поджимает плату к стенке +X."""

    # Замеры Амирхана и данные платы
    pcb: tuple[float, float, float] = (51.0, 28.0, 1.6)
    pcb_l_max: float = 52.3
    pin_row_off: float = 1.3  # (28 − 25,4) / 2
    pin_from_usb: float = 9.8
    header: float = 2.5  # пластик штырьков под ESP32
    seat: float = 0.35  # ESP32 обычно сидит в макетной плате не до конца: замер «вместе 17 мм» против 16,3 по расчёту
    module: tuple[float, float, float] = (25.5, 18.0, 3.2)
    usb: tuple[float, float, float] = (7.35, 8.94, 3.26)  # гнездо USB-C: длина, ширина, высота
    usb_out: float = 1.0  # гнездо выступает за край платы — замерить: --usb-vystup
    usb_bottom: float = 10.0  # низ гнезда над низом макетной платы: замер 9,5–10,5 мм
    usb_from_edge: float = 8.25  # замер Амирхана 8 ноября: от края ESP32 (не со стороны макетной платы) до края гнезда 8,0–8,5 мм
    bb: tuple[float, float, float] = (45.0, 33.0, 9.0)
    bb_margin: float = 2.53
    bb_col_margin: float = 2.18
    row_e: int = 4
    # Провода
    jumper_h: float = 14.0
    bend: float = 5.0
    wire_d: float = 1.4
    wire_n: int = 4
    chan_fit: float = 0.8
    chan_pitch: float = 10.8  # колодки DuPont 4 пин (10,16 мм) стоят внутри рядом, без нахлёста
    chan_z: float = 27.4  # колодки кабелей лежат над проводами «папа» из макетной платы (их верх — 25 мм): жиле есть где изогнуться
    squeeze: float = 0.25
    door_clear: float = 0.35
    # Окно USB-C: на 0,33 мм шире гнезда с каждой стороны, снаружи карман под корпус штекера
    hole: tuple[float, float] = (10.6, 5.4)  # с запасом на погрешность замера и печати: гнездо 8,94 × 3,26, по 0,8–1,1 мм с каждой стороны
    pocket: tuple[float, float] = (13.4, 7.8)  # штекеры бывают до 12,4 × 6,8
    # Опоры и прижимы
    post: float = 2.6
    hold_gap: float = 0.15
    stop_gap: float = 0.15  # бортик опоры — от края ESP32
    finger_pre: float = 0.3  # палец крышки поджимает ESP32 к стенке +X
    # Корпус
    wall: float = 3.0  # угол полости почти острый (плата в 0,1 мм от стенки) — на скруглённом углу снаружи остаётся 1,5 мм
    floor_t: float = 2.0
    lid_t: float = 2.2
    lip: float = 2.6
    cav_l: float = 64.4  # +10 мм: полка у −X кончается до торца ESP32, а провода «папа–папа» 10 см ложатся ровным жгутом
    cav_w: float = 41.1
    r_out: float = 7.5
    r_cav: float = 1.0  # угол ESP32 стоит в 0,1 мм от стенки +X и в 1 мм от −Y
    height: float = 33.0  # +3 мм против v3: колодки кабелей — над проводами макетной платы, а не среди них
    plate: tuple[float, float, float] = (76.4, 61.1, 3.0)  # плита основания — как у сокомандника, длиннее на 10 мм вместе с корпусом
    slot: tuple[float, float] = (50.5, 3.4)
    # Полка у торца −X — одно целое со стенками: на ней колодки кабелей «мама», примотанные изолентой.
    # ESP32 с макетной платой вставляется под неё наклонно: антенной вперёд, потом конец с USB-C опускается вниз
    shelf_len: float = 9.5  # кончается до проводов «папа» в столбце 2 макетной платы: над ними любое окно в полке Bambu печатает обрывками моста
    shelf_t: float = 2.2  # мост 41 мм между стенками ±Y: первый слой провисает меньше, чем у 2 мм
    # Чуть крепче, чем у сокомандника: выступ заходит за стенку на 0,5 мм с обеих сторон (у него 0,5 и 0,3),
    # длина 5 мм вместо 4, удерживающий скос 50° (у него 45° и 52°); паз 1,0 мм, как у него
    snap: Snap = field(default_factory=lambda: Snap(beam_len=28.0, beam_t=1.6, interference=0.5, bump_len=5.0, groove_len=6.0,
                                                   ret_deg=50.0))

    @property
    def shelf_top(self) -> float:
        # Колодка кабеля лежит на полке: её низ — ось ложбинки минус половина колодки
        return self.chan_bot + self.wire_d / 2 + 0.02 - 1.27 - 0.05

    @property
    def shelf_bot(self) -> float:
        return self.shelf_top - self.shelf_t

    @property
    def length(self) -> float:
        return self.cav_l + 2 * self.wall

    @property
    def width(self) -> float:
        return self.cav_w + 2 * self.wall

    @property
    def bb_top(self) -> float:
        return self.floor_t + self.bb[2]

    @property
    def pcb_z(self) -> float:
        return self.bb_top + self.header + self.seat

    @property
    def pcb_top(self) -> float:
        return self.pcb_z + self.pcb[2]

    @property
    def usb_zc(self) -> float:
        # Замер 8 ноября: низ гнезда USB-C — 9,5–10,5 мм над низом макетной платы (гнездо утоплено в плату)
        return self.floor_t + self.usb_bottom + self.usb[2] / 2

    @property
    def x_usb_end(self) -> float:
        return self.cav_l / 2 - 0.1

    @property
    def pcb_y(self) -> tuple[float, float]:
        # В макетной плате — ряд 3V3…D23 (у стенки +Y), висит ряд VIN…EN (у −Y)
        y0 = -self.cav_w / 2 + 0.9 + self.stop_gap
        return (y0, y0 + self.pcb[1])

    @property
    def pcb_yc(self) -> float:
        return sum(self.pcb_y) / 2

    @property
    def usb_yc(self) -> float:
        """Ось гнезда USB-C поперёк платы: гнездо стоит не посередине, а ближе к краю без макетной платы (замер)."""
        return self.pcb_y[1] - self.usb_from_edge - self.usb[1] / 2  # гнездо ближе к краю с D23/3V3 — он над макетной платой

    @property
    def row_y(self) -> list[float]:
        y_e = self.pcb_y[0] + self.pin_row_off + 25.4
        return [y_e + (self.row_e - i) * PITCH for i in range(5)]

    @property
    def bb_y(self) -> tuple[float, float]:
        y1 = self.row_y[0] + self.bb_margin
        return (y1 - self.bb[1], y1)

    @property
    def col_x(self) -> list[float]:
        x15 = self.x_usb_end - self.pin_from_usb
        return [x15 + (k - 15) * PITCH for k in range(1, 18)]

    @property
    def bb_x(self) -> tuple[float, float]:
        x0 = self.col_x[0] - self.bb_col_margin
        return (x0, x0 + self.bb[0])

    @property
    def jumper_top(self) -> float:
        return self.bb_top + self.jumper_h

    @property
    def chan_w(self) -> float:
        return self.wire_n * self.wire_d + self.chan_fit

    @property
    def chan_ys(self) -> list[float]:
        return [(i - 1) * self.chan_pitch for i in range(3)]

    @property
    def window_half(self) -> float:
        return self.chan_pitch + self.chan_w / 2

    @property
    def chan_bot(self) -> float:
        return self.floor_t + self.chan_z

    @property
    def door_bot(self) -> float:
        return self.chan_bot + self.wire_d - self.squeeze

    @property
    def posts(self) -> list[tuple[float, float]]:
        # Под висящим краем: у антенны и у USB — там нет выводов
        y = self.pcb_y[0] + 0.2 + self.post / 2
        xa = self.x_usb_end - self.pcb[0] + 0.2 + self.post / 2  # дальше от висящих штырьков: ESP32 опускают со сдвигом
        xu = self.x_usb_end - 2.6 - self.post / 2
        return [(xa, y), (xu, y)]

    @property
    def finger(self) -> tuple[float, float, float, float]:
        """Палец крышки у торца антенны: x0, x1, y0, y1."""
        x1 = self.x_usb_end - self.pcb[0] + self.finger_pre
        return (x1 - 1.6, x1, self.pcb_y[0] + 0.6, self.pcb_y[0] + 2.6)

    @property
    def slot_y(self) -> float:
        return 25.85  # как у сокомандника: прорезь 24,15–27,55


def hub_box(p: Hub) -> Part:
    L, W, H = p.length, p.width, p.height
    cx, cy = p.cav_l / 2, p.cav_w / 2
    # Плита основания с прорезями ремня (как у сокомандника), скруглённая, и корпус-«галька» на ней
    pl, pw, pt = p.plate
    with BuildSketch() as sk:
        RectangleRounded(pl, pw, 9.0)
        for s in (-1, 1):
            with Locations((0, s * p.slot_y)):
                RectangleRounded(p.slot[0], p.slot[1], 0.8, mode=Mode.SUBTRACT)
    plate = extrude(sk.sketch, amount=pt)
    plate = try_chamfer(plate, plate.edges().group_by(Axis.Z)[0], 0.6)
    plate = try_fillet(plate, plate.edges().group_by(Axis.Z)[-1], 1.2)
    body = plate + body_shell(L, W, p.r_out, H, foot=0.01)
    body = body - rprism(p.cav_l, p.cav_w, p.r_cav, p.floor_t, H)
    fz = p.floor_t - 0.01
    # Упоры макетной платы по Y (по X её ставит ESP32): у стенки +Y место под 0,9 мм, у −Y — ребро
    by0, by1 = p.bb_y
    bx0, bx1 = p.bb_x
    body = body + block(bx0 + 6, bx1 - 6, by0 - 0.4 - 1.2, by0 - 0.4, fz, p.floor_t + 3.0)
    # Бортик за торцом макетной платы: ESP32 опускают на (выступ USB + 0,3) мм ближе к −X — с таким зазором,
    # и ещё 0,3. С открытой крышкой плата не уедет дальше; с закрытой её держат палец крышки и гнездо в окне
    gap = p.usb_out + 0.3 + 0.3
    body = body + block(bx0 - gap - 1.6, bx0 - gap, by0 + 2, by1 - 2, fz, p.floor_t + 3.0)
    # Опоры под висящим краем ESP32 с бортиком: плата лежит на опоре, бортик ставит её по Y
    for x, y in p.posts:
        body = body + Pos(x, y, (fz + p.pcb_z) / 2) * Box(p.post, p.post, p.pcb_z - fz)
        lip_y1 = p.pcb_y[0] - p.stop_gap
        body = body + block(x - p.post / 2, x + p.post / 2, -cy - 0.01, lip_y1, fz, p.pcb_top + 1.2)
    # Окно USB-C: овал по гнезду, фаска-заход изнутри, карман под штекер снаружи
    yc, zc = p.usb_yc, p.usb_zc
    hw, hh = p.hole
    with BuildSketch(Plane.YZ.offset(cx - 1)) as sk:
        with Locations((yc, zc)):
            SlotCenterToCenter(hw - hh, hh)
    body = body - extrude(sk.sketch, amount=p.wall + 2)
    with BuildSketch(Plane.YZ.offset(cx - 0.01)) as sk:
        with Locations((yc, zc)):
            SlotCenterToCenter(hw - hh + 1.0, hh + 1.0)
    with BuildSketch(Plane.YZ.offset(cx + 0.5)) as sk2:
        with Locations((yc, zc)):
            SlotCenterToCenter(hw - hh, hh)
    from build123d import loft
    body = body - loft([sk.sketch.faces()[0], sk2.sketch.faces()[0]])
    pd = p.wall + 0.2 - p.usb_out  # дно кармана — на 0,1 мм глубже торца гнезда
    pd = max(0.6, min(pd, p.wall - 0.8))
    pw_, ph_ = p.pocket
    with BuildSketch(Plane.YZ.offset(L / 2 - pd)) as sk:
        with Locations((yc, zc)):
            RectangleRounded(pw_, ph_, 2.4)
    body = body - extrude(sk.sketch, amount=pd + 1)
    # Окно лент в торце −X, открыто сверху; перегородки делят его на три ложбинки
    xw = -(L / 2 - p.wall / 2)
    body = body - Pos(xw, 0, (p.chan_bot + H + 1) / 2) * Box(p.wall + 2, 2 * p.window_half, H + 1 - p.chan_bot)
    for i in (0, 1):
        y = (p.chan_ys[i] + p.chan_ys[i + 1]) / 2
        body = body + Pos(xw, y, (p.chan_bot + p.door_bot - 0.2) / 2) * Box(p.wall + 0.02, p.chan_pitch - p.chan_w, p.door_bot - 0.2 - p.chan_bot + 0.02)
    body = body + hub_shelf(p)
    body = body - snap_grooves(p.cav_w, p.snap, H, p.cav_l)
    # Выемка под ноготь на стенке +Y
    body = body - Pos(-L / 2 + 14, W / 2 + 0.5 - 1.2, H) * Rot(90, 0, 0) * Cylinder(4.5, 2.2)
    return body


def hub_shelf(p: Hub) -> Part:
    """Полка под колодки кабелей — заодно со стенками −X, −Y и +Y. Вырезы: у угла −X −Y проходят штырь и палец крышки
    к ESP32; у стенки +Y — провода «папа» в столбцах макетной платы под полкой: их вставляют сверху сквозь вырез."""
    cx, cy = p.cav_l / 2, p.cav_w / 2
    x0, x1 = -cx - 0.05, -cx + p.shelf_len
    shelf = block(x0, x1, -cy - 0.05, cy + 0.05, p.shelf_bot, p.shelf_top)
    xa, ya = p.posts[0]
    fx0, fx1, fy0, fy1 = p.finger
    # Закрытые окна (вырезы до стенок Bambu Studio печатает как «висящий выступ»): под штырь и под палец крышки
    shelf = shelf - Pos(xa, ya, p.shelf_bot + p.shelf_t / 2) * Cylinder(p.post / 2 + 0.5, p.shelf_t + 2)
    shelf = shelf - block(fx0 - 0.4, fx1 + 0.4, fy0 - 0.4, fy1 + 0.4, p.shelf_bot - 1, p.shelf_top + 1)
    under = [(p.col_x[c - 1], p.row_y[r]) for c, r, _ in JUMPERS if p.col_x[c - 1] - 1.25 < x1]
    if under:
        xs = [x for x, _ in under]
        ys = [y for _, y in under]
        shelf = shelf - block(min(xs) - 1.8, max(xs) + 1.8, min(ys) - 1.8, max(ys) + 1.8, p.shelf_bot - 1, p.shelf_top + 1)  # закрытое окно над проводами
    return shelf


def hub_lid(p: Hub) -> tuple[Part, Part]:
    L, W, H = p.length, p.width, p.height
    lid = lid_plate(L, W, p.r_out, H, p.lid_t, 1.6)
    # Бортик у торца −X вырезан над окном лент: там у стенки лежат колодки кабелей
    lid = lid + lid_rim(p.cav_l, p.cav_w, p.snap, p.lip, H, p.r_cav, [(-p.cav_l / 2, 0, 2 * (p.chan_pitch + 2 * PITCH + 0.6))])
    # Дверца: закрывает окно лент и прижимает их
    door_w = 2 * p.window_half - 2 * p.door_clear
    lid = lid + block(-L / 2 + 0.2, -p.cav_l / 2 + 0.01, -door_w / 2, door_w / 2, p.door_bot, H + 0.01)
    # Штырь над опорой у антенны: висящий край зажат между опорой и штырём
    xa, ya = p.posts[0]
    lid = lid + Pos(xa, ya, (p.pcb_top + p.hold_gap + H) / 2) * Cylinder(p.post / 2, H - p.pcb_top - p.hold_gap + 0.01)
    # Палец у торца антенны поджимает ESP32 к стенке +X: гибкий, плата 51–52 мм входит
    x0, x1, y0, y1 = p.finger
    lid = lid + block(x0, x1, y0, y1, p.pcb_z + 0.2, H + 0.01)
    top = H + p.lid_t
    stroke, dot = logo_cut(24.0, 3.0, 4.0, top, 0.6)
    cut = stroke + dot + text_cut("NeuroMove", 5.2, 3.0, -9.0, top, 0.5)
    for name, y in zip(("П", "ПР", "Г"), p.chan_ys):
        cut = cut + text_cut(name, 3.4, -L / 2 + 5.0, y, top, 0.5)
    return lid - cut, dot


# ESP32, макетная плата, провода — для проверок и картинок


def hub_parts(p: Hub, pcb_l: float | None = None, usb_out: float | None = None) -> dict[str, Part]:
    pl = p.pcb[0] if pcb_l is None else pcb_l
    uo = p.usb_out if usb_out is None else usb_out
    xu = p.x_usb_end
    xa = xu - pl
    py0, py1 = p.pcb_y
    yc = p.pcb_yc
    top = p.pcb_top
    bx0, bx1 = p.bb_x
    by0, by1 = p.bb_y
    col = p.col_x
    span = (col[0] - 1.27, col[14] + 1.27)
    y_e = p.row_y[p.row_e]
    y_h = py0 + p.pin_row_off
    ul, uw, uh = p.usb
    return {
        "макетная плата": block(bx0, bx1, by0, by1, p.floor_t, p.bb_top),
        "плата ESP32": block(xa, xu, py0, py1, p.pcb_z, top),
        "модуль ESP32": block(xa, xa + p.module[0], yc - p.module[1] / 2, yc + p.module[1] / 2, top, top + p.module[2]),
        "гнездо USB-C": usb_receptacle(p, xu + uo - ul, xu + uo),
        "кнопки EN и BOOT": block(xu - 6.5, xu - 2.0, py0 + 0.8, py0 + 5.0, top, top + 2.0) + block(xu - 6.5, xu - 2.0, py1 - 5.0, py1 - 0.8, top, top + 2.0),
        "детали платы": block(xu - 9.0, xa + p.module[0] + 0.5, yc - 6.0, yc + 6.0, top, top + 2.2),
        "штырьки в макетной плате": block(*span, y_e - 1.27, y_e + 1.27, p.bb_top, p.pcb_z),
        "висящие штырьки": block(*span, y_h - 1.27, y_h + 1.27, p.pcb_z - p.header - 6.0, p.pcb_z),
    }


def usb_receptacle(p: Hub, x0: float, x1: float) -> Part:
    """Гнездо USB-C: овал 8,94 × 3,26 мм (концы — полукруги), лежит на плате."""
    ul, uw, uh = p.usb
    with BuildSketch(Plane.YZ.offset(x0)) as sk:
        with Locations((p.usb_yc, p.usb_zc)):
            SlotCenterToCenter(uw - uh, uh)
    return extrude(sk.sketch, amount=x1 - x0)


# В макетной плате — ряд 3V3…D23 (8 ноября). Столбец k — вывод k от антенны: 1 D23, 2 D22, 3 TX0, 4 RX0, 5 D21,
# 6 D19, 7 D18, 8 D5, 9 D17, 10 D16, 11 D4, 12 D2, 13 D15, 14 GND, 15 3V3. Под перепрошивку: I2C подальше от
# колодок — длина провода 10 см уходит в путь, а не в петли; дальние D23, D22 — у «П»: у его колодки меньше места на дугу.
# Не брать: TX0, RX0 (USB-порт), D2, D5, D15 (от них зависит загрузка)
JUMPERS = (
    (15, 0, "VCC П"), (15, 1, "VCC ПР"), (15, 2, "VCC Г"), (14, 0, "GND П"), (14, 1, "GND ПР"), (14, 2, "GND Г"),
    (1, 0, "SDA П"), (2, 0, "SCL П"), (5, 1, "SDA ПР"), (6, 1, "SCL ПР"), (7, 2, "SDA Г"), (9, 2, "SCL Г"),
)
PINS = {1: "D23", 2: "D22", 5: "D21", 6: "D19", 7: "D18", 9: "D17", 14: "GND", 15: "3V3"}


def hub_jumpers(p: Hub) -> dict[str, Part]:
    return {n: block(p.col_x[c - 1] - 1.25, p.col_x[c - 1] + 1.25, p.row_y[r] - 1.25, p.row_y[r] + 1.25, p.bb_top, p.jumper_top) for c, r, n in JUMPERS}


def hub_cables(p: Hub, out: float = 12.0) -> list[tuple[Part, list[Part]]]:
    """Три кабеля: колодка DuPont 4 пин внутри у стенки −X и лента из четырёх жил в своей ложбинке."""
    z = p.chan_bot + p.wire_d / 2 + 0.02
    x_in = -p.cav_l / 2 + 0.6
    res = []
    for yc in p.chan_ys:
        housing = block(x_in, x_in + 14.0, yc - 2 * PITCH, yc + 2 * PITCH, z - 1.27, z + 1.27)
        ys = [yc + (i - (p.wire_n - 1) / 2) * p.wire_d for i in range(p.wire_n)]
        res.append((housing, [rod_x(x_in + 0.01, -(p.length / 2 + out), y, z, p.wire_d * 0.98) for y in ys]))
    return res


def usb_plug(p: Hub, usb_out: float | None = None) -> tuple[Part, Part]:
    """Штекер USB-C, вставленный до упора: металл 8,25 × 2,4 × 6,65, корпус штекера 12 × 6,4 мм."""
    uo = p.usb_out if usb_out is None else usb_out
    xm = p.x_usb_end + uo
    yc, zc = p.usb_yc, p.usb_zc
    with BuildSketch(Plane.YZ.offset(xm - 6.4)) as sk:
        with Locations((yc, zc)):
            SlotCenterToCenter(8.25 - 2.4, 2.4)
    metal = extrude(sk.sketch, amount=6.4)
    with BuildSketch(Plane.YZ.offset(xm)) as sk:
        with Locations((yc, zc)):
            RectangleRounded(12.0, 6.4, 2.0)
    over = extrude(sk.sketch, amount=20)
    return metal, over


# ── Проверки ───────────────────────────────────────────────────────────────────────────────────


def ov(a: Part, b: Part) -> float:
    try:
        return abs((a & b).volume)
    except Exception:
        return 0.0


def half(side: int) -> Part:
    return Pos(0, side * 100, 0) * Box(400, 200, 400)


class Report:
    def __init__(self, title: str):
        self.title = title
        self.rows: list[tuple[bool | None, str]] = []

    def check(self, ok: bool, text: str) -> None:
        self.rows.append((bool(ok), text))

    def note(self, text: str) -> None:
        self.rows.append((None, text))

    def print(self) -> bool:
        print(f"\n{self.title}")
        for ok, text in self.rows:
            print(f"  {'·' if ok is None else '✓' if ok else '✗'} {text}")
        return all(ok for ok, _ in self.rows if ok is not None)


def corner_wall(r_out: float, wall: float, r_cav: float) -> float:
    """Толщина стенки по диагонали скруглённого угла: от дуги полости до наружной дуги."""
    return r_out - (math.sqrt(2) * max(0.0, r_out - wall - r_cav) + r_cav) if r_out > wall + r_cav else wall


def check_snap(r: Report, lid: Part, box: Part, s: Snap, cav_w: float, H: float) -> None:
    r.check(ov(lid, box) < 1e-3, "крышка садится: выступы защёлки свободно стоят в пазах")
    for sy in (-1, 1):
        v = ov((Pos(0, 0, 0.6) * lid) & half(sy), box)
        r.check(v > 1e-3, f"крышка на 0,6 мм выше — выступ {'+' if sy > 0 else '−'}Y упирается в стенку: держит ({v:.2f} мм³)")
    for sy in (-1, 1):
        # Даже если крышку прижали к противоположной стенке, выступ заходит за грань стенки на натяг − зазор
        v = ov((Pos(0, -sy * s.fit, 1.0) * lid) & half(sy), box)
        r.check(v > 1e-3, f"крышка сдвинута на зазор {s.fit} мм от стенки {'+' if sy > 0 else '−'}Y — выступ всё равно держит")
    r.check(ov(lid.rotate(Axis.Z, 180), box) > 1e-3, "крышка, повёрнутая на 180°, не садится — встаёт одной стороной")
    for sy in (-1, 1):
        y = sy * (cav_w / 2 - s.fit - s.beam_t / 2)
        probe = Pos(0, y, H - s.slit / 2) * Box(s.beam_len - 0.5, s.beam_t - 0.2, s.slit - 0.1)
        r.check(ov(probe, lid) < 1e-4, f"балка {'+' if sy > 0 else '−'}Y свободна: прорезь {s.slit} мм на {s.beam_len:.0f} мм")
    r.check(s.strain() <= 0.016, f"растяжение балки при защёлкивании {100 * s.strain():.2f} % — PLA держит до ~2 %")
    r.note(f"защёлка: натяг {s.interference} мм, паз {s.groove} мм, зазор бортика {s.fit}/{s.end_fit} мм, выступ {s.bump_h:.2f} мм высотой")


def check_sensor(p: Sensor, box: Part, lids: dict[str, tuple[Part, Part]]) -> bool:
    r = Report(f"Датчик v4: {p.length:.1f} × {p.width:.1f} × {p.height + p.lid_t:.1f} мм, ремешок до {p.strap:.0f} мм")
    r.check(len(box.solids()) == 1 and box.is_valid, f"корпус — один кусок ({len(box.solids())})")
    for name, (lid, inlay) in lids.items():
        r.check(len(lid.solids()) == 1 and lid.is_valid, f"крышка «{name}» — один кусок")
        r.check(ov(inlay, lid) < 1e-3 and inlay.volume > 0.5, f"вкладыш «{name}» заполняет выемку и не залезает в крышку ({inlay.volume:.1f} мм³)")
    lid = lids["П"][0]
    # Разброс деталей: самая длинная и короткая плата, хвосты, пластик штырьков
    variants = {
        "номинал": Gy521(),
        "плата 15,4 × 20,4, пластик за краем 1,5 мм": Gy521(board_l=15.4, board_w=20.4, plastic_off=1.5),
        "плата 14,6 × 19,6, пластик за краем 0,5 мм": Gy521(board_l=14.6, board_w=19.6, plastic_off=0.5),
        "хвосты 1,5 мм, колодка 2,6 мм": Gy521(tail=1.5, housing_h=2.6),
        "ось штырька 2,4 мм над платой": Gy521(pin_z=2.4, housing_h=2.6),
        "ось штырька 3,0 мм над платой": Gy521(pin_z=3.0, housing_h=2.6),
    }
    for vname, g in variants.items():
        parts = gy521_parts(p, g)
        bad = [n for n, part in parts.items() if ov(part, box) > 1e-3 or any(ov(part, l) > 1e-3 for l, _ in lids.values())]
        r.check(not bad, f"{vname}: всё входит, крышка закрывается" + (f" — мешают {bad}" if bad else ""))
    parts = gy521_parts(p)
    r.check(ov(Pos(0, 0, -0.3) * parts["плата"], box) > 1e-3, "плата лежит на площадке: ниже на 0,3 мм — упирается")
    r.check(ov(Pos(0, 0, p.hold_gap + 0.2) * parts["плата"], lid) > 1e-3, f"плата выше на {p.hold_gap + 0.2:.2f} мм упирается в планку крышки — не болтается без клея")
    r.check(ov(Pos(0, 1.0, 0) * gy521_parts(p, Gy521(board_w=20.0))["плата"], box) > 1e-3, "плата 20 мм, сдвинутая вбок на 1 мм, упирается в упор")
    x_e = p.x_edge(p.board_l_min)
    deep = block(x_e + 1.27 - 0.9, x_e + 1.27 + 0.9, -p.row_half + 0.3, p.row_half - 0.3, p.ped_top - p.tail_max - 0.3, p.ped_top)
    r.check(ov(deep, box) < 1e-3, f"колодец под хвостами: хвосты до {p.tail_max + 0.3:.1f} мм с пайкой не касаются дна")
    pull = gy521_parts(p, Gy521(), housing_shift=-(p.housing_slack + 1.0 + 0.2))["колодка DuPont 4 пин"]
    r.check(ov(pull, box) > 1e-3, "дёрнули кабель — колодка упирается в стенку, в паз не пролезает, на штырьках остаётся ≥ 4,4 мм")
    wires = gy521_wires(p)
    r.check(all(ov(w, box) < 1e-3 for w in wires), f"{len(wires)} жилы по {p.wire_d} мм ложатся в паз торца −X")
    for name, (l, _) in lids.items():
        vs = [ov(w, l) for w in wires]
        r.check(min(vs) > 1e-4, f"язычок крышки «{name}» прижимает каждую жилу на {p.squeeze} мм")
    thick = gy521_wires(p, d=1.7)
    r.check(all(ov(w, box) < 1e-3 for w in [Pos(0, 0, 0.15) * w for w in thick]), "жилы до 1,7 мм тоже входят в паз (крышка прижмёт сильнее)")
    check_snap(r, lid, box, p.snap, p.cav_w, p.height)
    for s in (-1, 1):
        strap = Pos(0, s * (p.width / 2 - 1), p.bottom + 0.3 + 1.2) * Box(p.strap, p.width + 6, 2.4)
        r.check(ov(strap, box) < 1e-3, f"ремешок {p.strap:.0f} × 2,4 мм проходит сквозь туннель")
    r.check(ov(Pos(0, 0, p.bottom + 1.5) * Box(p.strap + 2.5, p.width + 6, 2.4), box) > 1e-3, f"ремешок {p.strap + 2.5:g} мм уже не проходит — проверка туннеля не пустая")
    r.check(p.wall - p.snap.groove >= 1.2, f"стенка за пазом защёлки — {p.wall - p.snap.groove:.1f} мм")
    cw = corner_wall(p.r_body, p.wall, p.r_cav)
    r.check(cw >= 1.2, f"стенка на скруглённых углах — {cw:.2f} мм, не тоньше 1,2")
    r.check(p.r_body >= 4.0, f"скругление углов корпуса {p.r_body:.1f} мм — туннель на прямом участке боковой грани")
    r.note(f"высоты: туннель {p.bottom}–{p.bottom + p.tunnel_h}, дно полости {p.floor_z:.1f}, площадка {p.ped_top:.1f}, плата до {p.board_top:.1f}, "
           f"ось штырьков {p.pin_zc:.2f}, верх колодки {p.housing_top:.2f}, шов {p.height:.2f}, с крышкой {p.height + p.lid_t:.2f} мм")
    return r.print()


def check_hub(p: Hub, box: Part, lid: Part, inlay: Part) -> bool:
    r = Report(f"ESP32 на макетной плате v4: {p.length:.1f} × {p.width:.1f} × {p.height + p.lid_t:.1f} мм, плита {p.plate[0]} × {p.plate[1]} мм")
    r.check(len(box.solids()) == 1 and box.is_valid, f"корпус — один кусок ({len(box.solids())})")
    r.check(len(lid.solids()) == 1 and lid.is_valid, "крышка — один кусок")
    r.check(ov(inlay, lid) < 1e-3, "вкладыш-точка не залезает в крышку")
    for uo in (0.0, p.usb_out, 1.8):
        for pl in (p.pcb[0], p.pcb_l_max) if uo == p.usb_out else (p.pcb[0],):
            parts = hub_parts(p, pl, uo)
            bad = [n for n, part in parts.items() if ov(part, box) > 1e-3 or (n != "плата ESP32" and ov(part, lid) > 1e-3)]
            r.check(not bad, f"ESP32 {pl:g} мм, USB-C выступает на {uo:g} мм: всё на месте, корпус и крышку не задевает" + (f" — мешают {bad}" if bad else ""))
    parts = hub_parts(p)
    pcb = parts["плата ESP32"]
    finger = ov(pcb, lid)
    r.check(finger > 1e-3 and ov(Pos(p.finger_pre + 0.05, 0, 0) * pcb, lid) < 1e-3,
            f"палец крышки поджимает ESP32 к стенке +X на {p.finger_pre} мм — плата не уедет от окна USB")
    r.check(ov(Pos(0.3, 0, 0) * pcb, box) > 1e-3, "торец ESP32 — в 0,1 мм от стенки +X: стенка ставит плату по X")
    r.check(ov(Pos(0, -0.3, 0) * pcb, box) > 1e-3, "бортики опор ставят ESP32 по Y")
    r.check(ov(Pos(0, 0, -0.3) * pcb, box) > 1e-3 and ov(Pos(0, 0, p.hold_gap + 0.15) * pcb, lid) > 1e-3,
            "висящий край лежит на опорах, сверху — штырь крышки: не болтается")
    r.check(ov(parts["кнопки EN и BOOT"], lid) < 1e-3, "кнопки EN и BOOT ничем не нажаты")
    # Окно USB-C: совпадает с гнездом
    usb = parts["гнездо USB-C"]
    hw, hh = p.hole
    r.check(ov(usb, box) < 1e-3, f"гнездо USB-C входит в окно {hw} × {hh} мм (гнездо {p.usb[1]} × {p.usb[2]})")
    my, mz = (hw - p.usb[1]) / 2 + 0.12, (hh - p.usb[2]) / 2 + 0.12
    for dy, dz in ((my, 0), (-my, 0), (0, mz), (0, -mz)):
        moved = Pos(0, dy, dz) * usb
        r.check(ov(moved, box) > 1e-4, f"окно по размеру разъёма: гнездо, сдвинутое на {'Y' if dy else 'Z'} {dy or dz:+.2f} мм, упирается в край")
    for uo in (p.usb_out, p.usb_out + 0.8):
        metal, over = usb_plug(p, uo)
        r.check(ov(metal, box) < 1e-3 and ov(over, box) < 1e-3,
                f"штекер USB-C (корпус 12 × 6,4 мм) входит до упора при выступе гнезда {uo:g} мм")
    pd = min(p.wall + 0.2 - p.usb_out, p.wall - 0.8)
    floor = p.length / 2 - pd
    for uo in (p.usb_out - 0.4, p.usb_out - 0.8):
        short = floor - (p.x_usb_end + uo)
        r.note(f"если гнездо выступает на {uo:g} мм — штекер не дойдёт на {max(0, short):.1f} мм: пересобрать с --usb-vystup {uo:g}")
    # Сборка: ESP32 с макетной платой опускается, сдвинутая на выступ USB к антенне, потом едет в окно
    unit = None
    for n in ("макетная плата", "плата ESP32", "модуль ESP32", "гнездо USB-C", "штырьки в макетной плате", "висящие штырьки", "кнопки EN и BOOT"):
        unit = parts[n] if unit is None else unit + parts[n]
    back = -(p.usb_out + 0.3)
    ok_down = all(ov(Pos(back, 0, 1.5 * i) * unit, box) < 1e-3 for i in range(0, 22))  # весь путь сверху, шаг 1,5 мм
    ok_slide = all(ov(Pos(back * f, 0, 0) * unit, box) < 1e-3 for f in (1.0, 0.6, 0.3, 0.0))
    r.check(ok_down and ok_slide, f"сборка: ESP32 с макетной платой опустить прямо сверху (полка — за торцом антенны) на {abs(back):.1f} мм ближе к −X и сдвинуть к стенке — гнездо входит в окно")
    jumpers = hub_jumpers(p)
    bad = [n for n, j in jumpers.items() if ov(j, box) > 1e-3 or ov(j, lid) > 1e-3 or ov(j, pcb) > 1e-3]
    r.check(not bad, f"{len(jumpers)} проводов «папа» в рядах a–c стоят, не задевая ESP32, корпус и крышку" + (f": {bad}" if bad else ""))
    r.check(p.height - p.jumper_top >= 4.5, f"над проводами {p.height - p.jumper_top:.1f} мм на изгиб")
    for name, (housing, ribbon) in zip(("П", "ПР", "Г"), hub_cables(p)):
        free = all(ov(w, box) < 1e-3 for w in ribbon) and ov(housing, box) < 1e-3 and ov(housing, lid) < 1e-3
        pressed = min(ov(w, lid) for w in ribbon)
        pulled = ov(Pos(-1.2, 0, 0) * housing, box) > 1e-3
        r.check(free and pressed > 1e-4 and pulled, f"кабель «{name}»: 4 жилы в ложбинке, дверца прижимает, колодка изнутри в окно не пролезает")
    check_snap(r, lid, box, p.snap, p.cav_w, p.height)
    bb = parts["макетная плата"]
    lim = p.usb_out + 0.3 + 0.3
    r.check(ov(Pos(-(lim - 0.05), 0, 0) * bb, box) < 1e-3 and ov(Pos(-(lim + 0.3), 0, 0) * bb, box) > 1e-3,
            f"бортик на дне за макетной платой: с открытой крышкой она уедет к −X не дальше {lim:.1f} мм")
    r.check(all(ov(Pos(0, 0, -0.25) * hs, box) > 1e-3 for hs, _ in hub_cables(p)) and p.shelf_len >= 9.0,
            f"полка — одно целое со стенками; на ней лежат колодки кабелей «мама» и приматываются изолентой")
    r.check(-p.cav_l / 2 + p.shelf_len < p.x_usb_end - p.pcb[0] - (p.usb_out + 0.3) - 0.5,
            "полка кончается до торца ESP32: ESP32 с макетной платой опускается прямо сверху, без наклона")
    r.note(f"полка {p.shelf_t} мм печатается мостом {p.cav_w:.0f} мм между стенками ±Y на высоте {p.shelf_bot:.1f} мм — поддержки не нужны")
    for s in (-1, 1):
        strap = Pos(0, s * p.slot_y, p.plate[2] / 2) * Box(p.slot[0] - 0.5, 2.0, p.plate[2] + 4)
        r.check(ov(strap, box) < 1e-3, f"ремень {p.slot[0] - 0.5:.0f} мм проходит сквозь прорезь {'+' if s > 0 else '−'}Y")
    r.check(p.wall - p.snap.groove >= 1.0, f"стенка за пазом защёлки — {p.wall - p.snap.groove:.1f} мм (у сокомандника 1,0)")
    cw = corner_wall(p.r_out, p.wall, p.r_cav)
    r.check(cw >= 1.2, f"стенка на скруглённых углах — {cw:.2f} мм, не тоньше 1,2")
    r.note(f"высоты: макетная плата до {p.bb_top:.1f}, ESP32 {p.pcb_z:.2f}–{p.pcb_top:.2f}, ось USB-C {p.usb_zc:.2f}, "
           f"провода до {p.jumper_top:.1f}, ложбинки {p.chan_bot:.1f}, шов {p.height:.1f}, с крышкой {p.height + p.lid_t:.1f} мм")
    return r.print()


# ── Вывод ──────────────────────────────────────────────────────────────────────────────────────


def for_print(part: Part, flip: bool, ref: Part | None = None) -> Part:
    """Корпус — дном на стол, крышка — верхом на стол. ref — по какой детали центрировать (крышка для вкладыша)."""
    ref = part if ref is None else ref
    if flip:
        part, ref = part.rotate(Axis.X, 180), ref.rotate(Axis.X, 180)
    bb = ref.bounding_box()
    return Pos(-bb.center().X, -bb.center().Y, -bb.min.Z) * part


def export(part: Part, name: str, step: bool) -> str:
    path = os.path.join(HERE, f"{name}.stl")
    export_stl(part, path, tolerance=0.03, angular_tolerance=0.15)
    if step:
        export_step(part, os.path.join(HERE, f"{name}.step"))
    return path


SENSORS = (("П", "P", False), ("ПР", "PR", False), ("Г", "G", True))


def arg(name: str, default: float) -> float:
    if name in sys.argv:
        return float(sys.argv[sys.argv.index(name) + 1])
    return default


def build(usb_out: float = 1.0):
    p = Sensor()
    hp = Hub(usb_out=usb_out)
    box = sensor_box(p)
    lids = {label: sensor_lid(p, label, to_cable) for label, _, to_cable in SENSORS}
    hbox = hub_box(hp)
    hlid, hinlay = hub_lid(hp)
    return p, hp, box, lids, hbox, hlid, hinlay


def main() -> int:
    want_step = "--step" in sys.argv
    usb_out = arg("--usb-vystup", Hub().usb_out)
    p, hp, box, lids, hbox, hlid, hinlay = build(usb_out)
    ok = check_sensor(p, box, lids)
    ok &= check_hub(hp, hbox, hlid, hinlay)
    files = {}
    files["datchik-korpus"] = export(for_print(box, False), "korpus-v4-datchik-korpus", want_step)
    for label, fname, _ in SENSORS:
        lid, inlay = lids[label]
        files[f"kryshka-{fname}"] = export(for_print(lid, True), f"korpus-v4-datchik-kryshka-{fname}", want_step)
        files[f"vkladysh-{fname}"] = export(for_print(inlay, True, lid), f"korpus-v4-datchik-vkladysh-{fname}", False)
    files["esp32-korpus"] = export(for_print(hbox, False), "korpus-v4-esp32-korpus", want_step)
    files["esp32-kryshka"] = export(for_print(hlid, True), "korpus-v4-esp32-kryshka", want_step)
    files["esp32-vkladysh"] = export(for_print(hinlay, True, hlid), "korpus-v4-esp32-vkladysh", False)
    print("\nВсе проверки прошли" if ok else "\nЕсть проваленные проверки — STL не печатать")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
