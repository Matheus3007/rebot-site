import sys, numpy as np, trimesh
sc = trimesh.load('public/models/rebot.glb')
def prof(name, axis_pt, ax=1):
    for gname, g in sc.geometry.items():
        if gname.startswith(name):
            v = g.vertices*1000
            o=[0,2] if ax==1 else [0,1]
            r = np.hypot(v[:,o[0]]-axis_pt[0], v[:,o[1]]-axis_pt[1])
            a = v[:,ax]
            print(gname, 'maxR', r.max().round(2))
            for lo in np.arange(a.min(), a.max(), (a.max()-a.min())/8):
                m=(a>=lo)&(a<lo+(a.max()-a.min())/8+1e-6)
                if m.any(): print('  y %.1f..: R %.1f-%.1f'%(lo, r[m].min(), r[m].max()))
            return
prof('SimpleWheelHub#1',(-113.7,16))
prof('RubberWheel#1',(-113.7,16))
prof('invertediFlight_Xing_2207_stp#2',(-79.1,15.9))
prof('invertediFlight_Xing_2207_stp#1',(-79.1,15.9))
