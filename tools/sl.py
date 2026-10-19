import numpy as np, trimesh, sys
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
sc = trimesh.load('public/models/rebot.glb')
fig,axs=plt.subplots(1,2,figsize=(14,6))
# top-down projection of wheel/rubber/motor y-slice  and side slice at z=16 (x,y plane)
for ax,(origin,normal,cols) in zip(axs,[([0,-120,0],[0,1,0],(0,2)),([0,0,16],[0,0,1],(0,1))]):
    for n,c in [('SimpleWheelHub#1','b'),('RubberWheel#1','k'),('invertediFlight_Xing_2207_stp#2','r'),('DriveBearing#4','g'),('DriveBearing#3','g'),('socket_head_cap_screw_am_B18_3_1M_-_8_x_1_25_x_50_Hex_SHCS_--_28NHX#1','m')]:
        g=sc.geometry[n].copy(); g.apply_scale(1000)
        s=g.section(plane_origin=origin,plane_normal=normal)
        if s is None: continue
        for e in s.discrete: ax.plot(e[:,cols[0]],e[:,cols[1]],c,lw=.8)
    ax.set_aspect('equal'); ax.set_title(str(origin))
    if cols==(0,1): ax.set_ylim(-150,-80)
plt.savefig('/tmp/claude-1000/-home-tths-rebot-site/094254cc-c3ba-48e6-b2c4-27cb5cf58aa2/scratchpad/sl.png',dpi=90)
