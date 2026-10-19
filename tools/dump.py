import sys
from build123d import import_step
c = import_step(sys.argv[1])
def walk(n, d):
    bb = n.bounding_box() if True else None
    print("  "*d + f"{n.label!r} {type(n).__name__} ch={len(n.children)} sz=({bb.size.X:.1f},{bb.size.Y:.1f},{bb.size.Z:.1f}) c=({bb.center().X:.1f},{bb.center().Y:.1f},{bb.center().Z:.1f})")
    for k in n.children: walk(k, d+1)
walk(c, 0)
