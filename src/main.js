import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import gsap from 'gsap';
import { ending } from './content.js';
import { buildParts, offsets, spinOf, rotorTest } from './parts.js';
import { creasedNormals } from './crease.js';
import { AGX_GLSL, agxDisplayJS, agxDisplayInvJS } from './agx.js';
import { createBoxes } from './boxes.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
// ?capture=1: for headless checks (software WebGL). No render loop, pixel ratio 1, no antialias, no AO/grain
// (add &fx=1 to keep them); window.__step(n, dt, draw) advances the sim by n fixed steps and renders the last one.
const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');
const FX = (!CAPTURE || Q.has('fx')) && !Q.has('nofx'); // ?nofx: plain render, for comparing frame rates

// ending copy
document.getElementById('tag-h').textContent = ending.headline;
document.getElementById('tag-s').textContent = ending.sub;

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !CAPTURE, alpha: false, powerPreference: 'high-performance' });
const mobile = () => innerWidth < 820;
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(devicePixelRatio, mobile() ? 1.5 : 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = CAPTURE && Q.has('exp') ? +Q.get('exp') : 1.5; // &exp= overrides it in capture mode, for tuning
const BG = 0x07080a;
renderer.setClearColor(BG, 1);
// shared by the final post pass and the grid: exposure, and the backdrop in linear and display sRGB
const bgDisplay = new THREE.Color(BG).convertLinearToSRGB();
const TONE = {
  uExposure: { value: renderer.toneMappingExposure },
  uBlack: { value: new THREE.Vector3(...agxDisplayJS(new THREE.Color(BG).toArray(), renderer.toneMappingExposure)) }, // AgX(backdrop)
  uBgD: { value: new THREE.Vector3(bgDisplay.r, bgDisplay.g, bgDisplay.b) },
};

const scene = new THREE.Scene();
// as scene.background (not only the clear colour) three converts it per target; the composer's RenderPass
// clear would otherwise use the colour already encoded for the screen and double-encode it
const bgColor = new THREE.Color(BG);
scene.background = bgColor;
scene.fog = new THREE.Fog(0x07080a, 1.6, 3.4);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(darkStudio(), 0.03).texture;
scene.environmentIntensity = 0.3;

// Reflection environment: a near-black room with a few hard-edged softboxes, so reflections are contrasty
// (bright edges, dark faces) instead of the even grey of a lit room.
function darkStudio() {
  const env = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), new THREE.MeshBasicMaterial({ color: 0x0a0b0d, side: THREE.BackSide }));
  env.add(box);
  const panel = (w, h, k, color, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  panel(2.2, 1.0, 9, 0xffffff, [-1.2, 2.4, 1.4]);  // key softbox, above front-left
  panel(0.35, 2.4, 6, 0xdfe6ff, [2.6, 0.8, -1.2]); // cool strip, back right
  panel(0.25, 1.8, 3, 0xffffff, [-2.7, 0.3, -1.6]); // thin back-left strip
  panel(3.0, 0.2, 2, 0xffffff, [0, -0.4, 2.8]);   // low front edge light
  panel(2.6, 1.4, 4, 0xffffff, [0.2, 2.6, -1.3]);  // overhead, behind: the sheen on flat carbon tops
  return env;
}

const FOV = 30;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
camera.position.set(0, 0.39, 0.9);
camera.lookAt(0, 0, 0);
const DIST = camera.position.length();
const halfH = DIST * Math.tan(THREE.MathUtils.degToRad(FOV / 2));

const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-0.6, 1.2, 0.9); scene.add(key);
// red rim kept low and grazing: on rough surfaces a higher one mirrors off the flat tops toward the camera
const rimR = new THREE.DirectionalLight(0xff2a30, 2.6); rimR.position.set(0.9, 0.18, -0.8); scene.add(rimR);
const rimW = new THREE.DirectionalLight(0xbcd0ff, 1.4); rimW.position.set(-1, 0.3, -0.7); scene.add(rimW);
const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(0.8, -0.2, 1.0); scene.add(fill);

// ---------------------------------------------------------------- rig
const root = new THREE.Group();   // placement, scale, yaw
const model = new THREE.Group();  // CAD frame (Z up, mm -> m already), rotated into Y-up
model.rotation.x = -Math.PI / 2;
root.add(model); scene.add(root);

// ---------------------------------------------------------------- ground
// The grid authors display colours. Under the post chain it writes the inverse of the final pass instead
// (opaque, already blended over the backdrop), so it lands on exactly the same colours as a direct render.
// The inverse comes from a lookup over (red mix, alpha); alpha is stored on a sqrt axis for precision near black.
const LUT_N = 64;
function gridLut() {
  const grey = [0.9, 0.9, 0.9], red = [0.9, 0.08, 0.1], bg = TONE.uBgD.value.toArray(), black = TONE.uBlack.value.toArray();
  const data = new Uint16Array(LUT_N * LUT_N * 4);
  for (let j = 0; j < LUT_N; j++) for (let i = 0; i < LUT_N; i++) {
    const k = i / (LUT_N - 1), A = (j / (LUT_N - 1)) ** 2;
    const d = [0, 1, 2].map((c) => bg[c] + (grey[c] + (red[c] - grey[c]) * k - bg[c]) * A);
    const u = d.map((x, c) => black[c] + (x - bg[c]) * (1 - black[c]) / (1 - bg[c])); // undo the black remap
    const x = agxDisplayInvJS(u, TONE.uExposure.value), o = (j * LUT_N + i) * 4;
    for (let c = 0; c < 3; c++) data[o + c] = THREE.DataUtils.toHalfFloat(x[c]);
    data[o + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const t = new THREE.DataTexture(data, LUT_N, LUT_N, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
const groundMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  defines: FX ? { AGX_INV: '' } : {},
  uniforms: { uOff: { value: new THREE.Vector2() }, uFade: { value: 1 }, uC: { value: new THREE.Vector2() }, uLut: { value: FX ? gridLut() : null } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    varying vec3 vW; uniform vec2 uOff; uniform float uFade; uniform vec2 uC;
    uniform sampler2D uLut;
    float grid(vec2 p, float s, float w){ vec2 q = p / s; vec2 d = abs(fract(q - .5) - .5) / fwidth(q); return 1. - min(min(d.x, d.y) / w, 1.); }
    void main(){
      vec2 p = vW.xz - uOff;
      float minor = grid(p, .04, 1.1), major = grid(p, .2, 1.4);
      float r = length(vW.xz - uC);
      float fade = smoothstep(1.15, .15, r) * uFade;
      float a = clamp(minor * .07 + major * .42, 0., 1.);
      vec3 col = mix(vec3(.9), vec3(.9,.08,.1), major * .42 / max(a, 1e-3));
    #ifdef AGX_INV
      vec2 q = vec2(major * .42 / max(a, 1e-3), sqrt(a * fade)) * ${(LUT_N - 1).toFixed(1)} + .5;
      gl_FragColor = vec4(texture2D(uLut, q / ${LUT_N.toFixed(1)}).rgb, 1.);
    #else
      gl_FragColor = vec4(col, a * fade);
    #endif
    }`,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), groundMat);
ground.rotation.x = -Math.PI / 2; ground.renderOrder = -2; scene.add(ground);
// ending minigame boxes (src/boxes.js): drawn with the grid's colours, through the same lookup under post
const boxes = createBoxes({ lut: groundMat.uniforms.uLut.value, lutN: LUT_N, bgD: TONE.uBgD.value });
scene.add(boxes.mesh);
if (CAPTURE) window.__boxes = boxes;

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

// ---------------------------------------------------------------- state driven by the page timeline
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
  rot: 0,        // 1 = showcase turntable running (set by the page logic)
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
// Gritty, worn look: only roughness/metalness differ from a clean render; the base colours are the brand palette.
const M = {
  carbon: () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: carbonTex, bumpMap: carbonTex, bumpScale: 1.2, metalness: 0.2, roughness: 0.55 }), // semi-matte weave
  body: () => new THREE.MeshStandardMaterial({ color: 0x5a5e65, roughness: 0.88, metalness: 0.0 }), // TPU unibody: very matte
  tpu: () => new THREE.MeshStandardMaterial({ color: 0xc3141c, roughness: 0.88, metalness: 0.0 }),
  tpu2: () => new THREE.MeshStandardMaterial({ color: 0xe5161c, roughness: 0.85, metalness: 0.0 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0xa8121a, roughness: 0.93, metalness: 0 }),
  rim: () => new THREE.MeshStandardMaterial({ color: 0xd3161e, roughness: 0.7, metalness: 0.05 }),
  alu: () => new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.55, metalness: 1.0 }), // dull bare aluminium
  steel: () => new THREE.MeshStandardMaterial({ color: 0x8b9099, roughness: 0.5, metalness: 1.0 }),
  hardox: () => new THREE.MeshStandardMaterial({ color: 0x6d737c, roughness: 0.6, metalness: 0.9 }), // dull ground steel, not chrome
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xe3e6ea, roughness: 0.28, metalness: 1.0 }),
  anod: () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.85 }),
  motor: () => new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.85 }),
  vyta: () => new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.82, metalness: 0 }),
  elec: () => new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.75, metalness: 0.15 }),
  batt: () => new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.8, metalness: 0.05 }),
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
    geo = creasedNormals(geo, 0.6);
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
const KP = 70, KD = 10.5, GRIP = 3.2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function simStep(dt, st = sim) {
  st.t += dt;
  if (st.t > LEG) { st.t -= LEG; st.side *= -1; }
  const err = st.side * AMP - st.psi;
  st.w += (KP * err - KD * st.w) * dt;
  st.psi += st.w * dt;
  const vT = VMAX - (VMAX - VMIN) * Math.min(1, Math.abs(st.w) / 3.5);
  st.v += (vT - st.v) * Math.min(1, dt * 4.5);
  st.phi += (st.psi - st.phi) * Math.min(1, dt * GRIP);
}

// lane (landing and ending): Rebot keeps its zig-zag, and the cursor steers where it does it, inside a
// small lane on the floor around its home spot. The cursor's floor point, clamped to the lane, is the
// target of a soft, speed-capped spring; over the copy, with no mouse, or during a page change, the target
// is home. Mouse/pen only. The offset is weighted by the zig-zag amount, so the showcases are untouched.
const lane = { ndc: new THREE.Vector2(), on: false, cx: 0, x: 0, z: 0, vx: 0, vz: 0, span: null };
const LANE_W = 0.2, LANE_D = 0.06; // half width (fraction of the half-screen), half depth (m, at scale 1)
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  lane.on = true; lane.cx = e.clientX; lane.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});
document.documentElement.addEventListener('pointerleave', () => { lane.on = false; });
addEventListener('resize', () => { lane.span = null; });
const ray = new THREE.Raycaster(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
function floorAt(nx, ny) { ray.setFromCamera(ndc.set(nx, ny), camera); floor.constant = -ground.position.y; return ray.ray.intersectPlane(floor, hit); }
// horizontal span of the page's copy, cached (the panels only ever move vertically)
function copySpan() {
  if (!lane.span) lane.span = {};
  if (!lane.span[page]) { const r = document.getElementById(page === 0 ? 'p1' : 'p5').getBoundingClientRect(); lane.span[page] = [r.left - 16, r.right + 16]; }
  return lane.span[page];
}
const laneHalfW = () => LANE_W * halfH * camera.aspect;
// a click on the ending drops boxes just below the screen's bottom edge, and the floor carries them in.
// The floor sways with the zig-zag, so a copy of the drive sim is run ahead to find where they would drift:
// they are placed so that they reach Rebot's line in line with the click (clamped to the lane), which is
// also where the cursor steers Rebot.
function spawnBoxes(cx, cy) {
  const L = layout();
  if (!floorAt((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1)) return;
  const W = laneHalfW(), x = L.x + Math.max(-W, Math.min(W, hit.x - L.x));
  if (!floorAt(0, -1)) return;
  const z = hit.z + 0.12 * L.sc, meet = lane.z + 0.1 * L.sc, st = { ...sim }, dt = 1 / 60;
  let dx = 0, dz = 0;
  for (let i = 0; i < 360 && z + dz > meet; i++) {
    simStep(dt, st);
    const tr = S.yaw + st.phi;
    dx -= Math.cos(tr) * st.v * dt; dz += Math.sin(tr) * st.v * dt;
  }
  boxes.spawn(x - dx, z, ground.position.y, L.sc);
}
function laneStep(dt, L) {
  let tx = 0, tz = 0;
  if (lane.on && !busy && (page === 0 || page === 4)) {
    const sp = copySpan();
    if ((lane.cx < sp[0] || lane.cx > sp[1]) && floorAt(lane.ndc.x, lane.ndc.y)) {
      const W = laneHalfW(), D = LANE_D * L.sc;
      tx = Math.max(-W, Math.min(W, hit.x - L.x)); tz = Math.max(-D, Math.min(D, hit.z));
    }
  }
  const w = 3.2, cap = 0.3 * L.sc;
  lane.vx += (w * w * (tx - lane.x) - 2 * w * lane.vx) * dt;
  lane.vz += (w * w * (tz - lane.z) - 2 * w * lane.vz) * dt;
  const v = Math.hypot(lane.vx, lane.vz);
  if (v > cap) { lane.vx *= cap / v; lane.vz *= cap / v; }
  lane.x += lane.vx * dt; lane.z += lane.vz * dt;
}

// showcase turntable: runs on its own while a drive/structure page is up, then settles back to its home angle
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
const prev = { x: 0, z: 0, yaw: 0, init: false };
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

function frame(now, draw = true) {
  const dt = Math.min(0.05, (now - clock.last) / 1000 || 0.016); clock.last = now;
  const run = REDUCED ? 0 : 1;
  if (run) { simStep(dt); turnStep(dt); }
  perfStep(dt);
  const L = layout();
  if (run) laneStep(dt, L);

  // timeline pose plus the zig-zag
  const cyc = S.cyc * run;
  const yawTot = S.yaw + cyc * sim.psi + turn.a;
  const px = L.x + lane.x * cyc, pz = lane.z * cyc;
  root.rotation.y = yawTot;
  root.scale.setScalar(L.sc);
  root.position.set(px, L.y, pz);
  const f = S.focus;
  model.position.set(-f[0] * 0.001, -f[2] * 0.001, f[1] * 0.001);

  // body speed from the rig's own motion plus the sim
  const fx = Math.cos(yawTot), fz = -Math.sin(yawTot);
  if (!prev.init) { Object.assign(prev, { x: px, z: pz, yaw: yawTot, init: true }); }
  const vRig = ((px - prev.x) * fx + (pz - prev.z) * fz) / Math.max(dt, 1e-4) / L.sc;
  const yawRate = wrap(yawTot - prev.yaw) / Math.max(dt, 1e-4);
  const rvx = (px - prev.x) / Math.max(dt, 1e-4), rvz = (pz - prev.z) / Math.max(dt, 1e-4);
  Object.assign(prev, { x: px, z: pz, yaw: yawTot });
  const vBody = vRig + cyc * sim.v;

  // the ground slides against the travel direction (which lags the heading: drift)
  const travel = S.yaw + sim.phi, gs = cyc * sim.v * dt;
  gOff.x -= Math.cos(travel) * gs; gOff.y += Math.sin(travel) * gs;
  gOff.y += 0.03 * S.gf * dt * run; // slow drift on the floating floor
  if (boxes.count) {
    const hits = boxes.step(dt, {
      px, py: L.y, pz, yaw: yawTot, yawRate, sc: L.sc, focus: S.focus, vx: rvx, vz: rvz,
      spin: sm.ww, floorY: ground.position.y, vG: [-Math.cos(travel) * cyc * sim.v, Math.sin(travel) * cyc * sim.v], home: L.x,
    });
    // each blade hit kicks the robot a little (the reaction's torque about its centre) and costs the blade speed
    for (const h of hits) { turn.w += 6 * (h.lx * h.tz - h.lz * h.tx); sm.ww *= 0.6; }
  }

  // wheel rates (rad/s about +Y CAD); right wheel is the CAD -Y side
  const clampR = (x) => Math.max(-40, Math.min(40, x));
  const diff = yawRate * HALF_TRACK * (1 - S.showSpin);
  let wR = clampR((vBody + diff) / RW), wL = clampR((vBody - diff) / RW);
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
  groundMat.uniforms.uC.value.set(px * 0.4, pz * 0.4);
  ground.visible = S.g > 0.01;
  blob.material.opacity = S.show.all * (1 - S.gf); blob.visible = blob.material.opacity > 0.01;

  if (!draw) return;
  if (composer) { grain.uniforms.uTime.value += dt * run; composer.render(dt); } // reduced motion: static grain
  else renderer.render(scene, camera);
}

// ---------------------------------------------------------------- post: AO, AgX + grain (the vignette is CSS)
// GTAO darkens seams, gaps and bolt heads. It runs at reduced resolution (less on phones) and ignores parts
// that are fading out, so they don't leave dark ghosts on what stays.
// Final pass: AgX with the Punchy look (src/agx.js), the backdrop black mapped back onto the brand black, and
// a fine animated grain, kept lighter on the black backdrop.
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmt: { value: 0.035 }, ...TONE },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmt; uniform float uExposure; uniform vec3 uBlack, uBgD; varying vec2 vUv;
    ${AGX_GLSL}
    float h(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec3 c = blackRemap(agxDisplay(texture2D(tDiffuse, vUv).rgb, uExposure), uBlack, uBgD);
      float l = dot(c, vec3(.2126, .7152, .0722));
      float n = h(gl_FragCoord.xy + fract(uTime * 7.13) * 917.) - .5;
      c += n * uAmt * mix(.25, 1., smoothstep(.0, .3, l));
      gl_FragColor = vec4(c, 1.);
    }`,
};
let composer = null, gtao = null, grain = null;
if (CAPTURE) window.__fx = () => ({ composer, gtao, grain });
const AO_RES = 0.5; // of the post resolution; the denoise hides the upsampling
if (FX) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile() ? 2 : 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({ radius: 0.035, distanceExponent: 1.4, thickness: 0.02, distanceFallOff: 1, scale: 1.3, samples: mobile() ? 6 : 8 });
  gtao.updatePdMaterial({ samples: mobile() ? 6 : 8, radius: 6 });
  gtao.blendIntensity = 1;
  const setAO = gtao.setSize.bind(gtao);
  gtao.setSize = (w, h) => setAO(Math.max(1, Math.round(w * AO_RES)), Math.max(1, Math.round(h * AO_RES)));
  const hide = gtao.overrideVisibility.bind(gtao);
  const show = gtao.restoreVisibility.bind(gtao);
  gtao.overrideVisibility = () => { hide(); scene.background = null; scene.traverse((o) => { if (o.isMesh && o.material.depthWrite === false) o.visible = false; }); };
  gtao.restoreVisibility = () => { show(); scene.background = bgColor; };
  composer.addPass(gtao);
  grain = new ShaderPass(FinalShader);
  grain.material.toneMapped = false; // it does its own tone mapping; keep three's out of the screen pass
  composer.addPass(grain);
}

// Resolution: the direct render keeps the full density; the post chain is capped (it is per pixel), and a
// frame-time guard steps it down further if a machine can't hold ~50 fps. It never steps back up, so it
// can't oscillate.
const perf = { avg: 1 / 60, t: 0, scale: 1 };
function prFor() {
  if (CAPTURE) return 1;
  if (!composer) return Math.min(devicePixelRatio, mobile() ? 1.5 : 2);
  return Math.max(0.75, Math.min(devicePixelRatio, mobile() ? 1.25 : 1.5) * perf.scale);
}
// ?fps: a small readout of frame rate and render resolution, for checking on real hardware
const fpsEl = Q.has('fps') ? Object.assign(document.body.appendChild(document.createElement('div')), {
  style: 'position:fixed;left:8px;bottom:8px;z-index:99;font:12px/1.3 monospace;color:#fff;background:rgba(0,0,0,.7);padding:4px 6px;pointer-events:none',
}) : null;
const fpsAcc = { n: 0, t: 0 };
function perfStep(dt) {
  if (fpsEl) {
    fpsAcc.n++; fpsAcc.t += dt;
    if (fpsAcc.t > 0.5) { fpsEl.textContent = `${Math.round(fpsAcc.n / fpsAcc.t)} fps · ${renderer.domElement.width}×${renderer.domElement.height} · pr ${prFor().toFixed(2)}${composer ? '' : ' · no post'}`; fpsAcc.n = fpsAcc.t = 0; }
  }
  if (CAPTURE || !composer || perf.scale <= 0.67) return;
  perf.avg += (dt - perf.avg) * 0.05; perf.t += dt;
  if (perf.t > 2 && perf.avg > 1 / 50) { perf.scale -= 0.165; perf.t = 0; perf.avg = 1 / 60; resize(); }
}

function resize() {
  const w = innerWidth, h = innerHeight;
  const pr = prFor();
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) {
    composer.setPixelRatio(pr); composer.setSize(w, h);
    grain.uniforms.uAmt.value = mobile() ? 0.025 : 0.035;
  }
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- timeline (paused; pages are labels on it)
const PAGES = [0, 300, 600, 840, 1000];     // landing, drive, weapon, structure, ending
const NAMES = ['rebot', 'drive', 'weapon', 'structure', 'end'];
const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.inOut' } });

function buildTimeline() {
  const at = (t, tw, vars) => tl.to(tw, { duration: 1, ...vars }, t);
  // yaw targets take the shortest way round from the previous one
  let yawNow = S.yaw;
  const yawTo = (mod) => { yawNow = yawNow + wrap(mod - yawNow); return yawNow; };
  // focus keyframes chained at build time (each tween interpolates from the previous target)
  const FK = [FOCUS.robot];
  const addFocus = (t, d, to, ease = 'power3.inOut') => {
    const from = FK[FK.length - 1].slice(); FK.push(to.slice());
    const prox = { k: 0 };
    tl.fromTo(prox, { k: 0 }, { k: 1, duration: d, ease, immediateRender: false, onUpdate() { for (let i = 0; i < 3; i++) S.focus[i] = from[i] + (to[i] - from[i]) * prox.k; } }, t);
  };

  // Each page-to-page segment is filled end to end: the old copy leaves while the model already moves,
  // steps overlap (reassemble -> explode -> isolate -> zoom), and the new copy lands as the motion settles.
  // seg(a, b) maps 0..1 to a span of the timeline.
  const seg = (a, b) => ({ t: (x) => a + x * (b - a), d: (x) => x * (b - a) });
  let q;

  // ---- 01 -> 02: Rebot keeps zig-zagging while the framing closes in on one drive module; the rest of the
  // robot fades, the armour and axle bolt come off, and the zig-zag settles into the showcase pose
  q = seg(0, PAGES[1]);
  addFocus(q.t(0.02), q.d(0.55), FOCUS.module, 'power2.inOut');
  at(q.t(0.02), S, { u: -0.3, duration: q.d(0.6), ease: 'power2.inOut' });
  at(q.t(0.15), S, { scale: 1.65, duration: q.d(0.7), ease: 'power2.inOut' });
  at(q.t(0.2), S.show, { module: 1, duration: q.d(0.02) });
  at(q.t(0.22), S.show, { all: 0, duration: q.d(0.4) });
  at(q.t(0.35), S, { cyc: 0, duration: q.d(0.5), ease: 'power2.inOut' });
  at(q.t(0.35), S, { yaw: yawTo(2.45), duration: q.d(0.63) });
  at(q.t(0.4), S, { gf: 1, g: 0.55, duration: q.d(0.55) });
  at(q.t(0.4), S, { showSpin: 1, duration: q.d(0.45) });
  at(q.t(0.45), S, { eR: 1, duration: q.d(0.53) });

  // ---- 02 -> 03: reassemble, explode vertically, isolate the weapon (no turntable: the drive does the moving)
  q = seg(PAGES[1], PAGES[2]);
  at(q.t(0.02), S.show, { all: 1, duration: q.d(0.3) });
  addFocus(q.t(0.02), q.d(0.4), FOCUS.robot);
  at(q.t(0.02), S, { eR: 0, duration: q.d(0.4) });
  at(q.t(0.02), S, { scale: 1.05, duration: q.d(0.4) });
  at(q.t(0.02), S, { u: 0.1, duration: q.d(0.4) });
  at(q.t(0.02), S, { yaw: yawTo(-0.55), duration: q.d(0.45) });
  at(q.t(0.3), S, { eV: 1, duration: q.d(0.4) });
  at(q.t(0.3), S, { weaponSlow: 1, duration: q.d(0.35) });
  at(q.t(0.5), S.show, { module: 0, weapon: 1, duration: q.d(0.02) });
  at(q.t(0.52), S.show, { all: 0, duration: q.d(0.33) });
  addFocus(q.t(0.52), q.d(0.46), FOCUS.weapon);
  at(q.t(0.52), S, { scale: 1.5, duration: q.d(0.46) });
  at(q.t(0.52), S, { u: 0.36, duration: q.d(0.46) });

  // ---- 03 -> 04: reassemble, structure
  q = seg(PAGES[2], PAGES[3]);
  at(q.t(0.02), S.show, { all: 1, duration: q.d(0.3) });
  addFocus(q.t(0.02), q.d(0.4), FOCUS.robot);
  at(q.t(0.02), S, { eV: 0, duration: q.d(0.4) });
  at(q.t(0.02), S, { scale: 1.05, duration: q.d(0.4) });
  at(q.t(0.02), S, { u: 0, duration: q.d(0.4) });
  at(q.t(0.4), S.show, { weapon: 0, struct: 1, duration: q.d(0.02) });
  at(q.t(0.42), S.show, { all: 0, duration: q.d(0.38) });
  at(q.t(0.42), S, { eS: 1, duration: q.d(0.5) });
  addFocus(q.t(0.42), q.d(0.55), FOCUS.struct);
  at(q.t(0.42), S, { scale: 1.12, duration: q.d(0.55) });
  at(q.t(0.42), S, { yaw: yawTo(-1.15), duration: q.d(0.55) });
  at(q.t(0.42), S, { mv: 0.04, duration: q.d(0.55) });

  // ---- 04 -> 05: back together, zig-zag again
  q = seg(PAGES[3], PAGES[4]);
  at(q.t(0.03), S.show, { all: 1, duration: q.d(0.37) });
  at(q.t(0.03), S, { eS: 0, duration: q.d(0.47) });
  addFocus(q.t(0.03), q.d(0.57), FOCUS.robot);
  at(q.t(0.03), S, { scale: 1.0, duration: q.d(0.57) });
  at(q.t(0.03), S, { u: -0.4, duration: q.d(0.57) });
  at(q.t(0.03), S, { mv: 0.3, duration: q.d(0.57) });
  at(q.t(0.03), S, { yaw: yawTo(BASE_YAW), duration: q.d(0.57) });
  at(q.t(0.1), S, { gf: 0, g: 1, duration: q.d(0.5) });
  at(q.t(0.1), S, { showSpin: 0, weaponSlow: 0, duration: q.d(0.4) });
  at(q.t(0.5), S.show, { struct: 0, duration: q.d(0.02) });
  at(q.t(0.45), S, { cyc: 1, duration: q.d(0.4) });
  tl.set({}, {}, PAGES[4]);

  // ---- copy panels (the landing copy is driven by the page logic: it leaves as soon as a page change starts)
  const mq = matchMedia('(max-width: 820px)');
  const panel = (id, tin, tout, last = false) => {
    const el = document.getElementById(id);
    gsap.set(el, { yPercent: mq.matches ? 0 : -50, y: 36, opacity: 0 });
    tl.fromTo(el, { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 32, ease: 'power2.out', immediateRender: false }, tin);
    if (!last) tl.to(el, { opacity: 0, y: -30, duration: 26, ease: 'power2.in' }, tout);
  };
  gsap.set('#p1', { yPercent: mq.matches ? 0 : -50, y: 0 }); // explicit y: GSAP can read the CSS -50% as a px offset and double it
  const P = PAGES, len = (i) => P[i + 1] - P[i];
  panel('p2', P[1] - 0.125 * len(0), P[1] + 0.02 * len(1));
  panel('p3', P[2] - 0.22 * len(1), P[2] + 0.02 * len(2));
  panel('p4a', P[3] - 0.22 * len(2), P[3] + 0.02 * len(3));
  panel('p4b', P[3] - 0.17 * len(2), P[3] + 0.02 * len(3));
  panel('p5', P[4] - 0.3 * len(3), 0, true);
}

// ---------------------------------------------------------------- pages
// note: seeks pass suppressEvents=false so the focus proxies' onUpdate still runs
let page = 0, busy = false, pending = null;
const links = [...document.querySelectorAll('.rail a')];
const setRail = (n) => links.forEach((a, i) => a.classList.toggle('on', i === n));
const p1 = (show) => gsap.to('#p1', { opacity: show ? 1 : 0, y: show ? 0 : -30, duration: show ? 0.7 : 0.45, ease: show ? 'power2.out' : 'power2.in', overwrite: true });
const updateRot = () => { S.rot = !busy && (page === 1 || page === 3) ? 1 : 0; };

function playTo(t, cb) {
  const d = Math.abs(t - tl.time());
  if (d < 0.5) { tl.seek(t, false); cb(); return; }
  // ~2.5-3 s for one page; longer jumps grow sub-linearly so a rail jump stays continuous but not endless.
  // Linear playback: the motion inside each segment carries its own easing.
  const dur = (REDUCED ? 0.5 : 1) * 2.6 * Math.pow(d / 240, 0.5);
  tl.tweenTo(t, { duration: dur, ease: 'none', onComplete: cb });
}

// Out-of-sequence jumps (e.g. 5 -> 1, 1 -> 4) go straight to the target page instead of playing every page
// in between: the framing moves directly, while the parts reassemble (if the source page took the robot apart)
// before the target page isolates or explodes its own. At the end the timeline is set to the target page,
// which holds exactly the state the tweens arrived at.
const STATES = [];
const snap = () => ({ ...S, focus: S.focus.slice(), show: { ...S.show } });
const PANELS = [[], ['#p2'], ['#p3'], ['#p4a', '#p4b'], ['#p5']];
function direct(n, from, cb) {
  const A = snap(), B = STATES[n], dur = (REDUCED ? 0.5 : 1) * 2.8;
  const d = gsap.timeline({ defaults: { ease: 'power2.inOut' }, onComplete() { tl.seek(PAGES[n], false); cb(); } });
  const at = (x, tw, vars) => d.to(tw, vars, x * dur);
  const span = (x0, x1) => (x1 - x0) * dur;
  // framing: one move from here to there
  const cam = {};
  for (const k of ['u', 'v', 'mv', 'scale', 'cyc', 'g', 'gf', 'showSpin', 'weaponSlow']) cam[k] = B[k];
  cam.yaw = A.yaw + wrap(B.yaw - A.yaw);
  at(0.02, S, { ...cam, duration: span(0.02, 0.98) });
  at(0.02, S.focus, { endArray: B.focus, duration: span(0.02, 0.98) });
  // explode: collapse first, expand late
  for (const k of ['eR', 'eV', 'eS']) {
    if (B[k] < A[k]) at(0.02, S, { [k]: B[k], duration: span(0.02, 0.5) });
    else if (B[k] > A[k]) at(0.45, S, { [k]: B[k], duration: span(0.45, 0.98) });
  }
  // visibility: back to the whole robot, swap the isolated set while it is whole, then isolate again
  const tags = ['module', 'weapon', 'struct'];
  if (A.show.all < 1 && B.show.all < 1) {
    at(0.02, S.show, { all: 1, duration: span(0.02, 0.35) });
    at(0.45, S.show, { ...Object.fromEntries(tags.map((t) => [t, B.show[t]])), duration: span(0.45, 0.47) });
    at(0.5, S.show, { all: B.show.all, duration: span(0.5, 0.85) });
  } else if (B.show.all > A.show.all) {
    at(0.02, S.show, { all: B.show.all, duration: span(0.02, 0.4) });
    at(0.45, S.show, { ...Object.fromEntries(tags.map((t) => [t, B.show[t]])), duration: span(0.45, 0.47) });
  } else {
    at(0.2, S.show, { ...Object.fromEntries(tags.map((t) => [t, B.show[t]])), duration: span(0.2, 0.22) });
    at(0.22, S.show, { all: B.show.all, duration: span(0.22, 0.62) });
  }
  // copy: the old panel leaves at once, the new one lands as the motion settles (the landing copy is p1())
  if (PANELS[from].length) d.to(PANELS[from], { opacity: 0, y: -30, duration: 0.3, ease: 'power2.in' }, 0);
  if (PANELS[n].length) d.fromTo(PANELS[n], { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', stagger: 0.1, immediateRender: false }, 0.8 * dur);
}

function goto(n) {
  n = Math.max(0, Math.min(PAGES.length - 1, n));
  if (busy) { pending = n; return; }
  if (n === page) return;
  const from = page;
  if (from === 4) boxes.clear();
  page = n; busy = true; updateRot(); setRail(n);
  history.replaceState(null, '', n ? `#${NAMES[n]}` : location.pathname + location.search);
  const done = () => {
    busy = false; updateRot();
    if (pending !== null && pending !== page) { const p = pending; pending = null; goto(p); } else pending = null;
  };
  const move = Math.abs(n - from) > 1 ? (cb) => direct(n, from, cb) : (cb) => playTo(PAGES[n], cb);
  if (from === 0) p1(false);
  if (n === 0) return move(() => { p1(true); done(); });
  move(done);
}

// direct jump (deep links and screenshots)
function jump(n) {
  boxes.clear();
  page = n; setRail(n); tl.seek(PAGES[n], false); updateRot();
  gsap.set('#p1', { opacity: n === 0 ? 1 : 0 });
}

function inputs() {
  // wheel: one page per gesture. A gesture re-arms after a short quiet gap, so trackpad inertia
  // doesn't skip pages; a gesture during a transition queues the next page.
  let acc = 0, armed = true, quiet = 0;
  addEventListener('wheel', (e) => {
    e.preventDefault();
    clearTimeout(quiet); quiet = setTimeout(() => { armed = true; acc = 0; }, 160);
    if (!armed) return;
    acc += e.deltaY;
    if (Math.abs(acc) > 30) { armed = false; goto((pending ?? page) + Math.sign(acc)); acc = 0; }
  }, { passive: false });
  addEventListener('keydown', (e) => {
    const k = e.key;
    if (['ArrowDown', 'ArrowRight', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); goto((pending ?? page) + 1); }
    else if (['ArrowUp', 'ArrowLeft', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); goto((pending ?? page) - 1); }
    else if (k === 'Home') goto(0);
    else if (k === 'End') goto(PAGES.length - 1);
  });
  // click / tap anywhere moves on; swipes go either way
  let ty = null, tx = null;
  addEventListener('touchstart', (e) => { ty = e.touches[0].clientY; tx = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', (e) => {
    if (ty === null) return;
    const dy = ty - e.changedTouches[0].clientY, dx = tx - e.changedTouches[0].clientX; ty = null;
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) goto((pending ?? page) + Math.sign(dy));
  }, { passive: true });
  addEventListener('click', (e) => {
    if (e.target.closest('.rail, .brand')) return;
    if (page === 4 && !busy && pending === null) { if (!REDUCED) spawnBoxes(e.clientX, e.clientY); return; } // the last page: play
    goto((pending ?? page) + 1);
  });
  links.forEach((a, i) => a.addEventListener('click', (e) => { e.preventDefault(); goto(i); }));
  document.querySelector('.brand').addEventListener('click', (e) => { e.preventDefault(); goto(0); });
}

function start() {
  buildTimeline();
  // the state each page lands on (this also initialises every tween in order, as a forward playback would)
  for (const t of PAGES) { tl.seek(t, false); STATES.push(snap()); }
  inputs();
  const n = NAMES.indexOf(location.hash.slice(1));
  jump(n > 0 ? n : 0);
  document.getElementById('loader').classList.add('done');
  clock.last = performance.now();
  if (CAPTURE) {
    window.__step = (n = 1, dt = 1 / 60, draw = true) => { for (let i = 0; i < n; i++) frame(clock.last + dt * 1000, draw && i === n - 1); };
    window.__step();
  } else gsap.ticker.add(() => frame(performance.now()));
}
window.__S = S;
window.__goto = (n, instant) => (instant ? jump(n) : goto(n));
window.__sim = sim;
window.__tl = tl;
