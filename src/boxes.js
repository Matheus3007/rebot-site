// Ending minigame: wireframe boxes in the grid's colours. They land just off screen, ride the floor (which
// slides under Rebot like a treadmill) into it, and react: the blade flings them, the body only shoves them.
// A small custom step is plenty for a couple of dozen boxes: spheres against the body's footprint and the
// blade's disc, a support-point floor contact that settles them flat, and sphere pushes between boxes.
// One instanced draw call; nothing runs while there are no boxes.
import * as THREE from 'three';

const MAX = 24, G = 9.81;
// measured from the CAD (mm): body footprint and height band, the blade's disc (Ø230) and its height band
const BODY = { x0: -146, x1: 0, y0: -145, y1: 145, z0: -16, z1: 48 };
const BLADE = { x: -49.4, y: 0, r: 115, z0: -14, z1: -4 };

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

export function createBoxes({ lut, lutN, bgD }) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const aHit = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
  aHit.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aHit', aHit);
  // same colour model as the grid: red edges, faint grey thirds, black faces; under the post chain it reads
  // the grid's inverse lookup so the boxes land on the grid's exact colours
  const mat = new THREE.ShaderMaterial({
    defines: lut ? { AGX_INV: '' } : {},
    uniforms: { uLut: { value: lut }, uBgD: { value: bgD } },
    vertexShader: `
      attribute float aHit; varying vec2 vUv; varying float vHit;
      void main(){ vUv = uv; vHit = aHit; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.); }`,
    fragmentShader: `
      uniform sampler2D uLut; uniform vec3 uBgD; varying vec2 vUv; varying float vHit;
      void main(){
        vec2 e = min(vUv, 1. - vUv) / fwidth(vUv);
        float edge = 1. - min(min(e.x, e.y) / 1.6, 1.);
        vec2 q = vUv * 3.; vec2 d = abs(fract(q - .5) - .5) / fwidth(q);
        float minor = (1. - min(min(d.x, d.y) / 1.1, 1.)) * (1. - edge);
        float red = edge * .9 + vHit * (.25 + .1 * edge), grey = minor * .14;
        float a = clamp(red + grey, 0., 1.), k = red / max(red + grey, 1e-3);
      #ifdef AGX_INV
        vec2 t = vec2(k, sqrt(a)) * ${(lutN - 1).toFixed(1)} + .5;
        gl_FragColor = vec4(texture2D(uLut, t / ${lutN.toFixed(1)}).rgb, 1.);
      #else
        gl_FragColor = vec4(mix(uBgD, mix(vec3(.9), vec3(.9, .08, .1), k), a), 1.);
      #endif
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;

  const list = [], stats = { hits: 0, shoves: 0 }; // stats: for the headless checks
  function die(b) { if (b.die < 0) b.die = 0; }

  // a loose cluster of three, resting on the floor at (x, z)
  function spawn(x, z, floorY, sc) {
    for (let i = 0; i < 3; i++) {
      if (list.length >= MAX) list.shift();
      const h = rnd(0.02, 0.027) * sc;
      list.push({
        p: new THREE.Vector3(x + (i - 1) * 0.06 * sc + rnd(-0.015, 0.015), floorY + h, z + rnd(0, 0.09) * sc),
        v: new THREE.Vector3(), w: new THREE.Vector3(),
        q: new THREE.Quaternion().setFromAxisAngle(UP, rnd(0, Math.PI)),
        h, age: 0, hit: 0, cool: 0, die: -1,
      });
    }
  }
  function clear() { list.forEach(die); }

  // R: the robot this frame (world): px, py, pz, yaw, yawRate, sc, focus (CAD mm), vx, vz (rig motion),
  // spin (blade rate about the CAD z axis), floorY, vG (floor velocity, x/z), home x, and how far boxes may roam.
  // Returns the hits, so the caller can recoil the robot and slow the blade.
  function step(dt, R) {
    const hits = [];
    const c = Math.cos(R.yaw), s = Math.sin(R.yaw), f = R.focus, sc = R.sc;
    // robot local frame (unscaled m): x forward (CAD x), y up (CAD z), z = -CAD y
    const bx0 = (BODY.x0 - f[0]) / 1e3, bx1 = (BODY.x1 - f[0]) / 1e3;
    const bz0 = (-BODY.y1 + f[1]) / 1e3, bz1 = (-BODY.y0 + f[1]) / 1e3;
    const by0 = (BODY.z0 - f[2]) / 1e3, by1 = (BODY.z1 - f[2]) / 1e3;
    const wx = (BLADE.x - f[0]) / 1e3, wz = (-BLADE.y + f[1]) / 1e3, wr = BLADE.r / 1e3;
    const wy0 = (BLADE.z0 - f[2]) / 1e3, wy1 = (BLADE.z1 - f[2]) / 1e3;
    const toWorld = (lx, lz) => [lx * c + lz * s, -lx * s + lz * c];

    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.age += dt; b.cool -= dt; b.hit = Math.max(0, b.hit - dt * 2.2);
      if (b.die >= 0) { b.die += dt; if (b.die > 0.35) { list.splice(i, 1); continue; } }

      b.v.y -= G * sc * dt;
      b.p.addScaledVector(b.v, dt);
      const wl = b.w.length();
      if (wl > 1e-4) { _q.setFromAxisAngle(_v.copy(b.w).divideScalar(wl), wl * dt); b.q.premultiply(_q).normalize(); }

      // floor: the lowest corner rests on it; friction pulls toward the floor's own motion; settle flat
      _m.makeRotationFromQuaternion(b.q); const e = _m.elements;
      const sup = b.h * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]));
      const pen = R.floorY + sup - b.p.y;
      if (pen > 0) {
        b.p.y += pen;
        if (b.v.y < 0) b.v.y = b.v.y < -0.5 * sc ? -b.v.y * 0.28 : 0;
        const fr = 1 - Math.exp(-7 * dt);
        b.v.x += (R.vG[0] - b.v.x) * fr; b.v.z += (R.vG[1] - b.v.z) * fr;
        b.w.multiplyScalar(Math.exp(-5 * dt));
        let k = 0; for (let j = 1; j < 3; j++) if (Math.abs(e[j * 4 + 1]) > Math.abs(e[k * 4 + 1])) k = j;
        const sg = Math.sign(e[k * 4 + 1]) || 1;
        _q2.setFromUnitVectors(_s.set(e[k * 4] * sg, e[k * 4 + 1] * sg, e[k * 4 + 2] * sg), UP);
        _q.identity().slerp(_q2, Math.min(1, 7 * dt)); b.q.premultiply(_q).normalize();
      }

      // robot: local position (unscaled), height band, then blade before body
      const dx = b.p.x - R.px, dz = b.p.z - R.pz;
      if (dx * dx + dz * dz < (0.3 * sc) ** 2) {
        const lx = (dx * c - dz * s) / sc, lz = (dx * s + dz * c) / sc, ly = (b.p.y - R.py) / sc, rb = b.h / sc;
        const ox = lx - wx, oz = lz - wz, od = Math.hypot(ox, oz);
        if (b.cool <= 0 && lx > bx1 && od < wr + rb && ly - rb < wy1 && ly + rb > wy0) {
          // the tooth's velocity at the contact (blade spins about local y at -spin), plus out and up
          const W = -R.spin, tx = W * oz, tz = -W * ox, tl = Math.hypot(tx, tz) || 1;
          const [tX, tZ] = toWorld(tx / tl, tz / tl), [nX, nZ] = toWorld(ox / od, oz / od);
          const sp = rnd(1.5, 2.3) * sc, out = rnd(0.6, 1.0) * sc;
          b.v.set(tX * sp + nX * out, rnd(1.5, 2.1) * sc, tZ * sp + nZ * out);
          b.w.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(25, 45));
          b.p.y += 0.004 * sc; b.hit = 1; b.cool = 0.4;
          hits.push({ lx, lz, tx: tx / tl, tz: tz / tl }); stats.hits++;
        } else if (ly - rb < by1 && ly + rb > by0) {
          // body: push out of the footprint; take on the robot's speed along the contact normal
          const cx = Math.min(Math.max(lx, bx0), bx1), cz = Math.min(Math.max(lz, bz0), bz1);
          let nx = lx - cx, nz = lz - cz, d = Math.hypot(nx, nz), depth;
          if (d > 1e-6) { depth = rb - d; nx /= d; nz /= d; }
          else { // centre inside: out through the nearest side
            const m = [lx - bx0, bx1 - lx, lz - bz0, bz1 - lz], j = m.indexOf(Math.min(...m));
            nx = j === 0 ? -1 : j === 1 ? 1 : 0; nz = j === 2 ? -1 : j === 3 ? 1 : 0; depth = rb + m[j];
          }
          if (depth > 0) {
            const [nX, nZ] = toWorld(nx, nz);
            b.p.x += nX * depth * sc; b.p.z += nZ * depth * sc;
            // robot surface velocity there: rig motion plus yaw rate about +y
            const rX = b.p.x - R.px, rZ = b.p.z - R.pz;
            const vX = R.vx + R.yawRate * rZ, vZ = R.vz - R.yawRate * rX;
            const vn = (b.v.x - vX) * nX + (b.v.z - vZ) * nZ;
            if (vn < 0) { stats.shoves++; b.v.x -= vn * nX * 1.1; b.v.z -= vn * nZ * 1.1; b.w.y += vn * 6 * (nX * rZ - nZ * rX > 0 ? 1 : -1); }
          }
        }
      }

      if (b.age > 14 || b.p.z < -1.1 || b.p.z > 1.3 || Math.abs(b.p.x - R.home) > 1.4 || b.p.y < R.floorY - 0.5) die(b);
    }

    // boxes against each other (as spheres)
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y, dz = b.p.z - a.p.z, r = a.h + b.h, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r || d2 < 1e-12) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, push = (r - d) / 2;
      a.p.x -= nx * push; a.p.y -= ny * push; a.p.z -= nz * push; b.p.x += nx * push; b.p.y += ny * push; b.p.z += nz * push;
      const vn = (b.v.x - a.v.x) * nx + (b.v.y - a.v.y) * ny + (b.v.z - a.v.z) * nz;
      if (vn < 0) { const k = vn * 0.6; a.v.x += nx * k; a.v.y += ny * k; a.v.z += nz * k; b.v.x -= nx * k; b.v.y -= ny * k; b.v.z -= nz * k; }
    }

    // to the instances (dying boxes shrink away)
    for (let i = 0; i < list.length; i++) {
      const b = list[i], life = b.die < 0 ? Math.min(1, b.age / 0.15) : 1 - b.die / 0.35;
      _m.compose(b.p, b.q, _s.setScalar(2 * b.h * Math.max(life, 1e-3)));
      mesh.setMatrixAt(i, _m); aHit.array[i] = b.hit;
    }
    mesh.count = list.length; mesh.visible = list.length > 0;
    mesh.instanceMatrix.needsUpdate = true; aHit.needsUpdate = true;
    return hits;
  }

  return { mesh, spawn, clear, step, stats, get count() { return list.length; } };
}
