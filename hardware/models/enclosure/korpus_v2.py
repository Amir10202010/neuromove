"""Корпуса NeuroMove, версия 2 (22 октября 2026): датчик GY-521 и плата ESP32 DevKit.

Что нового против первой версии (korpus-gy521.scad):
  • крышка держится на защёлках, без клея и скотча. В бортике крышки на длинных сторонах — гибкая
    балка с выступом, в стенке корпуса — паз. Нажал — щёлкнуло; открыть — ногтем в выемку на торце.
    Гнётся балка, а не стенка: стенка корпуса низкая и толстая, её рукой не отогнуть — расчёт
    в proverka_v2.py. Балка печатается вдоль слоёв и гнётся вдоль них: так пластик прочнее всего;
  • крышка зажимает кабель: язычок крышки входит в паз торца и давит на кабель сверху. Дёрнули
    за кабель — тянет корпус, а не пайку;
  • выход кабеля один, второй торец глухой. Крышка из-за язычка встаёт только одной стороной,
    поэтому стрелку X на ней не перепутать. Крышек три, с буквой датчика: «П» и «ПР» — стрелка от
    кабеля, к кисти; «Г» — стрелка к кабелю, вниз;
  • на крышке — NeuroMove, стрелка оси X и буква датчика; основание с прорезями под ремешок слито
    с корпусом, скругления, фаска по низу и по шву крышки;
  • корпус для ESP32: носится на поясе вертикально, USB снизу, кабели датчиков сверху. Плата
    лежит на угловых опорах, крышка прижимает её штырями, кабели зажимает дверца крышки.

Размеры платы датчика, кабеля, ремешка, упоров и зазор бортика — из первой версии: её отпечаток
15 октября сел на плату, крышка закрылась, ремешок прошёл (enclosure/фото-*.jpg). Вторая версия
не печаталась: проверена моделью — проверки ниже и proverka_v2.py.

Запуск (нужен Python с build123d: pip install build123d):
    python3 korpus_v2.py                  — модели, проверки, STL рядом с этим файлом
    python3 korpus_v2.py --natyag 0.25    — защёлка мягче (по умолчанию 0.30 мм), 0.35 — туже
    python3 korpus_v2.py --step           — то же и STEP для правки в любой CAD (Fusion, FreeCAD, Onshape)
    python3 korpus_v2.py --png            — то же и картинки для README (нужен Google Chrome)

Оси: X — вдоль кости (у ESP32 — вдоль платы), Y — поперёк, Z — вверх, к крышке. Ноль Z — дно.
"""

from __future__ import annotations

import base64
import math
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field

from build123d import (
    Align,
    Axis,
    Box,
    BuildSketch,
    Circle,
    Cylinder,
    Locations,
    Location,
    Mode,
    Part,
    Plane,
    Polygon,
    Pos,
    Rectangle,
    RectangleRounded,
    Rot,
    Text,
    chamfer,
    export_step,
    export_stl,
    extrude,
    fillet,
)

HERE = os.path.dirname(os.path.abspath(__file__))
# Шрифты надписей. На Windows их нет — подставьте любой жирный .ttf; для букв П, ПР, Г — с кириллицей
FONT = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"
FONT_LABEL = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

# Датчики: буква на крышке, имя файла, стрелка к кабелю или от него
SENSORS = (("П", "P", False), ("ПР", "PR", False), ("Г", "G", True))


# ── Параметры ──────────────────────────────────────────────────────────────────────────────────


@dataclass
class Snap:
    """Защёлка крышки: гибкая балка в бортике крышки, на ней выступ; в стенке корпуса — паз."""

    fit: float = 0.25  # зазор бортика и стенки, как в первой версии: её крышка садилась свободно
    # Насколько выступ заходит за стенку: на столько прогибается балка. 0,30 и балка 1,3 мм — лучшие
    # из 12 сочетаний по 1000 случайных отпечатков каждое (proverka_v2.py)
    interference: float = 0.30
    bump_len: float = 4.0  # длина выступа вдоль балки
    lead_deg: float = 40.0  # скос захода от вертикали: крышка входит легко
    ret_deg: float = 50.0  # скос удержания от вертикали: держит, но открывается ногтем в выемке
    crest: float = 0.2  # плоская вершина выступа
    beam_len: float = 24.0  # длина гибкой балки: концы держатся за углы бортика
    beam_t: float = 1.3  # толщина балки и всего бортика
    slit: float = 0.6  # прорезь между балкой и пластиной крышки: балка свободна по всей длине
    clear: float = 0.2  # запас паза по глубине и по высоте

    @property
    def out(self) -> float:
        # Насколько выступ выходит за наружную грань бортика
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
        # Верх выступа — чуть ниже верха балки
        return top_z - self.slit - 0.15


@dataclass
class SensorParams:
    """Корпус датчика GY-521. Числа — как в korpus-gy521.scad (проверены отпечатком 15 октября)."""

    x_along: str = "short"  # "short" — ось X платы вдоль короткой стороны (вариант «поперёк»), "long" — «вдоль»
    board: tuple[float, float, float] = (21.6, 16.6, 1.6)  # GY-521 с запасом 0,3 мм
    gap: float = 0.4
    tape: float = 1.2  # скотч-пена под платой
    cable_d: float = 4.6  # самый толстый кабель; тоньше — изолента в месте паза
    cable_fit: float = 0.6  # паз шире кабеля: на печати пазы выходят уже
    squeeze: float = 0.3  # на столько язычок крышки вдавливает оболочку кабеля
    tongue_clear: float = 0.35  # зазор язычка в пазу с каждой стороны: язычок не заклинит
    wall: float = 1.8
    floor_t: float = 1.6
    lid_t: float = 1.6
    lip: float = 2.4  # бортик крышки уходит в корпус
    strap: float = 30.0  # ширина ремешка
    slot_h: float = 3.2
    slot_in: float = 1.6
    ear: float = 8.0  # вынос основания с прорезью от стенки
    ear_end: float = 2.4  # перемычки по торцам прорези
    ear_t: float = 3.0  # толщина основания
    stop_w: float = 1.2
    stop_h: float = 2.0
    r_v: float = 3.0  # скругление вертикальных рёбер
    snap: Snap = field(default_factory=Snap)

    @property
    def along(self) -> float:
        return self.board[0] if self.x_along == "long" else self.board[1]

    @property
    def across(self) -> float:
        return self.board[1] if self.x_along == "long" else self.board[0]

    @property
    def above(self) -> float:
        # Над платой: детали ~1,5 мм и кабель, который лежит на краю платы у выхода
        return max(3.2, self.cable_d + 0.2)

    @property
    def cav(self) -> tuple[float, float, float]:
        return (self.along + 2 * self.gap, self.across + 2 * self.gap, self.tape + self.board[2] + self.above)

    @property
    def length(self) -> float:
        # Вдоль кости корпус не короче прорези под ремешок с перемычками — основание и корпус одной длины
        return max(self.cav[0] + 2 * self.wall, self.strap + 2 + 2 * self.ear_end)

    @property
    def width(self) -> float:
        return self.cav[1] + 2 * self.wall

    @property
    def height(self) -> float:
        return self.floor_t + self.cav[2]

    @property
    def inner_len(self) -> float:
        return self.length - 2 * self.wall

    @property
    def cable_z(self) -> float:
        # Ось паза: кабель лежит на краю платы у выхода
        return self.floor_t + self.tape + self.board[2] + self.cable_d / 2 - 0.4

    @property
    def cable_rest_z(self) -> float:
        # Центр кабеля, который лёг на дно паза: паз шире кабеля на cable_fit
        return self.cable_z - self.cable_fit / 2

    @property
    def slot_y(self) -> float:
        return self.width / 2 + self.slot_in + self.slot_h / 2


@dataclass
class HubParams:
    """Корпус платы ESP32 DevKit на 30 выводов: 52 × 28 мм (размер с фото товара на Kaspi, 9 октября).

    Перед печатью измерить свою плату линейкой — длину, ширину, где разъём USB-C и на сколько
    ближайший вывод отстоит от каждого торца, — и поправить pcb. Выводы на этой плате торчат вниз;
    на них надеты гнёзда проводов мама-мама — под платой нужно место. Углы платы на 3 мм от торцов
    ложатся на опоры снизу и под штыри крышки сверху — там не должно быть выводов и деталей.
    """

    pcb: tuple[float, float, float] = (52.0, 28.0, 1.6)
    gap: float = 0.8  # с запасом: плата у разных продавцов 51–53 × 28–29 мм
    # От дна до низа платы. Гнёзда мама-мама на выводах: гребёнка 2,5 + гнездо 14 + изгиб провода — 20 мм.
    # Провода припаяны к выводам, а выводы под пайкой откушены: гребёнка 2,5 + пайка 3 + изгиб — 9 мм
    under: float = 20.0
    top: float = 6.5  # над платой: модуль ESP32 3,1 мм, разъём USB-C ~3,2, кнопки, концы выводов
    wall: float = 2.0
    floor_t: float = 1.8
    lid_t: float = 1.8
    lip: float = 2.4
    post: float = 3.0  # угловые опоры под платой
    pin_d: float = 2.4  # штыри крышки над теми же углами
    hold_gap: float = 0.3  # между штырём и платой: плата не болтается, но и не зажата
    usb_w: float = 13.0  # вырез под штекер USB-C с литой частью
    usb_h: float = 8.0
    usb_z_over_pcb: float = 1.6  # центр разъёма над верхом платы
    cable_d: float = 4.6
    cable_fit: float = 0.4
    cable_pitch: float = 6.0  # три кабеля рядом, у каждого своя ложбинка
    cables: int = 3
    squeeze: float = 0.3
    door_clear: float = 0.35  # зазор дверцы в вырезе с каждой стороны
    strap: float = 40.0  # ремень или липучка до 40 мм
    slot_h: float = 3.4
    slot_in: float = 1.6
    ear: float = 8.0
    ear_end: float = 2.4
    ear_t: float = 3.0
    r_v: float = 4.0
    snap: Snap = field(default_factory=lambda: Snap(beam_len=28.0, beam_t=1.6))  # балка длиннее — толще

    @property
    def cav(self) -> tuple[float, float, float]:
        return (self.pcb[0] + 2 * self.gap, self.pcb[1] + 2 * self.gap, self.under + self.pcb[2] + self.top)

    @property
    def length(self) -> float:
        return self.cav[0] + 2 * self.wall

    @property
    def width(self) -> float:
        return self.cav[1] + 2 * self.wall

    @property
    def height(self) -> float:
        return self.floor_t + self.cav[2]

    @property
    def pcb_z(self) -> float:
        return self.floor_t + self.under

    @property
    def usb_zc(self) -> float:
        return self.pcb_z + self.pcb[2] + self.usb_z_over_pcb

    @property
    def slot_y(self) -> float:
        return self.width / 2 + self.slot_in + self.slot_h / 2

    @property
    def cable_z(self) -> float:
        # Ложбинки кабелей — под платой, с запасом от дна и от платы
        return self.floor_t + min(6.0, self.under / 2)

    @property
    def cable_rest_z(self) -> float:
        return self.cable_z - self.cable_fit / 2

    @property
    def cable_ys(self) -> list[float]:
        return [(i - (self.cables - 1) / 2) * self.cable_pitch for i in range(self.cables)]

    @property
    def cable_slot_half(self) -> float:
        # Половина ширины выреза под кабели: крайняя ложбинка и 0,5 мм
        return self.cable_ys[-1] + (self.cable_d + self.cable_fit) / 2 + 0.5

    @property
    def corners(self) -> list[tuple[float, float]]:
        # Центры угловых опор и штырей
        x, y = self.pcb[0] / 2 - self.post / 2, self.pcb[1] / 2 - self.post / 2
        return [(sx * x, sy * y) for sx in (-1, 1) for sy in (-1, 1)]


# ── Общие детали ───────────────────────────────────────────────────────────────────────────────


def rounded_block(length: float, width: float, height: float, r: float, z0: float = 0.0) -> Part:
    """Брусок со скруглёнными вертикальными рёбрами, низ — на высоте z0."""
    with BuildSketch(Plane.XY.offset(z0)) as sk:
        RectangleRounded(length, width, r)
    return extrude(sk.sketch, amount=height)


def shell(L: float, W: float, H: float, r_v: float, ear: float, ear_t: float, slot_len: float, slot_h: float, slot_y: float, *, base_length: float | None = None) -> Part:
    """Корпус без полости: брусок на общем основании с двумя прорезями под ремешок.
    Ремешок идёт под корпусом, вверх сквозь прорезь, через внешнюю планку и вниз — крышку видно."""
    with BuildSketch(Plane.XY) as sk:
        RectangleRounded(L if base_length is None else base_length, W + 2 * ear, r_v)
        with Locations((0, slot_y), (0, -slot_y)):
            Rectangle(slot_len, slot_h, mode=Mode.SUBTRACT)
    body = extrude(sk.sketch, amount=ear_t) + rounded_block(L, W, H, r_v)
    # Мягкий низ: фаска по контуру дна и по прорезям
    body = chamfer(body.edges().filter_by(Axis.Z, reverse=True).group_by(Axis.Z)[0], 0.6)
    # Верх основания: скругление по краю и по прорезям, плавный переход в стенки корпуса
    top = body.edges().filter_by(Axis.Z, reverse=True).filter_by_position(Axis.Z, ear_t - 0.01, ear_t + 0.01)
    try:
        body = fillet(top, 0.8)
    except ValueError:
        pass  # скругление не встало — кромка останется прямой, на прочность не влияет
    return seam_chamfer(body, H)


def lid_rim(inner_len: float, inner_wid: float, s: Snap, lip: float, top_z: float, cutouts: list[tuple[float, float]], r_cav: float) -> Part:
    """Бортик крышки — рамка вдоль стенок, уходит в корпус на lip. На длинных сторонах — гибкие балки:
    прорезь отделяет их от пластины крышки, концы держатся за углы бортика. В середине балки — выступ.
    cutouts — вырезы в рамке на торцах (x, ширина): над пазом кабеля или вырезом USB.
    r_cav — скругление углов полости: углы рамки скруглены на зазор меньше, иначе упрутся в углы корпуса."""
    outer_l = inner_len - 2 * s.fit
    outer_w = inner_wid - 2 * s.fit
    r_out = max(0.3, r_cav - s.fit)
    with BuildSketch(Plane.XY.offset(top_z - lip)) as sk:
        RectangleRounded(outer_l, outer_w, r_out)
        RectangleRounded(outer_l - 2 * s.beam_t, outer_w - 2 * s.beam_t, max(0.2, r_out - s.beam_t), mode=Mode.SUBTRACT)
        for x, w in cutouts:
            with Locations((x, 0)):
                Rectangle(4 * s.beam_t, w, mode=Mode.SUBTRACT)
    frame = extrude(sk.sketch, amount=lip + 0.01)
    # Прорезь над балками: до самой пластины, вместе с перекрытием 0,01 — иначе балка срастётся с пластиной
    for sy in (-1, 1):
        frame = frame - Pos(0, sy * (outer_w / 2 - s.beam_t / 2), top_z - s.slit / 2 + 0.01) * Box(s.beam_len, s.beam_t + 0.2, s.slit + 0.02)
    # Выступ: трапеция в сечении — пологий скос снизу (заходит), круче сверху (держит)
    zt = s.bump_top(top_z)
    zb = zt - s.bump_h
    for sy in (-1, 1):
        y0 = sy * outer_w / 2
        pts = [(y0 - sy * 0.05, zb), (y0 + sy * s.out, zb + s.lead_dz), (y0 + sy * s.out, zb + s.lead_dz + s.crest), (y0 - sy * 0.05, zt)]
        with BuildSketch(Plane.YZ) as sk2:
            Polygon(*pts, align=None)
        frame = frame + extrude(sk2.sketch, amount=s.bump_len / 2, both=True)
    return frame


def snap_grooves(inner_wid: float, s: Snap, top_z: float) -> Part:
    """Паз защёлки во внутренних длинных стенках — напротив выступов, с запасом по длине и высоте."""
    zt = s.bump_top(top_z) + s.clear
    zb = s.bump_top(top_z) - s.bump_h - s.clear
    depth = s.interference + s.clear
    g = []
    for sy in (-1, 1):
        y = sy * (inner_wid / 2 + depth / 2 - 0.01)
        g.append(Pos(0, y, (zb + zt) / 2) * Box(s.bump_len + 1.0, depth + 0.02, zt - zb))
    return g[0] + g[1]


def pry_notch_end(L: float, top_z: float, depth: float, r: float = 4.5) -> Part:
    """Выемка под ноготь на верхнем крае торца +X: поддеть крышку и открыть.
    Полукруглая, как у футляра очков: палец находит её на ощупь. Стенку насквозь не прорезает."""
    return Pos(L / 2 + (1 - depth) / 2, 0, top_z) * Rot(0, 90, 0) * Cylinder(r, depth + 1)


def pry_notch_side(x: float, W: float, top_z: float, depth: float, r: float = 4.5) -> Part:
    """То же на длинной стенке +Y, в точке x."""
    return Pos(x, W / 2 + (1 - depth) / 2, top_z) * Rot(90, 0, 0) * Cylinder(r, depth + 1)


def seam_chamfer(part: Part, z: float, size: float = 0.5) -> Part:
    """Фаска по наружному контуру на высоте z — шов крышки и корпуса выглядит как задуманная канавка."""
    edges = part.edges().filter_by(Axis.Z, reverse=True).filter_by_position(Axis.Z, z - 0.01, z + 0.01)
    try:
        return chamfer(edges, size)
    except ValueError:
        return part


def lid_plate(L: float, W: float, H: float, t: float, r_v: float, top: float) -> Part:
    """Пластина крышки над корпусом: фаска по верхней кромке и по шву. Крышка печатается верхом
    на столе — фаска 45° выходит ровной, скругление на первых слоях повисло бы в воздухе."""
    plate = rounded_block(L, W, t, r_v, z0=H)
    plate = chamfer(plate.edges().filter_by(Axis.Z, reverse=True).group_by(Axis.Z)[-1], top)
    return seam_chamfer(plate, H, 0.4)


def text_cut(text: str, size: float, x: float, y: float, z_top: float, depth: float, font: str = FONT) -> Part:
    """Надпись, утопленная в верхнюю грань на depth."""
    with BuildSketch(Plane.XY.offset(z_top - depth)) as sk:
        with Locations(Location((x, y))):
            Text(text, font_size=size, font_path=font, align=(Align.CENTER, Align.CENTER))
    return extrude(sk.sketch, amount=depth + 0.5)


def arrow_cut(x: float, y: float, z_top: float, depth: float, scale: float = 1.0) -> Part:
    """Стрелка оси X: острие — к +X. Утоплена — видно и на ощупь."""
    pts = [(-9, -1.6), (3, -1.6), (3, -4.2), (10, 0), (3, 4.2), (3, 1.6), (-9, 1.6)]
    with BuildSketch(Plane.XY.offset(z_top - depth)) as sk:
        with Locations((x, y)):
            Polygon(*[(px * scale, py * scale) for px, py in pts], align=None)
    return extrude(sk.sketch, amount=depth + 0.5)


def cable_tube(x0: float, x1: float, y: float, z: float, d: float) -> Part:
    """Кабель вдоль X от x0 до x1 — для проверок и картинок."""
    return Pos((x0 + x1) / 2, y, z) * Rot(0, 90, 0) * Cylinder(d / 2, abs(x1 - x0))


# ── Корпус датчика ─────────────────────────────────────────────────────────────────────────────


def sensor_box(p: SensorParams) -> Part:
    """Корпус один на все три датчика: кабель выходит в торец −X, торец +X глухой, в нём выемка под ноготь."""
    L, W, H = p.length, p.width, p.height
    body = shell(L, W, H, p.r_v, p.ear, p.ear_t, p.strap + 2, p.slot_h, p.slot_y)
    # Полость под плату
    body = body - Pos(0, 0, p.floor_t) * extrude(RectangleRounded(p.inner_len, p.cav[1], 1.0), amount=p.cav[2] + 1)
    # Паз кабеля в торце −X, открыт сверху: кабель кладут в паз, язычок крышки его прижимает
    d = p.cable_d + p.cable_fit
    x = -(L / 2 - p.wall / 2)
    groove = Pos(x, 0, p.cable_z) * Rot(0, 90, 0) * Cylinder(d / 2, p.wall + 2)
    groove = groove + Pos(x, 0, (p.cable_z + H + 1) / 2) * Box(p.wall + 2, d, H + 1 - p.cable_z)
    body = body - groove
    body = body - snap_grooves(p.cav[1], p.snap, H)
    body = body - pry_notch_end(L, H, 1.0)
    # Упоры на дне по торцам платы: плата не ездит вдоль кости и не встаёт с поворотом
    for s in (-1, 1):
        body = body + Pos(s * (p.cav[0] / 2 + p.stop_w / 2), 0, p.floor_t + p.stop_h / 2 - 0.01) * Box(p.stop_w, p.cav[1] + 0.02, p.stop_h + 0.02)
    return body


def sensor_lid(p: SensorParams, label: str = "", arrow_to_cable: bool = False) -> Part:
    """Крышка в собранном положении: пластина над корпусом, бортик внутри, язычок в пазу кабеля.
    arrow_to_cable=False — крышки «П» и «ПР»: стрелка от кабеля, к кисти.
    arrow_to_cable=True — крышка «Г»: стрелка к кабелю, вниз — кабель уходит вниз к поясу."""
    L, W, H = p.length, p.width, p.height
    plate = lid_plate(L, W, H, p.lid_t, p.r_v, 0.8)
    d = p.cable_d + p.cable_fit
    rim = lid_rim(p.inner_len, p.cav[1], p.snap, p.lip, H, [(-(L / 2 - p.wall), d + 0.6)], r_cav=1.0)
    # Язычок: заполняет паз сверху до кабеля и давит на него на squeeze
    z_bot = p.cable_rest_z + p.cable_d / 2 - p.squeeze
    tongue = Pos(-(L / 2 - p.wall / 2), 0, (z_bot + H) / 2 + 0.005) * Box(p.wall, d - 2 * p.tongue_clear, H - z_bot + 0.01)
    lid = plate + rim + tongue
    # Надпись, стрелка оси X и буква датчика. У крышки «Г» всё повёрнуто: стрелка смотрит к кабелю
    top = H + p.lid_t
    text_y = 4.6 if p.x_along == "short" else 3.6
    arrow_y = -5.6 if p.x_along == "short" else -4.6
    deco = text_cut("NeuroMove", 4.4, 0, text_y, top, 0.6) + arrow_cut(0.4, arrow_y, top, 0.6, scale=0.85)
    if label:
        deco = deco + text_cut(label, 4.0, -12.6, arrow_y, top, 0.6, font=FONT_LABEL)
    if arrow_to_cable:
        deco = deco.rotate(Axis.Z, 180)
    return lid - deco


# ── Корпус ESP32 ───────────────────────────────────────────────────────────────────────────────


def hub_box(p: HubParams) -> Part:
    """Корпус платы: USB-C — в торце +X (на поясе он внизу), кабели датчиков — в торце −X (вверху)."""
    L, W, H = p.length, p.width, p.height
    body = shell(L, W, H, p.r_v, p.ear, p.ear_t, p.strap + 2, p.slot_h, p.slot_y)
    body = body - Pos(0, 0, p.floor_t) * extrude(RectangleRounded(p.cav[0], p.cav[1], 1.5), amount=p.cav[2] + 1)
    # Угловые опоры под платой, слиты со стенками
    x0, x1 = p.pcb[0] / 2 - p.post, p.cav[0] / 2 + 0.01
    y0, y1 = p.pcb[1] / 2 - p.post, p.cav[1] / 2 + 0.01
    for sx in (-1, 1):
        for sy in (-1, 1):
            body = body + Pos(sx * (x0 + x1) / 2, sy * (y0 + y1) / 2, p.floor_t + p.under / 2 - 0.005) * Box(x1 - x0, y1 - y0, p.under + 0.01)
    # Вырез USB-C в торце +X, открыт сверху: сверху его закрывает крышка, тонкой перемычки нет
    z0 = p.usb_zc - p.usb_h / 2
    with BuildSketch(Plane.YZ.offset(L / 2 - p.wall - 1)) as sk:
        with Locations((0, (z0 + H + 3) / 2)):
            RectangleRounded(p.usb_w, H + 3 - z0, 2.0)
    body = body - extrude(sk.sketch, amount=p.wall + 2)
    # Вырез кабелей в торце −X, открыт сверху: внизу три ложбинки, сверху закрывает дверца крышки.
    # Кабели кладут сверху уже с гнёздами — продевать в отверстия не нужно
    r = (p.cable_d + p.cable_fit) / 2
    half = p.cable_slot_half
    with BuildSketch(Plane.YZ.offset(-L / 2 - 1)) as sk:
        with Locations((0, (p.cable_z + H + 1) / 2)):
            Rectangle(2 * half, H + 1 - p.cable_z)
        for y in p.cable_ys:
            with Locations((y, p.cable_z)):
                Circle(r)
    body = body - extrude(sk.sketch, amount=p.wall + 1.01)
    body = body - snap_grooves(p.cav[1], p.snap, H)
    # Выемка под ноготь — на длинной стенке у торца USB: торцы заняты вырезами
    body = body - pry_notch_side(L / 2 - 10, W, H, p.wall - 0.8)
    return body


def hub_lid(p: HubParams) -> Part:
    L, W, H = p.length, p.width, p.height
    lid = lid_plate(L, W, H, p.lid_t, p.r_v, 0.9)
    lid = lid + lid_rim(p.cav[0], p.cav[1], p.snap, p.lip, H, [(p.cav[0] / 2, p.usb_w + 1.0)], r_cav=1.5)
    # Дверца: закрывает вырез кабелей и давит на них на squeeze
    z_bot = p.cable_rest_z + p.cable_d / 2 - p.squeeze
    door_w = 2 * p.cable_slot_half - 2 * p.door_clear
    lid = lid + Pos(-(L / 2 - p.wall / 2), 0, (z_bot + H) / 2 + 0.005) * Box(p.wall, door_w, H - z_bot + 0.01)
    # Штыри над углами платы: плата лежит между опорами и штырями и не болтается
    pin_len = H - (p.pcb_z + p.pcb[2] + p.hold_gap)
    for x, y in p.corners:
        lid = lid + Pos(x, y, H - pin_len / 2 + 0.005) * Cylinder(p.pin_d / 2, pin_len + 0.01)
    # Надпись вдоль корпуса: на поясе корпус висит вертикально, USB внизу — читается сверху вниз,
    # как на корешке книги
    return lid - text_cut("NeuroMove", 7.0, 0, 0, H + p.lid_t, 0.6)


# ── Проверки ───────────────────────────────────────────────────────────────────────────────────


def overlap(a: Part, b: Part) -> float:
    """Объём пересечения двух тел, мм³. Почти ноль — не задевают."""
    inter = a & b
    try:
        return abs(inter.volume)
    except Exception:  # пустое пересечение
        return 0.0


def half_space(side: int) -> Part:
    """Половина пространства: y > 0 при side = 1, y < 0 при side = −1."""
    return Pos(0, side * 100, 0) * Box(400, 200, 400)


class Report:
    def __init__(self, title: str):
        self.title = title
        self.rows: list[tuple[bool | None, str]] = []

    def check(self, ok: bool, text: str) -> None:
        self.rows.append((ok, text))

    def note(self, text: str) -> None:
        self.rows.append((None, text))

    def print(self) -> bool:
        print(f"\n{self.title}")
        for ok, text in self.rows:
            print(f"  {'·' if ok is None else '✓' if ok else '✗'} {text}")
        return all(ok for ok, _ in self.rows if ok is not None)


def check_snap(r: Report, lid: Part, box: Part, s: Snap, inner_wid: float, top_z: float) -> None:
    """Общие проверки защёлки: крышка садится, держится с обеих сторон, ставится только одной стороной,
    балки свободны — прорезь над ними пустая."""
    r.check(overlap(lid, box) < 1e-3, "крышка садится, выступы защёлки свободны в пазу")
    up = Pos(0, 0, 1.0) * lid
    for sy in (-1, 1):
        v = overlap(up & half_space(sy), box)
        r.check(v > 1e-3, f"крышка на 1 мм выше — выступ стороны {'+' if sy > 0 else '−'}Y упирается в стенку ({v:.2f} мм³)")
    r.check(overlap(lid.rotate(Axis.Z, 180), box) > 1e-3, "крышка, повёрнутая на 180°, не садится — встаёт только одной стороной")
    for sy in (-1, 1):
        y = sy * (inner_wid / 2 - s.fit - s.beam_t / 2)
        probe = Pos(0, y, top_z - s.slit / 2) * Box(s.beam_len - 0.5, s.beam_t - 0.2, s.slit - 0.1)
        r.check(overlap(probe, lid) < 1e-4, f"балка стороны {'+' if sy > 0 else '−'}Y отделена от пластины прорезью {s.slit} мм на {s.beam_len:.0f} мм")


def check_sensor(p: SensorParams, box: Part, lids: dict[str, Part]) -> bool:
    r = Report(f"Датчик, вариант «{'поперёк' if p.x_along == 'short' else 'вдоль'}»: {p.length:.1f} × {p.width:.1f} × {p.height + p.lid_t:.1f} мм, с основанием {p.width + 2 * p.ear:.1f} мм")
    r.check(len(box.solids()) == 1, f"корпус — один кусок ({len(box.solids())})")
    for name, lid in lids.items():
        r.check(len(lid.solids()) == 1, f"крышка «{name}» — один кусок ({len(lid.solids())})")
    # Плата на скотче между упорами
    bz = p.floor_t + p.tape
    board = Pos(0, 0, bz + p.board[2] / 2) * Box(p.along, p.across, p.board[2])
    r.check(overlap(board, box) < 1e-3, "плата входит между упорами и стенками")
    moved = Pos(p.gap + 0.5, 0, 0) * board
    r.check(overlap(moved, box) > 1e-3, "сдвинутая на 0,9 мм плата упирается — упоры держат")
    parts_top = Pos(0, 0, bz + p.board[2] + 0.75) * Box(p.along, p.across, 1.5)
    for name, lid in lids.items():
        r.check(overlap(board, lid) + overlap(parts_top, lid) < 1e-3, f"крышка «{name}» не задевает плату и детали на ней высотой до 1,5 мм")
    lid = lids["П"]
    check_snap(r, lid, box, p.snap, p.cav[1], p.height)
    # Кабель: оболочка кончается у внутренней грани стенки, снаружи уходит на 6 мм
    x_in, x_out = -(p.length / 2 - p.wall), -(p.length / 2 + 6)
    cable = cable_tube(x_in, x_out, 0, p.cable_rest_z + 0.02, p.cable_d)
    r.check(overlap(cable, box) < 1e-3, f"кабель {p.cable_d} мм ложится в паз торца −X")
    for name, l in lids.items():
        v = overlap(cable, l)
        r.check(v > 1e-3, f"язычок крышки «{name}» прижимает кабель на {p.squeeze} мм ({v:.2f} мм³) — дёрнут кабель, тянет корпус")
    thin = cable_tube(x_in, x_out, 0, p.cable_rest_z - (p.cable_d - 4.0) / 2 + 0.02, 4.0)
    if overlap(thin, lid) < 1e-3:
        r.note("кабель 4,0 мм язычок уже не прижмёт: тоньше 4,6 — обмотать изолентой в месте паза")
    other = cable_tube(p.length / 2 - p.wall, p.length / 2 + 6, 0, p.cable_rest_z + 0.02, p.cable_d)
    r.check(overlap(other, box) > 1e-3, "торец +X глухой")
    # Ремешок сквозь обе прорези
    for s in (-1, 1):
        strap = Pos(0, s * p.slot_y, p.ear_t / 2) * Box(p.strap, 2.0, p.ear_t + 4)
        r.check(overlap(strap, box) < 1e-3, f"ремешок {p.strap:.0f} мм проходит сквозь прорезь {'−' if s < 0 else '+'}Y")
    wide = Pos(0, p.slot_y, p.ear_t / 2) * Box(p.strap + 4, 2.0, p.ear_t + 4)
    r.check(overlap(wide, box) > 1e-3, "ремешок на 4 мм шире уже не проходит — проверка прорези не пустая")
    r.check(p.wall - p.snap.interference - p.snap.clear >= 1.2, f"стенка у паза защёлки — {p.wall - p.snap.interference - p.snap.clear:.2f} мм, не тоньше 1,2")
    return r.print()


def check_hub(p: HubParams, box: Part, lid: Part) -> bool:
    r = Report(f"ESP32: {p.length:.1f} × {p.width:.1f} × {p.height + p.lid_t:.1f} мм, с основанием {p.width + 2 * p.ear:.1f} мм")
    r.check(len(box.solids()) == 1, f"корпус — один кусок ({len(box.solids())})")
    r.check(len(lid.solids()) == 1, f"крышка — один кусок ({len(lid.solids())})")
    pcb = Pos(0, 0, p.pcb_z + p.pcb[2] / 2) * Box(p.pcb[0], p.pcb[1], p.pcb[2])
    r.check(overlap(pcb, box) < 1e-3, "плата ложится на угловые опоры и не задевает стенки")
    r.check(overlap(Pos(0, 0, -0.5) * pcb, box) > 1e-3, "плата ниже на 0,5 мм упирается в опоры — опоры держат")
    r.check(overlap(pcb, lid) < 1e-3, f"штыри крышки не давят на плату: зазор {p.hold_gap} мм")
    r.check(overlap(Pos(0, 0, p.hold_gap + 0.2) * pcb, lid) > 1e-3, f"плата выше на {p.hold_gap + 0.2:.1f} мм упирается в штыри — не болтается")
    # Под платой: гребёнка 2,5 мм и гнёзда 14 мм на выводах (или пайка 3 мм) — два ряда через 25,4 мм
    below = 2.5 + (14.0 if p.under >= 17 else 3.0)
    what = "гнёзда мама-мама" if p.under >= 17 else "пайка на откушенных выводах"
    for sy in (-1, 1):
        row = Pos(0, sy * 12.7, p.pcb_z - below / 2) * Box(15 * 2.54, 2.6, below)
        r.check(overlap(row, box) < 1e-3, f"{what} на ряду выводов {'−' if sy < 0 else '+'}Y помещаются под платой")
    # Над платой: модуль ESP32 3,1 мм и разъём USB-C — не задевают крышку и штыри
    parts_top = Pos(0, 0, p.pcb_z + p.pcb[2] + 2.0) * Box(p.pcb[0] - 2, p.pcb[1] - 6, 4.0)
    r.check(overlap(parts_top, lid) < 1e-3, "детали платы высотой до 4 мм не задевают крышку")
    check_snap(r, lid, box, p.snap, p.cav[1], p.height)
    # Штекер USB-C: литая часть 12 × 6,5 мм заходит в вырез до разъёма
    plug = Pos(p.length / 2 + 2, 0, p.usb_zc) * Box(16.0, 12.0, 6.5)
    r.check(overlap(plug, box) < 1e-3 and overlap(plug, lid) < 1e-3, "штекер USB-C 12 × 6,5 мм входит в вырез")
    for s in (-1, 1):
        strap = Pos(0, s * p.slot_y, p.ear_t / 2) * Box(p.strap, 2.0, p.ear_t + 4)
        r.check(overlap(strap, box) < 1e-3, f"ремень {p.strap:.0f} мм проходит сквозь прорезь {'−' if s < 0 else '+'}Y")
    x_in, x_out = -(p.length / 2 - p.wall), -(p.length / 2 + 6)
    for i, y in enumerate(p.cable_ys):
        cable = cable_tube(x_in, x_out, y, p.cable_rest_z + 0.02, p.cable_d)
        ok = overlap(cable, box) < 1e-3 and overlap(cable, lid) > 1e-3
        r.check(ok, f"кабель {i + 1} лежит в своей ложбинке, дверца прижимает его на {p.squeeze} мм")
    return r.print()


# ── Вывод: STL для печати, STEP для правки в любой CAD, картинки ────────────────────────────────


def for_print(part: Part, flip: bool) -> Part:
    """Положение для печати: корпус — дном на стол, крышка — переворачивается надписью на стол."""
    if flip:
        part = part.rotate(Axis.X, 180)
    bb = part.bounding_box()
    return Pos(-bb.center().X, -bb.center().Y, -bb.min.Z) * part


def export(part: Part, name: str, step: bool) -> None:
    export_stl(part, os.path.join(HERE, f"{name}.stl"), tolerance=0.05, angular_tolerance=0.2)
    if step:
        export_step(part, os.path.join(HERE, f"{name}.step"))


def render_png(parts: list[tuple[Part, str]], out_png: str, title: str, view: str = "iso") -> None:
    """Картинка в headless Chrome: three.js по сетке STL. parts — (деталь, цвет); view — iso или top."""
    chrome = "/Applications/Google Chrome.website/Contents/MacOS/Google Chrome"
    if not os.path.exists(chrome):
        print("  Chrome не найден — картинку пропускаю")
        return
    data = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, (part, color) in enumerate(parts):
            path = os.path.join(tmp, f"{i}.stl")
            export_stl(part, path, tolerance=0.05, angular_tolerance=0.2)
            with open(path, "rb") as f:
                data.append((base64.b64encode(f.read()).decode(), color))
        meshes = ",".join(f'["{b64}","{color}"]' for b64, color in data)
        html = f"""<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0;background:#f4f2ee}}
#t{{position:absolute;left:28px;top:20px;font:600 20px -apple-system,Helvetica,sans-serif;color:#222}}</style>
<script type="importmap">{{"imports":{{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}}}</script>
</head><body><div id="t">{title}</div><script type="module">
import * as THREE from 'three';
import {{ STLLoader }} from 'three/addons/loaders/STLLoader.js';
const W = 1400, H = 900;
const r = new THREE.WebGLRenderer({{antialias:true, preserveDrawingBuffer:true}});
r.setSize(W, H); r.setPixelRatio(1); document.body.appendChild(r.domElement);
r.setClearColor(0xf4f2ee);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.1));
const d1 = new THREE.DirectionalLight(0xffffff, 1.6); d1.position.set(-60, -80, 120); scene.add(d1);
const d2 = new THREE.DirectionalLight(0xffffff, 0.5); d2.position.set(80, 40, 60); scene.add(d2);
const loader = new STLLoader();
const group = new THREE.Group();
for (const [b64, color] of [{meshes}]) {{
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  const g = loader.parse(bin); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({{color, roughness:0.55, metalness:0.0}}));
  group.add(m);
}}
scene.add(group);
const box = new THREE.Box3().setFromObject(group); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
const cam = new THREE.PerspectiveCamera(30, W/H, 1, 2000);
const dist = Math.max(s.x, s.y, s.z) * 2.5;
if ('{view}' === 'top') {{ cam.position.set(c.x, c.y, c.z + Math.max(s.x / 0.834, s.y / 0.536) * 1.12); cam.up.set(0,1,0); }}
else {{ cam.position.set(c.x - dist*0.55, c.y - dist*0.75, c.z + dist*0.62); cam.up.set(0,0,1); }}
cam.lookAt(c);
r.render(scene, cam);
document.title = 'done';
</script></body></html>"""
        page = os.path.join(tmp, "vid.html")
        with open(page, "w") as f:
            f.write(html)
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                        "--window-size=1400,900", "--virtual-time-budget=15000", f"--screenshot={out_png}", f"file://{page}"],
                       check=False, capture_output=True)


def sensor_scene(p: SensorParams, box: Part, lid: Part) -> list[tuple[Part, str]]:
    """Сборка для картинки: плата на скотче, кабель в пазу, крышка поднята."""
    bz = p.floor_t + p.tape
    board = Pos(0, 0, bz + p.board[2] / 2) * Box(p.along, p.across, p.board[2])
    chip = Pos(0, 0, bz + p.board[2] + 0.45) * Box(4.0, 4.0, 0.9)
    cable = cable_tube(-(p.length / 2 - p.wall - 0.5), -(p.length / 2 + 14), 0, p.cable_rest_z, p.cable_d)
    return [(box, "#f2f2f0"), (Pos(0, 0, 12) * lid, "#e9e9e6"), (board, "#2c6e49"), (chip, "#222222"), (cable, "#3a3a3a")]


def hub_scene(p: HubParams, box: Part, lid: Part) -> list[tuple[Part, str]]:
    """Сборка для картинки: плата на опорах, модуль ESP32, разъём USB, гнёзда, три кабеля, крышка поднята."""
    top = p.pcb_z + p.pcb[2]
    pcb = Pos(0, 0, p.pcb_z + p.pcb[2] / 2) * Box(p.pcb[0], p.pcb[1], p.pcb[2])
    module = Pos(-p.pcb[0] / 2 + 9.0, 0, top + 1.55) * Box(18.0, 25.5, 3.1)
    usb = Pos(p.pcb[0] / 2 - 3.5, 0, top + 1.6) * Box(7.5, 9.0, 3.2)
    below = 2.5 + (14.0 if p.under >= 17 else 3.0)
    rows = Pos(0, 12.7, p.pcb_z - below / 2) * Box(15 * 2.54, 2.5, below) + Pos(0, -12.7, p.pcb_z - below / 2) * Box(15 * 2.54, 2.5, below)
    cables = None
    for y in p.cable_ys:
        c = cable_tube(-(p.length / 2 - p.wall - 0.5), -(p.length / 2 + 16), y, p.cable_rest_z, p.cable_d)
        cables = c if cables is None else cables + c
    return [(box, "#f2f2f0"), (Pos(0, 0, 16) * lid, "#e9e9e6"), (pcb, "#1f3a5f"), (module, "#c9c9c9"), (usb, "#9a9a9a"), (rows, "#222222"), (cables, "#3a3a3a")]


def arg(name: str, default: float) -> float:
    """Число из командной строки: --natyag 0.25."""
    if name in sys.argv:
        return float(sys.argv[sys.argv.index(name) + 1])
    return default


def main() -> int:
    want_png = "--png" in sys.argv
    want_step = "--step" in sys.argv
    natyag = arg("--natyag", Snap().interference)
    ok = True
    for x_along, tag in (("short", "poperek"), ("long", "vdol")):
        p = SensorParams(x_along=x_along, snap=Snap(interference=natyag))
        box = sensor_box(p)
        lids = {label: sensor_lid(p, label, to_cable) for label, _, to_cable in SENSORS}
        ok &= check_sensor(p, box, lids)
        export(for_print(box, flip=False), f"korpus-v2-datchik-{tag}-korpus", want_step)
        for label, fname, _ in SENSORS:
            export(for_print(lids[label], flip=True), f"korpus-v2-datchik-{tag}-kryshka-{fname}", want_step)
        if want_png and tag == "poperek":
            render_png(sensor_scene(p, box, lids["П"]), os.path.join(HERE, "korpus-v2-datchik-vid.png"),
                       "Датчик, корпус v2: крышка на защёлках, язычок прижимает кабель")
            render_png([(Pos(-40, 0, 0) * lids["П"], "#e9e9e6"), (lids["ПР"], "#e9e9e6"), (Pos(40, 0, 0) * lids["Г"], "#e9e9e6")],
                       os.path.join(HERE, "korpus-v2-kryshki-sverhu.png"), "Крышки сверху: П, ПР, Г. Кабель у всех — слева", view="top")
    for tag, under in (("gnezda", 20.0), ("paika", 9.0)):
        hp = HubParams(under=under, snap=Snap(beam_len=28.0, beam_t=1.6, interference=natyag))
        hbox, hlid = hub_box(hp), hub_lid(hp)
        print(f"\n[{'гнёзда мама-мама на выводах' if tag == 'gnezda' else 'провода припаяны к выводам'}]", end="")
        ok &= check_hub(hp, hbox, hlid)
        export(for_print(hbox, flip=False), f"korpus-v2-esp32-{tag}-korpus", want_step)
        export(for_print(hlid, flip=True), f"korpus-v2-esp32-{tag}-kryshka", want_step)
        if want_png and tag == "gnezda":
            render_png(hub_scene(hp, hbox, hlid), os.path.join(HERE, "korpus-v2-esp32-vid.png"),
                       "ESP32, корпус v2: плата на опорах, дверца крышки прижимает кабели")
    print("\nВсе проверки прошли" if ok else "\nЕсть проваленные проверки — STL не печатать")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
