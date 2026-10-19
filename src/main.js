import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { ending } from './content.js';
import { buildParts, offsets, spinOf, rotorTest } from './parts.js';

gsap.registerPlugin(ScrollTrigger);

const qs = new URLSearchParams(location.search);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STILL = qs.has('still'); // no scroll smoothing (used for screenshots)

// ending copy
document.getElementById('tag-h').textContent = ending.headline;
document.getElementById('tag-s').textContent = ending.sub;

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
const mobile = () => innerWidth < 820;
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile() ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x07080a, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x07080a, 1.6, 3.4);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.42;

const FOV = 30;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
camera.position.set(0, 0.39, 0.9);
camera.lookAt(0, 0, 0);
const DIST = camera.position.length();
const halfH = DIST * Math.tan(THREE.MathUtils.degToRad(FOV / 2));

const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-0.6, 1.2, 0.9); scene.add(key);
const rimR = new THREE.DirectionalLight(0xff2a30, 3.2); rimR.position.set(0.9, 0.5, -0.8); scene.add(rimR);
const rimW = new THREE.DirectionalLight(0xbcd0ff, 1.4); rimW.position.set(-1, 0.3, -0.7); scene.add(rimW);
const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(0.8, -0.2, 1.0); scene.add(fill);

// ---------------------------------------------------------------- rig
const root = new THREE.Group();   // placement, scale, yaw
const model = new THREE.Group();  // CAD frame (Z up, mm -> m already), rotated into Y-up
model.rotation.x = -Math.PI / 2;
root.add(model); scene.add(root);

// ---------------------------------------------------------------- ground
const groundMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uOff: { value: new THREE.Vector2() }, uFade: { value: 1 }, uC: { value: new THREE.Vector2() } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    varying vec3 vW; uniform vec2 uOff; uniform float uFade; uniform vec2 uC;
    float grid(vec2 p, float s, float w){ vec2 q = p / s; vec2 d = abs(fract(q - .5) - .5) / fwidth(q); return 1. - min(min(d.x, d.y) / w, 1.); }
    void main(){
      vec2 p = vW.xz - uOff;
      float minor = grid(p, .04, 1.1), major = grid(p, .2, 1.4);
      float r = length(vW.xz - uC);
      float fade = smoothstep(1.15, .15, r) * uFade;
      float a = clamp(minor * .07 + major * .42, 0., 1.);
      vec3 col = mix(vec3(.9), vec3(.9,.08,.1), major * .42 / max(a, 1e-3));
      gl_FragColor = vec4(col, a * fade);
    }`,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), groundMat);
ground.rotation.x = -Math.PI / 2; ground.renderOrder = -2; scene.add(ground);

// soft contact shadow (child of model, CAD frame)
const blobTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(0,0,0,.85)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const GROUND_Z = -0.0166; // wheel bottom in CAD z (m)
const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
blob.position.set(-0.0695, 0, GROUND_Z); blob.renderOrder = -1; model.add(blob);

// ---------------------------------------------------------------- state driven by scroll
const BASE_YAW = -Math.PI / 2; // nose toward the camera
const S = {
  u: 0.42, v: 0, mv: 0.3, scale: 1, yaw: BASE_YAW, // mv: vertical placement on phones (text sits below)
  focus: [-69.5, 0, 16],
  eR: 0, eV: 0, eS: 0,
  show: { all: 1, module: 0, weapon: 0, struct: 0 },
  g: 1,          // grid opacity
  gf: 0,         // 0 = grid under the wheels, 1 = grid floats as a floor under the showcase
  cyc: 1,        // zig-zag drive-in-place amount
  showSpin: 0,   // 1 = slow showcase wheel/motor spin
  weaponSlow: 0,
  rot: 0,        // 1 = showcase turntable running (time-based, not scroll-based)
};
const FOCUS = {
  robot: [-69.5, 0, 16],
  module: [-100, -112, 16],
  weapon: [-56, -16, -6],
  struct: [-65, 0, 40],
};

// ---------------------------------------------------------------- materials
function makeCarbon() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const tw = (x + y) % 2 === 0;
    const gr = g.createLinearGradient(x * 16, y * 16, tw ? x * 16 + 16 : x * 16, tw ? y * 16 : y * 16 + 16);
    gr.addColorStop(0, '#22252a'); gr.addColorStop(.5, '#0c0d0f'); gr.addColorStop(1, '#1d2025');
    g.fillStyle = gr; g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const carbonTex = makeCarbon();
const M = {
  carbon: () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: carbonTex, bumpMap: carbonTex, bumpScale: 1.2, metalness: 0.35, roughness: 0.38 }),
  body: () => new THREE.MeshStandardMaterial({ color: 0x5a5e65, roughness: 0.62, metalness: 0.0 }),
  tpu: () => new THREE.MeshStandardMaterial({ color: 0xc3141c, roughness: 0.5, metalness: 0.0 }),
  tpu2: () => new THREE.MeshStandardMaterial({ color: 0xe5161c, roughness: 0.42, metalness: 0.0 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0xa8121a, roughness: 0.85, metalness: 0 }),
  rim: () => new THREE.MeshStandardMaterial({ color: 0xd3161e, roughness: 0.4, metalness: 0.1 }),
  alu: () => new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.28, metalness: 1.0 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0x8b9099, roughness: 0.32, metalness: 1.0 }),
  hardox: () => new THREE.MeshStandardMaterial({ color: 0x6d737c, roughness: 0.36, metalness: 1.0 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xe3e6ea, roughness: 0.14, metalness: 1.0 }),
  anod: () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.34, metalness: 0.9 }),
  motor: () => new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.3, metalness: 0.9 }),
  vyta: () => new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.62, metalness: 0 }),
  elec: () => new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.6, metalness: 0.2 }),
  batt: () => new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.7, metalness: 0.05 }),
};

// planar/box UVs for the carbon weave (the CAD export has none)
function boxUV(geo, scale) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (az >= ax && az >= ay) { u = p.getX(i); v = p.getY(i); } else if (ay >= ax) { u = p.getX(i); v = p.getZ(i); } else { u = p.getY(i); v = p.getZ(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// split a non-indexed geometry by a per-triangle test on its centroid (mm) -> [pass, fail]
function splitGeo(geo, test) {
  const p = geo.attributes.position.array, n = geo.attributes.normal.array;
  const A = { p: [], n: [] }, B = { p: [], n: [] };
  for (let i = 0; i < p.length; i += 9) {
    const cx = (p[i] + p[i + 3] + p[i + 6]) / 3 * 1000, cy = (p[i + 1] + p[i + 4] + p[i + 7]) / 3 * 1000, cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3 * 1000;
    const t = test(cx, cy, cz) ? A : B;
    for (let k = 0; k < 9; k++) { t.p.push(p[i + k]); t.n.push(n[i + k]); }
  }
  return [A, B].map((t) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(t.n, 3));
    return g;
  });
}

// ---------------------------------------------------------------- load
const parts = [];
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const lbar = document.getElementById('lbar');

function addPart(name, geo, sub) {
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3()).multiplyScalar(1000); // mm
  const info = buildParts.describe(name, c);
  if (info.mat === 'carbon') boxUV(geo, 1 / 0.04);
  const material = M[info.mat]();
  const m = new THREE.Mesh(geo, material);
  const part = { name: sub ? `${name}/${sub}` : name, base: info.base, sub, tags: info.tags, c, mesh: m, mat: material, holder: new THREE.Group(), pivot: new THREE.Vector3(), spin: null, off: null };
  const sp = spinOf(part);
  if (sp) { part.spin = sp; part.pivot.set(...sp.pivot).multiplyScalar(0.001); }
  part.off = offsets(part);
  m.position.copy(part.pivot).multiplyScalar(-1);
  part.holder.add(m); part.holder.position.copy(part.pivot); model.add(part.holder);
  parts.push(part);
}

// staggered explode: parts with bigger travel start later (overlapping action)
const STAG = 0.32;
function prepStagger() {
  for (const k of ['r', 'v', 's']) {
    const mags = parts.map((p) => Math.hypot(...p.off[k]));
    const mx = Math.max(...mags) || 1;
    parts.forEach((p, i) => { p.d = p.d || {}; p.d[k] = STAG * mags[i] / mx; });
  }
}
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const stag = (e, d) => smooth((e - d) / (1 - STAG));

loader.load('models/rebot.glb', (gltf) => {
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const mesh of meshes) {
    // bake to float CAD-frame geometry (handles quantized positions + node transform)
    const src = mesh.geometry, pa = src.attributes.position;
    const f = new Float32Array(pa.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld); f.set([v.x, v.y, v.z], i * 3); }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
    if (src.index) geo.setIndex(Array.from(src.index.array));
    geo = toCreasedNormals(geo, 0.6);
    const test = rotorTest(mesh.name.replace(/#\d+$/, ''));
    if (test) { const [rot, mount] = splitGeo(geo, test); addPart(mesh.name, rot, 'rotor'); addPart(mesh.name, mount, 'mount'); }
    else addPart(mesh.name, geo);
  }
  prepStagger();
  console.log('[rebot] parts', parts.length, 'tris', parts.reduce((a, p) => a + p.mesh.geometry.attributes.position.count / 3, 0));
  window.__parts = parts;
  start();
}, (e) => { if (e.total) lbar.style.width = (e.loaded / e.total * 100) + '%'; }, (e) => { console.error(e); });

// ---------------------------------------------------------------- drive-in-place sim
// Never stops: go, turn ~90 deg with a slight drift, go again. Heading is steered by a PD controller
// (underdamped: a little overshoot = follow-through), speed eases off in the turn but never reaches zero,
// and the travel direction lags the heading (drift). The body stays flat: a lean would put the blade in the floor.
const sim = { psi: Math.PI / 4, w: 0, phi: Math.PI / 4, v: 0.36, side: -1, t: 0 };
const LEG = 1.9, AMP = Math.PI / 4, VMAX = 0.46, VMIN = 0.24;
function simStep(dt) {
  sim.t += dt;
  if (sim.t > LEG) { sim.t -= LEG; sim.side *= -1; }
  const err = sim.side * AMP - sim.psi;
  sim.w += (70 * err - 10.5 * sim.w) * dt;
  sim.psi += sim.w * dt;
  const vT = VMAX - (VMAX - VMIN) * Math.min(1, Math.abs(sim.w) / 3.5);
  sim.v += (vT - sim.v) * Math.min(1, dt * 4.5);
  sim.phi += (sim.psi - sim.phi) * Math.min(1, dt * 3.2);
}

// showcase turntable: runs on its own while the copy is up, then settles back to its home angle
const turn = { a: 0, w: 0 };
function turnStep(dt) {
  if (S.rot > 0.5) {
    turn.w += (0.55 - turn.w) * Math.min(1, dt * 1.6);
  } else {
    const home = Math.round(turn.a / (Math.PI * 2)) * Math.PI * 2;
    turn.w += (14 * (home - turn.a) - 7.5 * turn.w) * dt;
  }
  turn.a += turn.w * dt;
}

// ---------------------------------------------------------------- loop
const clock = { last: 0 };
const ang = { wl: 0, wr: 0, weap: 0 }; // wheel left/right accum, weapon accum
const sm = { wl: 0, wr: 0, ww: 0 };
const prev = { x: 0, yaw: 0, init: false };
const gOff = new THREE.Vector2();
const RW = 0.0325, HALF_TRACK = 0.124, RATIO_DRIVE = 10.53, RATIO_WEAPON = 1.5;
const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function layout() {
  const aspect = innerWidth / innerHeight;
  const m = mobile() || aspect < 0.9;
  const halfW = halfH * aspect;
  const u = m ? 0 : S.u;
  const v = m ? S.v * 0.6 + S.mv : S.v;
  const sc = S.scale * (m ? Math.min(1, aspect * 1.2) * 0.95 : Math.min(1, aspect / 1.5));
  return { x: u * halfW, y: v * halfH, sc, m };
}

function frame(now) {
  const dt = Math.min(0.05, (now - clock.last) / 1000 || 0.016); clock.last = now;
  const run = REDUCED ? 0 : 1;
  if (run) { simStep(dt); turnStep(dt); }
  const L = layout();

  const cyc = S.cyc * run;
  const yawTot = S.yaw + cyc * sim.psi + turn.a;
  root.rotation.y = yawTot;
  root.scale.setScalar(L.sc);
  root.position.set(L.x, L.y, 0);
  const f = S.focus;
  model.position.set(-f[0] * 0.001, -f[2] * 0.001, f[1] * 0.001);

  // body speed from the rig's own motion (scroll transit) plus the sim
  const fx = Math.cos(yawTot), fz = -Math.sin(yawTot);
  if (!prev.init) { prev.x = L.x; prev.yaw = yawTot; prev.init = true; }
  const vRig = (L.x - prev.x) * fx / Math.max(dt, 1e-4) / L.sc;
  const yawRate = (yawTot - prev.yaw) / Math.max(dt, 1e-4);
  prev.x = L.x; prev.yaw = yawTot;
  const vBody = vRig + cyc * sim.v;

  // the ground slides against the travel direction (which lags the heading: drift)
  const travel = S.yaw + sim.phi;
  gOff.x -= Math.cos(travel) * cyc * sim.v * dt; gOff.y += Math.sin(travel) * cyc * sim.v * dt;
  gOff.y += 0.03 * S.gf * dt * run; // slow drift on the floating floor

  // wheel rates (rad/s about +Y CAD); right wheel is the CAD -Y side
  const clampR = (x) => Math.max(-40, Math.min(40, x));
  let wR = clampR((vBody + yawRate * HALF_TRACK * (1 - S.showSpin)) / RW), wL = clampR((vBody - yawRate * HALF_TRACK * (1 - S.showSpin)) / RW);
  wR = THREE.MathUtils.lerp(wR, 1.7, S.showSpin); wL = THREE.MathUtils.lerp(wL, 1.7, S.showSpin);
  sm.wr += (wR - sm.wr) * Math.min(1, dt * 8); sm.wl += (wL - sm.wl) * Math.min(1, dt * 8);
  ang.wr += sm.wr * dt * run; ang.wl += sm.wl * dt * run;
  const wTarget = THREE.MathUtils.lerp(26, 2.4, S.weaponSlow) * run;
  sm.ww += (wTarget - sm.ww) * Math.min(1, dt * 6);
  ang.weap += sm.ww * dt;

  // parts: staggered explode offset + visibility + spin
  for (const p of parts) {
    const o = p.off, d = p.d;
    const kr = stag(S.eR, d.r), kv = stag(S.eV, d.v), ks = stag(S.eS, d.s);
    p.holder.position.set(
      p.pivot.x + (kr * o.r[0] + kv * o.v[0] + ks * o.s[0]) * 0.001,
      p.pivot.y + (kr * o.r[1] + kv * o.v[1] + ks * o.s[1]) * 0.001,
      p.pivot.z + (kr * o.r[2] + kv * o.v[2] + ks * o.s[2]) * 0.001,
    );
    if (p.spin) {
      let a = 0;
      const sp = p.spin;
      if (sp.kind === 'wheel') a = (sp.side < 0 ? ang.wr : ang.wl);
      else if (sp.kind === 'dmotor') a = -RATIO_DRIVE * (sp.side < 0 ? ang.wr : ang.wl);
      else if (sp.kind === 'weapon') a = -ang.weap;
      else if (sp.kind === 'wmotor') a = RATIO_WEAPON * ang.weap;
      p.holder.quaternion.setFromAxisAngle(AXIS[sp.axis], a);
    }
    let op = S.show.all;
    for (const t of p.tags) op = Math.max(op, S.show[t] ?? 0);
    const mt = p.mat;
    if (mt.opacity !== op) { mt.opacity = op; mt.transparent = op < 0.995; mt.depthWrite = op > 0.5; }
    p.mesh.visible = op > 0.01;
  }

  // grid: under the wheels on the landing/ending, a floating floor under the showcases
  const gyWheels = L.y + L.sc * (GROUND_Z - f[2] * 0.001);
  const gyFloor = L.y - halfH * (L.m ? 0.42 : 0.62);
  ground.position.set(0, THREE.MathUtils.lerp(gyWheels, gyFloor, S.gf), 0);
  groundMat.uniforms.uOff.value.copy(gOff);
  groundMat.uniforms.uFade.value = S.g;
  groundMat.uniforms.uC.value.set(L.x * 0.4, 0);
  ground.visible = S.g > 0.01;
  blob.material.opacity = S.show.all * (1 - S.gf); blob.visible = blob.material.opacity > 0.01;

  renderer.render(scene, camera);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile() ? 1.5 : 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', () => { resize(); ScrollTrigger.refresh(); });
resize();

// ---------------------------------------------------------------- timeline (unit = vh of scroll)
const TOTAL = 1000;
const MARKS = [0, 60, 385, 675, 915];            // chapter starts (rail highlight)
const STOPS = { top: 0, s1: 0, s2: 322, s3: 612, s4: 848, s5: 1000 }; // rail targets: each chapter's hold
let lenis = null;
const toScroll = (t) => t / TOTAL * (document.documentElement.scrollHeight - innerHeight);

function timeline() {
  const tl = gsap.timeline({ defaults: { ease: 'power3.inOut' },
    scrollTrigger: { trigger: '#scroll', start: 'top top', end: 'bottom bottom', scrub: (STILL || REDUCED) ? true : 0.6 } });
  const at = (t, tw, vars) => tl.to(tw, { duration: 1, ...vars }, t);
  // yaw is kept monotone: next absolute value congruent to `mod` and >= prev
  let yawNow = S.yaw;
  const yawTo = (mod) => { const y = yawNow; while (mod < y) mod += Math.PI * 2; while (mod - Math.PI * 2 >= y) mod -= Math.PI * 2; yawNow = mod; return yawNow; };
  // focus keyframes chained at build time (each tween interpolates from the previous target)
  const FK = [FOCUS.robot];
  const addFocus = (t, d, to, ease = 'power3.inOut') => {
    const from = FK[FK.length - 1].slice(); FK.push(to.slice());
    const prox = { k: 0 };
    tl.fromTo(prox, { k: 0 }, { k: 1, duration: d, ease, immediateRender: false, onUpdate() { for (let i = 0; i < 3; i++) S.focus[i] = from[i] + (to[i] - from[i]) * prox.k; } }, t);
  };
  const state = (t0, t1) => { at(t0, S, { rot: 1, duration: 2, ease: 'none' }); at(t1, S, { rot: 0, duration: 2, ease: 'none' }); };

  // isolation groups switch on just before 'all' fades (they only matter while all < 1)
  at(190, S.show, { module: 1, duration: 8 });
  at(490, S.show, { module: 0, weapon: 1, duration: 8 });
  at(715, S.show, { weapon: 0, struct: 1, duration: 8 });
  at(950, S.show, { struct: 0, duration: 8 });

  // ---- 01 -> 02: the sim winds down, Rebot turns and drives right to left (anticipation + settle)
  at(55, S, { cyc: 0, duration: 45, ease: 'power2.inOut' });
  at(62, S, { u: -0.4, duration: 115, ease: 'back.inOut(1.1)' });
  at(62, S, { yaw: yawTo(-Math.PI), duration: 50 });
  at(150, S, { yaw: yawTo(2.45), duration: 60, ease: 'back.out(1.4)' }); // inner side faces the camera: motor on the rim, armour off the far side
  at(150, S, { gf: 1, g: 0.55, duration: 70 });
  at(160, S, { showSpin: 1, duration: 50 });
  // drive explode: armour and axle bolt come off, the tangential pair stays assembled
  at(175, S, { eR: 1, duration: 75 });
  at(200, S.show, { all: 0, duration: 55 });
  addFocus(200, 75, FOCUS.module);
  at(200, S, { scale: 1.65, duration: 75 });
  at(200, S, { u: -0.3, duration: 75 });
  state(262, 375);
  // ---- 02 -> 03: reassemble, explode vertically, isolate the weapon
  at(385, S.show, { all: 1, duration: 45 });
  addFocus(385, 60, FOCUS.robot);
  at(385, S, { eR: 0, duration: 60 });
  at(385, S, { scale: 1.05, duration: 60 });
  at(385, S, { u: 0.1, duration: 60 });
  at(390, S, { yaw: yawTo(-0.55), duration: 55 });
  at(445, S, { eV: 1, duration: 65 });
  at(445, S, { weaponSlow: 1, duration: 60 });
  at(500, S.show, { all: 0, duration: 50 });
  addFocus(500, 60, FOCUS.weapon);
  at(500, S, { scale: 1.5, duration: 60 });
  at(500, S, { u: 0.36, duration: 60 });
  state(555, 665);
  // ---- 03 -> 04: reassemble, structure
  at(675, S.show, { all: 1, duration: 40 });
  addFocus(675, 50, FOCUS.robot);
  at(675, S, { eV: 0, duration: 50 });
  at(675, S, { scale: 1.05, duration: 50 });
  at(675, S, { u: 0, duration: 50 });
  at(725, S.show, { all: 0, duration: 45 });
  at(725, S, { eS: 1, duration: 60 });
  addFocus(725, 60, FOCUS.struct);
  at(725, S, { scale: 1.12, duration: 60 });
  at(725, S, { yaw: yawTo(-1.15), duration: 60 });
  at(725, S, { mv: 0.04, duration: 60 });
  state(790, 900);
  // ---- 04 -> 05: back together, zig-zag again
  at(915, S.show, { all: 1, duration: 40 });
  at(915, S, { eS: 0, duration: 50 });
  addFocus(915, 50, FOCUS.robot);
  at(915, S, { scale: 1.0, duration: 50 });
  at(915, S, { u: -0.4, duration: 50 });
  at(915, S, { mv: 0.3, duration: 50 });
  at(915, S, { yaw: yawTo(BASE_YAW), duration: 50 });
  at(915, S, { gf: 0, g: 1, duration: 50 });
  at(940, S, { cyc: 1, duration: 40 });
  at(915, S, { showSpin: 0, weaponSlow: 0, duration: 40 });
  tl.set({}, {}, TOTAL);

  // ---- copy panels
  const mq = matchMedia('(max-width: 820px)');
  const panel = (id, tin, tout, last = false) => {
    const el = document.getElementById(id);
    gsap.set(el, { yPercent: mq.matches ? 0 : -50, y: id === 'p1' ? 0 : 36, opacity: id === 'p1' ? 1 : 0 });
    if (id !== 'p1') tl.fromTo(el, { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 24, ease: 'power2.out', immediateRender: false }, tin);
    if (!last) tl.to(el, { opacity: 0, y: -30, duration: 22, ease: 'power2.in' }, tout);
  };
  panel('p1', 0, 45);
  panel('p2', 255, 372);
  panel('p3', 545, 662);
  panel('p4a', 772, 895);
  panel('p4b', 788, 895);
  panel('p5', 960, 0, true);

  // rail state
  const links = [...document.querySelectorAll('.rail a')];
  ScrollTrigger.create({ trigger: '#scroll', start: 'top top', end: 'bottom bottom', onUpdate: (st) => {
    const t = st.progress * TOTAL + 15; let k = 0; MARKS.forEach((m, i) => { if (t >= m) k = i; });
    links.forEach((a, i) => a.classList.toggle('on', i === k));
  } });
}

function start() {
  if (!STILL && !REDUCED) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  timeline();
  document.getElementById('loader').classList.add('done');
  gsap.ticker.add(() => frame(performance.now()));
  clock.last = performance.now();
  document.querySelectorAll('.rail a, .brand').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const y = toScroll(STOPS[a.getAttribute('href').slice(1)]);
    if (lenis) lenis.scrollTo(y, { duration: 2.2 }); else scrollTo({ top: y, behavior: 'auto' });
  }));
}
window.__S = S;
