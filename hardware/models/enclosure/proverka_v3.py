"""Проверка корпусов v3 сверх геометрии korpus_v3.py (27 октября 2026).

Проверка корпуса v3:
  1. Защёлка методом конечных элементов: сила, растяжение балки.
  2. 1000 случайных отпечатков на каждый корпус. Сверх ошибок принтера и пластика (как в v2) — разброс
     того, что лежит внутри: плата GY-521, хвосты выводов, пластик штырьков, гнёзда, толщина провода,
     макетная плата, ESP32.
  3. STL на печать: сетка замкнута, деталь — одна, лежит на столе.

Запуск: pip install build123d scikit-fem trimesh, потом python3 proverka_v3.py [--provod 1.4]
Разбросы — допущения, а не замер: какие — сказано рядом с каждым. Seed зафиксирован.
"""

from __future__ import annotations

import glob
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import korpus_v2 as kv  # noqa: E402
import korpus_v3 as k3  # noqa: E402
import proverka_v2 as pv  # noqa: E402

SEED = 20261027


def sensor_extra(p: k3.Sensor, wire: tuple[float, float]):
    def extra(rng, n, g_out, g_in, dz_lid, dz_box):
        r = {}
        # Плата GY-521 у продавцов 20,0–21,2 × 15,6–16,4 мм
        bw = rng.uniform(20.0, 21.2, n)
        bl = rng.uniform(15.6, 16.4, n)
        r["плата входит между упорами"] = bw <= 2 * (p.board_w / 2 + 0.1) - 2 * g_in
        # Угловые штырьки: пластик торцом за край платы на 0–1 мм; ось штырька над платой 1,15–1,4 мм
        po = rng.uniform(0.0, 1.0, n)
        pz = rng.uniform(1.15, 1.4, n)
        # Гнездо мама 13,6–14,6 мм длиной и 2,45–2,6 мм в сечении
        hl = rng.uniform(13.6, 14.6, n)
        hs = rng.uniform(2.45, 2.6, n)
        # Плату кладут вплотную к стенке +X: гнездо садится до конца, если до стенки −X хватает места
        slack = p.cav_l - 2 * g_in - bl - po - hl
        r["гнёзда садятся на штырьки до конца"] = slack >= 0
        r["гнёзда не съезжают со штырьков (на штырьке ≥ 3 мм)"] = slack <= 3.0
        # Хвосты в 1,27 ± 0,2 мм от края платы, с пайкой — 1,6 мм шириной; длина 2,5–3,4 мм
        x_tail = p.cav_l / 2 - g_in - bl + rng.uniform(1.07, 1.47, n)
        t0, t1 = p.trench
        r["хвосты выводов попадают в канавку"] = (x_tail - 0.8 >= t0 + g_in) & (x_tail + 0.8 <= t1 - g_in)
        tail = rng.uniform(2.5, 3.4, n)
        tape = rng.uniform(0.0, 0.2, n)  # тонкий скотч или без него
        r["хвосты не достают дна канавки"] = tail <= p.ped_top + tape - p.trench_floor  # дно и площадка — одна деталь, ошибки высоты у них общие
        board_top = p.ped_top + dz_box + tape + rng.uniform(1.5, 1.7, n)
        pin = board_top + pz
        h_top = pin + hs / 2
        lid_under = p.height + dz_lid
        r["крышка не давит на гнёзда"] = h_top <= lid_under + 0.05
        # Гнездо не пролезает в паз: паз ниже гнезда и сверху, и снизу
        slot_bot = p.slot_bot + dz_box
        tongue = p.tongue_bot + dz_lid
        r["гнездо не пролезает в паз"] = (slot_bot >= pin - hs / 2 + 0.1) & (tongue <= pin + hs / 2 - 0.1)
        # Провод: держится в гнезде на оси штырька, если дно паза выше — лежит на дне паза
        d = rng.uniform(*wire, n)
        w_bot = np.maximum(pin - d / 2, slot_bot)
        sq = w_bot + d - tongue
        r["язычок прижимает провода (≥ 0,05 мм)"] = sq >= 0.05
        r["язычок не мешает крышке сесть (≤ 0,6 мм)"] = sq <= 0.6
        r["язычок входит в паз по ширине"] = p.tongue_clear - g_out - g_in >= -0.05
        sw = rng.uniform(24.5, 25.5, n)
        st = rng.uniform(1.5, 2.6, n)
        r["ремешок проходит в прорезь"] = (sw <= p.strap + 1 - 2 * g_in) & (st <= p.slot_h - 2 * g_in)
        return r
    return extra


def hub_extra(p: k3.Hub, wire: tuple[float, float]):
    def extra(rng, n, g_out, g_in, dz_lid, dz_box):
        r = {}
        # Макетная плата: замер 45 × 33 × 9 мм, ошибка замера линейкой ±0,3 мм
        bl = rng.uniform(44.7, 45.3, n)
        bw = rng.uniform(32.7, 33.3, n)
        bh = rng.uniform(8.7, 9.3, n)
        r["макетная плата входит между упорами"] = (bl <= p.bb[0] + 1.0 - 2 * g_out - 2 * g_in) & (bw <= p.bb[1] + p.bb_gap + 0.3 - g_out - g_in)
        # ESP32: 51–53 × 28,5–28,9 мм, ось ряда выводов в 1,5–1,8 мм от края, пластик штырьков 2,4–2,6 мм
        pl = rng.uniform(51.0, 53.0, n)
        pw = rng.uniform(28.5, 28.9, n)
        off = rng.uniform(1.5, 1.8, n)
        hdr = rng.uniform(2.4, 2.6, n)
        y_row = p.row_y[p.row_e] + rng.uniform(-0.3, 0.3, n)  # макетная плата прижата к стенке не вплотную
        y_lo = y_row + off - pw
        r["ESP32 входит поперёк"] = y_lo >= -p.cav_w / 2 + g_in + 0.05
        # Вдоль: торец с USB стоит там, куда его ставят выводы; антенный торец — в 9,8 + 35,6 + (pl − 52,3 + 6,9) мм
        x_ant = p.x_usb_end - pl + rng.uniform(-0.5, 0.5, n)
        r["ESP32 входит вдоль"] = x_ant >= -p.cav_l / 2 + g_in
        pcb_bot = p.floor_t + dz_box + bh + hdr
        pcb_top = pcb_bot + 1.6
        # Опора ниже края ESP32 на foam, на ней два слоя скотч-пены по 0,9–1,2 мм: пена должна коснуться
        # и сжаться не больше чем наполовину
        foam = rng.uniform(0.9, 1.2, n) + rng.uniform(0.9, 1.2, n)
        squash = (p.pcb_z - p.foam + dz_box) + foam - pcb_bot
        r["скотч-пена на опоре касается края ESP32"] = squash >= 0
        r["скотч-пена сжата не больше чем наполовину"] = squash <= foam / 2
        gap = (p.pcb_top + p.hold_gap + dz_lid) - pcb_top
        r["штыри крышки не мешают ей сесть"] = gap >= -0.15
        r["штыри держат ESP32 (зазор ≤ 0,8 мм)"] = gap <= 0.8
        # Гнёзда «папа» над макетной платой 13,5–15 мм, проводу на изгиб нужно не меньше 3,5 мм
        jh = rng.uniform(13.5, 15.0, n)
        r["над гнёздами ≥ 3,5 мм на изгиб"] = p.height + dz_lid - (p.floor_t + dz_box + bh + jh) >= 3.5
        # Штекер USB-C: литая часть 10–12 мм шириной, 5,5–7 мм высотой
        ph = rng.uniform(5.5, 7.0, n)
        usb_c = pcb_top + 1.6
        r["штекер USB-C входит в вырез"] = (rng.uniform(10.0, 12.0, n) <= p.usb_w - 2 * g_in) & (usb_c - ph / 2 >= p.usb_zc - p.usb_h / 2 + dz_box + g_in)
        # Ленты: жила того же провода
        d = rng.uniform(*wire, n)
        sq = (p.chan_bot + dz_box + d) - (p.door_bot + dz_lid)
        r["дверца прижимает ленты (≥ 0,05 мм)"] = sq >= 0.05
        r["дверца не мешает крышке сесть (≤ 0,6 мм)"] = sq <= 0.6
        r["лента из 5 жил входит в ложбинку"] = 5 * d <= p.chan_w - 2 * g_in
        r["дверца входит в окно по ширине"] = p.door_clear - g_out - g_in >= -0.05
        return r
    return extra


def main() -> int:
    rng = np.random.default_rng(SEED)
    wire_d = kv.arg("--provod", k3.Sensor().wire_d)
    sp, hp = k3.Sensor(wire_d=wire_d), k3.Hub(wire_d=wire_d)
    print("1. Защёлка, конечные элементы (PLA, E = 3000 МПа; у PETG силы на треть меньше, растяжение то же)\n")
    beams = {}
    for title, s, lip in (("датчик", sp.snap, sp.lip), ("ESP32", hp.snap, hp.lip)):
        F, e = pv.fea_beam(s, lip, s.interference)
        beams[title] = (F / s.interference, e / s.interference)
        print(f"  {title}: балка {s.beam_len:.0f} × {s.beam_t} × {lip - s.slit:.1f} мм, натяг {s.interference} мм: "
              f"{F:.1f} Н на выступ, растяжение {e * 100:.2f} %; закрыть ≈ {2 * F * pv.lever(s.lead_deg, np.array(0.3)):.0f} Н, "
              f"держит ≈ {2 * F * pv.lever(s.ret_deg, np.array(0.3)):.0f} Н (трение 0,3)")

    print(f"\n2. {pv.N} случайных отпечатков на корпус, seed {SEED}")
    print("   Принтер как в v2: наружные грани +(−0,05…0,20) мм, внутренние −(−0,05…0,20) мм на сторону, выступ")
    print("   −0,20…+0,05 мм, высоты ±0,1 мм; PLA или PETG поровну; трение 0,25–0,45.")
    print(f"   Провод: жила {wire_d} ± 0,1 мм — замерено им самим; без замера — 1,2–1,7 мм.\n")
    near = (wire_d - 0.1, wire_d + 0.1)
    cases = []
    k, eps = beams["датчик"]
    cases.append(pv.monte_carlo(f"датчик, жила {wire_d} ± 0,1 мм", sp.snap, k, eps, sensor_extra(sp, near), rng))
    cases.append(pv.monte_carlo("датчик, принтер как 15 октября", sp.snap, k, eps, sensor_extra(sp, near), rng, condition_v1=True))
    cases.append(pv.monte_carlo("датчик, провод не замерен: 1,2–1,7 мм", sp.snap, k, eps, sensor_extra(sp, (1.2, 1.7)), rng))
    k, eps = beams["ESP32"]
    cases.append(pv.monte_carlo(f"ESP32 на макетной плате, жила {wire_d} ± 0,1 мм", hp.snap, k, eps, hub_extra(hp, near), rng))
    cases.append(pv.monte_carlo("ESP32, принтер как 15 октября", hp.snap, k, eps, hub_extra(hp, near), rng, condition_v1=True))
    for name, res, ok, st in cases:
        print(f"  {name}: все условия — {ok.mean() * 100:.1f} % отпечатков")
        for crit, v in res.items():
            share = v.mean() * 100
            if share < 100:
                print(f"      {crit}: {share:.1f} %")
        q = np.percentile
        print(f"      закрыть {q(st['F_in'], 5):.0f}–{q(st['F_in'], 95):.0f} Н, держит {q(st['F_ret'], 5):.0f}–{q(st['F_ret'], 95):.0f} Н,"
              f" растяжение {q(st['strain'], 5) * 100:.2f}–{q(st['strain'], 95) * 100:.2f} % (5–95 % отпечатков)")

    print("\n3. STL на печать\n")
    for path in sorted(glob.glob(os.path.join(HERE, "korpus-v3-*.stl"))):
        for line in pv.check_stl(path):
            print("  " + line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
