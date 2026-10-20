import * as THREE from 'three';

// An articulated wooden-artist-style mannequin built from primitives. Units are metres; it
// stands on y = 0 and faces +z. Every joint is an Object3D pivot whose local rotation poses it.

export const JOINTS = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'lUpperArm',
  'lForearm',
  'lHand',
  'rUpperArm',
  'rForearm',
  'rHand',
  'lThigh',
  'lShin',
  'lFoot',
  'rThigh',
  'rShin',
  'rFoot',
] as const;
export type Joint = (typeof JOINTS)[number];

export const JOINT_LABEL: Record<Joint, string> = {
  hips: '骨盆',
  spine: '腰',
  chest: '胸',
  neck: '颈',
  head: '头',
  lUpperArm: '左上臂',
  lForearm: '左前臂',
  lHand: '左手',
  rUpperArm: '右上臂',
  rForearm: '右前臂',
  rHand: '右手',
  lThigh: '左大腿',
  lShin: '左小腿',
  lFoot: '左脚',
  rThigh: '右大腿',
  rShin: '右小腿',
  rFoot: '右脚',
};

/** Joint rotations in degrees (x, y, z) plus an optional vertical hip offset in metres. */
export interface Pose {
  joints: Partial<Record<Joint, [number, number, number]>>;
  hipsDrop?: number;
}

export interface Rig {
  root: THREE.Group;
  joints: Record<Joint, THREE.Object3D>;
  material: THREE.MeshStandardMaterial;
}

const HIPS_Y = 0.95;

function part(geo: THREE.BufferGeometry, mat: THREE.Material, y = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

/** A limb segment of `len` hanging down (−y) from its joint, with a ball at the joint. */
function limb(mat: THREE.Material, len: number, r: number) {
  const g = new THREE.Group();
  g.add(part(new THREE.CapsuleGeometry(r, len - 2 * r, 6, 12), mat, -len / 2));
  g.add(part(new THREE.SphereGeometry(r * 1.15, 14, 10), mat));
  return g;
}

export function buildMannequin(color = '#4f8ef7'): Rig {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
  const root = new THREE.Group();
  const j = {} as Record<Joint, THREE.Object3D>;
  const pivot = (name: Joint, parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    o.rotation.order = 'YXZ';
    parent.add(o);
    j[name] = o;
    return o;
  };

  const hips = pivot('hips', root, 0, HIPS_Y);
  hips.add(part(new THREE.SphereGeometry(0.13, 16, 12).scale(1.15, 0.75, 0.8), mat, -0.02));
  const spine = pivot('spine', hips, 0, 0.06);
  spine.add(part(new THREE.CapsuleGeometry(0.09, 0.12, 6, 12), mat, 0.1));
  const chest = pivot('chest', spine, 0, 0.2);
  chest.add(part(new THREE.SphereGeometry(0.16, 18, 14).scale(1.1, 1.05, 0.75), mat, 0.12));
  const neck = pivot('neck', chest, 0, 0.26);
  neck.add(part(new THREE.CapsuleGeometry(0.04, 0.05, 4, 10), mat, 0.04));
  const head = pivot('head', neck, 0, 0.09);
  head.add(part(new THREE.SphereGeometry(0.1, 20, 16).scale(0.9, 1.15, 0.95), mat, 0.1));
  // A small nose so the facing direction reads in screenshots.
  head.add(part(new THREE.ConeGeometry(0.018, 0.04, 8).rotateX(Math.PI / 2), mat, 0.1).translateZ(0.095));

  for (const side of [1, -1] as const) {
    const s = side === 1 ? 'l' : 'r';
    const upper = pivot(`${s}UpperArm` as Joint, chest, 0.2 * side, 0.2);
    upper.add(limb(mat, 0.28, 0.045));
    const fore = pivot(`${s}Forearm` as Joint, upper, 0, -0.28);
    fore.add(limb(mat, 0.25, 0.038));
    const hand = pivot(`${s}Hand` as Joint, fore, 0, -0.25);
    hand.add(part(new THREE.SphereGeometry(0.05, 12, 10).scale(0.8, 1.2, 0.5), mat, -0.05));

    const thigh = pivot(`${s}Thigh` as Joint, hips, 0.1 * side, -0.06);
    thigh.add(limb(mat, 0.42, 0.065));
    const shin = pivot(`${s}Shin` as Joint, thigh, 0, -0.42);
    shin.add(limb(mat, 0.41, 0.05));
    const foot = pivot(`${s}Foot` as Joint, shin, 0, -0.41);
    foot.add(part(new THREE.BoxGeometry(0.09, 0.06, 0.22), mat, -0.03).translateZ(0.06));
  }
  return { root, joints: j, material: mat };
}

const D = THREE.MathUtils.degToRad;

export function applyPose(rig: Rig, pose: Pose | undefined) {
  for (const name of JOINTS) {
    const r = pose?.joints[name] ?? [0, 0, 0];
    rig.joints[name].rotation.set(D(r[0]), D(r[1]), D(r[2]));
  }
  rig.joints.hips.position.y = HIPS_Y - (pose?.hipsDrop ?? 0);
}

/** Local joint rotations as quaternions [x, y, z, w], for motion-capture frames. */
export type QuatFrame = Partial<Record<Joint, [number, number, number, number]>> & { hipsDrop?: number };

export function applyQuatFrame(rig: Rig, frame: QuatFrame) {
  for (const name of JOINTS) {
    const q = frame[name];
    if (q) rig.joints[name].quaternion.set(q[0], q[1], q[2], q[3]);
    else rig.joints[name].quaternion.identity();
  }
  rig.joints.hips.position.y = HIPS_Y - (frame.hipsDrop ?? 0);
}

// Signs: for bones hanging down (limbs), −x swings them forward (+z) and +z swings the left
// side out; for bones pointing up (spine, neck, head), +x bends forward.
export const POSES: Record<string, Pose> = {
  站立: { joints: { lUpperArm: [0, 0, 6], rUpperArm: [0, 0, -6] } },
  T字: { joints: { lUpperArm: [0, 0, 90], rUpperArm: [0, 0, -90] } },
  行走: {
    joints: {
      lThigh: [-25, 0, 0],
      lShin: [10, 0, 0],
      rThigh: [20, 0, 0],
      rShin: [25, 0, 0],
      lUpperArm: [20, 0, 6],
      rUpperArm: [-22, 0, -6],
      lForearm: [-10, 0, 0],
      rForearm: [-25, 0, 0],
    },
  },
  奔跑: {
    hipsDrop: 0.05,
    joints: {
      spine: [12, 0, 0],
      lThigh: [-55, 0, 0],
      lShin: [45, 0, 0],
      rThigh: [30, 0, 0],
      rShin: [80, 0, 0],
      lUpperArm: [45, 0, 8],
      rUpperArm: [-50, 0, -8],
      lForearm: [-80, 0, 0],
      rForearm: [-85, 0, 0],
    },
  },
  坐下: {
    hipsDrop: 0.45,
    joints: { lThigh: [-90, 0, 4], rThigh: [-90, 0, -4], lShin: [90, 0, 0], rShin: [90, 0, 0], lUpperArm: [-15, 0, 6], rUpperArm: [-15, 0, -6], lForearm: [-50, 0, 0], rForearm: [-50, 0, 0] },
  },
  蹲下: {
    hipsDrop: 0.5,
    joints: { spine: [25, 0, 0], lThigh: [-110, 0, 8], rThigh: [-110, 0, -8], lShin: [135, 0, 0], rShin: [135, 0, 0], lFoot: [-25, 0, 0], rFoot: [-25, 0, 0], lUpperArm: [-40, 0, 10], rUpperArm: [-40, 0, -10], lForearm: [-40, 0, 0], rForearm: [-40, 0, 0] },
  },
  挥手: { joints: { lUpperArm: [0, 0, 6], rUpperArm: [0, 0, -150], rForearm: [0, 0, -25], head: [0, -10, 0] } },
  指向前方: { joints: { lUpperArm: [0, 0, 6], rUpperArm: [-90, 0, -5], head: [0, -5, 0] } },
  双手叉腰: { joints: { lUpperArm: [0, 0, 40], rUpperArm: [0, 0, -40], lForearm: [0, 0, -100], rForearm: [0, 0, 100] } },
  思考: { joints: { head: [12, 10, 0], lUpperArm: [-20, 0, 8], lForearm: [-80, 40, 0], rUpperArm: [-25, 0, -5], rForearm: [-135, 0, 0] } },
  举双手: { joints: { lUpperArm: [0, 0, 165], rUpperArm: [0, 0, -165], head: [-15, 0, 0] } },
  拥抱: { joints: { lUpperArm: [-70, 0, 30], rUpperArm: [-70, 0, -30], lForearm: [0, 0, -70], rForearm: [0, 0, 70] } },
  跳跃: {
    hipsDrop: -0.25,
    joints: { lThigh: [-50, 0, 0], lShin: [90, 0, 0], rThigh: [-20, 0, 0], rShin: [60, 0, 0], lUpperArm: [0, 0, 150], rUpperArm: [0, 0, -150] },
  },
};

/** The same pose with left and right swapped (for alternating steps). */
export function mirrorPose(p: Pose): Pose {
  const joints: Pose['joints'] = {};
  for (const [name, r] of Object.entries(p.joints) as [Joint, [number, number, number]][]) {
    const m = /^([lr])([A-Z]\w*)$/.exec(name);
    const other = (m ? (m[1] === 'l' ? 'r' : 'l') + m[2] : name) as Joint;
    joints[other] = [r[0], -r[1], -r[2]];
  }
  return { hipsDrop: p.hipsDrop, joints };
}
POSES['行走·换脚'] = mirrorPose(POSES['行走']);
POSES['奔跑·换脚'] = mirrorPose(POSES['奔跑']);

export const POSE_NAMES = Object.keys(POSES);
