import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ending } from './content.js';
import { buildParts, offsets, spinOf } from './parts.js';

gsap.registerPlugin(ScrollTrigger);

const qs = new URLSearchParams(location.search);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STILL = qs.has('still'); // no scrub smoothing (used for screenshots)

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
camera.position.set(0, 0.28, 0.95);
camera.lookAt(0, 0, 0);
const DIST = camera.position.length();
const halfH = DIST * Math.tan(THREE.MathUtils.degToRad(FOV / 2));

const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-0.6, 1.2, 0.9); scene.add(key);
const rimR = new THREE.DirectionalLight(0xff2a30, 3.2); rimR.position.set(0.9, 0.5, -0.8); scene.add(rimR);
const rimW = new THREE.DirectionalLight(0xbcd0ff, 1.4); rimW.position.set(-1, 0.3, -0.7); scene.add(rimW);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(0.8, -0.2, 1.0); scene.add(fill);

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
      vec3 col = vec3(.9) * minor * .07 + vec3(.9,.08,.1) * major * .42;
      float a = clamp(minor * .07 + major * .42, 0., 1.) * fade;
      gl_FragColor = vec4(col / max(a, 1e-3) * min(1., 1.), a);
    }`,
});
groundMat.extensions = { derivatives: true };
const ground = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), groundMat);
ground.rotation.x = -Math.PI / 2; ground.renderOrder = -2; scene.add(ground);

// soft contact shadow (child of model, CAD frame)
const blobTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(0,0,0,.85)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
blob.position.set(-0.0695, 0, -0.0166); blob.renderOrder = -1; model.add(blob);
const GROUND_Z = -0.0166; // wheel bottom in CAD z (m)

// ---------------------------------------------------------------- state driven by scroll
const S = {
  u: 0.42, v: 0, mv: 0.3, scale: 1, yaw: -0.55, // mv: vertical placement on phones (text sits below)
  focus: [-69.5, 0, 16],
  eR: 0, eRm: 0, eV: 0, eS: 0, // eRm: drive explode for the isolated module (closes again so the contact reads)
  show: { all: 1, module: 0, weapon: 0, struct: 0 },
  g: 1,          // ground fade
  cyc: 1,        // zig-zag drive-in-place amount
  showSpin: 0,   // 1 = slow showcase spin
  weaponSlow: 0,
};
const FOCUS = {
  robot: [-69.5, 0, 16],
  module: [-96, -111, 16],
  weapon: [-56, -16, 4],
  struct: [-65, 0, 48],
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
  tpu: () => new THREE.MeshStandardMaterial({ color: 0xb3121a, roughness: 0.5, metalness: 0.0 }),
  tpu2: () => new THREE.MeshStandardMaterial({ color: 0xe5161c, roughness: 0.42, metalness: 0.0 }),
  alu: () => new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.28, metalness: 1.0 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0x8b9099, roughness: 0.32, metalness: 1.0 }),
  hardox: () => new THREE.MeshStandardMaterial({ color: 0x6d737c, roughness: 0.36, metalness: 1.0 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xe3e6ea, roughness: 0.14, metalness: 1.0 }),
  anod: () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.34, metalness: 0.9 }),
  motor: () => new THREE.MeshStandardMaterial({ color: 0x8e0f16, roughness: 0.3, metalness: 0.85 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.92, metalness: 0 }),
  nylon: () => new THREE.MeshStandardMaterial({ color: 0xe6e7e9, roughness: 0.55, metalness: 0 }),
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

// ---------------------------------------------------------------- load
const parts = [];
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const lbar = document.getElementById('lbar');
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
    const name = mesh.name;
    const info = buildParts.describe(name);
    geo.computeBoundingBox();
    const c = geo.boundingBox.getCenter(new THREE.Vector3()).multiplyScalar(1000); // mm
    if (info.mat === 'carbon') boxUV(geo, 1 / 0.04);
    const material = M[info.mat]();
    const m = new THREE.Mesh(geo, material);
    const part = { name, base: info.base, tags: info.tags, c, mesh: m, mat: material, holder: new THREE.Group(), pivot: new THREE.Vector3(), spin: null, off: null };
    const sp = spinOf(part);
    if (sp) { part.spin = sp; part.pivot.set(...sp.pivot).multiplyScalar(0.001); }
    part.off = offsets(part);
    part.isModule = part.tags.includes('module');
    m.position.copy(part.pivot).multiplyScalar(-1);
    part.holder.add(m); part.holder.position.copy(part.pivot); model.add(part.holder);
    parts.push(part);
  }
  console.log('[rebot] parts', parts.length, 'tris', parts.reduce((a, p) => a + p.mesh.geometry.attributes.position.count / 3, 0));
  window.__parts = parts;
  start();
}, (e) => { if (e.total) lbar.style.width = (e.loaded / e.total * 100) + '%'; }, (e) => { console.error(e); });

// ---------------------------------------------------------------- zig-zag drive cycle (robot stays put, ground moves)
const VMAX = 0.13;                       // m/s ground speed
const FWD = 1.8, TURN = 0.7;             // seconds
const PER = 2 * (FWD + TURN);
const ease = (x) => x * x * (3 - 2 * x);
function cycle(t) {
  const k = ((t % PER) + PER) % PER;
  let th, vv = 0;
  if (k < FWD) { th = 0; vv = Math.min(1, k / .35, (FWD - k) / .35); }
  else if (k < FWD + TURN) { th = ease((k - FWD) / TURN) * Math.PI / 2; }
  else if (k < 2 * FWD + TURN) { th = Math.PI / 2; const q = k - FWD - TURN; vv = Math.min(1, q / .35, (FWD - q) / .35); }
  else { th = (1 - ease((k - 2 * FWD - TURN) / TURN)) * Math.PI / 2; }
  return { th, v: ease(Math.max(0, vv)) * VMAX };
}

// ---------------------------------------------------------------- loop
const clock = { t: 0, last: 0 };
const ang = { wl: 0, wr: 0, weap: 0 }; // wheel left/right accum, weapon accum
const sm = { wl: 0, wr: 0, ww: 0 };
const prev = { x: 0, z: 0, yaw: 0, init: false };
const gOff = new THREE.Vector2();
const RW = 0.0325, HALF_TRACK = 0.124, RATIO_DRIVE = 10.53, RATIO_WEAPON = 1.5;
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function layout() {
  const aspect = innerWidth / innerHeight;
  const m = mobile() || aspect < 0.9;
  const halfW = halfH * aspect;
  // u: -1..1 across the view; mobile keeps the robot centred, up top
  const u = m ? S.u * 0.0 : S.u;
  const v = m ? S.v * 0.6 + S.mv : S.v;
  const sc = S.scale * (m ? Math.min(1, aspect * 1.2) * 0.95 : Math.min(1, aspect / 1.5));
  return { x: u * halfW, y: v * halfH, sc };
}

function frame(now) {
  const dt = Math.min(0.05, (now - clock.last) / 1000 || 0.016); clock.last = now;
  const run = REDUCED ? 0 : 1;
  clock.t += dt * run;
  const L = layout();

  const cy = cycle(clock.t);
  const yawTot = S.yaw + S.cyc * cy.th * (REDUCED ? 0 : 1);
  root.rotation.y = yawTot;
  root.scale.setScalar(L.sc);
  root.position.set(L.x, L.y, 0);
  const f = S.focus;
  model.position.set(-f[0] * 0.001, -f[2] * 0.001, f[1] * 0.001);

  // forward direction in world (three): +x rotated by yaw
  const fx = Math.cos(yawTot), fz = -Math.sin(yawTot);
  if (!prev.init) { prev.x = L.x; prev.z = 0; prev.yaw = yawTot; prev.init = true; }
  const vRig = ((L.x - prev.x) * fx + (0 - prev.z) * fz) / Math.max(dt, 1e-4) / L.sc; // body speed, m/s at model scale
  const yawRate = (yawTot - prev.yaw) / Math.max(dt, 1e-4);
  prev.x = L.x; prev.z = 0; prev.yaw = yawTot;
  const vBody = vRig + S.cyc * cy.v * (REDUCED ? 0 : 1);
  // ground slides opposite to the cycle heading
  gOff.x -= fx * S.cyc * cy.v * dt * run; gOff.y -= fz * S.cyc * cy.v * dt * run;

  // wheel rates (rad/s about +Y CAD); right wheel is the CAD -Y side
  const clampR = (x) => Math.max(-40, Math.min(40, x));
  let wR = clampR((vBody + yawRate * HALF_TRACK) / RW), wL = clampR((vBody - yawRate * HALF_TRACK) / RW);
  const showW = 1.7;
  wR = THREE.MathUtils.lerp(wR, showW, S.showSpin); wL = THREE.MathUtils.lerp(wL, showW, S.showSpin);
  sm.wr += (wR - sm.wr) * Math.min(1, dt * 8); sm.wl += (wL - sm.wl) * Math.min(1, dt * 8);
  ang.wr += sm.wr * dt * run; ang.wl += sm.wl * dt * run;
  const wTarget = THREE.MathUtils.lerp(26, 2.4, S.weaponSlow) * run;
  sm.ww += (wTarget - sm.ww) * Math.min(1, dt * 6);
  ang.weap += sm.ww * dt;

  // parts: explode offset + visibility + spin
  for (const p of parts) {
    const o = p.off;
    const eR = p.isModule ? S.eRm : S.eR;
    p.holder.position.set(
      p.pivot.x + (eR * o.r[0] + S.eV * o.v[0] + S.eS * o.s[0]) * 0.001,
      p.pivot.y + (eR * o.r[1] + S.eV * o.v[1] + S.eS * o.s[1]) * 0.001,
      p.pivot.z + (eR * o.r[2] + S.eV * o.v[2] + S.eS * o.s[2]) * 0.001,
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

  // ground sits under the wheels; follows the rig height only
  const gy = L.y + L.sc * (GROUND_Z - f[2] * 0.001);
  ground.position.set(0, gy, 0);
  groundMat.uniforms.uOff.value.copy(gOff);
  groundMat.uniforms.uFade.value = S.g * S.show.all;
  groundMat.uniforms.uC.value.set(L.x * 0.4, 0);
  ground.visible = S.g * S.show.all > 0.01;
  blob.material.opacity = S.g * S.show.all; blob.visible = blob.material.opacity > 0.01;
  blob.position.set(-0.0695 + 0.0, 0, GROUND_Z);
  blob.position.x = -0.0695; blob.position.y = 0;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile() ? 1.5 : 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', () => { resize(); ScrollTrigger.refresh(); });
resize();

// ---------------------------------------------------------------- timeline (time unit = vh of scroll)
function timeline() {
  const TOTAL = 100 + 350 + 330 + 280 + 180 - 100; // scrollable vh
  const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' },
    scrollTrigger: { trigger: '#scroll', start: 'top top', end: 'bottom bottom', scrub: (STILL || REDUCED) ? true : 0.9 } });
  const at = (t, tw, vars) => tl.to(tw, { duration: 1, ...vars }, t);
  // yaw is kept monotone: next absolute value congruent to `mod` and >= prev
  let yawNow = S.yaw;
  const yawTo = (mod, extra = 0) => { const y = yawNow; while (mod < y) mod += Math.PI * 2; while (mod - Math.PI * 2 >= y) mod -= Math.PI * 2; yawNow = mod + extra; return yawNow; };
  // focus keyframes chained at build time (each tween interpolates from the previous target)
  const FK = [[0, FOCUS.robot]];
  const addFocus = (t, d, to) => { const from = FK[FK.length - 1][1].slice(); FK.push([t + d, to.slice()]);
    const prox = { k: 0 };
    tl.fromTo(prox, { k: 0 }, { k: 1, duration: d, immediateRender: false, onUpdate() { for (let i = 0; i < 3; i++) S.focus[i] = from[i] + (to[i] - from[i]) * prox.k; } }, t); };

  // ---- 01 -> 02: drive right to left
  // isolation groups switch on just before 'all' fades (they only matter while all < 1)
  at(320, S.show, { module: 1, duration: 8 });
  at(588, S.show, { module: 0, weapon: 1, duration: 8 });
  at(838, S.show, { weapon: 0, struct: 1, duration: 8 });
  at(1102, S.show, { struct: 0, duration: 8 });
  at(100, S, { cyc: 0, duration: 45 });
  at(112, S, { u: -0.42, duration: 118, ease: 'power2.inOut' });
  at(112, S, { yaw: yawTo(-2.6), duration: 55 });
  at(226, S, { yaw: yawTo(-0.5 + Math.PI * 2 * 0), duration: 40 });
  at(232, S, { g: 0, duration: 40 });
  at(255, S, { showSpin: 1, duration: 60 });
  // explode the drive modules
  at(262, S, { eR: 1, eRm: 1, duration: 70 });
  at(345, S, { eRm: 0, duration: 55 });
  // isolate one module and zoom in
  at(332, S.show, { all: 0, duration: 55 });
  addFocus(332, 70, FOCUS.module);
  at(332, S, { scale: 2.5, duration: 70 });
  at(332, S, { u: -0.4, duration: 70 });
  // slow turn around its axis
  at(380, S, { yaw: yawTo(-0.5, Math.PI * 2 * 0.9), duration: 80, ease: 'none' });
  // ---- 02 -> 03: reassemble, explode vertically, isolate the weapon
  at(448, S.show, { all: 1, duration: 40 });
  addFocus(448, 60, FOCUS.robot);
  at(448, S, { eR: 0, eRm: 0, duration: 60 });
  at(448, S, { scale: 1.05, duration: 60 });
  at(448, S, { u: 0.12, duration: 60 });
  at(452, S, { yaw: yawTo(-0.55), duration: 60 });
  at(520, S, { eV: 1, duration: 70 });
  at(520, S, { weaponSlow: 1, duration: 60 });
  at(600, S.show, { all: 0, duration: 45 });
  addFocus(600, 60, FOCUS.weapon);
  at(600, S, { scale: 1.45, duration: 60 });
  at(600, S, { u: 0.38, duration: 60 });
  at(640, S, { yaw: yawTo(-0.45, Math.PI * 2 * 0.9), duration: 130, ease: 'none' });
  // ---- 03 -> 04: reassemble, structure
  at(790, S.show, { all: 1, duration: 40 });
  addFocus(790, 50, FOCUS.robot);
  at(790, S, { eV: 0, duration: 50 });
  at(790, S, { scale: 1.05, duration: 50 });
  at(790, S, { u: 0, duration: 50 });
  at(850, S.show, { all: 0, duration: 40 });
  at(850, S, { eS: 1, duration: 60 });
  addFocus(850, 60, FOCUS.struct);
  at(850, S, { scale: 0.78, duration: 60 });
  at(850, S, { mv: 0.02, duration: 60 });
  at(1060, S, { mv: 0.3, duration: 50 });
  at(880, S, { yaw: yawTo(-0.5, Math.PI * 2 * 0.95), duration: 170, ease: 'none' });
  // ---- 04 -> 05: back together, zig-zag again
  at(1060, S.show, { all: 1, duration: 40 });
  at(1060, S, { eS: 0, duration: 50 });
  addFocus(1060, 50, FOCUS.robot);
  at(1060, S, { scale: 1.0, duration: 50 });
  at(1060, S, { u: -0.4, duration: 50 });
  at(1060, S, { yaw: yawTo(-0.55), duration: 50 });
  at(1085, S, { g: 1, duration: 30 });
  at(1090, S, { cyc: 1, duration: 30 });
  at(1060, S, { showSpin: 0, duration: 40 });
  at(1060, S, { weaponSlow: 0, duration: 40 });
  tl.set({}, {}, TOTAL);

  // ---- copy panels
  const mq = matchMedia('(max-width: 820px)');
  const panel = (id, tin, tout, last = false) => {
    const el = document.getElementById(id);
    const yp = () => (mq.matches ? 0 : -50);
    gsap.set(el, { yPercent: yp(), y: id === 'p1' ? 0 : 36, opacity: id === 'p1' ? 1 : 0 });
    if (id !== 'p1') tl.fromTo(el, { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 22, ease: 'power2.out', immediateRender: false }, tin);
    if (!last) tl.to(el, { opacity: 0, y: -30, duration: 22, ease: 'power2.in' }, tout);
  };
  panel('p1', 0, 70);
  panel('p2', 338, 440);
  panel('p3', 628, 780);
  panel('p4a', 888, 1048);
  panel('p4b', 906, 1048);
  panel('p5', 1096, 0, true);

  // rail state
  const marks = [0, 100, 470, 800, 1070];
  const links = [...document.querySelectorAll('.rail a')];
  ScrollTrigger.create({ trigger: '#scroll', start: 'top top', end: 'bottom bottom', onUpdate: (st) => {
    const vh = st.progress * TOTAL + 20; let k = 0; marks.forEach((m, i) => { if (vh >= m) k = i; });
    links.forEach((a, i) => a.classList.toggle('on', i === k));
  } });
}

function start() {
  timeline();
  document.getElementById('loader').classList.add('done');
  requestAnimationFrame((t) => { clock.last = t; frame(t); });
  document.querySelectorAll('.rail a, .brand').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    // land on each chapter's hold, not its transition
    const stops = { top: 0, s1: 0, s2: 405, s3: 700, s4: 965, s5: 1140 };
    const id = a.getAttribute('href').slice(1);
    scrollTo({ top: stops[id] * innerHeight / 100, behavior: REDUCED ? 'auto' : 'smooth' });
  }));
}
window.__S = S;
