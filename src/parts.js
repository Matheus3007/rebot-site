// Part catalogue for the Rebot V3 STEP: materials, show-groups, spin axes and explode offsets.
// All coordinates are the CAD frame in mm (Z up, +X forward, wheels on the Y axis).

const base = (n) => n.replace(/#\d+$/, '');
const has = (n, ...keys) => keys.some((k) => n.startsWith(k));

const WEAPON_SET = ['GanchoUnidente', 'WeaponWheel', 'TangentialDrivenPulley', 'WeaponMainBearing', 'RolamentoAxial',
  'WeaponNeedleBearing', 'EixoArmaCabeca', 'hex_thin_nut', 'WeaponMotor', 'RatchetedWeaponDrivePulleyTangential'];
const STRUCT_SET = ['ChevronChassis', 'TopPannel', 'MotorHolderPannel', '1xV2BottomPannel', '6xAxisSupport', '6xDriveSupport',
  'AluminiumStandoff', 'WheelProtectionGood', 'MirrorWheelProtectionGood'];
// one drive module: wheel, rim, motor, carbon side plate, side armour, axle bolt (+ its bearings and nuts)
const MODULE_SET = ['invertediFlight', 'SimpleWheelHub', 'RubberWheel', '6xDriveSupport', 'WheelProtectionGood', 'socket_head',
  'DriveBearing', 'DriveNut'];

function material(b) {
  if (has(b, 'ChevronChassis')) return 'body';
  if (has(b, 'WheelProtection', 'MirrorWheelProtection')) return 'tpu';
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
  if (has(b, 'SimpleWheelHub')) return 'rim';
  if (has(b, 'Battery')) return 'batt';
  return 'elec';
}

export const buildParts = {
  describe(name, c) {
    const b = base(name);
    const tags = [];
    if (WEAPON_SET.some((k) => b.startsWith(k))) tags.push('weapon');
    if (STRUCT_SET.some((k) => b.startsWith(k))) tags.push('struct');
    if (c.y < 0 && MODULE_SET.some((k) => b.startsWith(k))) tags.push('module');
    return { base: b, tags, mat: material(b) };
  },
};

// Motors are single solids in the STEP; split each into the spinning rotor (bell + shaft) and the mount
// that stays bolted to its plate. Profiles measured in tools/prof*.py.
export function rotorTest(b) {
  // drive 2207, axis Y at x=-79.08 z=15.9: bell |y|<102.3, shaft (R3) past the plate |y|>108.3
  if (has(b, 'invertediFlight')) return (x, y, z) => Math.abs(y) < 102.3 || (Math.abs(y) > 108.3 && Math.hypot(x + 79.08, z - 15.9) < 3.3);
  // weapon 2814, axis Z at (-64.82, -42.29): bell below z=29, shaft R2.5
  if (has(b, 'WeaponMotor')) return (x, y, z) => z < 29 || Math.hypot(x + 64.82, y + 42.29) < 2.7;
  return null;
}

// Tangential-drive geometry measured from the CAD:
//   wheel axis x=-113.67 z=16, drive motor axis x=-79.08 z=15.9 -> 34.6 mm apart;
//   motor shaft R3.0 runs on the wheel rim at R31.6 -> 10.53 : 1.
//   weapon axis (-49.43, 0), weapon motor axis (-64.82, -42.29), both on Z.
export function spinOf(p) {
  const b = p.base, c = p.c, side = Math.sign(c.y);
  if (has(b, 'SimpleWheelHub', 'RubberWheel')) return { kind: 'wheel', side, axis: 'y', pivot: [-113.67, c.y, 16] };
  if (has(b, 'invertediFlight') && p.sub === 'rotor') return { kind: 'dmotor', side, axis: 'y', pivot: [-79.08, c.y, 15.9] };
  if (has(b, 'GanchoUnidente', 'WeaponWheel', 'TangentialDrivenPulley')) return { kind: 'weapon', axis: 'z', pivot: [-49.428, 0, 0] };
  if ((has(b, 'WeaponMotor') && p.sub === 'rotor') || has(b, 'RatchetedWeaponDrivePulleyTangential')) return { kind: 'wmotor', axis: 'z', pivot: [-64.82, -42.29, 0] };
  return null;
}

const C = [-69.5, 0, 16];

export function offsets(p) {
  const b = p.base, c = p.c, s = Math.sign(c.y) || 1, ay = Math.abs(c.y);

  // r: drive explode. The tangential pair (motor, wheel, rim) and the carbon side plate stay assembled;
  // the side armour and the axle bolt come off. Everything else spreads out and fades.
  let r;
  if (has(b, 'invertediFlight', 'SimpleWheelHub', 'RubberWheel', '6xDriveSupport', 'DriveBearing')) r = [0, 0, 0];
  else if (has(b, 'WheelProtection', 'MirrorWheelProtection')) r = [-6, s * 58, 16];
  else if (has(b, 'socket_head')) r = [0, s * 128, 0];
  else if (has(b, 'DriveNut')) r = ay < 105 ? [0, s * -34, 0] : [0, 0, 0];
  else r = [(c.x - C[0]) * 0.9, c.y * 0.7, (c.z - C[2]) * 1.6 + 30];

  // v: vertical explode (weapon stack spread along its dead shaft; the VytaFlex wheel and its
  // bolted hub stay together, level with the ratchet on the motor)
  const VZ = {
    GanchoUnidente: -80, WeaponMainBearing: -50, TangentialDrivenPulley: -16, WeaponWheel: -16,
    WeaponNeedleBearing: -16, WeaponMotor: -16, RatchetedWeaponDrivePulleyTangential: -16, EixoArmaCabeca: -40,
    hex_thin_nut: 58, '6xAxisSupport': 70, TopPannel: 56, MotorHolderPannel: 60, '1xV2BottomPannel': -122,
    ChevronChassis: 30, AluminiumStandoff: 14,
  };
  let vz = null;
  for (const k in VZ) if (b.startsWith(k)) vz = VZ[k];
  if (has(b, 'RolamentoAxial')) vz = 8 + (c.z - 7.2) * 7;
  if (vz === null) vz = (c.z - C[2]) * 2.2 + 40;
  const v = [0, 0, vz];

  // s: structure explode, bottom to top: bottom carbon, TPU unibody (side plates and armour level with it),
  // standoffs, top carbon
  const SZ = { '1xV2BottomPannel': -55, ChevronChassis: 0, AluminiumStandoff: 58, TopPannel: 96, MotorHolderPannel: 96, '6xAxisSupport': 96 };
  let sz = 0; for (const k in SZ) if (b.startsWith(k)) sz = SZ[k];
  let sv = [0, 0, sz];
  if (has(b, '6xDriveSupport')) sv = [0, s * 26, 0];
  if (has(b, 'WheelProtection', 'MirrorWheelProtection')) sv = [0, s * 44, 0];
  return { r, v, s: sv };
}
