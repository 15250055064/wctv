import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { nanoid } from 'nanoid';
import { useShallow } from 'zustand/react/shallow';
import { MODELS } from '../canvas/config';
import { canvasJpeg, encodeFrames } from '../canvas/frames';
import { Icon } from '../canvas/Icon';
import { useLibrary } from '../canvas/library';
import { getMediaUrl, putMedia } from '../canvas/media';
import { generateText } from '../canvas/provider';
import { absPos, currentOutput, sizeOf, useCanvas } from '../canvas/store';
import { useUI } from '../canvas/ui';
import type { CanvasNode, MediaRef } from '../canvas/types';
import { JOINTS, JOINT_LABEL, POSES, POSE_NAMES, applyPose, applyQuatFrame, buildMannequin, type Joint, type Pose, type Rig } from './mannequin';
import {
  ASPECTS,
  BASIC_SHAPES,
  EASE_LABEL,
  PART_SHAPES,
  PROP_LABEL,
  aspectValue,
  buildCameraModel,
  buildProp,
  evaluate,
  keyAt,
  lookAtRotation,
  motionFrameAt,
  newObject,
  newScene,
  removeKeyAt,
  sceneStates,
  upsertKey,
  type DirObject,
  type DirScene,
  type Ease,
  type Keyframe,
  type ModelPart,
  type MotionClip,
  type PropShape,
  type Vec3,
} from './scene';

const R = THREE.MathUtils.degToRad;
const DEG = THREE.MathUtils.radToDeg;
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const FPS = 24;

interface Entry {
  root: THREE.Group;
  sig: string;
  rig?: Rig;
  cam?: THREE.PerspectiveCamera;
  label?: THREE.Sprite;
}

interface Three {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orbit: OrbitControls;
  transform: TransformControls;
  helper: THREE.Object3D;
  grid: THREE.Object3D;
  entries: Map<string, Entry>;
}

function textSprite(text: string) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = '600 44px -apple-system, "PingFang SC", sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  c.width = w;
  c.height = 72;
  ctx.font = '600 44px -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 72, 16);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 18, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Constant on-screen size, so labels stay readable far away and don't swamp the view up close.
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  s.scale.set((0.032 * w) / 72, 0.032, 1);
  s.renderOrder = 10;
  return s;
}

/** Rebuild key: anything that needs new meshes rather than an update. */
const sigOf = (o: DirObject) => `${o.kind}|${o.shape ?? ''}|${o.kind === 'prop' ? o.color : ''}|${o.name}|${o.parts ? JSON.stringify(o.parts) : ''}`;

/** Puts every object where it is at `time` (the one being dragged by the gizmo is left alone). */
function applyScene(t3: Three, d: DirScene, motions: MotionClip[], time: number) {
  const states = sceneStates(d, time);
  const dragged = t3.transform.dragging ? t3.transform.object : null;
  for (const o of d.objects) {
    const en = t3.entries.get(o.id);
    const st = states.get(o.id);
    if (!en || !st) continue;
    if (en.root !== dragged) {
      en.root.position.set(...st.position);
      en.root.rotation.set(R(st.rotation[0]), R(st.rotation[1]), R(st.rotation[2]));
      if (o.kind !== 'camera') en.root.scale.set(...st.scale);
    }
    if (en.rig) {
      en.rig.material.color.set(o.color);
      const clip = o.motionId ? motions.find((m) => m.id === o.motionId) : undefined;
      if (clip?.frames.length) applyQuatFrame(en.rig, clip.frames[motionFrameAt(o, clip, time)]);
      else applyPose(en.rig, st.pose);
    }
    if (en.cam) {
      const f = st.fov ?? 40;
      if (en.cam.fov !== f) {
        en.cam.fov = f;
        en.cam.updateProjectionMatrix();
      }
    }
  }
}

/** First JSON object in an AI reply. */
function parseJson<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 没有返回可用的数据');
  return JSON.parse(text.slice(start, end + 1)) as T;
}
const isVec = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(Number(x)));
const vec = (v: unknown, d: Vec3): Vec3 => (isVec(v) ? [Number(v[0]), Number(v[1]), Number(v[2])] : d);
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const isEase = (e: unknown): e is Ease => e === 'linear' || e === 'smooth' || e === 'hold';

function cleanParts(raw: unknown): ModelPart[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p === 'object')
    .slice(0, 80)
    .map((p) => ({
      shape: PART_SHAPES.includes(p.shape) ? p.shape : 'box',
      size: vec(p.size, [0.3, 0.3, 0.3]).map((x) => Math.max(0.005, Math.abs(x))) as Vec3,
      position: vec(p.position, [0, 0.15, 0]),
      ...(isVec(p.rotation) ? { rotation: vec(p.rotation, [0, 0, 0]) } : {}),
      ...(isColor(p.color) ? { color: p.color } : {}),
    }));
}

type AiMode = 'scene' | 'anim' | 'model';
const AI_MODES: [AiMode, string, string][] = [
  ['scene', '搭场景', '描述想要搭建的场景，例如：两个人在咖啡馆窗边对坐，低角度中景'],
  ['anim', '生成动画', '描述动作和运镜，例如：角色A从左走到桌边坐下，镜头缓慢推近到特写'],
  ['model', '生成模型', '描述要建的模型，例如：一辆复古红色自行车 / 带遮阳伞的咖啡摊'],
];

export function DirectorEditor() {
  const { directorFor, set, notify } = useUI(useShallow((s) => ({ directorFor: s.directorFor, set: s.set, notify: s.notify })));
  const node = useCanvas((s) => (directorFor ? s.nodes.find((n) => n.id === directorFor) : undefined));
  if (!directorFor || !node) return null;
  return <Editor key={node.id} node={node} close={() => set({ directorFor: null })} notify={notify} />;
}

function Editor({ node, close, notify }: { node: CanvasNode; close: () => void; notify: (m: string) => void }) {
  const [dir, setDir] = useState<DirScene>(() => structuredClone(node.data.scene ?? newScene()));
  const [selected, setSelected] = useState<string | null>(() => dir.objects.find((o) => o.kind === 'character')?.id ?? null);
  const [view, setView] = useState<'director' | 'camera'>('director');
  const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [tab, setTab] = useState<'props' | 'pose'>('props');
  const [q, setQ] = useState('');
  const [joint, setJoint] = useState<Joint>('rUpperArm');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [autoKey, setAutoKey] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode>('scene');
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [engine, setEngine] = useState('chatgpt');
  const [shotBusy, setShotBusy] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null);
  const [mocapBusy, setMocapBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const motions = useLibrary((s) => s.motions);
  const videoKey = useCanvas((s) =>
    s.nodes
      .filter((n) => currentOutput(n.data)?.media?.kind === 'video')
      .map((n) => `${n.id}\u0000${n.data.title}`)
      .join('\u0001'),
  );
  const videoNodes = useMemo(() => (videoKey ? videoKey.split('\u0001').map((x) => ({ id: x.split('\u0000')[0], title: x.split('\u0000')[1] })) : []), [videoKey]);

  const host = useRef<HTMLDivElement>(null);
  const three = useRef<Three | null>(null);
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const viewRef = useRef(view);
  viewRef.current = view;
  const motionsRef = useRef(motions);
  motionsRef.current = motions;
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  playingRef.current = playing;
  const autoKeyRef = useRef(autoKey);
  autoKeyRef.current = autoKey;
  const fileRef = useRef<HTMLInputElement>(null);

  const duration = dir.duration ?? 5;
  const sel = dir.objects.find((o) => o.id === selected);
  const update = (id: string, patch: Partial<DirObject>) => setDir((d) => ({ ...d, objects: d.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));

  /**
   * Changes to the animatable state. Objects with keyframes (or any object while auto-key is
   * on) record the change as a key at the playhead; others just change.
   */
  const edit = (id: string, patch: Partial<Omit<Keyframe, 't'>>) =>
    setDir((d) => ({
      ...d,
      objects: d.objects.map((o) => {
        if (o.id !== id) return o;
        if (o.keys?.length || autoKeyRef.current) return upsertKey(o, timeRef.current, patch);
        const { pose, poseName, ...rest } = patch;
        return { ...o, ...rest, ...(pose ? { pose } : {}), ...(poseName ? { poseName } : {}) };
      }),
    }));

  const seek = (t: number) => {
    const v = Math.max(0, Math.min(duration, t));
    timeRef.current = v;
    setTime(v);
  };

  // Save the scene back to the node (debounced).
  useEffect(() => {
    const t = setTimeout(() => useCanvas.getState().updateData(node.id, { scene: dir }), 400);
    return () => clearTimeout(t);
  }, [dir, node.id]);

  // ---- three.js setup -----------------------------------------------------
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#30364a', 1.4));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(4, 8, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#1a1d26', roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    // A hair below y = 0 so floor props laid on the ground don't flicker against it.
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    ground.name = 'ground';
    scene.add(ground);
    const grid = new THREE.GridHelper(60, 60, '#2c3a5c', '#202838');
    grid.position.y = 0.002;
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 300);
    camera.position.set(4.5, 3.2, 6.5);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 1, 0);
    orbit.enableDamping = true;
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.9);
    const helper = transform.getHelper();
    scene.add(helper);
    transform.addEventListener('dragging-changed', (e) => (orbit.enabled = !e.value));
    transform.addEventListener('objectChange', () => {
      const obj = transform.object;
      const id = obj?.userData.id as string | undefined;
      const o = id ? dirRef.current.objects.find((x) => x.id === id) : undefined;
      if (!obj || !o) return;
      edit(o.id, {
        position: [round(obj.position.x), round(obj.position.y), round(obj.position.z)],
        rotation: [round(DEG(obj.rotation.x), 1), round(DEG(obj.rotation.y), 1), round(DEG(obj.rotation.z), 1)],
        ...(o.kind === 'camera' ? {} : { scale: [round(obj.scale.x), round(obj.scale.y), round(obj.scale.z)] as Vec3 }),
      });
    });
    const t3: Three = { renderer, scene, camera, orbit, transform, helper, grid, entries: new Map() };
    three.current = t3;

    // Click to select (a drag that orbits doesn't count).
    let down: { x: number; y: number } | null = null;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || transform.dragging || viewRef.current === 'camera') return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const roots = [...t3.entries.values()].map((x) => x.root);
      const hit = ray.intersectObjects(roots, true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.id) o = o.parent;
      setSelected(o ? (o.userData.id as string) : null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let last = performance.now();
    let lastUi = 0;
    renderer.setAnimationLoop((now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const d = dirRef.current;
      const dur = d.duration ?? 5;
      if (playingRef.current) {
        timeRef.current = (timeRef.current + dt) % dur;
        if (now - lastUi > 50) {
          lastUi = now;
          setTime(timeRef.current);
        }
      }
      applyScene(t3, d, motionsRef.current, timeRef.current);
      orbit.update();
      scene.background = new THREE.Color(d.background);
      const w = el.clientWidth;
      const h = el.clientHeight;
      const camEntry = d.activeCamera ? t3.entries.get(d.activeCamera) : undefined;
      const inCamera = viewRef.current === 'camera' && camEntry?.cam;
      for (const [, en] of t3.entries) {
        if (en.cam) en.root.children[0].visible = !inCamera;
        if (en.label) en.label.visible = !inCamera;
      }
      helper.visible = !inCamera && !!transform.object;
      grid.visible = !inCamera;
      if (inCamera) {
        // Letterbox the camera's frame inside the viewport.
        const a = aspectValue(d.aspect);
        const vw = Math.min(w, h * a);
        const vh = vw / a;
        renderer.setScissorTest(true);
        renderer.setViewport(0, 0, w, h);
        renderer.setScissor(0, 0, w, h);
        renderer.setClearColor('#000');
        renderer.clear();
        renderer.setViewport((w - vw) / 2, (h - vh) / 2, vw, vh);
        renderer.setScissor((w - vw) / 2, (h - vh) / 2, vw, vh);
        const cam = camEntry!.cam!;
        cam.aspect = a;
        cam.updateProjectionMatrix();
        renderer.render(scene, cam);
        renderer.setScissorTest(false);
      } else {
        renderer.setViewport(0, 0, w, h);
        renderer.render(scene, camera);
      }
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // ---- build / remove three objects as the scene changes ---------------------
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const seen = new Set<string>();
    for (const o of dir.objects) {
      seen.add(o.id);
      let en = t.entries.get(o.id);
      const sig = sigOf(o);
      if (en && en.sig !== sig) {
        if (t.transform.object === en.root) t.transform.detach();
        t.scene.remove(en.root);
        en = undefined;
      }
      if (!en) {
        const root = new THREE.Group();
        root.userData.id = o.id;
        root.rotation.order = 'YXZ';
        en = { root, sig };
        if (o.kind === 'character') {
          en.rig = buildMannequin(o.color);
          root.add(en.rig.root);
          en.label = textSprite(o.name);
          en.label.position.y = 2.0;
          root.add(en.label);
        } else if (o.kind === 'camera') {
          root.add(buildCameraModel(o.color));
          en.cam = new THREE.PerspectiveCamera(o.fov ?? 40, 16 / 9, 0.05, 300);
          root.add(en.cam);
          en.label = textSprite(o.name);
          en.label.position.y = 0.35;
          root.add(en.label);
        } else root.add(buildProp(o.shape ?? 'box', o.color, o.parts));
        t.scene.add(root);
        t.entries.set(o.id, en);
      }
    }
    for (const [id, en] of t.entries)
      if (!seen.has(id)) {
        if (t.transform.object === en.root) t.transform.detach();
        t.scene.remove(en.root);
        t.entries.delete(id);
      }
    applyScene(t, dir, motions, timeRef.current);
  }, [dir, motions]);

  // Gizmo follows the selection (none in camera view or while playing).
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const en = selected ? t.entries.get(selected) : undefined;
    if (en && view === 'director' && !playing) t.transform.attach(en.root);
    else t.transform.detach();
    t.transform.setMode(mode);
  }, [selected, view, mode, playing, dir.objects.length]);

  // Keyboard: Space plays, K keys, W/E/R tools, ←/→ step, Delete removes, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tgt.tagName)) return;
      if (e.key === 'Escape') close();
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying(!playing);
      } else if (e.key === 'k' || e.key === 'K') addKey();
      else if (e.key === 'ArrowLeft') seek(timeRef.current - 1 / FPS);
      else if (e.key === 'ArrowRight') seek(timeRef.current + 1 / FPS);
      else if (e.key === 'w' || e.key === 'W') setMode('translate');
      else if (e.key === 'e' || e.key === 'E') setMode('rotate');
      else if (e.key === 'r' || e.key === 'R') setMode('scale');
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) removeObject(selected);
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ---- actions --------------------------------------------------------------
  const addObject = (kind: DirObject['kind'], extra: Partial<DirObject> = {}) => {
    const o = newObject(kind, dir, extra);
    setDir((d) => ({ ...d, objects: [...d.objects, o], activeCamera: kind === 'camera' && !d.activeCamera ? o.id : d.activeCamera }));
    setSelected(o.id);
    setAddOpen(false);
    return o;
  };
  function removeObject(id: string) {
    setDir((d) => {
      const objects = d.objects.filter((o) => o.id !== id).map((o) => (o.target === id ? { ...o, target: undefined } : o));
      return { ...d, objects, activeCamera: d.activeCamera === id ? (objects.find((o) => o.kind === 'camera')?.id ?? null) : d.activeCamera };
    });
    setSelected(null);
  }
  const duplicate = (o: DirObject) => {
    const shift = (p: Vec3): Vec3 => [p[0] + 0.6, p[1], p[2]];
    const copy: DirObject = {
      ...structuredClone(o),
      id: nanoid(8),
      name: `${o.name} 副本`,
      position: shift(o.position),
      keys: o.keys?.map((k) => ({ ...structuredClone(k), position: shift(k.position) })),
    };
    setDir((d) => ({ ...d, objects: [...d.objects, copy] }));
    setSelected(copy.id);
  };

  /** Key the selected object's current state at the playhead. */
  function addKey() {
    if (!sel) return notify('先选中一个物体');
    setDir((d) => ({ ...d, objects: d.objects.map((o) => (o.id === sel.id ? upsertKey(o, timeRef.current, {}) : o)) }));
  }
  const deleteKey = () => sel && setDir((d) => ({ ...d, objects: d.objects.map((o) => (o.id === sel.id ? removeKeyAt(o, timeRef.current) : o)) }));
  const clearKeys = () => {
    if (!sel) return;
    const st = evaluate(sel, timeRef.current);
    update(sel.id, { keys: undefined, position: st.position, rotation: st.rotation, scale: st.scale, ...(st.pose ? { pose: st.pose } : {}), ...(st.fov ? { fov: st.fov } : {}) });
  };
  const setKeyEase = (ease: Ease) => sel && setDir((d) => ({ ...d, objects: d.objects.map((o) => (o.id === sel.id ? upsertKey(o, timeRef.current, { ease }) : o)) }));
  const jumpKey = (dirn: 1 | -1) => {
    const times = [...new Set((sel ? [sel] : dir.objects).flatMap((o) => o.keys?.map((k) => k.t) ?? []))].sort((a, b) => a - b);
    const t = timeRef.current;
    const next = dirn > 0 ? times.find((x) => x > t + 0.01) : [...times].reverse().find((x) => x < t - 0.01);
    if (next !== undefined) seek(next);
  };
  const moveKey = (id: string, from: number, to: number) =>
    setDir((d) => ({
      ...d,
      objects: d.objects.map((o) => {
        if (o.id !== id || !o.keys) return o;
        if (o.keys.some((k) => Math.abs(k.t - to) < 0.02 && Math.abs(k.t - from) >= 0.02)) return o;
        return { ...o, keys: o.keys.map((k) => (Math.abs(k.t - from) < 0.02 ? { ...k, t: to } : k)).sort((a, b) => a.t - b.t) };
      }),
    }));

  /** Point the active camera where the director view is looking. */
  const cameraFromView = () => {
    const t = three.current;
    const cam = dir.objects.find((o) => o.id === dir.activeCamera);
    if (!t || !cam) return;
    const p = t.camera.position;
    const tg = t.orbit.target;
    edit(cam.id, { position: [round(p.x), round(p.y), round(p.z)], rotation: lookAtRotation([p.x, p.y, p.z], [tg.x, tg.y, tg.z]).map((v) => round(v, 1)) as Vec3 });
    if (cam.target) update(cam.id, { target: undefined });
    notify(`已把「${cam.name}」移到当前导演视角`);
  };

  /** Size of exported frames: 1920 on the long side. */
  const frameSize = () => {
    const a = aspectValue(dir.aspect);
    const even = (v: number) => Math.round(v / 2) * 2;
    return a >= 1 ? { W: 1920, H: even(1920 / a) } : { W: even(1920 * a), H: 1920 };
  };

  /** Renders the active camera's view at time t into a canvas, without gizmos, labels or grid. */
  const renderFrame = (t: number, W: number, H: number, target: THREE.WebGLRenderTarget, out: HTMLCanvasElement) => {
    const t3 = three.current!;
    const camEntry = t3.entries.get(dirRef.current.activeCamera!)!;
    applyScene(t3, dirRef.current, motionsRef.current, t);
    const hidden: THREE.Object3D[] = [t3.helper, t3.grid, ...[...t3.entries.values()].flatMap((en) => [en.label, en.cam ? en.root.children[0] : undefined].filter((x): x is THREE.Object3D => !!x))];
    const was = hidden.map((h) => h.visible);
    hidden.forEach((h) => (h.visible = false));
    camEntry.cam!.aspect = W / H;
    camEntry.cam!.updateProjectionMatrix();
    t3.scene.updateMatrixWorld();
    t3.renderer.setRenderTarget(target);
    t3.renderer.render(t3.scene, camEntry.cam!);
    const px = new Uint8Array(W * H * 4);
    t3.renderer.readRenderTargetPixels(target, 0, 0, W, H, px);
    t3.renderer.setRenderTarget(null);
    hidden.forEach((h, i) => (h.visible = was[i]));
    const ctx = out.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
  };

  const withFrames = async <T,>(fn: (W: number, H: number, target: THREE.WebGLRenderTarget, out: HTMLCanvasElement) => Promise<T>) => {
    const { W, H } = frameSize();
    const target = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    try {
      return await fn(W, H, target, out);
    } finally {
      target.dispose();
    }
  };

  const activeCam = () => {
    const camObj = dir.objects.find((o) => o.id === dir.activeCamera);
    return camObj && three.current?.entries.get(camObj.id)?.cam ? camObj : null;
  };

  const screenshot = async () => {
    const camObj = activeCam();
    if (!camObj) return notify('请先添加并选择一个机位');
    setShotBusy(true);
    try {
      const media = await withFrames(async (W, H, target, out) => {
        renderFrame(timeRef.current, W, H, target, out);
        const blob = await new Promise<Blob>((r) => out.toBlob((b) => r(b!), 'image/png'));
        return putMedia(blob, 'image', `${node.data.title}-${camObj.name}.png`, { w: W, h: H });
      });
      placeResult(media, camObj.name);
      notify(`已截取「${camObj.name}」画面到画布`);
    } catch (err) {
      notify(`截图失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setShotBusy(false);
    }
  };

  const exportVideo = async () => {
    const camObj = activeCam();
    if (!camObj) return notify('请先添加并选择一个机位');
    setPlaying(false);
    setExporting(0);
    try {
      const count = Math.max(1, Math.round(duration * FPS));
      const media = await withFrames((W, H, target, out) =>
        encodeFrames(
          `${node.data.title}-${camObj.name}.mp4`,
          FPS,
          count,
          async (i) => {
            renderFrame(i / FPS, W, H, target, out);
            return canvasJpeg(out, 0.93);
          },
          setExporting,
        ),
      );
      placeResult(media, `${camObj.name} 动画`);
      notify(`已导出 ${duration} 秒动画视频到画布`);
    } catch (err) {
      notify(`导出失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setExporting(null);
    }
  };

  /** Results become media nodes next to the director node; the latest is also the node's output. */
  const placeResult = (media: MediaRef, label: string) => {
    const s = useCanvas.getState();
    const me = s.nodes.find((n) => n.id === node.id);
    if (!me) return;
    const p = absPos(me, s.nodes);
    const count = s.edges.filter((e) => e.source === node.id).length;
    const out: CanvasNode = {
      id: nanoid(8),
      type: media.kind,
      position: { x: p.x + sizeOf(me).w + 120, y: p.y + count * 260 },
      data: { title: `${me.data.title} · ${label}`, outputs: [{ id: nanoid(6), createdAt: Date.now(), media }], current: 0, status: 'done' },
    };
    s.commit();
    const outputs = [...(me.data.outputs ?? []), { id: nanoid(6), createdAt: Date.now(), media }];
    useCanvas.setState({
      nodes: [...s.nodes.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, outputs, current: outputs.length - 1 } } : n)), out],
      edges: [...s.edges, { id: nanoid(8), source: node.id, target: out.id }],
    });
  };

  // ---- motion capture into the selected character ----------------------------
  const captureFrom = async (url: string, name: string, sourceVideo?: string) => {
    if (!sel || sel.kind !== 'character') return;
    const id = sel.id;
    const start = timeRef.current;
    setMocapBusy('正在加载动作识别模型…');
    try {
      const { captureMotion } = await import('./mocap');
      const res = await captureMotion(url, (p) => setMocapBusy(`正在识别动作 ${Math.round(p * 100)}%`));
      const clip: MotionClip = { id: nanoid(10), name: `${name} 动作`, fps: res.fps, frames: res.frames, sourceVideo, createdAt: Date.now() };
      useLibrary.getState().saveMotion(clip);
      const end = start + clip.frames.length / clip.fps;
      setDir((d) => ({ ...d, duration: Math.max(d.duration ?? 5, Math.ceil(end)), objects: d.objects.map((o) => (o.id === id ? { ...o, motionId: clip.id, motionStart: round(start) } : o)) }));
      notify(`已识别 ${res.detected}/${res.frames.length} 帧动作，从 ${start.toFixed(1)} 秒开始播放`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setMocapBusy(null);
    }
  };
  const captureFromNode = async (nodeId: string) => {
    const n = useCanvas.getState().nodes.find((x) => x.id === nodeId);
    const m = n && currentOutput(n.data)?.media;
    const url = m && (await getMediaUrl(m.id));
    if (!n || !m || !url) return notify('找不到这个视频文件');
    captureFrom(url, n.data.title, m.id);
  };
  const captureFromFile = (f: File) => {
    const url = URL.createObjectURL(f);
    captureFrom(url, f.name.replace(/\.[^.]+$/, '')).finally(() => URL.revokeObjectURL(url));
  };

  // ---- AI -------------------------------------------------------------------
  const refImages = () => {
    const s = useCanvas.getState();
    return s.edges
      .filter((e) => e.target === node.id)
      .map((e) => s.nodes.find((n) => n.id === e.source))
      .map((n) => n && currentOutput(n.data)?.media)
      .filter((m): m is MediaRef => m?.kind === 'image');
  };

  const COORDS = '坐标单位是米，地面是 y=0，x 向右、z 朝向默认镜头；人物约 1.75 米高，站在地面上。rotationY 为 0 表示面朝 +z（面向镜头），90 表示面朝 +x；朝 (dx,dz) 方向走时 rotationY = atan2(dx,dz) 的角度。';

  const runAI = async () => {
    const text = aiText.trim();
    if (!text) return;
    setAiBusy(true);
    try {
      if (aiMode === 'scene') await aiScene(text);
      else if (aiMode === 'anim') await aiAnimate(text);
      else await aiModel(text);
      setAiText('');
    } catch (err) {
      notify(`AI 生成失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setAiBusy(false);
    }
  };

  /** Build or rearrange the scene from a description (and any reference images wired in). */
  const aiScene = async (desc: string) => {
    const refs = refImages();
    const prompt = `你是电影美术与摄影指导。根据下面的描述${refs.length ? '和附上的参考图' : ''}，搭建一个简化的 3D 场景，只输出 JSON，不要其他文字。
描述：${desc}
${COORDS}
JSON 格式：
{"objects":[{"kind":"character","name":"角色名","position":[x,0,z],"rotationY":角度,"pose":"姿势","color":"#RRGGBB"},{"kind":"prop","shape":"形状","name":"名称","position":[x,0,z],"rotationY":角度,"size":[宽,高,深],"color":"#RRGGBB"}],"camera":{"position":[x,y,z],"lookAt":[x,y,z],"fov":角度},"background":"#RRGGBB"}
pose 只能从这些里选：${POSE_NAMES.join('、')}。shape 优先从这些里选：${BASIC_SHAPES.join('、')}（size 是相对默认尺寸的缩放倍数，默认 [1,1,1]）。
如果没有合适的 shape，就用 "shape":"custom" 并给出 "parts"：用基本几何体拼出这个物体，格式同下：[{"shape":"box|sphere|cylinder|cone|torus|capsule","size":[宽,高,深(米)],"position":[部件中心相对物体原点的 x,y,z],"rotation":[x,y,z 角度],"color":"#RRGGBB"}]，此时 size 字段省略。fov 一般 25 到 60。`;
    const plan = parseJson<{
      objects?: { kind: string; name?: string; position?: number[]; rotationY?: number; pose?: string; color?: string; shape?: string; size?: number[]; parts?: unknown }[];
      camera?: { position?: number[]; lookAt?: number[]; fov?: number };
      background?: string;
    }>(await generateText(engine, prompt, refs));
    setDir((d) => {
      const cams = d.objects.filter((o) => o.kind === 'camera').map((c) => ({ ...c, target: undefined, keys: undefined }));
      const objects: DirObject[] = [];
      for (const it of plan.objects ?? []) {
        const isChar = it.kind === 'character';
        const parts = it.shape === 'custom' ? cleanParts(it.parts) : [];
        const shape: PropShape = parts.length ? 'custom' : BASIC_SHAPES.includes(it.shape as PropShape) ? (it.shape as PropShape) : 'box';
        const o = newObject(isChar ? 'character' : 'prop', { ...d, objects: [...cams, ...objects] }, {
          ...(it.name ? { name: it.name } : {}),
          position: vec(it.position, [0, 0, 0]),
          rotation: [0, num(it.rotationY, 0), 0],
          ...(isChar ? { poseName: POSE_NAMES.includes(it.pose ?? '') ? it.pose : '站立' } : { shape, ...(parts.length ? { parts } : { scale: vec(it.size, [1, 1, 1]) }) }),
          ...(isColor(it.color) ? { color: it.color } : {}),
        });
        objects.push(o);
      }
      let camObjs = cams;
      const active = cams.find((c) => c.id === d.activeCamera) ?? cams[0];
      if (plan.camera && active) {
        const pos = vec(plan.camera.position, active.position);
        const at = vec(plan.camera.lookAt, [0, 1, 0]);
        camObjs = cams.map((c) => (c.id === active.id ? { ...c, position: pos, rotation: lookAtRotation(pos, at), fov: num(plan.camera?.fov, c.fov ?? 40) } : c));
      }
      return { ...d, objects: [...camObjs, ...objects], background: isColor(plan.background) ? plan.background : d.background };
    });
    setSelected(null);
    notify(`已按描述搭建场景（${(plan.objects ?? []).length} 个物体），可以接着用「生成动画」让它动起来`);
  };

  /** Keyframes for the existing scene from a description of the action and camera work. */
  const aiAnimate = async (desc: string) => {
    if (!dir.objects.length) throw new Error('场景是空的，先搭建场景');
    const states = sceneStates(dir, 0);
    const summary = dir.objects.map((o) => {
      const st = states.get(o.id)!;
      return {
        id: o.id,
        kind: o.kind,
        name: o.name,
        position: st.position.map((v) => round(v)),
        rotationY: round(st.rotation[1], 0),
        ...(o.kind === 'character' ? { pose: o.keys?.[0]?.poseName ?? o.poseName ?? '站立' } : {}),
        ...(o.kind === 'camera' ? { fov: st.fov ?? 40 } : {}),
        ...(o.kind === 'prop' ? { shape: o.shape } : {}),
      };
    });
    const prompt = `你是动画导演和摄影指导。下面是一个 3D 场景里的物体（JSON），请根据描述为它们制作关键帧动画，只输出 JSON，不要其他文字。
描述：${desc}
场景物体：${JSON.stringify(summary)}
当前动画时长：${duration} 秒（可以按需要改，最长 60 秒）。
${COORDS}
JSON 格式：
{"duration":秒,"tracks":[{"id":"物体id","keys":[{"t":秒,"position":[x,y,z],"rotationY":角度,"pose":"姿势","ease":"linear|smooth|hold"}]}],"cameras":[{"id":"机位id","target":"要一直注视的物体id，或省略","keys":[{"t":秒,"position":[x,y,z],"lookAt":[x,y,z],"fov":角度,"ease":"linear|smooth"}]}]}
规则：
- 只给需要动的物体写 track；每个 track 第一个关键帧 t=0，至少 2 个关键帧，t 不超过 duration。
- pose 只能从这些里选：${POSE_NAMES.join('、')}。人物走路时每 0.4–0.5 秒交替使用「行走」和「行走·换脚」，跑步交替「奔跑」和「奔跑·换脚」，位置匀速变化（ease 用 linear），朝向与移动方向一致；停下时换回「站立」等姿势。
- 机位的推拉摇移跟用 position + lookAt（或 target）表达，ease 用 smooth 更自然；变焦用 fov。
- ease 表示从这一帧到下一帧的过渡：linear 匀速、smooth 缓入缓出、hold 定格到下一帧。`;
    const plan = parseJson<{
      duration?: number;
      tracks?: { id?: string; keys?: { t?: number; position?: number[]; rotationY?: number; pose?: string; ease?: string }[] }[];
      cameras?: { id?: string; target?: string; keys?: { t?: number; position?: number[]; lookAt?: number[]; fov?: number; ease?: string }[] }[];
    }>(await generateText(engine, prompt, refImages()));
    const dur = Math.max(1, Math.min(60, num(plan.duration, duration)));
    const find = (id?: string) => dir.objects.find((o) => o.id === id) ?? dir.objects.find((o) => o.name === id);
    const changed = new Map<string, Partial<DirObject>>();
    for (const tr of plan.tracks ?? []) {
      const o = find(tr.id);
      if (!o || !tr.keys?.length) continue;
      const base = evaluate(o, 0);
      const keys: Keyframe[] = tr.keys.map((k) => {
        const poseName = o.kind === 'character' && POSE_NAMES.includes(k.pose ?? '') ? k.pose : undefined;
        return {
          t: Math.max(0, Math.min(dur, num(k.t, 0))),
          position: vec(k.position, base.position),
          rotation: [base.rotation[0], num(k.rotationY, base.rotation[1]), base.rotation[2]],
          scale: base.scale,
          ...(o.kind === 'character' ? { pose: poseName ? POSES[poseName] : base.pose, poseName } : {}),
          ...(o.kind === 'camera' ? { fov: base.fov } : {}),
          ...(isEase(k.ease) ? { ease: k.ease } : {}),
        };
      });
      changed.set(o.id, { keys: dedupe(keys), ...(o.kind === 'character' && tr.keys.some((k) => k.pose) ? { motionId: undefined } : {}) });
    }
    for (const c of plan.cameras ?? []) {
      const o = find(c.id);
      if (!o || o.kind !== 'camera') continue;
      const base = evaluate(o, 0);
      const target = find(c.target)?.id;
      const keys: Keyframe[] = (c.keys ?? []).map((k) => {
        const pos = vec(k.position, base.position);
        return {
          t: Math.max(0, Math.min(dur, num(k.t, 0))),
          position: pos,
          rotation: isVec(k.lookAt) ? lookAtRotation(pos, vec(k.lookAt, [0, 1, 0])) : base.rotation,
          scale: base.scale,
          fov: Math.max(5, Math.min(120, num(k.fov, base.fov ?? 40))),
          ...(isEase(k.ease) ? { ease: k.ease } : {}),
        };
      });
      changed.set(o.id, { target: target && target !== o.id ? target : undefined, ...(keys.length ? { keys: dedupe(keys) } : {}) });
    }
    if (!changed.size) throw new Error('AI 没有给出可用的关键帧，换个说法再试试');
    setDir((d) => ({ ...d, duration: dur, objects: d.objects.map((o) => (changed.has(o.id) ? { ...o, ...changed.get(o.id) } : o)) }));
    seek(0);
    setPlaying(true);
    notify(`已生成 ${dur} 秒动画（${changed.size} 个物体），关键帧都可以在下方时间轴里修改`);
  };

  /** A new prop assembled from primitives. */
  const aiModel = async (desc: string) => {
    const refs = refImages();
    const prompt = `你是 3D 建模师。用基本几何体拼出下面描述的低多边形模型${refs.length ? '（参考附上的图片）' : ''}，只输出 JSON，不要其他文字。
描述：${desc}
单位是米，模型立在地面 y=0 上，正面朝 +z，原点在模型底部中心；尺寸要符合真实比例。
JSON 格式：{"name":"模型名称","parts":[{"shape":"box|sphere|cylinder|cone|torus|capsule","size":[宽,高,深],"position":[x,y,z],"rotation":[x,y,z],"color":"#RRGGBB"}]}
size 是部件的外框尺寸（米）；position 是部件中心；rotation 是角度（cylinder/cone/capsule 默认竖直，torus 默认立在 xy 平面）。用 8 到 50 个部件，把主要结构和特征都表现出来，颜色要区分材质。`;
    const plan = parseJson<{ name?: string; parts?: unknown }>(await generateText(engine, prompt, refs));
    const parts = cleanParts(plan.parts);
    if (!parts.length) throw new Error('AI 没有返回模型部件');
    const o = addObject('prop', { shape: 'custom', parts, name: (plan.name || desc).slice(0, 20), position: [sel && sel.kind !== 'camera' ? sel.position[0] + 1.2 : 1.5, 0, 0] });
    setMode('translate');
    notify(`已生成模型「${o.name}」（${parts.length} 个部件），可以移动、缩放或加关键帧`);
  };

  // ---- panels ---------------------------------------------------------------
  const states = useMemo(() => sceneStates(dir, time), [dir, time]);
  const st = sel ? states.get(sel.id) : undefined;
  const listed = dir.objects.filter((o) => !q.trim() || o.name.includes(q.trim()));
  const icon = (o: DirObject) => (o.kind === 'camera' ? 'video' : o.kind === 'character' ? 'person' : 'cube');
  const pose: Pose = st?.pose ?? { joints: {} };
  const jointVal = pose.joints[joint] ?? [0, 0, 0];
  const curKey = sel ? keyAt(sel, time) : undefined;
  const poseLabel = sel && (sel.keys?.length ? curKey?.poseName : sel.poseName);
  const setJointAxis = (axis: number, v: number) => {
    if (!sel) return;
    const next: Pose = { hipsDrop: pose.hipsDrop, joints: { ...structuredClone(pose.joints), [joint]: jointVal.map((x, i) => (i === axis ? v : x)) as Vec3 } };
    edit(sel.id, { pose: next, poseName: '自定义' });
  };
  const clip = sel?.motionId ? motions.find((m) => m.id === sel.motionId) : undefined;
  const cameras = dir.objects.filter((o) => o.kind === 'camera');

  const vecField = (label: string, key: 'position' | 'rotation' | 'scale', step: number) =>
    sel &&
    st && (
      <div className="dr-field">
        <span>{label}</span>
        <div className="dr-vec">
          {(['X', 'Y', 'Z'] as const).map((ax, i) => (
            <label key={ax}>
              <i>{ax}</i>
              <input
                type="number"
                step={step}
                value={round(st[key][i], key === 'rotation' ? 1 : 2)}
                onChange={(e) => {
                  const v = [...st[key]] as Vec3;
                  v[i] = Number(e.target.value) || 0;
                  edit(sel.id, { [key]: v });
                }}
              />
            </label>
          ))}
        </div>
      </div>
    );

  const busyLabel = exporting !== null ? `导出中 ${Math.round(exporting * 100)}%` : null;

  return (
    <div className="director">
      <header className="dr-head">
        <button className="icon-btn" onClick={close} aria-label="关闭">
          <Icon name="x" />
        </button>
        <b>3D 导演台 · {node.data.title}</b>
        <div className="seg dr-view">
          <button className={view === 'director' ? 'on' : ''} onClick={() => setView('director')}>
            导演视角
          </button>
          <button className={view === 'camera' ? 'on' : ''} onClick={() => setView('camera')} disabled={!cameras.length}>
            机位视角
          </button>
        </div>
        <div className="grow" />
        <select className="pp-select" value={dir.activeCamera ?? ''} onChange={(e) => setDir((d) => ({ ...d, activeCamera: e.target.value || null }))} title="当前机位">
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="pp-select" value={dir.aspect} onChange={(e) => setDir((d) => ({ ...d, aspect: e.target.value }))} title="画幅">
          {ASPECTS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <button className="text-btn" onClick={cameraFromView} title="把当前机位移到导演视角的位置和方向">
          <Icon name="camera" size={14} />
          机位对齐视角
        </button>
        <button className="text-btn" disabled={shotBusy || exporting !== null} onClick={screenshot}>
          <Icon name="image" size={14} />
          {shotBusy ? '截图中…' : '截图到画布'}
        </button>
        <button className="primary-btn" disabled={exporting !== null} onClick={exportVideo} title={`用当前机位把 ${duration} 秒动画渲染成视频`}>
          {busyLabel ?? '导出视频'}
        </button>
      </header>

      <aside className="dr-left">
        <div className="dr-add">
          <button className="text-btn" onClick={() => addObject('character')}>
            <Icon name="person" size={14} />
            人物
          </button>
          <button className="text-btn" onClick={() => addObject('camera')}>
            <Icon name="video" size={14} />
            机位
          </button>
          <div className="dr-add-wrap">
            <button className="text-btn" onClick={() => setAddOpen(!addOpen)}>
              <Icon name="cube" size={14} />
              道具
            </button>
            {addOpen && (
              <div className="popover dr-props" onMouseLeave={() => setAddOpen(false)}>
                {BASIC_SHAPES.map((s) => (
                  <button key={s} onClick={() => addObject('prop', { shape: s })}>
                    {PROP_LABEL[s]}
                  </button>
                ))}
                <button
                  className="dr-props-ai"
                  onClick={() => {
                    setAddOpen(false);
                    setAiMode('model');
                  }}
                >
                  <Icon name="sparkles" size={12} />
                  AI 生成模型…
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="lib-search">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索场景物体" />
        </div>
        <div className="dr-list">
          {listed.map((o) => (
            <button key={o.id} className={`dr-item ${o.id === selected ? 'on' : ''}`} onClick={() => setSelected(o.id)}>
              <Icon name={icon(o)} size={14} />
              <span>{o.name}</span>
              {(o.keys?.length || o.motionId) && <Icon name="diamond" size={10} />}
              {o.kind === 'camera' && o.id === dir.activeCamera && <small>当前</small>}
            </button>
          ))}
        </div>
      </aside>

      <main className="dr-main">
        <div className="dr-stage">
          <div className="dr-canvas" ref={host} />
          <div className="dr-tools">
            {(
              [
                ['translate', 'move', '移动 W'],
                ['rotate', 'rotate', '旋转 E'],
                ['scale', 'scale', '缩放 R'],
              ] as const
            ).map(([m, ic, tip]) => (
              <button key={m} className={`dock-btn ${mode === m ? 'on' : ''}`} title={tip} onClick={() => setMode(m)}>
                <Icon name={ic} />
              </button>
            ))}
          </div>
          <div className="dr-ai">
            <div className="seg dr-ai-modes">
              {AI_MODES.map(([m, label]) => (
                <button key={m} className={aiMode === m ? 'on' : ''} onClick={() => setAiMode(m)} disabled={aiBusy}>
                  {label}
                </button>
              ))}
            </div>
            <input
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && runAI()}
              placeholder={AI_MODES.find((m) => m[0] === aiMode)![2]}
              disabled={aiBusy}
            />
            <select className="pp-select" value={engine} onChange={(e) => setEngine(e.target.value)}>
              {MODELS.text.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button className="pp-go" disabled={aiBusy || !aiText.trim()} onClick={runAI} title="交给 AI 生成">
              {aiBusy ? <span className="spinner" /> : <Icon name="arrowUp" size={16} />}
            </button>
          </div>
        </div>

        <Timeline
          dir={dir}
          time={time}
          duration={duration}
          selected={selected}
          motions={motions}
          onSeek={(t) => {
            setPlaying(false);
            seek(t);
          }}
          onSelect={setSelected}
          onMoveKey={moveKey}
        >
          <button className="icon-btn" title="回到开头" onClick={() => seek(0)}>
            <Icon name="skipBack" size={14} />
          </button>
          <button className="icon-btn" title="上一个关键帧" onClick={() => jumpKey(-1)}>
            <Icon name="prevKey" size={14} />
          </button>
          <button className="icon-btn dr-play" title={playing ? '暂停（空格）' : '播放（空格）'} onClick={() => setPlaying(!playing)}>
            <Icon name={playing ? 'pause' : 'play'} size={14} />
          </button>
          <button className="icon-btn" title="下一个关键帧" onClick={() => jumpKey(1)}>
            <Icon name="nextKey" size={14} />
          </button>
          <span className="dr-time">
            {time.toFixed(2)}s /
            <input type="number" min={1} max={120} step={0.5} value={duration} onChange={(e) => setDir((d) => ({ ...d, duration: Math.max(1, Math.min(120, Number(e.target.value) || 5)) }))} title="动画时长（秒）" />s
          </span>
          <div className="grow" />
          <label className={`dr-autokey ${autoKey ? 'on' : ''}`} title="开启后，修改任何物体都会在当前时间记录关键帧（有关键帧的物体始终会自动记录）">
            <input type="checkbox" checked={autoKey} onChange={(e) => setAutoKey(e.target.checked)} />
            自动记录
          </label>
          <button className="text-btn" disabled={!sel} onClick={addKey} title="在当前时间为选中物体打关键帧（K）">
            <Icon name="diamond" size={12} />
            {curKey ? '更新关键帧' : '添加关键帧'}
          </button>
          {curKey && (
            <>
              <select className="pp-select" value={curKey.ease ?? 'linear'} onChange={(e) => setKeyEase(e.target.value as Ease)} title="从这一帧到下一帧的过渡">
                {(Object.keys(EASE_LABEL) as Ease[]).map((k) => (
                  <option key={k} value={k}>
                    {EASE_LABEL[k]}
                  </option>
                ))}
              </select>
              <button className="icon-btn" title="删除这个关键帧" onClick={deleteKey}>
                <Icon name="trash" size={14} />
              </button>
            </>
          )}
          {!!sel?.keys?.length && !curKey && (
            <button className="text-btn" onClick={clearKeys} title="删除选中物体的全部关键帧，保留当前状态">
              清除动画
            </button>
          )}
        </Timeline>
      </main>

      <aside className="dr-right">
        {!sel || !st ? (
          <div className="dr-empty">
            <p className="muted">在场景中点选物体，或在左侧列表选择。</p>
            <label className="dr-field">
              <span>背景颜色</span>
              <input type="color" value={dir.background} onChange={(e) => setDir((d) => ({ ...d, background: e.target.value }))} />
            </label>
            <p className="muted small">做动画：拖动下方时间轴到某个时间，选中物体点「添加关键帧」（K），再换个时间移动它或改姿势，就会自动记下新的关键帧。也可以直接用「生成动画」让 AI 来做。</p>
          </div>
        ) : (
          <>
            <div className="dr-right-head">
              <b>{sel.kind === 'character' ? '角色' : sel.kind === 'camera' ? '机位' : sel.shape === 'custom' ? 'AI 模型' : '道具'}</b>
              {!!sel.keys?.length && <small className="dr-keyed">{sel.keys.length} 个关键帧</small>}
              <div className="grow" />
              <button className="icon-btn" title="复制" onClick={() => duplicate(sel)}>
                <Icon name="copy" size={14} />
              </button>
              <button className="icon-btn" title="删除" onClick={() => removeObject(sel.id)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
            {sel.kind === 'character' && (
              <div className="seg dr-tabs">
                <button className={tab === 'props' ? 'on' : ''} onClick={() => setTab('props')}>
                  属性
                </button>
                <button className={tab === 'pose' ? 'on' : ''} onClick={() => setTab('pose')}>
                  姿势与动作
                </button>
              </div>
            )}
            {(tab === 'props' || sel.kind !== 'character') && (
              <div className="dr-props-panel">
                <label className="dr-field">
                  <span>名称</span>
                  <input className="dr-input" value={sel.name} onChange={(e) => update(sel.id, { name: e.target.value })} />
                </label>
                {vecField('位置', 'position', 0.1)}
                {!(sel.kind === 'camera' && sel.target) && vecField('旋转', 'rotation', 5)}
                {sel.kind !== 'camera' && vecField('缩放', 'scale', 0.1)}
                {sel.kind !== 'camera' && (
                  <label className="dr-field">
                    <span>统一缩放 {st.scale[0].toFixed(2)}</span>
                    <input type="range" min={0.2} max={3} step={0.01} value={st.scale[0]} onChange={(e) => edit(sel.id, { scale: [Number(e.target.value), Number(e.target.value), Number(e.target.value)] })} />
                  </label>
                )}
                {sel.kind === 'camera' && (
                  <>
                    <label className="dr-field">
                      <span>
                        视野 {Math.round(st.fov ?? 40)}°（约 {Math.round(12 / Math.tan(R((st.fov ?? 40) / 2)))}mm）
                      </span>
                      <input type="range" min={10} max={100} step={1} value={st.fov ?? 40} onChange={(e) => edit(sel.id, { fov: Number(e.target.value) })} />
                    </label>
                    <label className="dr-field">
                      <span>注视目标（镜头始终对准它）</span>
                      <select className="pp-select" value={sel.target ?? ''} onChange={(e) => update(sel.id, { target: e.target.value || undefined })}>
                        <option value="">不跟随</option>
                        {dir.objects
                          .filter((o) => o.kind !== 'camera')
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button className="text-btn" onClick={() => setDir((d) => ({ ...d, activeCamera: sel.id }))} disabled={dir.activeCamera === sel.id}>
                      设为当前机位
                    </button>
                  </>
                )}
                {sel.kind !== 'camera' && (
                  <label className="dr-field">
                    <span>{sel.shape === 'custom' ? '颜色（未单独着色的部件）' : '颜色'}</span>
                    <input type="color" value={sel.color} onChange={(e) => update(sel.id, { color: e.target.value })} />
                  </label>
                )}
              </div>
            )}
            {sel.kind === 'character' && tab === 'pose' && (
              <div className="dr-props-panel">
                <span className="dr-sub">预设姿势{sel.keys?.length ? `（记录在 ${time.toFixed(2)}s）` : ''}</span>
                <div className="dr-poses">
                  {POSE_NAMES.map((p) => (
                    <button
                      key={p}
                      className={!sel.motionId && poseLabel === p ? 'on' : ''}
                      disabled={!!sel.motionId}
                      onClick={() => edit(sel.id, { pose: structuredClone(POSES[p]), poseName: p })}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <span className="dr-sub">关节微调{!sel.motionId && poseLabel === '自定义' ? '（自定义）' : ''}</span>
                <select className="pp-select" value={joint} onChange={(e) => setJoint(e.target.value as Joint)}>
                  {JOINTS.map((jn) => (
                    <option key={jn} value={jn}>
                      {JOINT_LABEL[jn]}
                    </option>
                  ))}
                </select>
                {(['前后 X', '转向 Y', '侧摆 Z'] as const).map((label, i) => (
                  <label key={label} className="dr-field">
                    <span>
                      {label} {Math.round(jointVal[i])}°
                    </span>
                    <input type="range" min={-180} max={180} step={1} value={jointVal[i]} disabled={!!sel.motionId} onChange={(e) => setJointAxis(i, Number(e.target.value))} />
                  </label>
                ))}
                <span className="dr-sub">动作捕捉</span>
                <p className="muted small">从视频里识别人物动作，放到时间轴的当前位置（{time.toFixed(1)}s）。使用动作时姿势关键帧不生效，位置关键帧照常生效。</p>
                {mocapBusy ? (
                  <div className="dr-mocap-busy">
                    <span className="spinner" />
                    {mocapBusy}
                  </div>
                ) : (
                  <div className="dr-mocap">
                    <select className="pp-select" value="" onChange={(e) => e.target.value && captureFromNode(e.target.value)} disabled={!videoNodes.length}>
                      <option value="">{videoNodes.length ? '从画布上的视频提取…' : '画布上没有视频'}</option>
                      {videoNodes.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title}
                        </option>
                      ))}
                    </select>
                    <button className="text-btn" onClick={() => fileRef.current?.click()}>
                      <Icon name="upload" size={14} />
                      本地视频
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="video/*"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) captureFromFile(f);
                      }}
                    />
                  </div>
                )}
                {motions.length > 0 && (
                  <>
                    <select className="pp-select" value={sel.motionId ?? ''} onChange={(e) => update(sel.id, { motionId: e.target.value || undefined, motionStart: sel.motionStart ?? 0 })}>
                      <option value="">不使用动作（用姿势关键帧）</option>
                      {motions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}（{(m.frames.length / m.fps).toFixed(1)} 秒）
                        </option>
                      ))}
                    </select>
                    {clip && (
                      <label className="dr-field">
                        <span>动作开始时间（秒）</span>
                        <input className="dr-input" type="number" step={0.1} min={0} value={sel.motionStart ?? 0} onChange={(e) => update(sel.id, { motionStart: Math.max(0, Number(e.target.value) || 0) })} />
                      </label>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function dedupe(keys: Keyframe[]) {
  const out: Keyframe[] = [];
  for (const k of [...keys].sort((a, b) => a.t - b.t)) {
    if (out.length && Math.abs(out[out.length - 1].t - k.t) < 0.02) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Timeline: a ruler with the playhead and one track of keyframes per object
// ---------------------------------------------------------------------------

function Timeline({
  dir,
  time,
  duration,
  selected,
  motions,
  onSeek,
  onSelect,
  onMoveKey,
  children,
}: {
  dir: DirScene;
  time: number;
  duration: number;
  selected: string | null;
  motions: MotionClip[];
  onSeek: (t: number) => void;
  onSelect: (id: string) => void;
  onMoveKey: (id: string, from: number, to: number) => void;
  children: React.ReactNode;
}) {
  const area = useRef<HTMLDivElement>(null);
  const tAt = (clientX: number) => {
    const r = area.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const snap = (t: number) => Math.round(t * FPS) / FPS;
  const scrub = (e: ReactPointerEvent) => {
    onSeek(snap(tAt(e.clientX)));
    const move = (ev: PointerEvent) => onSeek(snap(tAt(ev.clientX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const dragKey = (e: ReactPointerEvent, id: string, t0: number) => {
    e.stopPropagation();
    onSelect(id);
    onSeek(t0);
    let cur = t0;
    const move = (ev: PointerEvent) => {
      const t = snap(tAt(ev.clientX));
      if (Math.abs(t - cur) < 1e-6) return;
      onMoveKey(id, cur, t);
      onSeek(t);
      cur = t;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const pct = (t: number) => `${(Math.min(duration, t) / duration) * 100}%`;
  const step = duration <= 6 ? 0.5 : duration <= 15 ? 1 : duration <= 40 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);

  return (
    <div className="dr-tl">
      <div className="dr-tl-bar">{children}</div>
      <div className="dr-tl-body">
        <div className="dr-tl-names">
          <div className="dr-tl-ruler-pad" />
          {dir.objects.map((o) => (
            <button key={o.id} className={`dr-tl-name ${o.id === selected ? 'on' : ''}`} onClick={() => onSelect(o.id)}>
              {o.name}
            </button>
          ))}
        </div>
        <div className="dr-tl-tracks" ref={area} onPointerDown={scrub}>
          <div className="dr-tl-ruler">
            {ticks.map((t) => (
              <span key={t} style={{ left: pct(t) }}>
                {Number.isInteger(t) ? `${t}s` : ''}
              </span>
            ))}
          </div>
          {dir.objects.map((o) => {
            const clip = o.motionId ? motions.find((m) => m.id === o.motionId) : undefined;
            return (
              <div key={o.id} className={`dr-tl-track ${o.id === selected ? 'on' : ''}`}>
                {clip && (
                  <div className="dr-tl-clip" style={{ left: pct(o.motionStart ?? 0), width: `calc(${pct((o.motionStart ?? 0) + clip.frames.length / clip.fps)} - ${pct(o.motionStart ?? 0)})` }} title={clip.name}>
                    {clip.name}
                  </div>
                )}
                {o.keys && o.keys.length > 1 && <div className="dr-tl-span" style={{ left: pct(o.keys[0].t), width: `calc(${pct(o.keys[o.keys.length - 1].t)} - ${pct(o.keys[0].t)})` }} />}
                {o.keys?.map((k) => (
                  <i
                    key={k.t}
                    className={`dr-tl-key ${Math.abs(k.t - time) < 0.02 && o.id === selected ? 'on' : ''} ${k.ease ?? 'linear'}`}
                    style={{ left: pct(k.t) }}
                    title={`${k.t.toFixed(2)}s${k.poseName ? ` · ${k.poseName}` : ''} · ${EASE_LABEL[k.ease ?? 'linear']}`}
                    onPointerDown={(e) => dragKey(e, o.id, k.t)}
                  />
                ))}
              </div>
            );
          })}
          <div className="dr-tl-head" style={{ left: pct(time) }} />
        </div>
      </div>
    </div>
  );
}
