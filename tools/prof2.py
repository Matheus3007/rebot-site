import numpy as np, trimesh
sc = trimesh.load('public/models/rebot.glb')
g=sc.geometry['SimpleWheelHub#1'].vertices*1000
r=np.hypot(g[:,0]+113.67,g[:,2]-16)
for y in np.arange(-134.8,-113.8,1.0):
    m=(g[:,1]>=y)&(g[:,1]<y+1)
    if m.any(): print('y%.1f R %.1f..%.1f'%(y,r[m].min(),r[m].max()))
mo=sc.geometry['invertediFlight_Xing_2207_stp#2'].vertices*1000
print('motor x',mo[:,0].min(),mo[:,0].max(),'z',mo[:,2].min(),mo[:,2].max(),'y',mo[:,1].min(),mo[:,1].max())
rm=np.hypot(mo[:,0]+79.12,mo[:,2]-15.9)
for y in np.arange(-126,-90,3):
    m=(mo[:,1]>=y)&(mo[:,1]<y+3)
    if m.any(): print('motor y%.1f R %.1f..%.1f'%(y,rm[m].min(),rm[m].max()))
