// AgX tone mapping as GLSL (three's Filament/Blender port, same constants) plus Blender's "Punchy" look,
// which restores the saturation plain AgX takes out of the brand reds. Also the exact inverse, so shaders
// that author display colours directly (the grid) can still land on those colours after the post chain.
// Linear-sRGB in, display sRGB out. GLSL ES 3.0 (needs inverse()).
export const AGX_GLSL = /* glsl */ `
const mat3 AGX_S2R = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 AGX_R2S = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 AGX_IN = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
const mat3 AGX_OUT = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
const float AGX_LO = -12.47393, AGX_HI = 4.026069;
const vec3 AGX_LW = vec3(0.2626983, 0.6780088, 0.0592929); // Rec.2020 luminance, as Blender's look
const float AGX_POW = 1.35, AGX_SAT = 1.4;                  // Blender "Punchy"
float agxSig(float x) { float x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
float agxSigInv(float y) { float a = 0., b = 1.; for (int i = 0; i < 18; i++) { float m = .5 * (a + b); if (agxSig(m) < y) a = m; else b = m; } return .5 * (a + b); }
vec3 srgbOetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
vec3 srgbEotf(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
vec3 agxDisplay(vec3 c, float exposure) {
  c = AGX_IN * (AGX_S2R * (c * exposure));
  c = clamp((log2(max(c, 1e-10)) - AGX_LO) / (AGX_HI - AGX_LO), 0., 1.);
  c = vec3(agxSig(c.r), agxSig(c.g), agxSig(c.b));
  c = pow(max(c, 0.), vec3(AGX_POW)); float l = dot(c, AGX_LW); c = l + AGX_SAT * (c - l);
  c = pow(max(AGX_OUT * c, 0.), vec3(2.2));
  return srgbOetf(clamp(AGX_R2S * c, 0., 1.));
}
vec3 agxDisplayInv(vec3 d, float exposure) {
  vec3 c = inverse(AGX_R2S) * srgbEotf(clamp(d, 0., 1.));
  c = inverse(AGX_OUT) * pow(max(c, 0.), vec3(1. / 2.2));
  float l = dot(c, AGX_LW); c = l + (c - l) / AGX_SAT; c = pow(max(c, 0.), vec3(1. / AGX_POW));
  c = vec3(agxSigInv(c.r), agxSigInv(c.g), agxSigInv(c.b));
  c = exp2(c * (AGX_HI - AGX_LO) + AGX_LO);
  return inverse(AGX_S2R) * (inverse(AGX_IN) * c) / exposure;
}
// AgX lifts or crushes the backdrop black; the final pass maps AgX(backdrop) back onto the exact brand black.
vec3 blackRemap(vec3 d, vec3 black, vec3 bg) { return bg + (d - black) * (1. - bg) / (1. - black); }
vec3 blackRemapInv(vec3 d, vec3 black, vec3 bg) { return black + (d - bg) * (1. - black) / (1. - bg); }
`;
