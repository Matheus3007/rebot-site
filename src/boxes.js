// Ending minigame: wireframe boxes in the grid's colours. Each click drops one just off screen; it rides the
// floor (which slides under Rebot like a treadmill) into it. The blade flings it hard (sparks, and the caller
// adds hit-stop, shake and recoil); the body only shoves it. Boxes leave by derezzing into small red cubes.
// A small custom step is plenty here: spheres against the body's footprint and the blade's disc, a
// support-point floor contact that settles boxes flat, and sphere pushes between boxes.
// Three draw calls at most (boxes, fragments, sparks); nothing runs while all three are empty.
import * as THREE from 'three';

const MAX = 24, G = 9.81;
const FR = 3, FRAG_PER = FR * FR * FR, MAX_FRAG = 12 * FRAG_PER, MAX_SPARK = 72;
// measured from the CAD (mm): body footprint and height band, the blade's disc (Ø230) and its height band
const BODY = { x0: -146, x1: 0, y0: -145, y1: 145, z0: -16, z1: 48 };
const BLADE = { x: -49.4, y: 0, r: 115, z0: -14, z1: -4 };

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Cubes in the grid's colour model: red edges, faint grey divisions (uDiv per face, 1 = none), black faces,
// and aFill: a red glow across the faces. Under the post chain it reads the grid's inverse lookup, so the
// colours land exactly on the grid's.
function cubes(n, div, { lut, lutN, bgD }) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const aFill = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  aFill.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aFill', aFill);
  const mat = new THREE.ShaderMaterial({
    defines: lut ? { AGX_INV: '' } : {},
    uniforms: { uLut: { value: lut }, uBgD: { value: bgD }, uDiv: { value: div } },
    vertexShader: `
      attribute float aFill; varying vec2 vUv; varying float vFill;
      void main(){ vUv = uv; vFill = aFill; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.); }`,
    fragmentShader: `
      uniform sampler2D uLut; uniform vec3 uBgD; uniform float uDiv; varying vec2 vUv; varying float vFill;
      void main(){
        vec2 e = min(vUv, 1. - vUv) / fwidth(vUv);
        float edge = 1. - min(min(e.x, e.y) / 1.6, 1.);
        float minor = 0.;
        if (uDiv > 1.5) { vec2 q = vUv * uDiv; vec2 d = abs(fract(q - .5) - .5) / fwidth(q); minor = (1. - min(min(d.x, d.y) / 1.1, 1.)) * (1. - edge); }
        float red = edge * .9 + vFill * .6, grey = minor * .14;
        float a = clamp(red + grey, 0., 1.), k = red / max(red + grey, 1e-3);
      #ifdef AGX_INV
        vec2 t = vec2(k, sqrt(a)) * ${(lutN - 1).toFixed(1)} + .5;
        gl_FragColor = vec4(texture2D(uLut, t / ${lutN.toFixed(1)}).rgb, 1.);
      #else
        gl_FragColor = vec4(mix(uBgD, mix(vec3(.9), vec3(.9, .08, .1), k), a), 1.);
      #endif
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
  return { mesh, aFill };
}

export function createBoxes(look) {
  const box = cubes(MAX, 3, look), frag = cubes(MAX_FRAG, 1, look);

  // sparks: short hot streaks (additive, HDR, through the normal tone mapping)
  const sPos = new Float32Array(MAX_SPARK * 6), sCol = new Float32Array(MAX_SPARK * 6);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3).setUsage(THREE.DynamicDrawUsage));
  const sparkMesh = new THREE.LineSegments(sGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sparkMesh.frustumCulled = false; sparkMesh.visible = false;
  const group = new THREE.Group(); group.add(box.mesh, frag.mesh, sparkMesh);

  const list = [], frags = [], sparks = [], stats = { hits: 0, shoves: 0 }; // stats: for the headless checks

  function spawn(x, z, floorY, sc) {
    if (list.length >= MAX) derezz(list.shift());
    const h = rnd(0.02, 0.027) * sc;
    list.push({
      p: new THREE.Vector3(x, floorY + h, z), v: new THREE.Vector3(), w: new THREE.Vector3(),
      q: new THREE.Quaternion().setFromAxisAngle(UP, rnd(0, Math.PI)),
      h, age: 0, hit: 0, cool: 0, spent: -1,
    });
  }

  // derezz: the box becomes a 3x3x3 of small red cubes that peel away top first, float up and fade
  function derezz(b) {
    const s = (2 * b.h) / FR;
    for (let k = 0; k < FR; k++) for (let j = 0; j < FR; j++) for (let i = 0; i < FR; i++) {
      if (frags.length >= MAX_FRAG) frags.shift();
      const o = new THREE.Vector3((i - 1) * s, (k - 1) * s, (j - 1) * s).applyQuaternion(b.q);
      const out = o.clone().normalize();
      frags.push({
        p: o.add(b.p), q: b.q.clone(), s: s * 0.86,
        v: new THREE.Vector3(b.v.x * 0.3 + out.x * rnd(0.05, 0.22), rnd(0.1, 0.32), b.v.z * 0.3 + out.z * rnd(0.05, 0.22)),
        w: new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(6),
        t: -((FR - 1 - k) * 0.07 + rnd(0, 0.05)), life: rnd(0.45, 0.8),
      });
    }
  }
  function clear() { while (list.length) derezz(list.pop()); }

  function burst(x, y, z, dx, dz, sc) {
    for (let i = 0; i < 16; i++) {
      if (sparks.length >= MAX_SPARK) sparks.shift();
      const sp = rnd(1.2, 3.6) * sc, a = rnd(-0.9, 0.9), c = Math.cos(a), s = Math.sin(a);
      sparks.push({ p: new THREE.Vector3(x, y, z), v: new THREE.Vector3((dx * c - dz * s) * sp, rnd(0.2, 1.4) * sc, (dx * s + dz * c) * sp), t: 0, life: rnd(0.12, 0.3) });
    }
  }

  // R: the robot this frame (world): px, py, pz, yaw, yawRate, sc, focus (CAD mm), vx, vz (rig motion),
  // spin (blade rate about the CAD z axis), floorY, vG (floor velocity, x/z), home x.
  // Returns the hits, so the caller can recoil the robot, slow the blade and add hit-stop and shake.
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
      b.age += dt; b.cool -= dt; b.hit = Math.max(0, b.hit - dt * 3);

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
        if (b.v.y < 0) b.v.y = b.v.y < -0.5 * sc ? -b.v.y * 0.3 : 0;
        const fr = 1 - Math.exp(-(b.spent >= 0 ? 3 : 7) * dt);
        b.v.x += (R.vG[0] - b.v.x) * fr; b.v.z += (R.vG[1] - b.v.z) * fr;
        b.w.multiplyScalar(Math.exp(-4 * dt));
        let k = 0; for (let j = 1; j < 3; j++) if (Math.abs(e[j * 4 + 1]) > Math.abs(e[k * 4 + 1])) k = j;
        const sg = Math.sign(e[k * 4 + 1]) || 1;
        _q2.setFromUnitVectors(_s.set(e[k * 4] * sg, e[k * 4 + 1] * sg, e[k * 4 + 2] * sg), UP);
        _q.identity().slerp(_q2, Math.min(1, 6 * dt)); b.q.premultiply(_q).normalize();
      }
      if (b.spent >= 0) b.spent += dt;

      // robot: local position (unscaled), height band, then blade before body
      const dx = b.p.x - R.px, dz = b.p.z - R.pz;
      if (dx * dx + dz * dz < (0.3 * sc) ** 2) {
        const lx = (dx * c - dz * s) / sc, lz = (dx * s + dz * c) / sc, ly = (b.p.y - R.py) / sc, rb = b.h / sc;
        const ox = lx - wx, oz = lz - wz, od = Math.hypot(ox, oz);
        if (b.cool <= 0 && lx > bx1 && od < wr + rb && ly - rb < wy1 && ly + rb > wy0) {
          // the tooth's velocity at the contact (blade spins about local y at -spin), plus out and up
          const W = -R.spin, tx = W * oz, tz = -W * ox, tl = Math.hypot(tx, tz) || 1;
          const [tX, tZ] = toWorld(tx / tl, tz / tl), [nX, nZ] = toWorld(ox / od, oz / od);
          const sp = rnd(3.4, 4.8) * sc, out = rnd(0.8, 1.3) * sc;
          // thrown across the screen: what would head back at the camera is mostly turned sideways
          let vx = tX * sp + nX * out, vz = tZ * sp + nZ * out;
          const hv = Math.hypot(vx, vz);
          if (vz > 0) { vz *= 0.3; const k = hv / Math.hypot(vx, vz); vx *= k; vz *= k; }
          b.v.set(vx, rnd(1.9, 2.7) * sc, vz);
          b.w.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(40, 65));
          b.p.y += 0.004 * sc; b.hit = 1; b.cool = 0.4; b.spent = 0;
          const [cX, cZ] = toWorld(wx + (ox / od) * wr, wz + (oz / od) * wr);
          burst(R.px + cX * sc, b.p.y - b.h * 0.5, R.pz + cZ * sc, tX, tZ, sc);
          hits.push({ lx, lz, tx: tx / tl, tz: tz / tl, kx: b.v.x / Math.hypot(b.v.x, b.v.z) });
          stats.hits++;
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

      // a flung box derezzes once it has landed and settled a moment; strays and old ones too
      const settled = b.spent > 1.2 && Math.abs(b.v.y) < 0.05 && pen > -0.002;
      if (settled || b.spent > 3 || b.age > 12 || b.p.z < -1.1 || b.p.z > 1.3 || Math.abs(b.p.x - R.home) > 1.4 || b.p.y < R.floorY - 0.5) {
        derezz(b); list.splice(i, 1);
      }
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

    // fragments: hold the box's shape until their turn, then drift up, spin, glow and shrink
    for (let i = frags.length - 1; i >= 0; i--) {
      const g = frags[i];
      g.t += dt;
      if (g.t > g.life) { frags.splice(i, 1); continue; }
      if (g.t > 0) {
        g.v.multiplyScalar(Math.exp(-1.5 * dt)); g.v.y += 0.25 * sc * dt;
        g.p.addScaledVector(g.v, dt);
        const wl = g.w.length(); _q.setFromAxisAngle(_v.copy(g.w).divideScalar(wl), wl * dt); g.q.premultiply(_q);
      }
    }

    // sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const k = sparks[i];
      k.t += dt;
      if (k.t > k.life) { sparks.splice(i, 1); continue; }
      k.v.y -= G * sc * dt; k.v.multiplyScalar(Math.exp(-3 * dt)); k.p.addScaledVector(k.v, dt);
    }

    // to the GPU
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      box.mesh.setMatrixAt(i, _m.compose(b.p, b.q, _s.setScalar(2 * b.h * Math.min(1, 0.4 + b.age / 0.1))));
      box.aFill.array[i] = b.hit;
    }
    box.mesh.count = list.length; box.mesh.visible = list.length > 0;
    box.mesh.instanceMatrix.needsUpdate = true; box.aFill.needsUpdate = true;
    for (let i = 0; i < frags.length; i++) {
      const g = frags[i], u = Math.max(0, g.t) / g.life;
      frag.mesh.setMatrixAt(i, _m.compose(g.p, g.q, _s.setScalar(g.s * (1 - smooth(0.45, 1, u)))));
      frag.aFill.array[i] = g.t < 0 ? 0.25 : 1 - 0.7 * u;
    }
    frag.mesh.count = frags.length; frag.mesh.visible = frags.length > 0;
    frag.mesh.instanceMatrix.needsUpdate = true; frag.aFill.needsUpdate = true;
    sCol.fill(0);
    for (let i = 0; i < sparks.length; i++) {
      const k = sparks[i], o = i * 6, a = 1 - k.t / k.life, len = 0.018;
      sPos[o] = k.p.x; sPos[o + 1] = k.p.y; sPos[o + 2] = k.p.z;
      sPos[o + 3] = k.p.x - k.v.x * len; sPos[o + 4] = k.p.y - k.v.y * len; sPos[o + 5] = k.p.z - k.v.z * len;
      sCol[o] = 9 * a; sCol[o + 1] = 2.6 * a; sCol[o + 2] = 1.4 * a; sCol[o + 3] = 2 * a; sCol[o + 4] = 0.25 * a; sCol[o + 5] = 0.2 * a;
    }
    sGeo.attributes.position.needsUpdate = true; sGeo.attributes.color.needsUpdate = true;
    sGeo.setDrawRange(0, sparks.length * 2); sparkMesh.visible = sparks.length > 0;
    return hits;
  }

  return { group, spawn, clear, step, stats, get count() { return list.length + frags.length + sparks.length; } };
}
