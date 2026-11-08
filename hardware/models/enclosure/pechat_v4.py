"""Столы печати v4 для Bambu Lab A1 (256 × 256 мм): print-ready/A1-v4-*.3mf и проверка STL.

Крышка и её вкладыш киноварью — одна деталь из двух частей (компоненты 3MF): Bambu Studio открывает их как
один объект, второй части назначается второй филамент. Без AMS — назначить всему один белый, выемки останутся.

Запуск после korpus_v4.py: python pechat_v4.py
"""

from __future__ import annotations

import json
import sys
import os
import zipfile

import numpy as np
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "print-ready")
BED = 256.0
GAP = 8.0

# Стол: список деталей; деталь — (имя, [stl, ...]) — несколько STL = одна деталь из частей
PLATES = {
    "A1-v4-1-proba": [
        ("datchik-korpus", ["korpus-v4-datchik-korpus"]),
        ("datchik-kryshka-P", ["korpus-v4-datchik-kryshka-P", "korpus-v4-datchik-vkladysh-P"]),
    ],
    "A1-v4-2-datchiki": [
        ("datchik-korpus-P", ["korpus-v4-datchik-korpus"]),
        ("datchik-korpus-PR", ["korpus-v4-datchik-korpus"]),
        ("datchik-korpus-G", ["korpus-v4-datchik-korpus"]),
        ("kryshka-P", ["korpus-v4-datchik-kryshka-P", "korpus-v4-datchik-vkladysh-P"]),
        ("kryshka-PR", ["korpus-v4-datchik-kryshka-PR", "korpus-v4-datchik-vkladysh-PR"]),
        ("kryshka-G", ["korpus-v4-datchik-kryshka-G", "korpus-v4-datchik-vkladysh-G"]),
    ],
    "A1-v4-3-esp32": [
        ("esp32-korpus", ["korpus-v4-esp32-korpus"]),
        ("esp32-kryshka", ["korpus-v4-esp32-kryshka", "korpus-v4-esp32-vkladysh"]),
    ],
}

NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"


def load(name: str) -> trimesh.Trimesh:
    m = trimesh.load_mesh(os.path.join(HERE, f"{name}.stl"))
    assert isinstance(m, trimesh.Trimesh)
    return m


def check_mesh(name: str, m: trimesh.Trimesh) -> dict:
    parts = len(m.split(only_watertight=False))
    info = {"файл": f"{name}.stl", "замкнута": bool(m.is_watertight), "кусков": parts, "лежит на столе": bool(abs(m.bounds[0][2]) < 1e-3),
            "габарит, мм": [round(float(v), 2) for v in m.extents], "объём, см³": round(float(m.volume) / 1000, 2)}
    return info


def mesh_xml(oid: int, m: trimesh.Trimesh, name: str) -> str:
    vs = "".join(f'<vertex x="{x:.5f}" y="{y:.5f}" z="{z:.5f}"/>' for x, y, z in m.vertices)
    ts = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in m.faces)
    return f'<object id="{oid}" name="{name}" type="model"><mesh><vertices>{vs}</vertices><triangles>{ts}</triangles></mesh></object>'


def layout(sizes: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Ряды слева направо; возвращает центр каждой детали на столе."""
    pos, x, y, row_h = [], GAP, GAP, 0.0
    for w, h in sizes:
        if x + w > BED - GAP:
            x, y, row_h = GAP, y + row_h + GAP, 0.0
        pos.append((x + w / 2, y + h / 2))
        x += w + GAP
        row_h = max(row_h, h)
    assert y + row_h <= BED - GAP, "детали не помещаются на стол"
    # Центрируем раскладку на столе
    xs = [p[0] for p in pos]
    ys = [p[1] for p in pos]
    dx = BED / 2 - (min(xs) + max(xs)) / 2
    dy = BED / 2 - (min(ys) + max(ys)) / 2
    return [(px + dx, py + dy) for px, py in pos]


def plate(name: str, items: list[tuple[str, list[str]]]) -> dict:
    objects, build, oid = [], [], 1
    meshes = [[load(s) for s in stls] for _, stls in items]
    sizes = []
    for ms in meshes:
        lo = np.min([m.bounds[0] for m in ms], axis=0)
        hi = np.max([m.bounds[1] for m in ms], axis=0)
        sizes.append((float(hi[0] - lo[0]), float(hi[1] - lo[1])))
    centers = layout(sizes)
    for (iname, stls), ms, (cx, cy) in zip(items, meshes, centers):
        ids = []
        for s, m in zip(stls, ms):
            objects.append(mesh_xml(oid, m, s))
            ids.append(oid)
            oid += 1
        if len(ids) == 1:
            top = ids[0]
        else:
            comps = "".join(f'<component objectid="{i}"/>' for i in ids)
            objects.append(f'<object id="{oid}" name="{iname}" type="model"><components>{comps}</components></object>')
            top = oid
            oid += 1
        build.append(f'<item objectid="{top}" transform="1 0 0 0 1 0 0 0 1 {cx:.3f} {cy:.3f} 0"/>')
    model = (f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="ru-RU" xmlns="{NS}">'
             f'<metadata name="Title">{name}</metadata><metadata name="Designer">NeuroMove</metadata>'
             f'<resources>{"".join(objects)}</resources><build>{"".join(build)}</build></model>')
    path = os.path.join(OUT, f"{name}.3mf")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
        z.writestr("3D/3dmodel.model", model)
    # Проверка: файл читается обратно, детали не пересекаются и все на столе
    import xml.etree.ElementTree as ET
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("3D/3dmodel.model"))
    n_items = len(root.findall(f"{{{NS}}}build/{{{NS}}}item"))
    n_mesh = len(root.findall(f"{{{NS}}}resources/{{{NS}}}object/{{{NS}}}mesh"))
    assert n_items == len(items)
    boxes = []
    for (iname, _), ms, (cx, cy) in zip(items, meshes, centers):
        lo = np.min([m.bounds[0] for m in ms], axis=0) + [cx, cy, 0]
        hi = np.max([m.bounds[1] for m in ms], axis=0) + [cx, cy, 0]
        assert lo[0] >= 0 and lo[1] >= 0 and hi[0] <= BED and hi[1] <= BED, f"{iname} за краем стола"
        boxes.append((lo, hi))
    gap = min((max(b[0][0] - a[1][0], a[0][0] - b[1][0], b[0][1] - a[1][1], a[0][1] - b[1][1])
               for i, a in enumerate(boxes) for b in boxes[i + 1:]), default=99)
    assert gap >= GAP - 1e-6, f"детали ближе {GAP} мм"
    grams = sum(float(m.volume) for ms in meshes for m in ms) / 1000 * 1.24
    return {"стол": os.path.basename(path), "деталей": len(items), "сеток в файле": n_mesh, "зазор между деталями, мм": round(gap, 1),
            "пластик без учёта заполнения, г (верхняя оценка)": round(grams, 1)}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    report = {"STL": [], "столы": []}
    names = sorted({s for items in PLATES.values() for _, stls in items for s in stls})
    ok = True
    for n in names:
        info = check_mesh(n, load(n))
        report["STL"].append(info)
        # Вкладыш датчика — точка знака и черта: два куска в одной части, это нормально
        good = info["замкнута"] and (info["кусков"] == 1 or "vkladysh" in n) and info["лежит на столе"]
        ok &= good
        print(("✓ " if good else "✗ ") + json.dumps(info, ensure_ascii=False))
    for name, items in PLATES.items():
        info = plate(name, items)
        report["столы"].append(info)
        print("✓ " + json.dumps(info, ensure_ascii=False))
    with open(os.path.join(OUT, "v4-verification.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("Сетки в порядке" if ok else "Есть плохие сетки — не печатать")


if __name__ == "__main__" and "--narezat" not in sys.argv:
    main()


# ── Нарезка в Bambu Studio: готовые проекты с настройками прошлых столов ─────────────────────────────

import re  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402

BAMBU = r"C:\Program Files\Bambu Studio\bambu-studio.exe"
PROFILES = r"C:\Program Files\Bambu Studio\resources\profiles\BBL"
# Настройки берём из проекта, который уже печатался на A1 (3 стенки, 20 %, PLA 1,24 г/см³, текстурный PEI)
SETTINGS_FROM = os.path.join(OUT, "A1-3-esp32-ready.3mf")
WHITE, VERMILION = "#F2F2F0", "#B7452C"


def _cli(args: list[str], outdir: str) -> dict:
    subprocess.run([BAMBU, *args, "--outputdir", outdir], check=False, capture_output=True, timeout=1800)
    with open(os.path.join(outdir, "result.json"), encoding="utf-8") as f:
        return json.load(f)


def _rewrite(src: str, dst: str, settings: dict, two_colors: bool) -> None:
    with zipfile.ZipFile(src) as z:
        files = {n: z.read(n) for n in z.namelist()}
    files["Metadata/project_settings.config"] = json.dumps(settings, indent=4).encode()
    ms = files["Metadata/model_settings.config"].decode()
    if two_colors:
        # Вторая часть крышки (вкладыш) — филамент 2. Части вкладыша — после основной части в каждом объекте
        def mark(m: re.Match) -> str:
            part = m.group(0)
            return part.replace('<metadata key="name"', '<metadata key="extruder" value="2"/>\n      <metadata key="name"', 1)
        ms = re.sub(r'<part id="\d+" subtype="normal_part"[^>]*>\s*<metadata key="name" value="[^"]*_2"/>', mark, ms)
    files["Metadata/model_settings.config"] = ms.encode()
    for n in [n for n in files if n.endswith(".gcode") or n.endswith(".gcode.md5")]:
        del files[n]
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for n, b in files.items():
            z.writestr(n, b)


def slice_all() -> list[dict]:
    with zipfile.ZipFile(SETTINGS_FROM) as z:
        base = json.loads(z.read("Metadata/project_settings.config"))
    out = []
    only = [a for a in sys.argv[1:] if a in PLATES]  # python pechat_v4.py --narezat A1-v4-3-esp32 — только этот стол
    for name in PLATES:
        if only and name not in only:
            if os.path.exists(os.path.join(OUT, f"{name}.3mf")):
                os.remove(os.path.join(OUT, f"{name}.3mf"))
            continue
        with tempfile.TemporaryDirectory() as tmp:
            # 1. Первый проход — Bambu превращает 3MF в свой проект (крышка = объект из двух частей)
            first = _cli(["--slice", "0",
                          "--load-settings", f"{PROFILES}/machine/Bambu Lab A1 0.4 nozzle.json;{PROFILES}/process/0.20mm Standard @BBL A1.json",
                          "--load-filaments", f"{PROFILES}/filament/Generic PLA @BBL A1.json;{PROFILES}/filament/Generic PLA @BBL A1.json",
                          "--export-3mf", "first.3mf", os.path.join(OUT, f"{name}.3mf")], tmp)
            assert first["return_code"] == 0, first
            with zipfile.ZipFile(os.path.join(tmp, "first.3mf")) as z:
                cli_cfg = json.loads(z.read("Metadata/project_settings.config"))
            # Двухцветный проект консольный Bambu Studio собирает с неполными настройками второго филамента —
            # нарезаем белый; вкладыш остаётся отдельной частью крышки, филамент 2 ему назначается в Bambu Studio
            for two in (False,):
                cfg = json.loads(json.dumps(base))
                if two:
                    # Два филамента: настройки первого прохода (Bambu сам собрал их на два PLA) плюс то, что
                    # отличало печатавшийся проект: стенки, плита, плотность
                    cfg = json.loads(json.dumps(cli_cfg))
                    for key in ("wall_loops", "sparse_infill_density", "curr_bed_type", "top_shell_layers", "bottom_shell_layers"):
                        if key in base:
                            cfg[key] = base[key]
                    n = len(cfg["filament_settings_id"])
                    cfg["filament_density"] = ["1.24"] * n
                    cfg["filament_colour"] = [WHITE, VERMILION][:n]
                else:
                    cfg["filament_colour"] = [WHITE]
                suffix = "-ready-2cveta" if two else "-ready"
                proj = os.path.join(tmp, f"proj{suffix}.3mf")
                _rewrite(os.path.join(tmp, "first.3mf"), proj, cfg, two)
                # 2. Второй проход — нарезка с настройками печатавшегося проекта
                d2 = os.path.join(tmp, "o" + suffix)
                os.makedirs(d2)
                res = _cli(["--slice", "0", "--export-3mf", f"{name}{suffix}.3mf", proj], d2)
                plate = res["sliced_plates"][0] if res.get("sliced_plates") else {}
                ok = res["return_code"] == 0 and not plate.get("warning_message")
                grams = sum(f.get("total_used_g", 0) for f in plate.get("filaments", []))
                info = {"проект": f"{name}{suffix}.3mf", "нарезан": ok, "сообщение": res.get("error_string"),
                        "время, мин": round(plate.get("total_predication", 0) / 60), "пластик, г": round(grams, 1),
                        "смен филамента": plate.get("filament_change_times"), "предупреждение": plate.get("warning_message", "")}
                if ok:
                    shutil.copy(os.path.join(d2, f"{name}{suffix}.3mf"), os.path.join(OUT, f"{name}{suffix}.3mf"))
                print(("✓ " if ok else "✗ ") + json.dumps(info, ensure_ascii=False))
                out.append(info)
        os.remove(os.path.join(OUT, f"{name}.3mf"))  # промежуточный 3MF — остаётся только готовый проект
    return out


if __name__ == "__main__" and "--narezat" in sys.argv:
    res = slice_all()
    path = os.path.join(OUT, "v4-verification.json")
    with open(path, encoding="utf-8") as f:
        rep = json.load(f)
    rep["нарезка Bambu Studio"] = res
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rep, f, ensure_ascii=False, indent=2)
