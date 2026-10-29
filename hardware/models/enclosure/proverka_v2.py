"""Проверка корпусов v2 сверх геометрии korpus_v2.py (22 октября 2026).

Три части:
  1. Расчёт защёлки методом конечных элементов: какой силой крышка защёлкивается и на сколько
     растягивается пластик. Для сравнения — первая защёлка v2 (коммит 5e79b4b), где гнулась стенка.
  2. 1000 случайных отпечатков на каждый корпус: принтер печатает наружные грани толще, внутренние
     уже, мелкие выступы — меньше; платы, кабели и ремешки тоже бывают разные. Для каждого отпечатка —
     садится ли крышка, держит ли, не слишком ли туго, зажат ли кабель, входят ли плата и ремешок.
  3. STL, которые уйдут на печать: сетка замкнута, деталь — одна, лежит на столе плоской гранью,
     висящих снизу граней почти нет.

Запуск: pip install build123d scikit-fem trimesh, потом python3 proverka_v2.py
Числа принтера — допущения, а не замер: какие — сказано рядом с каждым. Seed зафиксирован.
"""

from __future__ import annotations

import glob
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import korpus_v2 as kv  # noqa: E402

SEED = 20261022
N = 1000

# Пластик. Модуль упругости напечатанной детали ниже, чем у прутка: берём диапазоны
E_PLA = (2400.0, 3500.0)  # МПа
E_PETG = (1700.0, 2200.0)
NU = 0.35
STRAIN_LIMIT = 0.02  # 2 % — растяжение, которое PLA выдерживает много раз вдоль слоёв


# ── 1. Конечные элементы ───────────────────────────────────────────────────────────────────────


def _axis(lo: float, hi: float, step: float, marks: list[float]) -> np.ndarray:
    pts = set(np.round(np.linspace(lo, hi, int(np.ceil((hi - lo) / step)) + 1), 4))
    for m in marks:
        if lo < m < hi:
            pts.add(round(m, 4))
    return np.array(sorted(pts))


def _solve(mesh, fixed_fn, load_fn, delta: float, E: float, load_dir: float):
    """Упругость, квадратичные шестигранники. На узлах load_fn — смещение по Y, на fixed_fn — заделка.
    Возвращает силу на нагруженных узлах (Н) и наибольшее главное растяжение."""
    from skfem import Basis, ElementHex2, ElementVector, asm, condense, solve
    from skfem.models.elasticity import lame_parameters, linear_elasticity

    ib = Basis(mesh, ElementVector(ElementHex2()), intorder=4)
    K = asm(linear_elasticity(*lame_parameters(E, NU)), ib)
    fix = ib.get_dofs(fixed_fn).all()
    load = ib.get_dofs(load_fn).all("u^2")
    u = np.zeros(K.shape[0])
    u[load] = load_dir * delta
    u = solve(*condense(K, np.zeros(K.shape[0]), x=u, D=np.union1d(fix, load)))
    force = abs((K @ u)[load].sum())
    g = ib.interpolate(u).grad
    eps = 0.5 * (g + np.transpose(g, (1, 0, 2, 3)))
    principal = np.linalg.eigvalsh(np.moveaxis(eps, (0, 1), (-2, -1)))[..., -1].max()
    return force, principal


def fea_wall_v2_first(delta: float = 0.35, E: float = 3000.0):
    """Первая защёлка v2 (5e79b4b): выступы давят на стенку корпуса 1,8 мм, гнётся стенка.
    Стенка — пластина 33,2 мм между торцами, от дна (1,6) до верха (9,2); снаружи до 3 мм её держит
    основание. Паз 0,55 мм по всей длине на высоте 7,0–8,6. Два выступа длиной 6 мм на ±8,5 мм."""
    from skfem import MeshHex

    a, t, z0, z1 = 33.2, 1.8, 1.6, 9.2
    xs = _axis(-a / 2, a / 2, 0.8, [-15.6, 15.6, -11.5, -5.5, 5.5, 11.5])
    ys = _axis(0, t, t / 2, [t - 0.55])
    zs = _axis(z0, z1, 0.5, [3.0, 7.0, 8.6])
    m = MeshHex.init_tensor(xs, ys, zs)
    c = m.p[:, m.t].mean(axis=1)
    groove = (np.abs(c[0]) < 15.6) & (c[1] > t - 0.55) & (c[2] > 7.0) & (c[2] < 8.6)
    m = m.remove_elements(np.nonzero(groove)[0])
    e = 1e-6
    fixed = lambda x: (x[2] < z0 + e) | ((x[1] < e) & (x[2] < 3.0 + e)) | (np.abs(np.abs(x[0]) - a / 2) < e)
    load = lambda x: (np.abs(x[1] - t) < e) & (np.abs(x[0]) > 5.5 - e) & (np.abs(x[0]) < 11.5 + e) & (x[2] > 8.6 - e)
    force, _ = _solve(m, fixed, load, delta, E, -1.0)
    # Растяжение у основания стенки — по формуле консоли: от основания (≈2,3 мм) до точки касания (≈8,9 мм)
    strain = 1.5 * t * delta / (8.9 - 2.3) ** 2
    return force, strain


def fea_beam(s: kv.Snap, lip: float, delta: float, E: float = 3000.0):
    """Нынешняя защёлка: гибкая балка в бортике крышки, концы заделаны в углы бортика.
    Балка: длина beam_len, толщина beam_t, высота lip − slit. Выступ длиной bump_len в середине
    сдвигает её наружную грань внутрь на delta.
    Сила — из расчёта: это интеграл, он от сетки почти не зависит. Растяжение — по силе и формуле
    балки с заделанными концами (момент P·L/8 в заделке и под выступом): наибольшее главное растяжение
    из расчёта сидит на углу площадки, где задано смещение, и меняется от сетки — ему верить нельзя."""
    from skfem import MeshHex

    L, t, h = s.beam_len, s.beam_t, lip - s.slit
    # Выступ по высоте — в координатах балки (низ балки — 0)
    zt = h - 0.15
    zb = zt - s.bump_h
    xs = _axis(-L / 2, L / 2, 0.6, [-s.bump_len / 2, s.bump_len / 2])
    ys = _axis(0, t, t / 2, [])
    zs = _axis(0, h, 0.3, [zb, zt])
    m = MeshHex.init_tensor(xs, ys, zs)
    e = 1e-6
    fixed = lambda x: np.abs(np.abs(x[0]) - L / 2) < e
    load = lambda x: (x[1] < e) & (np.abs(x[0]) < s.bump_len / 2 + e) & (x[2] > zb - e) & (x[2] < zt + e)
    force, _ = _solve(m, fixed, load, delta, E, 1.0)
    inertia = h * t**3 / 12
    strain = force * L / 8 * (t / 2) / (E * inertia)
    return force, strain


# ── 2. Тысяча отпечатков ──────────────────────────────────────────────────────────────────────


def lever(angle_deg: float, mu: np.ndarray) -> np.ndarray:
    """Во сколько раз сила вдоль хода крышки больше силы прогиба балки: скос под углом к вертикали и трение."""
    t = math.tan(math.radians(angle_deg))
    return (t + mu) / np.maximum(1e-9, 1 - mu * t)


def monte_carlo(name: str, snap: kv.Snap, k_per_mm: float, strain_per_mm: float, extra, rng: np.random.Generator, condition_v1: bool = False):
    """Один корпус, N случайных отпечатков. k_per_mm — жёсткость балки при E = 3000 МПа, Н/мм на выступ;
    strain_per_mm — растяжение на 1 мм прогиба. extra(rng, n, g_out, g_in, dz) — свои проверки корпуса.
    condition_v1 — только принтеры, на которых крышка v1 с зазором 0,25 села свободно (g_out + g_in < 0,25)."""
    rows = []
    n_done = 0
    while n_done < N:
        n = N - n_done
        # Принтер: наружные грани толще на g_out, внутренние уже на g_in (на сторону), мелкий выступ — свой разброс
        g_out = rng.uniform(-0.05, 0.20, n)
        g_in = rng.uniform(-0.05, 0.20, n)
        if condition_v1:
            keep = g_out + g_in < 0.25
            g_out, g_in = g_out[keep], g_in[keep]
            n = keep.sum()
        g_bump = rng.uniform(-0.20, 0.05, n)  # выступ 0,6 мм — полторы линии сопла, обычно выходит меньше
        dz_lid = rng.uniform(-0.1, 0.1, n)  # слой 0,2 мм: высоты выходят ±0,1
        dz_box = rng.uniform(-0.1, 0.1, n)
        petg = rng.random(n) < 0.5
        E = np.where(petg, rng.uniform(*E_PETG, n), rng.uniform(*E_PLA, n))
        mu = rng.uniform(0.25, 0.45, n)
        rows.append(dict(g_out=g_out, g_in=g_in, g_bump=g_bump, dz_lid=dz_lid, dz_box=dz_box, E=E, mu=mu, petg=petg))
        n_done += n
    d = {k: np.concatenate([r[k] for r in rows])[:N] for k in rows[0]}
    g_out, g_in, g_bump, E, mu = d["g_out"], d["g_in"], d["g_bump"], d["E"], d["mu"]

    res: dict[str, np.ndarray] = {}
    # Бортик входит в корпус: зазор на сторону не меньше нуля
    rim_gap = snap.fit - g_out - g_in
    res["бортик входит в корпус"] = rim_gap >= 0
    # Натяг защёлки: вершина выступа против грани стенки
    i = snap.interference + g_out + g_bump + g_in
    res["выступ заходит за стенку хотя бы на 0,1 мм — щёлкает"] = i >= 0.1
    k = 2 * k_per_mm * E / 3000.0  # два выступа
    F_in = k * i * lever(snap.lead_deg, mu)
    F_ret = k * i * lever(snap.ret_deg, mu)
    res["закрыть — не больше 40 Н (нажим большим пальцем)"] = F_in <= 40
    res["держит — не меньше 10 Н"] = F_ret >= 10
    res["открыть за торец — не больше 30 Н"] = F_ret / 2 <= 30
    strain = strain_per_mm * i
    res["растяжение балки меньше 2 %"] = strain < STRAIN_LIMIT
    # Выступ встаёт в паз: по высоте разница ошибок меньше запаса; по глубине — паз не мельче выступа
    res["выступ по высоте попадает в паз"] = np.abs(d["dz_lid"] - d["dz_box"]) <= snap.clear + 1e-9
    preload = np.maximum(0, (g_out + g_bump + g_in) - snap.clear)
    res["в пазу балка свободна или прижата не больше 0,2 мм"] = preload <= 0.2
    res.update(extra(rng, N, g_out, g_in, d["dz_lid"], d["dz_box"]))
    ok = np.all(np.array(list(res.values())), axis=0)
    stats = dict(F_in=F_in, F_ret=F_ret, strain=strain, i=i, preload=preload)
    return name, res, ok, stats


def sensor_extra(p: kv.SensorParams, cable: tuple[float, float]):
    def extra(rng, n, g_out, g_in, dz_lid, dz_box):
        r = {}
        # Плата: размеры GY-521 у разных продавцов 20,0–21,2 × 15,6–16,4 мм (комментарий в korpus-gy521.scad)
        bl = rng.uniform(20.0, 21.2, n)
        bw = rng.uniform(15.6, 16.4, n)
        along, across = (bl, bw) if p.x_along == "long" else (bw, bl)
        r["плата входит между упорами и стенками"] = (along <= p.cav[0] - 2 * g_out) & (across <= p.cav[1] - 2 * g_in)
        # Детали на плате у края — до 1 мм высотой; бортик крышки над краем платы не должен их задевать
        tape = rng.uniform(0.8, 1.6, n)
        bt = rng.uniform(1.5, 1.7, n)
        top = p.floor_t + tape + bt + 1.0
        r["бортик крышки выше платы и деталей у края"] = top <= p.height - p.lip + dz_lid
        # Кабель на дне паза, язычок сверху
        cd = rng.uniform(*cable, n)
        groove_bottom = p.cable_z - (p.cable_d + p.cable_fit) / 2 + dz_box + 0.5 * g_in
        squeeze = groove_bottom + cd - (p.cable_rest_z + p.cable_d / 2 - p.squeeze + dz_lid)
        r["кабель входит в паз"] = cd <= p.cable_d + p.cable_fit - 2 * g_in
        r["язычок прижимает кабель (≥ 0,05 мм)"] = squeeze >= 0.05
        r["язычок не мешает крышке сесть (≤ 0,7 мм)"] = squeeze <= 0.7
        r["язычок входит в паз по ширине"] = p.tongue_clear - g_out - g_in >= -0.05
        # Ремешок: липучка 20 мм, толщина 1,6–2,6 мм
        sw = rng.uniform(19.5, 20.5, n)
        st = rng.uniform(1.6, 2.6, n)
        r["ремешок проходит в прорезь"] = (sw <= p.strap + 2 - 2 * g_in) & (st <= p.slot_h - 2 * g_in)
        return r
    return extra


def hub_extra(p: kv.HubParams):
    def extra(rng, n, g_out, g_in, dz_lid, dz_box):
        r = {}
        # Плата ESP32 на 30 выводов у разных продавцов: 51–53 × 27,5–28,8 мм — замерить свою
        bl = rng.uniform(51.0, 53.0, n)
        bw = rng.uniform(27.5, 28.8, n)
        r["плата входит в полость"] = (bl <= p.cav[0] - 2 * g_in) & (bw <= p.cav[1] - 2 * g_in)
        # Плата не съезжает с угловых опор: опора от стенки до (pcb/2 − post), край платы должен на неё лечь
        ledge_in = p.pcb[0] / 2 - p.post + g_out
        shift = (p.cav[0] - 2 * g_in - bl) / 2  # плата может уехать к одному торцу
        r["плата лежит на опорах даже сдвинутая к торцу"] = bl / 2 - shift >= ledge_in + 0.8
        # Штекер USB-C: литая часть 10–12 мм шириной, 5,5–7 мм высотой
        pw = rng.uniform(10.0, 12.0, n)
        ph = rng.uniform(5.5, 7.0, n)
        top_gap = p.height - (p.usb_zc + ph / 2) + dz_lid
        r["штекер USB-C входит в вырез"] = (pw <= p.usb_w - 2 * g_in) & (p.usb_zc - ph / 2 >= p.usb_zc - p.usb_h / 2 + g_in) & (top_gap >= 0)
        cd = rng.uniform(4.4, 4.8, n)
        groove_bottom = p.cable_z - (p.cable_d + p.cable_fit) / 2 + dz_box + 0.5 * g_in
        squeeze = groove_bottom + cd - (p.cable_rest_z + p.cable_d / 2 - p.squeeze + dz_lid)
        r["дверца прижимает кабели (≥ 0,05 мм)"] = squeeze >= 0.05
        r["дверца не мешает крышке сесть (≤ 0,7 мм)"] = squeeze <= 0.7
        r["дверца входит в вырез по ширине"] = p.door_clear - g_out - g_in >= -0.05
        return r
    return extra


# ── 3. STL ─────────────────────────────────────────────────────────────────────────────────────


def check_stl(path: str) -> list[str]:
    import trimesh

    m = trimesh.load_mesh(path)
    out = []
    bodies = m.split(only_watertight=False)
    z = m.vertices[:, 2]
    n = m.face_normals
    a = m.area_faces
    centroid_z = m.triangles_center[:, 2]
    bed = a[(n[:, 2] < -0.99) & (centroid_z < 0.01)].sum()
    # Снизу без опоры: горизонтальные грани — мосты (прорезь над балкой, дно букв, потолок паза);
    # наклонные круче 45° от вертикали. Фаски ровно 45° сюда не попадают — они печатаются
    up = centroid_z > 0.05
    bridges = (n[:, 2] < -0.99) & up
    steep = (n[:, 2] >= -0.99) & (n[:, 2] < -0.72) & up
    out.append(f"{os.path.basename(path)}: замкнута {'да' if m.is_watertight else 'НЕТ'}, "
               f"обход граней {'верный' if m.is_winding_consistent else 'НЕВЕРНЫЙ'}, кусков {len(bodies)}, "
               f"объём {m.volume / 1000:.2f} см³, {' × '.join(f'{v:.1f}' for v in m.extents)} мм, "
               f"низ на столе {'да' if abs(z.min()) < 1e-6 else 'НЕТ'}, площадь на столе {bed:.0f} мм², "
               f"мосты {a[bridges].sum():.0f} мм², круче 45° {a[steep].sum():.1f} мм²")
    return out


def main() -> int:
    rng = np.random.default_rng(SEED)
    print("1. Защёлка, конечные элементы (PLA, E = 3000 МПа; у PETG силы на треть меньше, растяжение то же)\n")
    F0, e0 = fea_wall_v2_first()
    print(f"  первая защёлка v2 (5e79b4b), гнётся стенка, натяг 0,35 мм: {F0:.0f} Н на сторону, закрыть ≈ {2 * F0 * lever(40, np.array(0.3)):.0f} Н"
          f" — рукой не закрыть; растяжение у основания стенки ≈ {e0 * 100:.1f} % по формуле консоли")
    sp = kv.SensorParams()
    hp = kv.HubParams()
    beams = {}
    for title, s, lip in (("датчик", sp.snap, sp.lip), ("ESP32", hp.snap, hp.lip)):
        F, e = fea_beam(s, lip, s.interference)
        beams[title] = (F / s.interference, e / s.interference)
        print(f"  {title}: балка {s.beam_len:.0f} × {s.beam_t} × {lip - s.slit:.1f} мм, натяг {s.interference} мм: "
              f"{F:.1f} Н на выступ, растяжение {e * 100:.2f} %; закрыть ≈ {2 * F * lever(s.lead_deg, np.array(0.3)):.0f} Н, "
              f"держит ≈ {2 * F * lever(s.ret_deg, np.array(0.3)):.0f} Н (трение 0,3)")

    print(f"\n2. {N} случайных отпечатков на корпус, seed {SEED}")
    print("   Принтер: наружные грани +(−0,05…0,20) мм, внутренние −(−0,05…0,20) мм на сторону, выступ защёлки")
    print("   −0,20…+0,05 мм, высоты ±0,1 мм; пластик PLA или PETG поровну; трение 0,25–0,45.\n")
    cases = []
    for x_along, tag in (("short", "поперёк"), ("long", "вдоль")):
        p = kv.SensorParams(x_along=x_along)
        k, eps = beams["датчик"]
        cases.append(monte_carlo(f"датчик «{tag}», кабель 4,6 ± 0,15 мм", p.snap, k, eps, sensor_extra(p, (4.45, 4.75)), rng))
    p = kv.SensorParams()
    k, eps = beams["датчик"]
    cases.append(monte_carlo("датчик «поперёк», принтер как 15 октября", p.snap, k, eps, sensor_extra(p, (4.45, 4.75)), rng, condition_v1=True))
    cases.append(monte_carlo("датчик «поперёк», кабель 3,0–4,4 мм без изоленты", p.snap, k, eps, sensor_extra(p, (3.0, 4.4)), rng))
    for under, tag in ((20.0, "гнёзда"), (9.0, "пайка")):
        h = kv.HubParams(under=under)
        k, eps = beams["ESP32"]
        cases.append(monte_carlo(f"ESP32, {tag}", h.snap, k, eps, hub_extra(h), rng))
    for name, res, ok, st in cases:
        print(f"  {name}: все условия — {ok.mean() * 100:.1f} % отпечатков")
        for crit, v in res.items():
            share = v.mean() * 100
            if share < 100:
                print(f"      {crit}: {share:.1f} %")
        q = lambda a, x: np.percentile(a, x)
        print(f"      закрыть {q(st['F_in'], 5):.0f}–{q(st['F_in'], 95):.0f} Н, держит {q(st['F_ret'], 5):.0f}–{q(st['F_ret'], 95):.0f} Н,"
              f" растяжение {q(st['strain'], 5) * 100:.2f}–{q(st['strain'], 95) * 100:.2f} % (5–95 % отпечатков)")

    print("\n3. STL на печать\n")
    for path in sorted(glob.glob(os.path.join(HERE, "korpus-v2-*.stl"))):
        for line in check_stl(path):
            print("  " + line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
