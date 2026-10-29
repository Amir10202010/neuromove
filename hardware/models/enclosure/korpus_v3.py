"""Корпуса NeuroMove, версия 3 (27 октября 2026): датчик со штырьками и ESP32 на маленькой макетной плате.

Почему третья версия. 26 октября решили без пайки: на всех трёх GY-521 припаяны угловые штырьки,
провода мама-папа надеваются на них, а 3V3 и GND раздаёт макетная плата. Корпуса v2 рассчитаны
на плоскую плату с кабелем: со штырьками и гнёздами крышка не закроется.

Замер Амирхана 27 октября (фото IMG_2789–2791):
  • датчик со штырьками — 22 мм поперёк ряда выводов, 19 мм вдоль ряда, 7 мм в высоту, если положить на стол.
    На столе он лежит с наклоном около 11°, сторона со штырьками выше. Наклон дают хвосты выводов под
    платой: 22 мм и 11° — это примерно 2,9 мм хвоста. Вдоль ряда 19 мм — меньше, чем нужно восьми
    выводам с шагом 2,54 (20,3 мм), поэтому ширина взята по корпусу v1, который сел на плату 15 октября;
  • макетная плата — 45 × 33 × 9 мм (на 170 точек: 17 столбцов, два ряда по 5 дырок);
  • ESP32 — 51 × 28 × 13 мм, вместе с макетной платой — 51 × 38 × 17 мм: один ряд выводов воткнут
    в макетную плату, второй висит за её краем.

Что нового против v2 (korpus_v2.py, оттуда же защёлка, основание с прорезями и всё общее):
  • датчик лежит ровно, а не с наклоном: хвосты выводов уходят в канавку в дне, плата лежит на площадке.
    Гнёзда проводов лежат на полке и упираются торцом в стенку: дёрнули за провода — тянет стенку,
    а не штырьки. Провода выходят плоской лентой в широкий паз, язычок крышки прижимает их сверху;
  • прорезь под ремешок 26 мм: ремешок шире 25 мм не нужен;
  • корпус ESP32 — под сборку «ESP32 на макетной плате»: макетная плата приклеена ко дну между упорами,
    висящий край ESP32 лежит на двух опорах, крышка прижимает его штырями. Над макетной платой —
    место под гнёзда проводов высотой 14 мм и изгиб провода. Три ленты проводов выходят в торец
    по своим ложбинкам, дверца крышки прижимает их, над ложбинками на крышке — буквы П, ПР, Г.

Сколько места на макетной плате (раздел «Провода» в ПЕЧАТЬ-v3.md): у каждого вывода ESP32 свободны
три дырки, ряды a, b, c. Ряд d закрывает край платы ESP32. Висящий ряд выводов (там D32 и D33) для
проводов не годится: гнездо на штырьке уходит на 14 мм вниз, а до дна корпуса там 9 мм. Поэтому все шины —
на правом ряду: с 27 октября прошивка по умолчанию на трёх шинах (NeuroMoveStand/config.h, схема-стенда.png).

Не печаталось. Проверено моделью — проверки ниже и proverka_v3.py.

Запуск (нужен Python с build123d: pip install build123d):
    python3 korpus_v3.py                  — модели, проверки, STL рядом с этим файлом
    python3 korpus_v3.py --provod 1.6     — толщина одной жилы провода мама-папа, мм (по умолчанию 1.4)
    python3 korpus_v3.py --natyag 0.25    — защёлка мягче (по умолчанию 0.30 мм), 0.35 — туже
    python3 korpus_v3.py --step           — то же и STEP для правки в любой CAD
    python3 korpus_v3.py --png            — то же и картинки (нужен Google Chrome)

Оси: X — вдоль кости (у ESP32 — вдоль платы), Y — поперёк, Z — вверх, к крышке. Ноль Z — дно.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field

from build123d import Axis, Box, BuildSketch, Cylinder, Locations, Mode, Part, Plane, Polygon, Pos, Rectangle, RectangleRounded, Rot, extrude

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import korpus_v2 as kv  # noqa: E402  — защёлка, основание, надписи, проверки и вывод — общие с v2

PITCH = 2.54  # шаг выводов и дырок макетной платы


# ── Параметры ──────────────────────────────────────────────────────────────────────────────────


@dataclass
class Sensor:
    """Корпус датчика GY-521 с угловыми штырьками и надетыми гнёздами проводов мама-папа.

    Ось X платы — поперёк ряда выводов, от выводов. Штырьки смотрят в −X,
    к кабелю; стрелка X на крышке — от кабеля."""

    board_w: float = 21.6  # плата вдоль ряда выводов, по Y — с запасом, как в v1 (сел 15 октября)
    board_l: float = 16.0  # плата поперёк ряда, по X: у продавцов 15,6–16,4 мм
    board_t: float = 1.6
    far_gap: float = 0.2  # от дальнего края платы до стенки +X
    pins: int = 8  # VCC GND SCL SDA XDA XCL AD0 INT
    wires: tuple[int, ...] = (0, 1, 2, 3, 6)  # провода на VCC, GND, SCL, SDA и AD0
    tail: float = 2.9  # хвосты выводов с пайкой под платой: из наклона 11° на столе
    tail_clear: float = 0.6
    tape: float = 0.1  # тонкий двусторонний скотч, не вспененный: высота платы не должна гулять
    pin_z: float = 1.27  # ось штырька над платой: пластик углового штырька — 2,5 мм
    plastic_off: float = 0.5  # торец пластика штырьков за краем платы
    housing_len: float = 14.0  # гнездо провода мама-папа
    housing_slack: float = 1.5  # гнездо может отъехать от пластика до стенки: на штырьке остаётся 4,5 мм из 6
    wire_d: float = 1.4  # одна жила провода мама-папа. Замерить: --provod
    squeeze: float = 0.3  # на столько язычок крышки вдавливает провода: 0,25 не прижимал у 5% отпечатков (proverka_v3.py)
    tongue_clear: float = 0.35
    side_clear: float = 0.4  # от гнёзд до бортика крышки по Y
    top_clear: float = 0.3  # от верха гнёзд до крышки
    wall: float = 1.8
    floor_t: float = 1.6
    trench_floor: float = 1.0  # под канавкой хвостов дно тоньше: 1 мм
    lid_t: float = 1.6
    lip: float = 2.4
    strap: float = 25.0  # ремешок до 25 мм, прорезь на 1 мм длиннее
    slot_h: float = 3.2
    slot_in: float = 1.6
    ear: float = 8.0
    ear_end: float = 2.4
    ear_t: float = 3.0
    r_v: float = 3.0
    snap: kv.Snap = field(default_factory=kv.Snap)

    # Высоты
    @property
    def ped_top(self) -> float:
        # Площадка под платой: хвосты выводов не достают до дна канавки
        return self.trench_floor + self.tail + self.tail_clear - self.tape

    @property
    def board_top(self) -> float:
        return self.ped_top + self.tape + self.board_t

    @property
    def pin_zc(self) -> float:
        return self.board_top + self.pin_z

    @property
    def housing_top(self) -> float:
        return self.pin_zc + PITCH / 2

    @property
    def height(self) -> float:
        return self.housing_top + self.top_clear

    # План
    @property
    def row_half(self) -> float:
        return self.pins * PITCH / 2

    @property
    def cav_w(self) -> float:
        # Бортик крышки (зазор + балка) ложится снаружи от гнёзд, а не над ними — корпус ниже
        return 2 * (self.row_half + self.side_clear + self.snap.fit + self.snap.beam_t)

    @property
    def cav_l(self) -> float:
        return self.far_gap + self.board_l + self.plastic_off + self.housing_len + self.housing_slack

    @property
    def length(self) -> float:
        # Широкий нагрудный ремень удлиняет только основание, не полость и крышку.
        return self.cav_l + 2 * self.wall

    @property
    def base_length(self) -> float:
        return max(self.length, self.strap + 1 + 2 + 2 * self.ear_end)

    @property
    def width(self) -> float:
        return self.cav_w + 2 * self.wall

    @property
    def x_pin_edge(self) -> float:
        # Край платы со штырьками — у платы средней длины
        return self.cav_l / 2 - self.far_gap - self.board_l

    @property
    def trench(self) -> tuple[float, float]:
        # Хвосты — в 1,27 мм от края платы; канавка накрывает их у плат 15,6–16,4 мм с запасом
        return (self.x_pin_edge - 1.2, self.x_pin_edge + 3.4)

    @property
    def x_housing_end(self) -> float:
        return self.x_pin_edge - self.plastic_off - self.housing_len

    @property
    def wire_ys(self) -> list[float]:
        return [(i - (self.pins - 1) / 2) * PITCH for i in self.wires]

    @property
    def slot_half(self) -> float:
        return (self.pins - 1) / 2 * PITCH + self.wire_d / 2 + 0.5

    @property
    def slot_bot(self) -> float:
        return self.pin_zc - self.wire_d / 2 - 0.15

    @property
    def tongue_bot(self) -> float:
        return self.pin_zc + self.wire_d / 2 - self.squeeze

    @property
    def slot_y(self) -> float:
        return self.width / 2 + self.slot_in + self.slot_h / 2


@dataclass
class Hub:
    """Корпус ESP32 DevKit (HW-394A, 30 выводов), воткнутой одним рядом в макетную плату на 170 точек.

    Как воткнуть (ПЕЧАТЬ-v3.md): ряд выводов с 3V3, GND, D21, D22 — в ряд e макетной платы, вывод D23 —
    в крайний столбец 1, 3V3 — в столбец 15. Второй ряд выводов висит за краем. USB-C смотрит в +X."""

    bb: tuple[float, float, float] = (45.0, 33.0, 9.0)
    bb_margin: float = 2.53  # от края макетной платы до первого ряда дырок: (33 − 11 шагов) / 2
    bb_col_margin: float = 2.18  # от торца до первого столбца: (45 − 16 шагов) / 2
    bb_gap: float = 0.3
    pcb: tuple[float, float, float] = (52.3, 28.7, 1.6)  # замер 23 октября по фото
    pin_from_usb: float = 9.8  # от торца с USB до первого вывода
    pin_row_off: float = 1.65  # от длинного края платы до оси ряда выводов
    header: float = 2.5  # пластик штырьков под платой ESP32
    row_e: int = 4  # в какой ряд макетной платы воткнута ESP32: a = 0, … e = 4
    module: tuple[float, float, float] = (18.0, 25.5, 3.1)
    usb: tuple[float, float, float] = (7.5, 9.0, 3.2)
    usb_out: float = 2.4  # разъём USB-C выступает за плату
    usb_w: float = 13.0
    usb_h: float = 8.0
    jumper_h: float = 14.0  # гнездо «папа» над макетной платой
    bend: float = 5.0  # изгиб провода над гнездом: гнёзда бывают до 15 мм
    wire_d: float = 1.4
    wire_n: int = 5  # жил в ленте
    chan_fit: float = 0.8  # ложбинка шире ленты
    tooth: float = 1.6  # перегородка между ложбинками
    chan_z: float = 20.0  # дно ложбинок над дном полости
    squeeze: float = 0.25
    door_clear: float = 0.35
    post: float = 3.0  # опоры под висящим краем ESP32
    foam: float = 1.6  # опора ниже края ESP32: на неё два слоя вспененного скотча — высота макетной платы гуляет на ±0,3 мм
    pin_d: float = 3.0  # штыри крышки над опорами
    hold_gap: float = 0.3
    wall: float = 2.0
    floor_t: float = 2.0
    lid_t: float = 1.8
    lip: float = 2.4
    cav_l: float = 54.4  # плата ESP32 до 53 мм: на 53,6 не входила у 8% отпечатков (proverka_v3.py)
    strap: float = 40.0
    slot_h: float = 3.4
    slot_in: float = 1.6
    ear: float = 8.0
    ear_end: float = 2.4
    ear_t: float = 3.0
    r_v: float = 4.0
    snap: kv.Snap = field(default_factory=lambda: kv.Snap(beam_len=28.0, beam_t=1.6))

    @property
    def bb_top(self) -> float:
        return self.floor_t + self.bb[2]

    @property
    def pcb_z(self) -> float:
        return self.bb_top + self.header

    @property
    def pcb_top(self) -> float:
        return self.pcb_z + self.pcb[2]

    @property
    def usb_zc(self) -> float:
        return self.pcb_top + self.usb[2] / 2

    @property
    def x_usb_end(self) -> float:
        return self.cav_l / 2 - 0.6

    @property
    def col_x(self) -> list[float]:
        # Столбцы макетной платы: вывод 1 ESP32 (D23) — в столбце 1, 3V3 — в 15
        x15 = self.x_usb_end - self.pin_from_usb
        return [x15 + (k - 15) * PITCH for k in range(1, 18)]

    @property
    def bb_x(self) -> tuple[float, float]:
        x0 = self.col_x[0] - self.bb_col_margin
        return (x0, x0 + self.bb[0])

    @property
    def row_y(self) -> list[float]:
        # Ряды a–e: макетная плата прижата к стенке +Y, ряд a — у стенки
        y_edge = self.cav_w / 2 - self.bb_gap
        return [y_edge - self.bb_margin - i * PITCH for i in range(5)]

    @property
    def pcb_y(self) -> tuple[float, float]:
        y_hi = self.row_y[self.row_e] + self.pin_row_off
        return (y_hi - self.pcb[1], y_hi)

    @property
    def pcb_yc(self) -> float:
        return sum(self.pcb_y) / 2

    @property
    def cav_w(self) -> float:
        # Макетная плата 33 мм, за её краем — ESP32 до края платы; по 0,3–0,6 мм запаса
        y_hi = self.bb_gap + self.bb_margin + self.row_e * PITCH - self.pin_row_off
        return round(y_hi + self.pcb[1] + 0.2 + 0.6 + self.bb_gap, 1)

    @property
    def jumper_top(self) -> float:
        return self.bb_top + self.jumper_h

    @property
    def height(self) -> float:
        return self.jumper_top + self.bend

    @property
    def length(self) -> float:
        return self.cav_l + 2 * self.wall

    @property
    def width(self) -> float:
        return self.cav_w + 2 * self.wall

    @property
    def chan_w(self) -> float:
        return self.wire_n * self.wire_d + self.chan_fit

    @property
    def chan_ys(self) -> list[float]:
        return [(i - 1) * (self.chan_w + self.tooth) for i in range(3)]

    @property
    def window_half(self) -> float:
        return 1.5 * self.chan_w + self.tooth

    @property
    def chan_bot(self) -> float:
        return self.floor_t + self.chan_z

    @property
    def door_bot(self) -> float:
        return self.chan_bot + self.wire_d - self.squeeze

    @property
    def corners(self) -> list[tuple[float, float]]:
        # Опоры и штыри — под углами висящего края ESP32: там нет ни выводов, ни модуля, ни USB
        y = self.pcb_y[0] + 1.5 + self.post / 2
        x_ant = self.x_usb_end - self.pcb[0] + 0.8 + self.post / 2
        x_usb = self.x_usb_end - 0.5 - self.post / 2 - 2.0
        return [(x_ant, y), (x_usb, y)]

    @property
    def slot_y(self) -> float:
        return self.width / 2 + self.slot_in + self.slot_h / 2


# Провода на макетной плате: (столбец, ряд, что, цвет). Ряд 0 = a. Столбец k — вывод k ESP32 от антенны
# (правый ряд: 1 D23, 2 D22, 5 D21, 6 D19, 7 D18, 14 GND, 15 3V3), 16 — продолжение 3V3 через перемычку
RED, BLACK, GREEN, WHITE, ORANGE = "#d63b3b", "#262626", "#2f9e44", "#e8e8e8", "#f08c00"
JUMPERS = (
    (15, 0, "VCC П", RED), (15, 1, "VCC ПР", RED), (15, 2, "VCC Г", RED), (16, 0, "AD0 ПР", ORANGE),
    (14, 0, "GND П", BLACK), (14, 1, "GND ПР", BLACK), (14, 2, "GND Г", BLACK),
    (5, 0, "SDA П", GREEN), (5, 1, "SDA ПР", GREEN), (2, 0, "SCL П", WHITE), (2, 1, "SCL ПР", WHITE),
    (6, 0, "SDA Г", GREEN), (7, 0, "SCL Г", WHITE),
)


# ── Общие детали ───────────────────────────────────────────────────────────────────────────────


def lid_rim(inner_len: float, inner_wid: float, s: kv.Snap, lip: float, top_z: float, cutouts: list[tuple[float, float, float]], r_cav: float) -> Part:
    """Бортик крышки с гибкими балками — как kv.lid_rim, но вырезы (x, y, ширина) могут стоять не по центру."""
    outer_l = inner_len - 2 * s.fit
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
    zt = s.bump_top(top_z)
    zb = zt - s.bump_h
    for sy in (-1, 1):
        y0 = sy * outer_w / 2
        pts = [(y0 - sy * 0.05, zb), (y0 + sy * s.out, zb + s.lead_dz), (y0 + sy * s.out, zb + s.lead_dz + s.crest), (y0 - sy * 0.05, zt)]
        with BuildSketch(Plane.YZ) as sk2:
            Polygon(*pts, align=None)
        frame = frame + extrude(sk2.sketch, amount=s.bump_len / 2, both=True)
    return frame


def block(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> Part:
    """Брусок по границам — так проще читать раскладку, чем по центру и размеру."""
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(x1 - x0, y1 - y0, z1 - z0)


def wire_x(x0: float, x1: float, y: float, z: float, d: float) -> Part:
    return Pos((x0 + x1) / 2, y, z) * Rot(0, 90, 0) * Cylinder(d / 2, abs(x1 - x0))


# ── Корпус датчика ─────────────────────────────────────────────────────────────────────────────


def sensor_box(p: Sensor) -> Part:
    """Дно ступенькой: полка под гнёздами, канавка под хвостами выводов, площадка под платой.
    Провода выходят в торец −X, торец +X глухой, в нём выемка под ноготь."""
    L, W, H = p.length, p.width, p.height
    cx0, cx1 = -p.cav_l / 2, p.cav_l / 2
    cy = p.cav_w / 2
    body = kv.shell(L, W, H, p.r_v, p.ear, p.ear_t, p.strap + 1, p.slot_h, p.slot_y, base_length=p.base_length)
    body = body - Pos(0, 0, p.floor_t) * extrude(RectangleRounded(p.cav_l, p.cav_w, 1.0), amount=H)
    t0, t1 = p.trench
    # Площадка под платой — от канавки до стенки +X; полка под гнёздами — от стенки −X до канавки
    body = body + block(t1, cx1 + 0.01, -cy - 0.01, cy + 0.01, p.floor_t - 0.01, p.ped_top)
    body = body + block(cx0 - 0.01, t0, -cy - 0.01, cy + 0.01, p.floor_t - 0.01, p.board_top - 0.3)
    # Канавка под хвостами выводов — глубже дна на 0,6 мм
    body = body - block(t0, t1, -(p.row_half + 0.8), p.row_half + 0.8, p.trench_floor, p.floor_t + 0.01)
    # Упоры по бокам платы: плата не ездит поперёк. Ниже бортика крышки
    for s in (-1, 1):
        y_in = s * (p.board_w / 2 + 0.1)
        body = body + block(t1 + 0.5, cx1 - 1.0, min(y_in, s * (cy + 0.01)), max(y_in, s * (cy + 0.01)), p.ped_top - 0.01, p.board_top - 0.2)
    # Паз проводов в торце −X, открыт сверху: провода кладут сверху, язычок крышки прижимает их
    xw = -(L / 2 - p.wall / 2)
    body = body - Pos(xw, 0, (p.slot_bot + H + 1) / 2) * Box(p.wall + 2, 2 * p.slot_half, H + 1 - p.slot_bot)
    body = body - kv.snap_grooves(p.cav_w, p.snap, H)
    body = body - kv.pry_notch_end(L, H, 1.0)
    return body


def sensor_lid(p: Sensor, label: str = "", arrow_to_cable: bool = False) -> Part:
    """Крышка в собранном положении. Язычок в пазу торца −X прижимает провода — крышка встаёт только
    одной стороной. «П», «ПР»: стрелка X от кабеля, к кисти; «Г»: к кабелю, вниз."""
    L, W, H = p.length, p.width, p.height
    plate = kv.lid_plate(L, W, H, p.lid_t, p.r_v, 0.8)
    # Бортик над гнёздами у торца −X вырезан: гнёзда подходят к стенке вплотную
    rim = lid_rim(p.cav_l, p.cav_w, p.snap, p.lip, H, [(-p.cav_l / 2, 0, 2 * (p.row_half + p.side_clear))], r_cav=1.0)
    tw = 2 * p.slot_half - 2 * p.tongue_clear
    tongue = Pos(-(L / 2 - p.wall / 2), 0, (p.tongue_bot + H) / 2 + 0.005) * Box(p.wall, tw, H - p.tongue_bot + 0.01)
    lid = plate + rim + tongue
    top = H + p.lid_t
    deco = kv.text_cut("NeuroMove", 5.0, 1.2, 4.9, top, 0.6) + kv.arrow_cut(3.0, -5.8, top, 0.6, scale=0.95)
    if label:
        deco = deco + kv.text_cut(label, 4.6, -11.4, -5.8, top, 0.6, font=kv.FONT_LABEL)
    if arrow_to_cable:
        deco = deco.rotate(Axis.Z, 180)
    return lid - deco


def sensor_parts(p: Sensor) -> dict[str, Part]:
    """Плата и всё, что на ней, в собранном положении — для проверок и картинок."""
    x_e = p.x_pin_edge
    bz = p.ped_top + p.tape
    parts = {
        "плата": block(x_e, x_e + p.board_l, -p.board_w / 2 + 0.3, p.board_w / 2 - 0.3, bz, bz + p.board_t),
        "хвосты выводов": block(x_e + 1.27 - 0.6, x_e + 1.27 + 0.6, -p.row_half, p.row_half, bz - p.tail, bz),
        "пластик штырьков": block(x_e - p.plastic_off, x_e + 2.0, -p.row_half, p.row_half, p.board_top, p.board_top + 2.5),
        "детали на плате": block(x_e + 3.0, x_e + p.board_l - 1.6, -p.board_w / 2 + 1.8, p.board_w / 2 - 1.8, p.board_top, p.board_top + 1.9),
        "чип": block(x_e + p.board_l / 2 - 2, x_e + p.board_l / 2 + 2, -2, 2, p.board_top, p.board_top + 0.9),
    }
    xs = x_e - p.plastic_off
    parts["гнёзда"] = block(xs - p.housing_len, xs, -p.row_half + 0.03, p.row_half - 0.03, p.board_top, p.housing_top)
    return parts


def sensor_wires(p: Sensor, x_out: float = 8.0) -> list[Part]:
    x0 = p.x_housing_end + 0.01
    x1 = -(p.length / 2 + x_out)
    return [wire_x(x0, x1, y, p.pin_zc, p.wire_d) for y in p.wire_ys]


# ── Корпус ESP32 на макетной плате ─────────────────────────────────────────────────────────────


def hub_box(p: Hub) -> Part:
    L, W, H = p.length, p.width, p.height
    cx, cy = p.cav_l / 2, p.cav_w / 2
    body = kv.shell(L, W, H, p.r_v, p.ear, p.ear_t, p.strap + 2, p.slot_h, p.slot_y)
    body = body - Pos(0, 0, p.floor_t) * extrude(RectangleRounded(p.cav_l, p.cav_w, 1.5), amount=H)
    fz, rib_h = p.floor_t - 0.01, p.floor_t + 3.0
    # Упоры макетной платы: по торцам и вдоль края −Y. К стенке +Y она прижата сама
    bx0, bx1 = p.bb_x
    by0 = cy - p.bb_gap - p.bb[1]
    body = body + block(bx0 - 0.5 - 1.2, bx0 - 0.5, by0 + 2, cy + 0.01, fz, rib_h)
    body = body + block(bx1 + 0.5, bx1 + 0.5 + 1.2, by0 + 2, cy + 0.01, fz, rib_h)
    body = body + block(bx0 + 4, bx1 - 4, by0 - 0.3 - 1.2, by0 - 0.3, fz, rib_h)
    # Опоры под висящим краем ESP32
    for x, y in p.corners:
        body = body + Pos(x, y, (fz + p.pcb_z - p.foam) / 2) * Box(p.post, p.post, p.pcb_z - p.foam - fz)
    # Вырез USB-C в торце +X, открыт сверху
    z0 = p.usb_zc - p.usb_h / 2
    with BuildSketch(Plane.YZ.offset(L / 2 - p.wall - 1)) as sk:
        with Locations((p.pcb_yc, (z0 + H + 3) / 2)):
            RectangleRounded(p.usb_w, H + 3 - z0, 2.0)
    body = body - extrude(sk.sketch, amount=p.wall + 2)
    # Окно лент в торце −X, открыто сверху; внизу перегородки делят его на три ложбинки
    xw = -(L / 2 - p.wall / 2)
    body = body - Pos(xw, 0, (p.chan_bot + H + 1) / 2) * Box(p.wall + 2, 2 * p.window_half, H + 1 - p.chan_bot)
    for i in (0, 1):
        y = (p.chan_ys[i] + p.chan_ys[i + 1]) / 2
        body = body + Pos(xw, y, (p.chan_bot + p.door_bot - 0.2) / 2) * Box(p.wall + 0.02, p.tooth, p.door_bot - 0.2 - p.chan_bot + 0.02)
    body = body - kv.snap_grooves(p.cav_w, p.snap, H)
    body = body - kv.pry_notch_side(L / 2 - 10, W, H, p.wall - 0.8)
    return body


def hub_lid(p: Hub) -> Part:
    L, W, H = p.length, p.width, p.height
    lid = kv.lid_plate(L, W, H, p.lid_t, p.r_v, 0.9)
    lid = lid + lid_rim(p.cav_l, p.cav_w, p.snap, p.lip, H, [(p.cav_l / 2, p.pcb_yc, p.usb_w + 1.0)], r_cav=1.5)
    # Дверца: закрывает окно лент и прижимает их
    door_w = 2 * p.window_half - 2 * p.door_clear
    lid = lid + Pos(-(L / 2 - p.wall / 2), 0, (p.door_bot + H) / 2 + 0.005) * Box(p.wall, door_w, H - p.door_bot + 0.01)
    # Штыри над опорами: висящий край ESP32 зажат между опорой и штырём
    pin_len = H - (p.pcb_top + p.hold_gap)
    for x, y in p.corners:
        lid = lid + Pos(x, y, H - pin_len / 2 + 0.005) * Cylinder(p.pin_d / 2, pin_len + 0.01)
    top = H + p.lid_t
    deco = kv.text_cut("NeuroMove", 7.4, 3.0, 0, top, 0.6)
    # Буквы над ложбинками — какая лента куда
    for (name, y) in zip(("П", "ПР", "Г"), p.chan_ys):
        deco = deco + kv.text_cut(name, 3.6, -L / 2 + 4.6, y, top, 0.6, font=kv.FONT_LABEL)
    return lid - deco


def hub_parts(p: Hub) -> dict[str, Part]:
    bx0, bx1 = p.bb_x
    cy = p.cav_w / 2
    by1 = cy - p.bb_gap
    py0, py1 = p.pcb_y
    xu = p.x_usb_end
    xa = xu - p.pcb[0]
    col = p.col_x
    pin_span = (col[0] - 1.27, col[14] + 1.27)
    y_hang = p.row_y[p.row_e] - 25.4
    return {
        "макетная плата": block(bx0, bx1, by1 - p.bb[1], by1, p.floor_t, p.bb_top),
        "плата ESP32": block(xa, xu, py0, py1, p.pcb_z, p.pcb_top),
        "модуль ESP32": block(xa, xa + p.module[1], p.pcb_yc - p.module[0] / 2, p.pcb_yc + p.module[0] / 2, p.pcb_top, p.pcb_top + p.module[2]),
        "разъём USB-C": block(xu - p.usb[0] + p.usb_out, xu + p.usb_out, p.pcb_yc - p.usb[1] / 2, p.pcb_yc + p.usb[1] / 2, p.pcb_top, p.pcb_top + p.usb[2]),
        "штырьки в макетной плате": block(*pin_span, p.row_y[p.row_e] - 1.27, p.row_y[p.row_e] + 1.27, p.bb_top, p.pcb_z),
        "висящие штырьки": block(*pin_span, y_hang - 1.27, y_hang + 1.27, p.bb_top - 6.0, p.pcb_z),
    }


def hub_jumpers(p: Hub) -> dict[str, tuple[Part, str]]:
    out = {}
    for c, r, name, color in JUMPERS:
        x, y = p.col_x[c - 1], p.row_y[r]
        out[name] = (block(x - 1.25, x + 1.25, y - 1.25, y + 1.25, p.bb_top, p.jumper_top), color)
    return out


def hub_ribbons(p: Hub) -> list[list[Part]]:
    x0, x1 = -(p.cav_l / 2 - 4.0), -(p.length / 2 + 10)
    z = p.chan_bot + p.wire_d / 2 + 0.02
    out = []
    for yc in p.chan_ys:
        ys = [yc + (i - (p.wire_n - 1) / 2) * p.wire_d for i in range(p.wire_n)]
        out.append([wire_x(x0, x1, y, z, p.wire_d * 0.98) for y in ys])
    return out


# ── Проверки ───────────────────────────────────────────────────────────────────────────────────


ov = kv.overlap


def check_sensor(p: Sensor, box: Part, lids: dict[str, Part]) -> bool:
    r = kv.Report(f"Датчик v3: {p.length:.1f} × {p.width:.1f} × {p.height + p.lid_t:.1f} мм, с основанием {p.width + 2 * p.ear:.1f} мм")
    r.check(len(box.solids()) == 1, f"корпус — один кусок ({len(box.solids())})")
    for name, lid in lids.items():
        r.check(len(lid.solids()) == 1, f"крышка «{name}» — один кусок ({len(lid.solids())})")
    parts = sensor_parts(p)
    for name in ("плата", "хвосты выводов", "пластик штырьков", "гнёзда"):
        r.check(ov(parts[name], box) < 1e-3, f"{name} — входят, корпус не задевают")
    r.check(ov(Pos(0, 0, -0.3) * parts["плата"], box) > 1e-3, "плата лежит на площадке ровно: ниже на 0,3 мм — упирается")
    r.check(ov(Pos(0, 0, -0.3) * parts["хвосты выводов"], box) < 1e-3, "хвосты выводов не достают дна канавки и с запасом 0,3 мм")
    r.check(ov(Pos(0, 0.5, 0) * parts["плата"], box) > 1e-3, "плата, сдвинутая вбок на 0,5 мм, упирается в упор")
    gap = p.x_housing_end - (-p.cav_l / 2)
    r.check(ov(Pos(-(gap + 0.2), 0, 0) * parts["гнёзда"], box) > 1e-3, f"гнёзда отъезжают не больше чем на {gap:.1f} мм — дальше стенка; на штырьке остаётся {6 - gap:.1f} мм")
    for name, lid in lids.items():
        v = sum(ov(parts[n], lid) for n in ("плата", "пластик штырьков", "детали на плате", "гнёзда"))
        r.check(v < 1e-3, f"крышка «{name}» не задевает плату, детали до 1,9 мм, пластик штырьков и гнёзда")
    kv.check_snap(r, lids["П"], box, p.snap, p.cav_w, p.height)
    wires = sensor_wires(p)
    r.check(all(ov(w, box) < 1e-3 for w in wires), f"{len(wires)} проводов по {p.wire_d} мм ложатся в паз торца −X")
    for name, lid in lids.items():
        vs = [ov(w, lid) for w in wires]
        r.check(min(vs) > 1e-4, f"язычок крышки «{name}» прижимает каждый провод на {p.squeeze} мм (меньшее {min(vs):.3f} мм³)")
    # Гнездо в паз не пролезает: паз ниже гнезда сверху и снизу
    r.check(p.slot_bot > p.board_top and p.tongue_bot < p.housing_top,
            f"гнездо в паз не пролезает: паз {p.slot_bot:.2f}–{p.tongue_bot:.2f} мм, гнездо {p.board_top:.2f}–{p.housing_top:.2f} — дёрнули провода, тянет стенку")
    other = wire_x(p.cav_l / 2 - 0.5, p.length / 2 + 6, 0, p.pin_zc, p.wire_d)
    r.check(ov(other, box) > 1e-3, "торец +X глухой")
    for s in (-1, 1):
        strap = Pos(0, s * p.slot_y, p.ear_t / 2) * Box(p.strap, 2.0, p.ear_t + 4)
        r.check(ov(strap, box) < 1e-3, f"ремешок {p.strap:.0f} мм проходит сквозь прорезь {'−' if s < 0 else '+'}Y")
    r.check(ov(Pos(0, p.slot_y, p.ear_t / 2) * Box(p.strap + 3, 2.0, p.ear_t + 4), box) > 1e-3, f"ремешок {p.strap + 3:g} мм уже не проходит — проверка прорези не пустая")
    r.check(p.wall - p.snap.interference - p.snap.clear >= 1.2, f"стенка у паза защёлки — {p.wall - p.snap.interference - p.snap.clear:.2f} мм, не тоньше 1,2")
    r.check(p.trench_floor >= 1.0, f"дно под канавкой — {p.trench_floor} мм")
    r.note(f"высоты: площадка {p.ped_top:.2f}, плата {p.board_top - p.board_t:.2f}–{p.board_top:.2f}, ось штырьков {p.pin_zc:.2f}, "
           f"верх гнёзд {p.housing_top:.2f}, верх корпуса {p.height:.2f}, с крышкой {p.height + p.lid_t:.2f} мм")
    return r.print()


def check_hub(p: Hub, box: Part, lid: Part) -> bool:
    r = kv.Report(f"ESP32 на макетной плате: {p.length:.1f} × {p.width:.1f} × {p.height + p.lid_t:.1f} мм, с основанием {p.width + 2 * p.ear:.1f} мм")
    r.check(len(box.solids()) == 1, f"корпус — один кусок ({len(box.solids())})")
    r.check(len(lid.solids()) == 1, f"крышка — один кусок ({len(lid.solids())})")
    parts = hub_parts(p)
    for name, part in parts.items():
        r.check(ov(part, box) < 1e-3 and ov(part, lid) < 1e-3, f"{name} — на месте, корпус и крышку не задевают")
    bb = parts["макетная плата"]
    r.check(ov(Pos(-1.0, 0, 0) * bb, box) > 1e-3 and ov(Pos(1.0, 0, 0) * bb, box) > 1e-3 and ov(Pos(0, -1.0, 0) * bb, box) > 1e-3,
            "макетная плата, сдвинутая на 1 мм в любую сторону, упирается — упоры держат")
    pcb = parts["плата ESP32"]
    r.check(ov(Pos(0, 0, -0.3) * pcb, box) < 1e-3 and ov(Pos(0, 0, -(p.foam + 0.05)) * pcb, box) > 1e-3,
            f"висящий край ESP32 лежит на опорах через два слоя скотч-пены ({p.foam} мм под краем)")
    r.check(ov(Pos(0, 0, p.hold_gap + 0.2) * pcb, lid) > 1e-3, f"ESP32 выше на {p.hold_gap + 0.2:.1f} мм упирается в штыри крышки — не болтается")
    jumpers = hub_jumpers(p)
    bad = [n for n, (j, _) in jumpers.items() if ov(j, box) > 1e-3 or ov(j, lid) > 1e-3 or ov(j, pcb) > 1e-3]
    r.check(not bad, f"{len(jumpers)} гнёзд «папа» в рядах a–c стоят, не задевая ESP32, корпус и крышку" + (f": мешают {bad}" if bad else ""))
    x, y = p.col_x[14], p.row_y[3]
    row_d = block(x - 1.25, x + 1.25, y - 1.25, y + 1.25, p.bb_top, p.jumper_top)
    r.check(ov(row_d, pcb) > 1e-3, "в ряд d гнездо не встанет — мешает край ESP32: поэтому три дырки, a–c")
    flat = block(p.col_x[14] - 0.3, p.col_x[15] + 0.3, y - 0.3, y + 0.3, p.bb_top, p.bb_top + 0.8)
    r.check(ov(flat, pcb) < 1e-3 and ov(flat, box) < 1e-3, "перемычка 3V3 из столбца 15 в 16 по ряду d лежит под краем ESP32")
    r.check(p.height - p.jumper_top >= 4.5, f"над гнёздами {p.height - p.jumper_top:.1f} мм на изгиб провода")
    hang = parts["висящие штырьки"]
    under = Pos(0, 0, -14.0 + 6.0) * hang  # гнездо «мама» на висящем штырьке ушло бы на 14 мм вниз
    r.check(ov(under, box) > 1e-3, "гнездо «мама» на висящий вывод (D32, D33) упёрлось бы в дно — поэтому шина 1 на D19, D18")
    kv.check_snap(r, lid, box, p.snap, p.cav_w, p.height)
    plug = Pos(p.length / 2 + 2, p.pcb_yc, p.usb_zc) * Box(16.0, 12.0, 6.5)
    r.check(ov(plug, box) < 1e-3 and ov(plug, lid) < 1e-3, "штекер USB-C 12 × 6,5 мм входит в вырез")
    for name, ribbon in zip(("П", "ПР", "Г"), hub_ribbons(p)):
        free = all(ov(w, box) < 1e-3 for w in ribbon)
        pressed = min(ov(w, lid) for w in ribbon)
        r.check(free and pressed > 1e-4, f"лента «{name}», {p.wire_n} жил по {p.wire_d} мм, лежит в своей ложбинке, дверца прижимает каждую жилу")
    for s in (-1, 1):
        strap = Pos(0, s * p.slot_y, p.ear_t / 2) * Box(p.strap, 2.0, p.ear_t + 4)
        r.check(ov(strap, box) < 1e-3, f"ремень {p.strap:.0f} мм проходит сквозь прорезь {'−' if s < 0 else '+'}Y")
    r.note(f"высоты: макетная плата до {p.bb_top:.1f}, ESP32 {p.pcb_z:.1f}–{p.pcb_top:.1f}, гнёзда до {p.jumper_top:.1f}, "
           f"ложбинки {p.chan_bot:.1f}, верх корпуса {p.height:.1f}, с крышкой {p.height + p.lid_t:.1f} мм")
    return r.print()


# ── Картинки ───────────────────────────────────────────────────────────────────────────────────


SHELL, LID = "#f4f4f2", "#ecebe8"


def sensor_scene(p: Sensor, box: Part, lid: Part, lift: float = 14.0) -> list[tuple[Part, str]]:
    parts = sensor_parts(p)
    xs = p.x_pin_edge - p.plastic_off
    scene = [(box, SHELL), (Pos(0, 0, lift) * lid, LID), (parts["плата"], "#1f4fa8"), (parts["чип"], "#1b1b1b"),
             (parts["пластик штырьков"], "#1b1b1b")]
    colors = (RED, BLACK, WHITE, GREEN, ORANGE)
    for (i, w), color in zip(zip(p.wires, sensor_wires(p, 18.0)), colors):
        y = (i - (p.pins - 1) / 2) * PITCH
        scene.append((block(xs - p.housing_len, xs, y - 1.24, y + 1.24, p.board_top, p.housing_top), "#202020"))
        scene.append((w, color))
    return scene


def hub_scene(p: Hub, box: Part, lid: Part | None, lift: float = 22.0) -> list[tuple[Part, str]]:
    parts = hub_parts(p)
    scene = [(box, SHELL)] + ([(Pos(0, 0, lift) * lid, LID)] if lid is not None else []) + [(parts["макетная плата"], "#fafafa"), (parts["плата ESP32"], "#1f3a5f"),
             (parts["модуль ESP32"], "#c9c9c9"), (parts["разъём USB-C"], "#9a9a9a"), (parts["штырьки в макетной плате"], "#202020"),
             (parts["висящие штырьки"], "#202020")]
    for j, color in hub_jumpers(p).values():
        c = j.bounding_box().center()
        scene.append((j, "#202020"))
        # Цветной провод над гнездом — видно, какой куда
        scene.append((block(c.X - 0.6, c.X + 0.6, c.Y - 0.6, c.Y + 0.6, p.jumper_top, p.jumper_top + 2.5), color))
    for ribbon in hub_ribbons(p):
        for w, color in zip(ribbon, (RED, BLACK, WHITE, GREEN, ORANGE)):
            scene.append((w, color))
    return scene


# ── Запуск ─────────────────────────────────────────────────────────────────────────────────────


SENSORS = kv.SENSORS  # («П», "P", стрелка к кабелю?)


def main() -> int:
    want_png = "--png" in sys.argv
    want_step = "--step" in sys.argv
    natyag = kv.arg("--natyag", kv.Snap().interference)
    provod = kv.arg("--provod", Sensor().wire_d)
    ok = True
    p = Sensor(wire_d=provod, snap=kv.Snap(interference=natyag))
    box = sensor_box(p)
    lids = {label: sensor_lid(p, label, to_cable) for label, _, to_cable in SENSORS}
    ok &= check_sensor(p, box, lids)
    kv.export(kv.for_print(box, flip=False), "korpus-v3-datchik-korpus", want_step)
    for label, fname, _ in SENSORS:
        kv.export(kv.for_print(lids[label], flip=True), f"korpus-v3-datchik-kryshka-{fname}", want_step)
    hp = Hub(wire_d=provod, snap=kv.Snap(beam_len=28.0, beam_t=1.6, interference=natyag))
    hbox, hlid = hub_box(hp), hub_lid(hp)
    ok &= check_hub(hp, hbox, hlid)
    kv.export(kv.for_print(hbox, flip=False), "korpus-v3-esp32-korpus", want_step)
    kv.export(kv.for_print(hlid, flip=True), "korpus-v3-esp32-kryshka", want_step)
    if want_png:
        kv.render_png(sensor_scene(p, box, lids["П"]), os.path.join(HERE, "korpus-v3-datchik-vid.png"),
                      "Датчик v3: плата ровно на площадке, гнёзда упираются в стенку, язычок прижимает провода")
        kv.render_png(hub_scene(hp, hbox, hlid), os.path.join(HERE, "korpus-v3-esp32-vid.png"),
                      "ESP32 на макетной плате: провода в рядах a–c, три ленты под дверцей крышки")
        kv.render_png(hub_scene(hp, hbox, None), os.path.join(HERE, "korpus-v3-esp32-sverhu.png"),
                      "Без крышки, сверху: USB справа, ленты выходят слева. Цвет над гнездом — какой провод", view="top")
        kv.render_png([(Pos(-24, 0, 0) * lids["П"], LID), (Pos(24, 0, 0) * lids["Г"], LID), (Pos(0, -52, 0) * hlid, LID)],
                      os.path.join(HERE, "korpus-v3-kryshki-sverhu.png"), "Крышки сверху: датчик П, датчик Г, ESP32", view="top")
    print("\nВсе проверки прошли" if ok else "\nЕсть проваленные проверки — STL не печатать")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
