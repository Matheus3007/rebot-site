// Same result as three's BufferGeometryUtils.toCreasedNormals (incl. its 1/100-unit position hash, which on
// this metre-scale CAD averages over 1 cm cells and is part of the look), but much faster: each cell keeps
// its distinct face normals with a weight (how many corners of that face land in the cell), and each
// (face, cell) pair is evaluated once per group of coplanar faces instead of once per corner.
// Only float summation order (and a 1e-7 normal grouping) differs from three's output.
import { BufferAttribute } from 'three';

export function creasedNormals(geometry, creaseAngle) {
  const creaseDot = Math.cos(creaseAngle);
  const hm = (1 + 1e-10) * 1e2;
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position.array;
  const nf = p.length / 9;
  // face normals (same arithmetic as three: (c - b) x (a - b), normalized)
  const fn = new Float64Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const o = f * 9;
    const ax = p[o], ay = p[o + 1], az = p[o + 2], bx = p[o + 3], by = p[o + 4], bz = p[o + 5], cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
    const ux = cx - bx, uy = cy - by, uz = cz - bz, vx = ax - bx, vy = ay - by, vz = az - bz;
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    fn[f * 3] = x / l; fn[f * 3 + 1] = y / l; fn[f * 3 + 2] = z / l;
  }
  // cell id per corner (same truncation as three's hash; packed into one integer key)
  const cellOf = new Int32Array(nf * 3);
  const ids = new Map();
  for (let i = 0; i < nf * 3; i++) {
    const key = ((~~(p[i * 3] * hm) + 1024) * 2048 + (~~(p[i * 3 + 1] * hm) + 1024)) * 2048 + (~~(p[i * 3 + 2] * hm) + 1024);
    let c = ids.get(key);
    if (c === undefined) { c = ids.size; ids.set(key, c); }
    cellOf[i] = c;
  }
  // per cell, the distinct faces touching it and how many of their corners land there (CSR layout)
  const nc = ids.size, start = new Int32Array(nc + 1);
  for (let f = 0; f < nf; f++) {
    const a = cellOf[f * 3], b = cellOf[f * 3 + 1], c = cellOf[f * 3 + 2];
    start[a + 1]++; if (b !== a) start[b + 1]++; if (c !== a && c !== b) start[c + 1]++;
  }
  for (let c = 0; c < nc; c++) start[c + 1] += start[c];
  const fill = start.slice(0, nc), cf = new Int32Array(start[nc]), cw = new Float64Array(start[nc]);
  for (let f = 0; f < nf; f++) {
    const a = cellOf[f * 3], b = cellOf[f * 3 + 1], c = cellOf[f * 3 + 2];
    const wa = 1 + (b === a) + (c === a);
    cf[fill[a]] = f; cw[fill[a]++] = wa;
    if (b !== a) { cf[fill[b]] = f; cw[fill[b]++] = 1 + (c === b); }
    if (c !== a && c !== b) { cf[fill[c]] = f; cw[fill[c]++] = 1; }
  }
  // within each cell, coplanar faces share a normal: group them (to 1e-7, far below float32 output
  // precision) so each (cell, normal group) is solved once
  const grp = new Int32Array(start[nc]);        // entry -> group id (global)
  const gN = [], gW = [], gStart = new Int32Array(nc + 1);
  const r = (x) => Math.round(x * 1e7);
  const local = new Map(); // numeric (x, y) key -> [rz, group, rz, group, ...] (cleared per cell)
  for (let c = 0; c < nc; c++) {
    local.clear();
    for (let j = start[c], e = start[c + 1]; j < e; j++) {
      const o = cf[j] * 3, rz = r(fn[o + 2]);
      const key = (r(fn[o]) + 1e7) * 2.0000001e7 + (r(fn[o + 1]) + 1e7);
      let list = local.get(key), gi = -1;
      if (list === undefined) { list = []; local.set(key, list); }
      for (let k = 0; k < list.length; k += 2) if (list[k] === rz) { gi = list[k + 1]; break; }
      if (gi < 0) { gi = gW.length; list.push(rz, gi); gN.push(fn[o], fn[o + 1], fn[o + 2]); gW.push(0); }
      gW[gi] += cw[j]; grp[j] = gi;
    }
    gStart[c + 1] = gW.length;
  }
  // solve each group against the other groups in its cell
  const gRes = new Float64Array(gW.length * 3);
  for (let c = 0; c < nc; c++) {
    for (let gi = gStart[c], ge = gStart[c + 1]; gi < ge; gi++) {
      const nx = gN[gi * 3], ny = gN[gi * 3 + 1], nz = gN[gi * 3 + 2];
      let sx = 0, sy = 0, sz = 0;
      for (let gj = gStart[c]; gj < ge; gj++) {
        const ox = gN[gj * 3], oy = gN[gj * 3 + 1], oz = gN[gj * 3 + 2];
        if (nx * ox + ny * oy + nz * oz > creaseDot) { const w = gW[gj]; sx += ox * w; sy += oy * w; sz += oz * w; }
      }
      const l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      gRes[gi * 3] = sx / l; gRes[gi * 3 + 1] = sy / l; gRes[gi * 3 + 2] = sz / l;
    }
  }
  // each corner takes its face's group result in its cell
  const out = new Float32Array(nf * 9);
  for (let c = 0; c < nc; c++) for (let j = start[c], e = start[c + 1]; j < e; j++) {
    const f = cf[j], gi = grp[j];
    for (let k = 0; k < 3; k++) if (cellOf[f * 3 + k] === c) {
      const o = f * 9 + k * 3;
      out[o] = gRes[gi * 3]; out[o + 1] = gRes[gi * 3 + 1]; out[o + 2] = gRes[gi * 3 + 2];
    }
  }
  g.setAttribute('normal', new BufferAttribute(out, 3));
  return g;
}
