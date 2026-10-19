"""STEP -> per-part GLB (names kept). Units: mm -> metres*? keep mm/1000 later in the app; here output in mm scaled 0.001 (metres)."""
import sys, json, numpy as np, trimesh
from build123d import import_step
from OCP.BRepMesh import BRepMesh_IncrementalMesh
c = import_step(sys.argv[1])
scene = trimesh.Scene()
meta = {}
cnt = {}
for n in c.children:
    base = n.label.split('^')[0]
    cnt[base] = cnt.get(base, 0) + 1
    name = f"{base}#{cnt[base]}"
    shapes = [n]
    verts, faces = n.tessellate(0.05, 0.3)  # tol mm, angular rad
    v = np.array([[p.X, p.Y, p.Z] for p in verts]) * 0.001
    f = np.array(faces)
    m = trimesh.Trimesh(v, f, process=True)
    m.merge_vertices()
    scene.add_geometry(m, node_name=name, geom_name=name)
    meta[name] = {"tris": int(len(m.faces)), "bbox_mm": (m.bounds*1000).round(2).tolist()}
scene.export(sys.argv[2])
json.dump(meta, open(sys.argv[3], "w"), indent=1)
print(sum(m["tris"] for m in meta.values()), "tris")
