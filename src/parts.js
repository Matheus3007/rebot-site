// Part catalogue for the Rebot V3 STEP: materials, show-groups, spin axes and explode offsets.
// All coordinates are the CAD frame in mm (Z up, +X forward, wheels on the Y axis).

const base = (n) => n.replace(/#\d+$/, '');
const has = (n, ...keys) => keys.some((k) => n.startsWith(k));

const WEAPON_SET = ['GanchoUnidente', 'WeaponWheel', 'TangentialDrivenPulley', 'WeaponMainBearing', 'RolamentoAxial',
  'WeaponNeedleBearing', 'EixoArmaCabeca', 'hex_thin_nut', 'WeaponMotor', 'RatchetedWeaponDrivePulleyTangential'];
const STRUCT_SET = ['ChevronChassis', 'TopPannel', 'MotorHolderPannel', '1xV2BottomPannel', '6xAxisSupport', '6xDriveSupport',
  'AluminiumStandoff', 'WheelProtectionGood', 'MirrorWheelProtectionGood'];

function material(b) {
  if (has(b, 'ChevronChassis', 'WheelProtection', 'MirrorWheelProtection')) return 'tpu';
  if (has(b, 'Ratcheted')) return 'tpu2';
  if (has(b, 'TopPannel', 'MotorHolderPannel', '1xV2BottomPannel', '6xAxisSupport', '6xDriveSupport')) return 'carbon';
  if (has(b, 'AluminiumStandoff')) return 'alu';
  if (has(b, 'GanchoUnidente')) return 'hardox';
  if (has(b, 'WeaponWheel')) return 'vyta';
  if (has(b, 'TangentialDrivenPulley')) return 'anod';
  if (has(b, 'Rolamento', 'WeaponNeedle', 'WeaponMainBearing', 'DriveBearing')) return 'chrome';
  if (has(b, 'EixoArmaCabeca', 'hex_thin', 'socket_head', 'DriveNut')) return 'steel';
  if (has(b, 'WeaponMotor', 'invertediFlight')) return 'motor';
  if (has(b, 'RubberWheel')) return 'rubber';
  if (has(b, 'SimpleWheelHub')) return 'nylon';
  if (has(b, 'Battery')) return 'batt';
  return 'elec';
}

export const buildParts = {
  describe(name) {
    const b = base(name);
    const tags = [];
    if (WEAPON_SET.some((k) => b.startsWith(k))) tags.push('weapon');
    if (STRUCT_SET.some((k) => b.startsWith(k))) tags.push('struct');
    return { base: b, tags, mat: material(b) };
  },
};

// Tangential-drive geometry measured from the CAD (tools/prof*.py):
//   wheel axis x=-113.67 z=16, drive motor axis x=-79.08 z=15.9 -> 34.6 mm apart;
//   motor shaft R3.0 runs on the wheel rim at R31.6 -> 10.53 : 1.
//   weapon axis (-49.43, 0), weapon motor axis (-64.82, -42.29), both on Z.
export function spinOf(p) {
  const b = p.base, c = p.c, side = Math.sign(c.y);
  if (has(b, 'SimpleWheelHub', 'RubberWheel')) return { kind: 'wheel', side, axis: 'y', pivot: [-113.67, c.y, 16] };
  if (has(b, 'invertediFlight')) return { kind: 'dmotor', side, axis: 'y', pivot: [-79.08, c.y, 15.9] };
  if (has(b, 'GanchoUnidente', 'WeaponWheel', 'TangentialDrivenPulley')) return { kind: 'weapon', axis: 'z', pivot: [-49.428, 0, 0] };
  if (has(b, 'WeaponMotor', 'RatchetedWeaponDrivePulleyTangential')) return { kind: 'wmotor', axis: 'z', pivot: [-64.82, -42.29, 0] };
  return null;
}

const C = [-69.5, 0, 16];

export function offsets(p) {
  const b = p.base, c = p.c, s = Math.sign(c.y) || 1, ay = Math.abs(c.y);
  if (!p.tags.includes('module') && c.y < 0 && has(b, 'invertediFlight', 'SimpleWheelHub', 'RubberWheel')) p.tags.push('module');

  // r: drive explode (wheel stacks open along their axle, motors pull off the rim)
  let r;
  if (has(b, 'invertediFlight')) r = [52, s * -6, 0];
  else if (has(b, 'SimpleWheelHub')) r = [0, s * 8, 0];
  else if (has(b, 'RubberWheel')) r = [0, s * 62, 0];
  else if (has(b, 'DriveBearing')) r = ay > 124 ? [0, s * 96, 0] : [0, s * -34, 0];
  else if (has(b, 'socket_head')) r = [0, s * 150, 0];
  else if (has(b, 'DriveNut')) r = ay > 105 ? [0, s * -52, 0] : [0, s * -74, 0];
  else if (has(b, 'WheelProtection', 'MirrorWheelProtection')) r = [-30, s * 40, 50];
  else r = [(c.x - C[0]) * 0.9, c.y * 0.7, (c.z - C[2]) * 1.6 + 30];

  // v: vertical explode (weapon stack spread on its dead shaft)
  const VZ = {
    GanchoUnidente: -92, WeaponMainBearing: -66, TangentialDrivenPulley: -42, WeaponWheel: -16,
    WeaponNeedleBearing: -4, WeaponMotor: -16, RatchetedWeaponDrivePulleyTangential: -16, EixoArmaCabeca: 0,
    hex_thin_nut: 92, '6xAxisSupport': 70, TopPannel: 56, MotorHolderPannel: 60, '1xV2BottomPannel': -122,
    ChevronChassis: 30, AluminiumStandoff: 14,
  };
  let vz = null;
  for (const k in VZ) if (b.startsWith(k)) vz = VZ[k];
  if (has(b, 'RolamentoAxial')) vz = 14 + (c.z - 7.2) * 9;
  if (vz === null) vz = (c.z - C[2]) * 2.2 + 40;
  const v = [0, 0, vz];

  // s: structure explode (sandwich layers apart, unibody lifted clear)
  const SZ = { '1xV2BottomPannel': -78, AluminiumStandoff: 0, TopPannel: 62, MotorHolderPannel: 92, '6xAxisSupport': 120, ChevronChassis: 175 };
  let sz = 0; for (const k in SZ) if (b.startsWith(k)) sz = SZ[k];
  let sv = [0, 0, sz];
  if (has(b, '6xDriveSupport')) sv = [0, s * 58, 0];
  if (has(b, 'WheelProtection', 'MirrorWheelProtection')) sv = [-10, s * 60, 175];
  return { r, v, s: sv };
}
