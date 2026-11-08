"""3D-просмотр корпусов v4 в браузере: korpus-v4-vid.html (один файл, модели внутри).

Детали — подробные модели из detali_v4.py: GY-521 со штырьками и пайкой, колодки DuPont, ESP32 DevKit с модулем
ESP-32D и гнездом USB-C, макетная плата с дырками, провода «папа–папа», кабель USB-C, ремешки 5 см.
Кнопка «Разрез» режет сборку плоскостью. Крутить мышью, колесо — масштаб.

Запуск: python vid_v4.py   (нужен Python с build123d, как для korpus_v4.py)
"""

from __future__ import annotations

import base64
import json
import os
import sys

import trimesh
from build123d import Pos

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import detali_v4 as d  # noqa: E402
import korpus_v4 as k  # noqa: E402

WHITE, LID = "#f1f0ec", "#ebe9e4"
PLASTIC = (0.0, 0.62)


_C: dict = {}


def once(key, fn):
    """Каждая деталь строится и попадает в файл один раз, сколько бы сцен её ни показывали."""
    if key not in _C:
        _C[key] = fn()
    return _C[key]


def lifted(items: list, dz: float) -> list:
    if dz == 0:
        return items
    return [((Pos(0, 0, dz) * o) if not isinstance(o, trimesh.Trimesh) else o.copy().apply_translation((0, 0, dz)), c, m, r) for o, c, m, r in items]


def sensor_scene(p: k.Sensor, box, lid, inlay, lift: float, strap: bool = True) -> list:
    look = once("gy", lambda: d.gy521(p)[1])
    cable = once("gyc", lambda: d.gy521_cable(p))
    out = [(box, WHITE, *PLASTIC)] + lifted([(lid, LID, *PLASTIC), (inlay, k.ACCENT, 0.0, 0.5)], lift) + look + cable
    if strap:
        out.append((once("strap", lambda: d.sensor_strap(p)), "#3a3d42", 0.0, 0.9))
    return out


def hub_scene(h: k.Hub, box, lid, inlay, lift: float, belt: bool = True, inside: bool = True) -> list:
    out = [(box, WHITE, *PLASTIC)]
    if lid is not None:
        out += lifted([(lid, LID, *PLASTIC), (inlay, k.ACCENT, 0.0, 0.5)], lift)
    if inside:
        look = once("esp", lambda: d.esp32(h)[1])
        body, holes = once("bb", lambda: d.breadboard(h))
        wiring = once("wire", lambda: d.hub_wiring(h)[1])
        out += look + [(body, "#f4f4f0", 0.0, 0.7), (holes, "#2b2b2b", 0.0, 0.8)] + wiring
        out.append((once("tape", lambda: d.tape(h)), "#2d3b8f", 0.0, 0.55))
    out += once("rib", lambda: d.hub_ribbons(h)) + once("usb", lambda: d.usb_cable(h))
    if belt:
        out.append((once("belt", lambda: d.hub_belt(h)), "#3a3d42", 0.0, 0.9))
    return out


def main() -> None:
    p, hp, box, lids, hbox, hlid, hinlay = k.build(k.arg("--usb-vystup", k.Hub().usb_out))
    lid, inlay = lids["П"]
    scenes = {
        "Датчик — разбор": (sensor_scene(p, box, lid, inlay, 18.0, strap=False), "iso"),
        "Датчик — закрыт": (sensor_scene(p, box, lid, inlay, 0.0), "iso"),
        "Датчик снизу — ремешок 5 см": (sensor_scene(p, box, lid, inlay, 0.0), "under"),
        "ESP32 — разбор": (hub_scene(hp, hbox, hlid, hinlay, 30.0, belt=False), "iso"),
        "ESP32 — без крышки": (hub_scene(hp, hbox, None, None, 0.0, belt=False), "top"),
        "ESP32 — закрыт": (hub_scene(hp, hbox, hlid, hinlay, 0.0), "iso"),
        "ESP32 — USB-C": (hub_scene(hp, hbox, hlid, hinlay, 0.0, belt=False), "usb"),
    }
    pool, keys, data = [], {}, {}
    for name, (items, view) in scenes.items():
        refs = []
        for obj, color, metal, rough in items:
            if obj is None:
                continue
            key = id(obj)
            if key not in keys:
                m = d.to_mesh(obj, 0.05)
                keys[key] = len(pool)
                pool.append(base64.b64encode(m.export(file_type="stl")).decode())
            refs.append([keys[key], color, metal, rough])
        data[name] = {"view": view, "meshes": refs}
        print("сцена:", name, len(refs))
    html = PAGE.replace("__POOL__", json.dumps(pool)).replace("__DATA__", json.dumps(data))
    out = os.path.join(HERE, "korpus-v4-vid.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(out, round(len(html) / 1e6, 1), "МБ")
    # Копия для сайта: кнопка «Корпуса в 3D» в Настройках и в гиде открывает website/public/hardware/korpus-v4-vid.html
    site = os.path.join(HERE, "..", "..", "..", "website", "public", "hardware")
    if os.path.isdir(site):
        with open(os.path.join(site, "korpus-v4-vid.html"), "w", encoding="utf-8") as f:
            f.write(html)
        print("и в сайт:", os.path.normpath(os.path.join(site, "korpus-v4-vid.html")))


PAGE = r"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Корпуса NeuroMove v4</title>
<style>
html,body{margin:0;height:100%;background:#f4f2ee;font:500 14px 'Segoe UI',system-ui,sans-serif;color:#1d211f;overflow:hidden}
#bar{position:absolute;left:16px;top:14px;right:16px;display:flex;flex-wrap:wrap;gap:6px;z-index:2}
button{border:1px solid #d8d4cc;background:#fff;border-radius:999px;padding:6px 12px;font:inherit;cursor:pointer}
button.on{background:#1d211f;color:#fff;border-color:#1d211f}
#cut.on{background:#b7452c;border-color:#b7452c}
#t{position:absolute;left:18px;bottom:14px;font-weight:600;font-size:16px}
</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
</head><body><div id="bar"></div><div id="t"></div><script type="module">
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const POOL = __POOL__; const DATA = __DATA__; const GEO = {};
const r = new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true});
r.setPixelRatio(Math.min(2, devicePixelRatio)); r.localClippingEnabled = true;
document.body.appendChild(r.domElement); r.setClearColor(0xf4f2ee);
r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.15));
const d1 = new THREE.DirectionalLight(0xffffff, 1.5); d1.position.set(-60,-80,140); scene.add(d1);
const d2 = new THREE.DirectionalLight(0xffffff, 0.55); d2.position.set(90,50,40); scene.add(d2);
const cam = new THREE.PerspectiveCamera(28, 1, 1, 3000); cam.up.set(0,0,1);
const ctl = new OrbitControls(cam, r.domElement);
const loader = new STLLoader();
const clip = new THREE.Plane(new THREE.Vector3(0,-1,0), 0);
let group = null, cutOn = false, cur = null;
function size(){ r.setSize(innerWidth, innerHeight); cam.aspect = innerWidth/innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', size); size();
function show(name){
  cur = name; document.getElementById('t').textContent = name;
  document.querySelectorAll('#bar button.s').forEach(b => b.classList.toggle('on', b.textContent === name));
  if (group) scene.remove(group);
  group = new THREE.Group();
  for (const [idx, color, metalness, roughness] of DATA[name].meshes){
    if (!GEO[idx]) { const bin = Uint8Array.from(atob(POOL[idx]), c => c.charCodeAt(0)).buffer; GEO[idx] = loader.parse(bin); GEO[idx].computeVertexNormals(); }
    const g = GEO[idx];
    const m = new THREE.MeshStandardMaterial({color, roughness, metalness, side:THREE.DoubleSide, clippingPlanes: cutOn ? [clip] : []});
    group.add(new THREE.Mesh(g, m));
  }
  scene.add(group);
  const box = new THREE.Box3().setFromObject(group), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const d = Math.max(s.x, s.y, s.z) * 2.4, v = DATA[name].view;
  if (v === 'top') cam.position.set(c.x, c.y - 0.01, c.z + d * 1.2);
  else if (v === 'under') cam.position.set(c.x + d*0.35, c.y - d*0.75, c.z - d*0.45);
  else if (v === 'usb') { c.set(30, -6.8, 17); cam.position.set(c.x + 75, c.y - 32, c.z + 24); }
  else cam.position.set(c.x - d*0.55, c.y - d*0.75, c.z + d*0.62);
  ctl.target.copy(c); ctl.update();
}
const bar = document.getElementById('bar');
for (const n of Object.keys(DATA)){ const b = document.createElement('button'); b.className='s'; b.textContent=n; b.onclick=()=>show(n); bar.appendChild(b); }
const cb = document.createElement('button'); cb.id='cut'; cb.textContent='Разрез'; cb.onclick=()=>{cutOn=!cutOn; cb.classList.toggle('on',cutOn); show(cur);}; bar.appendChild(cb);
window.setCut = (nx, ny, nz, c) => { clip.normal.set(nx, ny, nz); clip.constant = c; cutOn = true; cb.classList.add('on'); show(cur); };
window.show = show;
const hs = new URLSearchParams(location.hash.slice(1));
if (hs.get('s')) { bar.style.display='none'; document.getElementById('t').style.display='none'; show(hs.get('s')); if (hs.get('cut')) { const [nx,ny,nz,c0] = hs.get('cut').split(',').map(Number); clip.normal.set(nx,ny,nz); clip.constant=c0; cutOn=true; show(hs.get('s')); } if (hs.get('z')) { cam.position.lerp(ctl.target, Number(hs.get('z'))); ctl.update(); } }
else show(Object.keys(DATA)[0]);
(function loop(){ requestAnimationFrame(loop); r.render(scene, cam); })();
</script></body></html>"""

if __name__ == "__main__":
    main()
