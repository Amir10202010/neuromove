"""Make only the chest sensor base fit a 38 mm strap; retain the other three meshes."""
from __future__ import annotations

import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
import trimesh
from build123d import Box, Pos, export_step, export_stl

import korpus_v3 as v3

HERE = Path(__file__).resolve().parent
OUT = HERE / 'print-ready'
CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'
NS = {'c': CORE}
ET.register_namespace('', CORE)
ET.register_namespace('p', PROD)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    normal = v3.Sensor()
    chest = v3.Sensor(strap=38.0)
    assert (normal.length, normal.width, normal.height, normal.cav_l, normal.cav_w) == (
        chest.length, chest.width, chest.height, chest.cav_l, chest.cav_w)
    baseline = v3.sensor_box(normal)
    body = v3.sensor_box(chest)
    assert len(body.solids()) == 1 and body.is_valid

    # Protect all electronics seating and the upper housing/snap interfaces.
    # The enlarged base legitimately relocates its external bottom chamfer.
    protected = Pos(0, 0, chest.height / 2) * Box(chest.cav_l, chest.cav_w, chest.height + 0.1)
    protected += Pos(0, 0, (chest.height + chest.ear_t) / 2) * Box(chest.length, chest.width, chest.height - chest.ear_t)
    diff_inside = v3.ov(body - baseline, protected) + v3.ov(baseline - body, protected)
    assert diff_inside < 1e-3, f'Central housing changed: {diff_inside}'
    for sign in (-1, 1):
        strap = Pos(0, sign * chest.slot_y, chest.ear_t / 2) * Box(38.0, 2.0, chest.ear_t + 4)
        assert v3.ov(strap, body) < 1e-3, '38 mm strap is obstructed'
        too_wide = Pos(0, sign * chest.slot_y, chest.ear_t / 2) * Box(41.0, 2.0, chest.ear_t + 4)
        assert v3.ov(too_wide, body) > 1e-3, 'Slot end bridges missing'
    for name, part in v3.sensor_parts(chest).items():
        assert v3.ov(part, body) < 1e-3, f'Electronics collision: {name}'

    print_body = v3.kv.for_print(body, flip=False)
    stl_path = OUT / 'korpus-v3-datchik-korpus-G-38mm.stl'
    export_stl(print_body, str(stl_path), tolerance=0.05, angular_tolerance=0.2)
    export_step(body, str(OUT / 'korpus-v3-datchik-korpus-G-38mm.step'))
    mesh = trimesh.load_mesh(stl_path)
    assert mesh.is_watertight and len(mesh.split()) == 1

    source = OUT / 'A1-2-datchiki-template.3mf'
    target = OUT / 'A1-2-datchiki-G38-ready.3mf'
    replacement = '3D/Objects/object_2.model'
    with zipfile.ZipFile(source) as old:
        root = ET.fromstring(old.read('3D/3dmodel.model'))
        build_items = root.findall('c:build/c:item', NS)
        transforms = [np.array(list(map(float, i.get('transform').split()))) for i in build_items]
        for t in transforms:
            assert np.allclose(t[:9], [1,0,0,0,1,0,0,0,1])
        assert build_items[1].get('objectid') == '4'
        obj = root.find("c:resources/c:object[@id='4']/c:components/c:component", NS)
        assert obj.get('{' + PROD + '}path') == '/' + replacement
        assert obj.get('transform') == '1 0 0 0 1 0 0 0 1 0 0 0'
        model = ET.fromstring(old.read(replacement))
        node = model.find('c:resources/c:object/c:mesh', NS)
        old_vertices = np.array([[float(v.get(a)) for a in ('x','y','z')]
                                 for v in node.findall('c:vertices/c:vertex', NS)])
        assert np.allclose(np.ptp(old_vertices, axis=0), [normal.length, normal.width + 2*normal.ear, normal.height], atol=0.001)
        # Existing instance position is untouched; mesh remains centred in XY and grounded in Z.
        local_vertices = mesh.vertices.copy()
        local_vertices[:, 2] -= transforms[1][11]
        node.clear()
        vertices = ET.SubElement(node, '{' + CORE + '}vertices')
        for x, y, z in local_vertices:
            ET.SubElement(vertices, '{' + CORE + '}vertex', x=f'{x:.8f}', y=f'{y:.8f}', z=f'{z:.8f}')
        faces = ET.SubElement(node, '{' + CORE + '}triangles')
        for a, b, c in mesh.faces:
            ET.SubElement(faces, '{' + CORE + '}triangle', v1=str(a), v2=str(b), v3=str(c))
        settings = ET.fromstring(old.read('Metadata/model_settings.config'))
        chest_meta = settings.find("object[@id='4']")
        for meta in chest_meta.findall('.//metadata'):
            if meta.get('key') == 'name':
                meta.set('value', '2-korpus-v3-datchik-G-remen-38mm')
            if 'face_count' in meta.attrib:
                meta.set('face_count', str(len(mesh.faces)))
        for stat in chest_meta.findall('.//mesh_stat'):
            stat.set('face_count', str(len(mesh.faces)))
        changed = {
            replacement: ET.tostring(model, encoding='utf-8', xml_declaration=True),
            'Metadata/model_settings.config': ET.tostring(settings, encoding='utf-8', xml_declaration=True),
        }
        bounds = []
        for index in range(4):
            if index == 1:
                verts = local_vertices
            else:
                part = ET.fromstring(old.read(f'3D/Objects/object_{index+1}.model'))
                verts = np.array([[float(v.get(a)) for a in ('x','y','z')]
                                  for v in part.findall('.//c:vertices/c:vertex', NS)])
            world = verts + transforms[index][9:]
            bounds.append(np.array([world.min(axis=0), world.max(axis=0)]))
        min_gap = min(bounds[i+1][0,0] - bounds[i][1,0] for i in range(3))
        assert min_gap >= 6.0
        assert all(np.all(b[0,:2] >= 0) and np.all(b[1,:2] <= 256) and abs(b[0,2]) < 1e-4 for b in bounds)
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as new:
            for info in old.infolist():
                new.writestr(info, changed.get(info.filename, old.read(info.filename)))
    # Every other mesh and all process/material/placement settings remain byte-identical.
    with zipfile.ZipFile(source) as old, zipfile.ZipFile(target) as new:
        for name in old.namelist():
            if name not in changed:
                assert old.read(name) == new.read(name), name
    report = {
        'strap_width_mm': 38, 'slot_length_mm': 39, 'slot_width_mm': chest.slot_h,
        'base_length_mm': chest.base_length,
        'body_length_mm': chest.length, 'body_width_mm': chest.width,
        'central_housing_difference_mm3': diff_inside,
        'single_valid_solid': True, 'mesh_watertight': True,
        'other_three_meshes_unchanged': True, 'placements_and_process_unchanged': True,
        'minimum_gap_mm': float(min_gap), 'project': str(target),
    }
    (OUT / 'chest-38mm-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
