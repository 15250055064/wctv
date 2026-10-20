import * as THREE from 'three';
import { FilesetResolver, PoseLandmarker, type Landmark } from '@mediapipe/tasks-vision';
import type { Joint, QuatFrame } from './mannequin';

// Video → MediaPipe pose (3D world landmarks, metres, hip-centred) → local joint rotations for
// the mannequin. MediaPipe's world axes are x right (image), y down, z away from the camera;
// with the subject facing the camera, that maps to the mannequin's +x left, +y up, +z forward.

let landmarker: PoseLandmarker | null = null;

async function getLandmarker() {
  if (landmarker) return landmarker;
  const files = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/mediapipe/pose_landmarker_full.task', delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  landmarker = await make('GPU').catch(() => make('CPU'));
  return landmarker;
}

const L = { nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lIdx: 19, rIdx: 20, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lToe: 31, rToe: 32 };

const v3 = (p: Landmark) => new THREE.Vector3(p.x, -p.y, -p.z);
const mid = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().add(b).multiplyScalar(0.5);
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);

/** Orientation whose +x follows `side` and +y follows `up` (orthonormalised). */
function basis(side: THREE.Vector3, up: THREE.Vector3) {
  const y = up.clone().normalize();
  const z = new THREE.Vector3().crossVectors(side, y).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Local rotation turning `rest` (in the parent's frame) toward world direction `dir`. */
function aim(parentWorld: THREE.Quaternion, rest: THREE.Vector3, dir: THREE.Vector3) {
  const local = dir.clone().normalize().applyQuaternion(parentWorld.clone().invert());
  return new THREE.Quaternion().setFromUnitVectors(rest, local);
}

const arr = (q: THREE.Quaternion): [number, number, number, number] => [q.x, q.y, q.z, q.w];

/** One frame of world landmarks → mannequin joint rotations. */
export function retarget(lm: Landmark[]): QuatFrame {
  const P = (i: number) => v3(lm[i]);
  const hipL = P(L.lHip);
  const hipR = P(L.rHip);
  const shL = P(L.lSh);
  const shR = P(L.rSh);
  const hipMid = mid(hipL, hipR);
  const shMid = mid(shL, shR);
  const torsoUp = shMid.clone().sub(hipMid);

  const hipsW = basis(hipL.clone().sub(hipR), torsoUp);
  const chestW = basis(shL.clone().sub(shR), torsoUp);
  const spineW = hipsW.clone().slerp(chestW, 0.5);
  const earMid = mid(P(L.lEar), P(L.rEar));
  const neckDir = earMid.clone().sub(shMid);
  const neckW = chestW.clone().multiply(aim(chestW, UP, neckDir));
  const headW = basis(P(L.lEar).sub(P(L.rEar)), neckDir);

  const f: QuatFrame = {};
  f.hips = arr(hipsW);
  f.spine = arr(hipsW.clone().invert().multiply(spineW));
  f.chest = arr(spineW.clone().invert().multiply(chestW));
  f.neck = arr(chestW.clone().invert().multiply(neckW));
  f.head = arr(neckW.clone().invert().multiply(headW));

  const chain = (parentW: THREE.Quaternion, pts: [number, number, number, number], names: [Joint, Joint, Joint], endRest: THREE.Vector3) => {
    const [a, b, c, d] = pts.map(P);
    const q1 = aim(parentW, DOWN, b.clone().sub(a));
    const w1 = parentW.clone().multiply(q1);
    const q2 = aim(w1, DOWN, c.clone().sub(b));
    const w2 = w1.clone().multiply(q2);
    const q3 = aim(w2, endRest, d.clone().sub(c));
    f[names[0]] = arr(q1);
    f[names[1]] = arr(q2);
    f[names[2]] = arr(q3);
  };
  chain(chestW, [L.lSh, L.lEl, L.lWr, L.lIdx], ['lUpperArm', 'lForearm', 'lHand'], DOWN);
  chain(chestW, [L.rSh, L.rEl, L.rWr, L.rIdx], ['rUpperArm', 'rForearm', 'rHand'], DOWN);
  chain(hipsW, [L.lHip, L.lKn, L.lAn, L.lToe], ['lThigh', 'lShin', 'lFoot'], FWD);
  chain(hipsW, [L.rHip, L.rKn, L.rAn, L.rToe], ['rThigh', 'rShin', 'rFoot'], FWD);

  // Lower the hips when the legs fold (sitting, crouching): compare hip height to leg length.
  const footY = Math.min(P(L.lAn).y, P(L.rAn).y);
  const hipHeight = hipMid.y - footY;
  f.hipsDrop = Math.max(0, Math.min(0.6, 0.86 - hipHeight));
  return f;
}

function smooth(prev: QuatFrame | undefined, next: QuatFrame, t: number): QuatFrame {
  if (!prev) return next;
  const out: QuatFrame = { hipsDrop: (prev.hipsDrop ?? 0) * (1 - t) + (next.hipsDrop ?? 0) * t };
  for (const k of Object.keys(next) as (keyof QuatFrame)[]) {
    if (k === 'hipsDrop') continue;
    const a = prev[k as Joint];
    const b = next[k as Joint];
    if (!a || !b) {
      out[k as Joint] = b;
      continue;
    }
    out[k as Joint] = arr(new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), t));
  }
  return out;
}

export interface CaptureResult {
  fps: number;
  frames: QuatFrame[];
  detected: number;
}

/** Steps through the video at `fps`, detecting the pose in each sampled frame. */
export async function captureMotion(url: string, onProgress: (p: number) => void, fps = 15, maxSeconds = 30): Promise<CaptureResult> {
  const lm = await getLandmarker();
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((ok, fail) => {
    video.onloadeddata = () => ok();
    video.onerror = () => fail(new Error('视频无法读取'));
  });
  const duration = Math.min(maxSeconds, Number.isFinite(video.duration) ? video.duration : maxSeconds);
  const total = Math.max(1, Math.floor(duration * fps));
  const frames: QuatFrame[] = [];
  let detected = 0;
  let last: QuatFrame | undefined;
  for (let i = 0; i < total; i++) {
    const t = i / fps;
    video.currentTime = t;
    await new Promise<void>((ok) => (video.onseeked = () => ok()));
    const res = lm.detectForVideo(video, Math.round(t * 1000) + 1);
    const world = res.worldLandmarks[0];
    if (world?.length) {
      detected++;
      last = smooth(last, retarget(world), 0.6);
    }
    if (last) frames.push(last);
    onProgress((i + 1) / total);
  }
  video.removeAttribute('src');
  video.load();
  if (!detected) throw new Error('没有在视频中识别到人物，请换一段人物全身清晰的视频');
  return { fps, frames, detected };
}
