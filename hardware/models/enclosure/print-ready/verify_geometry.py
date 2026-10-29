"""Read-only comparison of original and Bambu-saved world-space meshes."""
import collections
import json
import itertools
import math
import pathlib
import xml.etree.ElementTree as ET
import zipfile

BASE = pathlib.Path(__file__).resolve().parent.parent
NS = {'c': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
PROD = '{http://schemas.microsoft.com/3dmanufacturing/production/2015/06}'

def triangles(path):
    result = collections.Counter()
    with zipfile.ZipFile(path) as archive:
        roots = {}
        def root(part):
            if part not in roots:
                roots[part] = ET.fromstring(archive.read(part))
            return roots[part]
        def transform(point, matrix):
            x, y, z = point
            return tuple(x*matrix[i] + y*matrix[3+i] + z*matrix[6+i] + matrix[9+i] for i in range(3))
        def matrix(node):
            value = node.get('transform')
            return list(map(float, value.split())) if value else [1,0,0,0,1,0,0,0,1,0,0,0]
        def visit(part, oid, transforms):
            obj = root(part).find(f"c:resources/c:object[@id='{oid}']", NS)
            mesh = obj.find('c:mesh', NS)
            if mesh is not None:
                points = []
                for v in mesh.findall('c:vertices/c:vertex', NS):
                    point = tuple(float(v.get(axis)) for axis in ('x', 'y', 'z'))
                    for m in reversed(transforms):
                        point = transform(point, m)
                    points.append(tuple(round(n, 8) for n in point))
                for t in mesh.findall('c:triangles/c:triangle', NS):
                    result[tuple(sorted(points[int(t.get(k))] for k in ('v1', 'v2', 'v3')))] += 1
            for comp in obj.findall('c:components/c:component', NS):
                visit(comp.get(PROD+'path', part).lstrip('/'), comp.get('objectid'), transforms+[matrix(comp)])
        for item in root('3D/3dmodel.model').findall('c:build/c:item', NS):
            visit('3D/3dmodel.model', item.get('objectid'), [matrix(item)])
    return result

checks = []
for stem in ('A1-1-proba', 'A1-2-datchiki', 'A1-3-esp32'):
    source = triangles(BASE / (stem+'.3mf'))
    saved = triangles(BASE / 'print-ready' / (stem+'-ready.3mf'))
    # Bambu stores mesh coordinates as floats and rounds placement transforms.
    # Match vertices within 0.0001 mm instead of comparing rounded strings.
    bins = collections.defaultdict(list)
    cell = lambda p: tuple(math.floor(n * 1000) for n in p)
    for point in {v for t in source for v in t}:
        bins[cell(point)].append(point)
    matched = {}
    max_error = 0.0
    for point in {v for t in saved for v in t}:
        key = cell(point)
        options = [v for offset in itertools.product((-1,0,1), repeat=3)
                   for v in bins[tuple(a+b for a,b in zip(key,offset))]]
        nearest = min(options, key=lambda v: math.dist(v,point)) if options else None
        error = math.dist(nearest,point) if nearest else math.inf
        max_error = max(max_error,error)
        matched[point] = nearest if error <= 0.0001 else point
    restored = collections.Counter()
    for triangle, count in saved.items():
        restored[tuple(sorted(matched[v] for v in triangle))] += count
    check = {'file': stem, 'triangles': source.total(), 'maximum_vertex_difference_mm': max_error,
             'geometry_and_world_positions_unchanged': source == restored}
    checks.append(check)
    print(json.dumps(check))
(BASE / 'print-ready' / 'geometry-verification.json').write_text(json.dumps(checks, indent=2), encoding='utf-8')
assert all(c['geometry_and_world_positions_unchanged'] for c in checks)
