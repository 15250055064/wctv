import * as THREE from 'three';
import { nanoid } from 'nanoid';
import { JOINTS, POSES, type Pose, type QuatFrame } from './mannequin';

export type DirKind = 'character' | 'prop' | 'camera';
export type PropShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'wall' | 'table' | 'chair' | 'door' | 'tree' | 'car' | 'custom';
export type Vec3 = [number, number, number];

/** One primitive of an AI-built model. Size is its bounding box in metres; position is its centre. */
export interface ModelPart {
  shape: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'capsule';
  size: Vec3;
  position: Vec3;
  rotation?: Vec3;
  color?: string;
}
export const PART_SHAPES: ModelPart['shape'][] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule'];

export type Ease = 'linear' | 'smooth' | 'hold';
export const EASE_LABEL: Record<Ease, string> = { linear: '匀速', smooth: '缓入缓出', hold: '定格' };

/** An object's animatable state at a moment; `ease` shapes the segment to the next key. */
export interface Keyframe {
  t: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  pose?: Pose;
  poseName?: string;
  fov?: number;
  ease?: Ease;
}

export const PROP_LABEL: Record<PropShape, string> = {
  box: '方块',
  sphere: '球体',
  cylinder: '圆柱',
  cone: '圆锥',
  wall: '墙面',
  table: '桌子',
  chair: '椅子',
  door: '门',
  tree: '树',
  car: '汽车',
  custom: 'AI 模型',
};
/** Shapes offered in the add menu (custom models come from AI). */
export const BASIC_SHAPES: PropShape[] = (Object.keys(PROP_LABEL) as PropShape[]).filter((k) => k !== 'custom');

export interface DirObject {
  id: string;
  kind: DirKind;
  name: string;
  /** Metres. */
  position: [number, number, number];
  /** Degrees. */
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  shape?: PropShape;
  /** Character: a preset name or custom joint rotations. */
  poseName?: string;
  pose?: Pose;
  /** Character: a captured motion clip and the frame shown. */
  motionId?: string;
  motionFrame?: number;
  /** Character: when the captured motion starts on the timeline (seconds). */
  motionStart?: number;
  /** Camera: vertical field of view in degrees. */
  fov?: number;
  /** Camera: keep aimed at this object. */
  target?: string;
  /** Prop with shape 'custom': its primitives. */
  parts?: ModelPart[];
  /** Keyframes, sorted by time; when present they drive the transform/pose/fov. */
  keys?: Keyframe[];
}

export interface DirScene {
  objects: DirObject[];
  activeCamera: string | null;
  /** Frame of the camera view and screenshots, e.g. "16:9". */
  aspect: string;
  background: string;
  /** Animation length in seconds. */
  duration?: number;
}

export interface MotionClip {
  id: string;
  name: string;
  fps: number;
  frames: QuatFrame[];
  sourceVideo?: string;
  createdAt: number;
}

export const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '2.39:1'];
export const aspectValue = (a: string) => {
  const [w, h] = a.split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
};

/** Euler degrees that make an object at `from` look at `to` (cameras look down their −z). */
export function lookAtRotation(from: [number, number, number], to: [number, number, number]): [number, number, number] {
  const o = new THREE.Object3D();
  o.position.set(...from);
  o.lookAt(new THREE.Vector3(...to));
  // Object3D.lookAt points +z at the target for non-cameras; turn it around for a camera.
  o.rotateY(Math.PI);
  const e = new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ');
  return [THREE.MathUtils.radToDeg(e.x), THREE.MathUtils.radToDeg(e.y), THREE.MathUtils.radToDeg(e.z)];
}

const COLORS = ['#4f8ef7', '#f7894f', '#5fc77a', '#c86ff2', '#f2c94c', '#ef5f7a'];

export function newObject(kind: DirKind, scene: DirScene, extra: Partial<DirObject> = {}): DirObject {
  const count = scene.objects.filter((o) => o.kind === kind).length;
  const base: DirObject = {
    id: nanoid(8),
    kind,
    name: kind === 'character' ? `角色${String.fromCharCode(65 + (count % 26))}` : kind === 'camera' ? `机位${count + 1}` : `${PROP_LABEL[extra.shape ?? 'box']}${count + 1}`,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: COLORS[count % COLORS.length],
  };
  if (kind === 'character') return { ...base, poseName: '站立', position: [count * 0.8 - 0.0, 0, 0], ...extra };
  if (kind === 'camera') {
    const pos: [number, number, number] = [count * 1.5, 1.6, 5];
    return { ...base, color: '#9aa4b2', fov: 40, position: pos, rotation: lookAtRotation(pos, [0, 1.1, 0]), ...extra };
  }
  return { ...base, shape: 'box', color: '#8a8f99', position: [1.5, 0, 0], ...extra };
}

export function newScene(): DirScene {
  const scene: DirScene = { objects: [], activeCamera: null, aspect: '16:9', background: '#0b0c10', duration: 5 };
  const cam = newObject('camera', scene);
  scene.objects.push(cam);
  scene.objects.push(newObject('character', scene));
  scene.activeCamera = cam.id;
  return scene;
}

/** A prop as a unit-sized group standing on y = 0; the object's scale sizes it. */
export function buildProp(shape: PropShape, color: string, parts: ModelPart[] = []): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.6), roughness: 0.8 });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, m: THREE.Material = mat) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  switch (shape) {
    case 'sphere':
      add(new THREE.SphereGeometry(0.5, 24, 16), 0, 0.5, 0);
      break;
    case 'cylinder':
      add(new THREE.CylinderGeometry(0.5, 0.5, 1, 24), 0, 0.5, 0);
      break;
    case 'cone':
      add(new THREE.ConeGeometry(0.5, 1, 24), 0, 0.5, 0);
      break;
    case 'wall':
      add(new THREE.BoxGeometry(4, 2.6, 0.12), 0, 1.3, 0);
      break;
    case 'table':
      add(new THREE.BoxGeometry(1.4, 0.06, 0.8), 0, 0.74, 0);
      for (const [x, z] of [
        [0.62, 0.32],
        [-0.62, 0.32],
        [0.62, -0.32],
        [-0.62, -0.32],
      ])
        add(new THREE.BoxGeometry(0.06, 0.72, 0.06), x, 0.36, z, dark);
      break;
    case 'chair':
      add(new THREE.BoxGeometry(0.46, 0.05, 0.46), 0, 0.45, 0);
      add(new THREE.BoxGeometry(0.46, 0.5, 0.05), 0, 0.72, -0.21);
      for (const [x, z] of [
        [0.2, 0.2],
        [-0.2, 0.2],
        [0.2, -0.2],
        [-0.2, -0.2],
      ])
        add(new THREE.BoxGeometry(0.04, 0.45, 0.04), x, 0.225, z, dark);
      break;
    case 'door':
      add(new THREE.BoxGeometry(0.95, 2.1, 0.06), 0, 1.05, 0);
      add(new THREE.SphereGeometry(0.035, 10, 8), 0.38, 1.0, 0.05, dark);
      break;
    case 'tree':
      add(new THREE.CylinderGeometry(0.12, 0.16, 1.4, 12), 0, 0.7, 0, new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.9 }));
      add(new THREE.ConeGeometry(0.9, 2.2, 16), 0, 2.4, 0);
      break;
    case 'car':
      add(new THREE.BoxGeometry(1.8, 0.55, 4.2), 0, 0.55, 0);
      add(new THREE.BoxGeometry(1.6, 0.5, 2.2), 0, 1.05, -0.2, dark);
      for (const [x, z] of [
        [0.85, 1.3],
        [-0.85, 1.3],
        [0.85, -1.3],
        [-0.85, -1.3],
      ])
        add(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 18).rotateZ(Math.PI / 2), x, 0.34, z, new THREE.MeshStandardMaterial({ color: '#1b1d22' }));
      break;
    case 'custom':
      for (const p of parts) {
        const geo =
          p.shape === 'sphere'
            ? new THREE.SphereGeometry(0.5, 20, 14)
            : p.shape === 'cylinder'
              ? new THREE.CylinderGeometry(0.5, 0.5, 1, 20)
              : p.shape === 'cone'
                ? new THREE.ConeGeometry(0.5, 1, 20)
                : p.shape === 'torus'
                  ? new THREE.TorusGeometry(0.4, 0.1, 12, 28)
                  : p.shape === 'capsule'
                    ? new THREE.CapsuleGeometry(0.25, 0.5, 6, 14)
                    : new THREE.BoxGeometry(1, 1, 1);
        const sc = p.shape === 'capsule' ? [p.size[0] * 2, p.size[1], p.size[2] * 2] : p.size;
        const m = add(geo, ...p.position, p.color ? new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.7 }) : mat);
        m.scale.set(Math.max(0.001, sc[0]), Math.max(0.001, sc[1]), Math.max(0.001, sc[2]));
        if (p.rotation) m.rotation.set(...(p.rotation.map((d) => THREE.MathUtils.degToRad(d)) as Vec3));
      }
      break;
    default:
      add(new THREE.BoxGeometry(1, 1, 1), 0, 0.5, 0);
  }
  return g;
}

/** A small film-camera model; its lens looks down −z like a THREE camera. */
export function buildCameraModel(color: string): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.3), mat);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.14, 16).rotateX(Math.PI / 2), mat);
  lens.position.z = -0.21;
  g.add(body, lens);
  return g;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export interface ObjState {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  pose?: Pose;
  fov?: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lv = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function lerpPose(a: Pose | undefined, b: Pose | undefined, t: number): Pose {
  const joints: Pose['joints'] = {};
  for (const j of JOINTS) joints[j] = lv(a?.joints[j] ?? [0, 0, 0], b?.joints[j] ?? [0, 0, 0], t);
  return { joints, hipsDrop: lerp(a?.hipsDrop ?? 0, b?.hipsDrop ?? 0, t) };
}

/** The un-animated state stored on the object itself. */
export function baseState(o: DirObject): ObjState {
  return {
    position: o.position,
    rotation: o.rotation,
    scale: o.scale,
    pose: o.kind === 'character' ? (o.pose ?? POSES[o.poseName ?? '站立']) : undefined,
    fov: o.fov,
  };
}

const keyState = (k: Keyframe, base: ObjState): ObjState => ({ position: k.position, rotation: k.rotation, scale: k.scale, pose: k.pose ?? base.pose, fov: k.fov ?? base.fov });

/** The object's state at time t (camera targets are resolved separately in sceneStates). */
export function evaluate(o: DirObject, t: number): ObjState {
  const base = baseState(o);
  const ks = o.keys;
  if (!ks?.length) return base;
  if (t <= ks[0].t) return keyState(ks[0], base);
  const last = ks[ks.length - 1];
  if (t >= last.t) return keyState(last, base);
  let i = 0;
  while (i < ks.length - 2 && ks[i + 1].t <= t) i++;
  const a = ks[i];
  const b = ks[i + 1];
  let u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  if (a.ease === 'hold') u = 0;
  else if (a.ease === 'smooth') u = u * u * (3 - 2 * u);
  const sa = keyState(a, base);
  const sb = keyState(b, base);
  return {
    position: lv(sa.position, sb.position, u),
    rotation: lv(sa.rotation, sb.rotation, u),
    scale: lv(sa.scale, sb.scale, u),
    pose: o.kind === 'character' ? lerpPose(sa.pose, sb.pose, u) : undefined,
    fov: lerp(sa.fov ?? 40, sb.fov ?? 40, u),
  };
}

/** The point a camera aims at on an object: a character's face, a prop's middle. */
export function aimPoint(o: DirObject, st: ObjState): Vec3 {
  const h = o.kind === 'character' ? 1.5 * st.scale[1] - (st.pose?.hipsDrop ?? 0) : 0.5 * st.scale[1];
  return [st.position[0], st.position[1] + h, st.position[2]];
}

/** Every object's state at time t, with cameras turned toward their targets. */
export function sceneStates(scene: DirScene, t: number): Map<string, ObjState> {
  const out = new Map<string, ObjState>();
  for (const o of scene.objects) out.set(o.id, evaluate(o, t));
  for (const o of scene.objects) {
    if (o.kind !== 'camera' || !o.target) continue;
    const tg = scene.objects.find((x) => x.id === o.target);
    const st = out.get(o.id)!;
    if (tg && tg.id !== o.id) out.set(o.id, { ...st, rotation: lookAtRotation(st.position, aimPoint(tg, out.get(tg.id)!)) });
  }
  return out;
}

const KEY_EPS = 0.02;

/**
 * Writes `patch` into a key at time t (merging with a key already there). An object's first
 * key made later than 0 s also gets a key at 0 s holding its old state, so it moves from there.
 */
export function upsertKey(o: DirObject, t: number, patch: Partial<Omit<Keyframe, 't'>>): DirObject {
  const keys = [...(o.keys ?? [])];
  const cur = evaluate(o, t);
  if (!keys.length && t > KEY_EPS) {
    const b = baseState(o);
    keys.push({ t: 0, position: b.position, rotation: b.rotation, scale: b.scale, pose: b.pose, poseName: o.poseName, fov: b.fov });
  }
  const i = keys.findIndex((k) => Math.abs(k.t - t) < KEY_EPS);
  const key: Keyframe = i >= 0 ? { ...keys[i], ...patch } : { t, position: cur.position, rotation: cur.rotation, scale: cur.scale, pose: cur.pose, fov: cur.fov, ...patch };
  if (i >= 0) keys[i] = key;
  else keys.push(key);
  keys.sort((a, b) => a.t - b.t);
  return { ...o, keys };
}

export const keyAt = (o: DirObject, t: number) => o.keys?.find((k) => Math.abs(k.t - t) < KEY_EPS);

export function removeKeyAt(o: DirObject, t: number): DirObject {
  const keys = (o.keys ?? []).filter((k) => Math.abs(k.t - t) >= KEY_EPS);
  if (keys.length) return { ...o, keys };
  // Last key gone: the object keeps the pose it had there.
  const st = evaluate(o, t);
  return { ...o, keys: undefined, position: st.position, rotation: st.rotation, scale: st.scale, ...(st.pose ? { pose: st.pose } : {}), ...(st.fov ? { fov: st.fov } : {}) };
}

/** Which captured-motion frame a character shows at time t (held before start / after end). */
export function motionFrameAt(o: DirObject, clip: MotionClip, t: number) {
  const i = Math.floor((t - (o.motionStart ?? 0)) * clip.fps);
  return Math.max(0, Math.min(clip.frames.length - 1, i));
}
