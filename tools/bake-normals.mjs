// Bake creased normals into the GLB, so the page doesn't compute them at load (was ~4 s of main thread).
// Same input and the same three.js toCreasedNormals(geo, 0.6) the page used to run; the result is
// re-indexed (exact pos+normal matches welded) and written with identity node transforms.
// node tools/bake-normals.mjs in.glb out.glb   (then meshopt-compress out.glb)
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const [src, out] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
for (const ext of root.listExtensionsUsed()) ext.dispose(); // written back uncompressed; meshopt runs after

let before = 0, after = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    const f = new Float32Array(pos.getCount() * 3), el = [0, 0, 0], v = new THREE.Vector3();
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, el); v.fromArray(el).applyMatrix4(m); f.set([v.x, v.y, v.z], i * 3); }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
    if (idx) geo.setIndex(Array.from(idx.getArray()));
    geo = toCreasedNormals(geo, 0.6);
    // weld exact duplicates back into an indexed mesh
    const P = geo.attributes.position.array, N = geo.attributes.normal.array;
    const map = new Map(), oP = [], oN = [], oI = new Uint32Array(P.length / 3);
    // key: exact position bits + normal to 1e-4 (float summation order differs per corner; 1e-4 is ~0.006 deg)
    const fb = new Float32Array(3), bits = new Uint32Array(fb.buffer), r = (x) => Math.round(x * 1e4);
    for (let i = 0; i < P.length / 3; i++) {
      fb.set([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      const key = `${bits[0]},${bits[1]},${bits[2]},${r(N[i * 3])},${r(N[i * 3 + 1])},${r(N[i * 3 + 2])}`;
      let k = map.get(key);
      if (k === undefined) { k = oP.length / 3; map.set(key, k); oP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); oN.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); }
      oI[i] = k;
    }
    before += pos.getCount(); after += oP.length / 3;
    for (const s of prim.listSemantics()) prim.setAttribute(s, null);
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(oP)).setBuffer(buffer));
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(oN)).setBuffer(buffer));
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(oP.length / 3 < 65536 ? Uint16Array.from(oI) : oI).setBuffer(buffer));
  }
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
// parents carried the quantization transforms too; positions are now baked in world space
for (const n of root.listNodes()) if (!n.getMesh()) n.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
await io.write(out, doc);
console.log(`baked normals: ${before} -> ${after} vertices`);
