import * as THREE from 'three';
import { nanoid } from 'nanoid';
import type { Pose, QuatFrame } from './mannequin';

export type DirKind = 'character' | 'prop' | 'camera';
export type PropShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'wall' | 'table' | 'chair' | 'door' | 'tree' | 'car';

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
};

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
  /** Camera: vertical field of view in degrees. */
  fov?: number;
}

export interface DirScene {
  objects: DirObject[];
  activeCamera: string | null;
  /** Frame of the camera view and screenshots, e.g. "16:9". */
  aspect: string;
  background: string;
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
  const scene: DirScene = { objects: [], activeCamera: null, aspect: '16:9', background: '#0b0c10' };
  const cam = newObject('camera', scene);
  scene.objects.push(cam);
  scene.objects.push(newObject('character', scene));
  scene.activeCamera = cam.id;
  return scene;
}

/** A prop as a unit-sized group standing on y = 0; the object's scale sizes it. */
export function buildProp(shape: PropShape, color: string): THREE.Group {
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
