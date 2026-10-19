import numpy as np, trimesh
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
sc = trimesh.load('public/models/rebot.glb')
fig,axs=plt.subplots(1,2,figsize=(14,7))
for ax,z in zip(axs,[-8,3]):
    for n,c in [('RatchetedWeaponDrivePulleyTangential#1','r'),('TangentialDrivenPulley#1','b'),('WeaponWheel#1','g'),('WeaponMotor#1','m'),('GanchoUnidente#1','k')]:
        g=sc.geometry[n].copy(); g.apply_scale(1000)
        s=g.section(plane_origin=[0,0,z],plane_normal=[0,0,1])
        if s is None: continue
        for e in s.discrete: ax.plot(e[:,0],e[:,1],c,lw=.8)
    ax.set_aspect('equal'); ax.set_title('z=%s'%z); ax.set_xlim(-100,0); ax.set_ylim(-70,40)
plt.savefig('/tmp/claude-1000/-home-tths-rebot-site/094254cc-c3ba-48e6-b2c4-27cb5cf58aa2/scratchpad/sl2.png',dpi=80)
