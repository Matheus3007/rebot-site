// AgX tone mapping as GLSL (three's Filament/Blender port, same constants) plus Blender's "Punchy" look,
// which restores the saturation plain AgX takes out of the brand reds. Linear-sRGB in, display sRGB out.
// Below it, the same maths in JS plus its exact inverse, for the constants the shaders use.
export const AGX_GLSL = /* glsl */ `
const mat3 AGX_S2R = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 AGX_R2S = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 AGX_IN = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
const mat3 AGX_OUT = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
const float AGX_LO = -12.47393, AGX_HI = 4.026069;
const vec3 AGX_LW = vec3(0.2626983, 0.6780088, 0.0592929); // Rec.2020 luminance, as Blender's look
const float AGX_POW = 1.35, AGX_SAT = 1.4;                  // Blender "Punchy"
float agxSig(float x) { float x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 srgbOetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
vec3 agxDisplay(vec3 c, float exposure) {
  c = AGX_IN * (AGX_S2R * (c * exposure));
  c = clamp((log2(max(c, 1e-10)) - AGX_LO) / (AGX_HI - AGX_LO), 0., 1.);
  c = vec3(agxSig(c.r), agxSig(c.g), agxSig(c.b));
  c = pow(max(c, 0.), vec3(AGX_POW)); float l = dot(c, AGX_LW); c = l + AGX_SAT * (c - l);
  c = pow(max(AGX_OUT * c, 0.), vec3(2.2));
  return srgbOetf(clamp(AGX_R2S * c, 0., 1.));
}
// AgX lifts or crushes the backdrop black; the final pass maps AgX(backdrop) back onto the exact brand black.
vec3 blackRemap(vec3 d, vec3 black, vec3 bg) { return bg + (d - black) * (1. - bg) / (1. - black); }
`;

// The same maths in JS, for values that are constant: the backdrop black point (a uniform, not a per-pixel
// evaluation) and the grid's lookup table (not a per-pixel inverse). Matrices are GLSL column-major: m[col][row].
const S2R = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.0880], [0.0433, 0.0113, 0.8956]];
const R2S = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
const IN = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]];
const OUT = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]];
const LO = -12.47393, HI = 4.026069, LW = [0.2626983, 0.6780088, 0.0592929], POW = 1.35, SAT = 1.4;
const mul = (m, v) => [0, 1, 2].map((i) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2]);
function inv(m) {
  const [a, b, c] = m; // columns
  const det = a[0] * (b[1] * c[2] - c[1] * b[2]) - b[0] * (a[1] * c[2] - c[1] * a[2]) + c[0] * (a[1] * b[2] - b[1] * a[2]);
  const r = [ // rows of the inverse
    [(b[1] * c[2] - c[1] * b[2]) / det, (c[0] * b[2] - b[0] * c[2]) / det, (b[0] * c[1] - c[0] * b[1]) / det],
    [(c[1] * a[2] - a[1] * c[2]) / det, (a[0] * c[2] - c[0] * a[2]) / det, (c[0] * a[1] - a[0] * c[1]) / det],
    [(a[1] * b[2] - b[1] * a[2]) / det, (b[0] * a[2] - a[0] * b[2]) / det, (a[0] * b[1] - b[0] * a[1]) / det],
  ];
  return [0, 1, 2].map((j) => [r[0][j], r[1][j], r[2][j]]); // back to columns
}
const R2S_I = inv(R2S), OUT_I = inv(OUT), S2R_I = inv(S2R), IN_I = inv(IN);
const sig = (x) => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; };
const sigInv = (y) => { let a = 0, b = 1; for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (sig(m) < y) a = m; else b = m; } return (a + b) / 2; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const oetf = (x) => (x < 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const eotf = (x) => (x < 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));

export function agxDisplayJS(c, exposure) {
  c = mul(IN, mul(S2R, c.map((x) => x * exposure)));
  c = c.map((x) => sig(clamp01((Math.log2(Math.max(x, 1e-10)) - LO) / (HI - LO))));
  c = c.map((x) => Math.pow(Math.max(x, 0), POW));
  const l = c[0] * LW[0] + c[1] * LW[1] + c[2] * LW[2];
  c = mul(OUT, c.map((x) => l + SAT * (x - l))).map((x) => Math.pow(Math.max(x, 0), 2.2));
  return mul(R2S, c).map((x) => oetf(clamp01(x)));
}
export function agxDisplayInvJS(d, exposure) {
  let c = mul(R2S_I, d.map((x) => eotf(clamp01(x))));
  c = mul(OUT_I, c.map((x) => Math.pow(Math.max(x, 0), 1 / 2.2)));
  const l = c[0] * LW[0] + c[1] * LW[1] + c[2] * LW[2];
  c = c.map((x) => Math.pow(Math.max(l + (x - l) / SAT, 0), 1 / POW));
  c = c.map((x) => Math.pow(2, sigInv(x) * (HI - LO) + LO));
  return mul(S2R_I, mul(IN_I, c)).map((x) => x / exposure);
}
