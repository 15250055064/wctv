import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { nanoid } from 'nanoid';
import { useShallow } from 'zustand/react/shallow';
import { MODELS } from '../canvas/config';
import { Icon } from '../canvas/Icon';
import { useLibrary } from '../canvas/library';
import { putMedia } from '../canvas/media';
import { generateText } from '../canvas/provider';
import { absPos, currentOutput, sizeOf, useCanvas } from '../canvas/store';
import { useUI } from '../canvas/ui';
import type { CanvasNode, MediaRef } from '../canvas/types';
import { JOINTS, JOINT_LABEL, POSES, POSE_NAMES, applyPose, applyQuatFrame, buildMannequin, type Joint, type Pose, type Rig } from './mannequin';
import { ASPECTS, PROP_LABEL, aspectValue, buildCameraModel, buildProp, lookAtRotation, newObject, newScene, type DirObject, type DirScene, type PropShape } from './scene';

const R = THREE.MathUtils.degToRad;
const DEG = THREE.MathUtils.radToDeg;
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

interface Entry {
  root: THREE.Group;
  sig: string;
  rig?: Rig;
  cam?: THREE.PerspectiveCamera;
  label?: THREE.Sprite;
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
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set((0.28 * w) / 72, 0.28, 1);
  s.renderOrder = 10;
  return s;
}

/** Rebuild key: anything that needs new meshes rather than an update. */
const sigOf = (o: DirObject) => `${o.kind}|${o.shape ?? ''}|${o.kind === 'prop' ? o.color : ''}|${o.name}`;

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
  const [playing, setPlaying] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [engine, setEngine] = useState('chatgpt');
  const [shotBusy, setShotBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const motions = useLibrary((s) => s.motions);

  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    orbit: OrbitControls;
    transform: TransformControls;
    helper: THREE.Object3D;
    entries: Map<string, Entry>;
  } | null>(null);
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const viewRef = useRef(view);
  viewRef.current = view;

  const sel = dir.objects.find((o) => o.id === selected);
  const update = (id: string, patch: Partial<DirObject>) => setDir((d) => ({ ...d, objects: d.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));

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
      if (!obj || !id) return;
      setDir((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          o.id === id
            ? {
                ...o,
                position: [round(obj.position.x), round(obj.position.y), round(obj.position.z)],
                rotation: [round(DEG(obj.rotation.x), 1), round(DEG(obj.rotation.y), 1), round(DEG(obj.rotation.z), 1)],
                scale: o.kind === 'camera' ? o.scale : [round(obj.scale.x), round(obj.scale.y), round(obj.scale.z)],
              }
            : o,
        ),
      }));
    });
    three.current = { renderer, scene, camera, orbit, transform, helper, entries: new Map() };

    // Click to select (a drag that orbits doesn't count).
    let down: { x: number; y: number } | null = null;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || transform.dragging || viewRef.current === 'camera') return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const roots = [...three.current!.entries.values()].map((x) => x.root);
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

    renderer.setAnimationLoop(() => {
      const t = three.current!;
      orbit.update();
      const d = dirRef.current;
      scene.background = new THREE.Color(d.background);
      const w = el.clientWidth;
      const h = el.clientHeight;
      const camEntry = d.activeCamera ? t.entries.get(d.activeCamera) : undefined;
      const inCamera = viewRef.current === 'camera' && camEntry?.cam;
      for (const [, en] of t.entries) {
        if (en.cam) en.root.children[0].visible = !inCamera;
        if (en.label) en.label.visible = !inCamera;
      }
      helper.visible = !inCamera;
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

  // ---- keep three objects in sync with the scene data ----------------------
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
        } else root.add(buildProp(o.shape ?? 'box', o.color));
        t.scene.add(root);
        t.entries.set(o.id, en);
      }
      en.root.rotation.order = 'YXZ';
      en.root.position.set(...o.position);
      en.root.rotation.set(R(o.rotation[0]), R(o.rotation[1]), R(o.rotation[2]));
      if (o.kind !== 'camera') en.root.scale.set(...o.scale);
      if (en.rig) {
        en.rig.material.color.set(o.color);
        const clip = o.motionId ? motions.find((m) => m.id === o.motionId) : undefined;
        if (clip?.frames.length) applyQuatFrame(en.rig, clip.frames[Math.min(clip.frames.length - 1, Math.max(0, o.motionFrame ?? 0))]);
        else applyPose(en.rig, o.pose ?? POSES[o.poseName ?? '站立']);
      }
      if (en.cam) {
        en.cam.fov = o.fov ?? 40;
        en.cam.updateProjectionMatrix();
      }
    }
    for (const [id, en] of t.entries)
      if (!seen.has(id)) {
        if (t.transform.object === en.root) t.transform.detach();
        t.scene.remove(en.root);
        t.entries.delete(id);
      }
  }, [dir, motions]);

  // Gizmo follows the selection (none in camera view).
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const en = selected ? t.entries.get(selected) : undefined;
    if (en && view === 'director') t.transform.attach(en.root);
    else t.transform.detach();
    t.transform.setMode(mode);
  }, [selected, view, mode, dir.objects.length]);

  // Play a captured motion on the selected character.
  useEffect(() => {
    if (!playing || !sel?.motionId) return;
    const clip = motions.find((m) => m.id === sel.motionId);
    if (!clip) return;
    const id = sel.id;
    const timer = setInterval(() => {
      setDir((d) => ({ ...d, objects: d.objects.map((o) => (o.id === id ? { ...o, motionFrame: ((o.motionFrame ?? 0) + 1) % clip.frames.length } : o)) }));
    }, 1000 / clip.fps);
    return () => clearInterval(timer);
  }, [playing, sel?.id, sel?.motionId, motions]);

  // Keyboard: W/E/R tools, Delete removes, Esc closes. Typing in fields is left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tgt.tagName)) return;
      if (e.key === 'Escape') close();
      if (e.key === 'w' || e.key === 'W') setMode('translate');
      if (e.key === 'e' || e.key === 'E') setMode('rotate');
      if (e.key === 'r' || e.key === 'R') setMode('scale');
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) removeObject(selected);
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
  };
  function removeObject(id: string) {
    setDir((d) => {
      const objects = d.objects.filter((o) => o.id !== id);
      return { ...d, objects, activeCamera: d.activeCamera === id ? (objects.find((o) => o.kind === 'camera')?.id ?? null) : d.activeCamera };
    });
    setSelected(null);
  }
  const duplicate = (o: DirObject) => {
    const copy = { ...structuredClone(o), id: nanoid(8), name: `${o.name} 副本`, position: [o.position[0] + 0.6, o.position[1], o.position[2]] as [number, number, number] };
    setDir((d) => ({ ...d, objects: [...d.objects, copy] }));
    setSelected(copy.id);
  };

  /** Point the active camera where the director view is looking. */
  const cameraFromView = () => {
    const t = three.current;
    const cam = dir.objects.find((o) => o.id === dir.activeCamera);
    if (!t || !cam) return;
    const p = t.camera.position;
    const tg = t.orbit.target;
    update(cam.id, { position: [round(p.x), round(p.y), round(p.z)], rotation: lookAtRotation([p.x, p.y, p.z], [tg.x, tg.y, tg.z]).map((v) => round(v, 1)) as [number, number, number] });
    notify(`已把「${cam.name}」移到当前导演视角`);
  };

  const screenshot = async () => {
    const t = three.current;
    const camEntry = dir.activeCamera ? t?.entries.get(dir.activeCamera) : undefined;
    const camObj = dir.objects.find((o) => o.id === dir.activeCamera);
    if (!t || !camEntry?.cam || !camObj) return notify('请先添加并选择一个机位');
    setShotBusy(true);
    try {
      const a = aspectValue(dir.aspect);
      const W = a >= 1 ? 1920 : Math.round(1920 * a);
      const H = Math.round(W / a);
      // Render the camera's frame offscreen, without gizmos, labels or grid.
      const target = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
      const hidden: THREE.Object3D[] = [t.helper, ...[...t.entries.values()].flatMap((en) => [en.label, en.cam ? en.root.children[0] : undefined].filter((x): x is THREE.Object3D => !!x))];
      const grid = t.scene.children.find((c) => c instanceof THREE.GridHelper);
      if (grid) hidden.push(grid);
      const was = hidden.map((h) => h.visible);
      hidden.forEach((h) => (h.visible = false));
      camEntry.cam.aspect = a;
      camEntry.cam.updateProjectionMatrix();
      t.renderer.setRenderTarget(target);
      t.renderer.render(t.scene, camEntry.cam);
      const px = new Uint8Array(W * H * 4);
      t.renderer.readRenderTargetPixels(target, 0, 0, W, H, px);
      t.renderer.setRenderTarget(null);
      hidden.forEach((h, i) => (h.visible = was[i]));
      target.dispose();
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      ctx.putImageData(img, 0, 0);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
      const media = await putMedia(blob, 'image', `${node.data.title}-${camObj.name}.png`, { w: W, h: H });
      placeShot(media, camObj.name);
      notify(`已截取「${camObj.name}」画面到画布`);
    } catch (err) {
      notify(`截图失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setShotBusy(false);
    }
  };

  /** Shots become image nodes next to the director node; the latest is also the node's output. */
  const placeShot = (media: MediaRef, camName: string) => {
    const s = useCanvas.getState();
    const me = s.nodes.find((n) => n.id === node.id);
    if (!me) return;
    const p = absPos(me, s.nodes);
    const count = s.edges.filter((e) => e.source === node.id).length;
    const img: CanvasNode = {
      id: nanoid(8),
      type: 'image',
      position: { x: p.x + sizeOf(me).w + 120, y: p.y + count * 260 },
      data: { title: `${me.data.title} · ${camName}`, outputs: [{ id: nanoid(6), createdAt: Date.now(), media }], current: 0, status: 'done' },
    };
    s.commit();
    const outputs = [...(me.data.outputs ?? []), { id: nanoid(6), createdAt: Date.now(), media }];
    useCanvas.setState({
      nodes: [...s.nodes.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, outputs, current: outputs.length - 1 } } : n)), img],
      edges: [...s.edges, { id: nanoid(8), source: node.id, target: img.id }],
    });
  };

  /** Build or rearrange the scene from a description (and any reference images wired in). */
  const buildWithAI = async () => {
    if (!aiText.trim()) return;
    setAiBusy(true);
    try {
      const s = useCanvas.getState();
      const refs = s.edges
        .filter((e) => e.target === node.id)
        .map((e) => s.nodes.find((n) => n.id === e.source))
        .map((n) => n && currentOutput(n.data)?.media)
        .filter((m): m is MediaRef => m?.kind === 'image');
      const prompt = `你是电影美术与摄影指导。根据下面的描述${refs.length ? '和附上的参考图' : ''}，搭建一个简化的 3D 场景，只输出 JSON，不要其他文字。
描述：${aiText.trim()}
坐标单位是米，地面是 y=0，x 向右、z 朝向镜头；人物约 1.75 米高，站在地面上。
JSON 格式：
{"objects":[{"kind":"character","name":"角色名","position":[x,0,z],"rotationY":角度,"pose":"姿势","color":"#RRGGBB"},{"kind":"prop","shape":"形状","name":"名称","position":[x,0,z],"rotationY":角度,"size":[宽,高,深],"color":"#RRGGBB"}],"camera":{"position":[x,y,z],"lookAt":[x,y,z],"fov":角度},"background":"#RRGGBB"}
pose 只能从这些里选：${POSE_NAMES.join('、')}。shape 只能从这些里选：${Object.keys(PROP_LABEL).join('、')}（size 是相对默认尺寸的缩放倍数，默认 [1,1,1]）。rotationY 为 0 表示面向镜头。fov 一般 25 到 60。`;
      const text = await generateText(engine, prompt, refs);
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0) throw new Error('AI 没有返回场景数据');
      const plan = JSON.parse(text.slice(start, end + 1)) as {
        objects?: { kind: string; name?: string; position?: number[]; rotationY?: number; pose?: string; color?: string; shape?: string; size?: number[] }[];
        camera?: { position?: number[]; lookAt?: number[]; fov?: number };
        background?: string;
      };
      const vec = (v: number[] | undefined, d: [number, number, number]): [number, number, number] => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? [v[0], v[1], v[2]] : d);
      setDir((d) => {
        const cams = d.objects.filter((o) => o.kind === 'camera');
        const draft: DirScene = { ...d, objects: cams };
        const objects: DirObject[] = [];
        for (const it of plan.objects ?? []) {
          const isChar = it.kind === 'character';
          const shape = (Object.keys(PROP_LABEL) as PropShape[]).includes(it.shape as PropShape) ? (it.shape as PropShape) : 'box';
          const o = newObject(isChar ? 'character' : 'prop', { ...draft, objects: [...cams, ...objects] }, {
            ...(it.name ? { name: it.name } : {}),
            position: vec(it.position, [0, 0, 0]),
            rotation: [0, Number(it.rotationY) || 0, 0],
            ...(isChar ? { poseName: POSE_NAMES.includes(it.pose ?? '') ? it.pose : '站立' } : { shape, scale: vec(it.size, [1, 1, 1]) }),
            ...(it.color && /^#[0-9a-f]{6}$/i.test(it.color) ? { color: it.color } : {}),
          });
          objects.push(o);
        }
        let camObjs = cams;
        const active = cams.find((c) => c.id === d.activeCamera) ?? cams[0];
        if (plan.camera && active) {
          const pos = vec(plan.camera.position, active.position);
          const at = vec(plan.camera.lookAt, [0, 1, 0]);
          camObjs = cams.map((c) => (c.id === active.id ? { ...c, position: pos, rotation: lookAtRotation(pos, at), fov: Number(plan.camera?.fov) || c.fov } : c));
        }
        return { ...d, objects: [...camObjs, ...objects], background: plan.background && /^#[0-9a-f]{6}$/i.test(plan.background) ? plan.background : d.background };
      });
      setSelected(null);
      notify(`已按描述搭建场景（${(plan.objects ?? []).length} 个物体）`);
      setAiText('');
    } catch (err) {
      notify(`搭建失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setAiBusy(false);
    }
  };

  // ---- panels ---------------------------------------------------------------
  const listed = dir.objects.filter((o) => !q.trim() || o.name.includes(q.trim()));
  const icon = (o: DirObject) => (o.kind === 'camera' ? 'video' : o.kind === 'character' ? 'person' : 'cube');
  const pose: Pose = sel?.pose ?? POSES[sel?.poseName ?? '站立'] ?? { joints: {} };
  const jointVal = pose.joints[joint] ?? [0, 0, 0];
  const setJointAxis = (axis: number, v: number) => {
    if (!sel) return;
    const next: Pose = { hipsDrop: pose.hipsDrop, joints: { ...structuredClone(pose.joints), [joint]: jointVal.map((x, i) => (i === axis ? v : x)) as [number, number, number] } };
    update(sel.id, { pose: next, poseName: '自定义', motionId: undefined });
  };
  const clip = sel?.motionId ? motions.find((m) => m.id === sel.motionId) : undefined;
  const cameras = dir.objects.filter((o) => o.kind === 'camera');

  const vecField = (label: string, key: 'position' | 'rotation' | 'scale', step: number) =>
    sel && (
      <div className="dr-field">
        <span>{label}</span>
        <div className="dr-vec">
          {(['X', 'Y', 'Z'] as const).map((ax, i) => (
            <label key={ax}>
              <i>{ax}</i>
              <input
                type="number"
                step={step}
                value={sel[key][i]}
                onChange={(e) => {
                  const v = [...sel[key]] as [number, number, number];
                  v[i] = Number(e.target.value) || 0;
                  update(sel.id, { [key]: v });
                }}
              />
            </label>
          ))}
        </div>
      </div>
    );

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
        <button className="primary-btn" disabled={shotBusy} onClick={screenshot}>
          {shotBusy ? '截图中…' : '截图到画布'}
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
                {(Object.keys(PROP_LABEL) as PropShape[]).map((s) => (
                  <button key={s} onClick={() => addObject('prop', { shape: s })}>
                    {PROP_LABEL[s]}
                  </button>
                ))}
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
              {o.kind === 'camera' && o.id === dir.activeCamera && <small>当前</small>}
            </button>
          ))}
        </div>
      </aside>

      <main className="dr-main">
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
          <input
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && buildWithAI()}
            placeholder="描述想要搭建的场景，例如：两个人在咖啡馆窗边对坐，低角度中景"
            disabled={aiBusy}
          />
          <select className="pp-select" value={engine} onChange={(e) => setEngine(e.target.value)}>
            {MODELS.text.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button className="pp-go" disabled={aiBusy || !aiText.trim()} onClick={buildWithAI} title="由 AI 搭建场景">
            {aiBusy ? <span className="spinner" /> : <Icon name="arrowUp" size={16} />}
          </button>
        </div>
      </main>

      <aside className="dr-right">
        {!sel ? (
          <div className="dr-empty">
            <p className="muted">在场景中点选物体，或在左侧列表选择。</p>
            <label className="dr-field">
              <span>背景颜色</span>
              <input type="color" value={dir.background} onChange={(e) => setDir((d) => ({ ...d, background: e.target.value }))} />
            </label>
          </div>
        ) : (
          <>
            <div className="dr-right-head">
              <b>{sel.kind === 'character' ? '角色' : sel.kind === 'camera' ? '机位' : '道具'}</b>
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
                {vecField('旋转', 'rotation', 5)}
                {sel.kind !== 'camera' && vecField('缩放', 'scale', 0.1)}
                {sel.kind !== 'camera' && (
                  <label className="dr-field">
                    <span>统一缩放 {sel.scale[0].toFixed(2)}</span>
                    <input type="range" min={0.2} max={3} step={0.01} value={sel.scale[0]} onChange={(e) => update(sel.id, { scale: [Number(e.target.value), Number(e.target.value), Number(e.target.value)] })} />
                  </label>
                )}
                {sel.kind === 'camera' && (
                  <>
                    <label className="dr-field">
                      <span>视野 {sel.fov ?? 40}°（约 {Math.round(12 / Math.tan(R((sel.fov ?? 40) / 2)))}mm）</span>
                      <input type="range" min={10} max={100} step={1} value={sel.fov ?? 40} onChange={(e) => update(sel.id, { fov: Number(e.target.value) })} />
                    </label>
                    <button className="text-btn" onClick={() => setDir((d) => ({ ...d, activeCamera: sel.id }))} disabled={dir.activeCamera === sel.id}>
                      设为当前机位
                    </button>
                  </>
                )}
                {sel.kind !== 'camera' && (
                  <label className="dr-field">
                    <span>颜色</span>
                    <input type="color" value={sel.color} onChange={(e) => update(sel.id, { color: e.target.value })} />
                  </label>
                )}
              </div>
            )}
            {sel.kind === 'character' && tab === 'pose' && (
              <div className="dr-props-panel">
                <span className="dr-sub">预设姿势</span>
                <div className="dr-poses">
                  {POSE_NAMES.map((p) => (
                    <button key={p} className={!sel.motionId && sel.poseName === p ? 'on' : ''} onClick={() => update(sel.id, { poseName: p, pose: undefined, motionId: undefined })}>
                      {p}
                    </button>
                  ))}
                </div>
                <span className="dr-sub">关节微调{!sel.motionId && sel.poseName === '自定义' ? '（自定义）' : ''}</span>
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
                {motions.length === 0 ? (
                  <p className="muted small">还没有动作。选中画布上的视频节点，点「动作捕捉」即可从视频生成人物动作。</p>
                ) : (
                  <>
                    <select
                      className="pp-select"
                      value={sel.motionId ?? ''}
                      onChange={(e) => {
                        setPlaying(false);
                        update(sel.id, { motionId: e.target.value || undefined, motionFrame: 0 });
                      }}
                    >
                      <option value="">不使用动作（用上面的姿势）</option>
                      {motions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}（{(m.frames.length / m.fps).toFixed(1)} 秒）
                        </option>
                      ))}
                    </select>
                    {clip && (
                      <div className="dr-timeline">
                        <button className="icon-btn" onClick={() => setPlaying(!playing)} title={playing ? '暂停' : '播放'}>
                          <Icon name={playing ? 'pause' : 'play'} size={14} />
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={clip.frames.length - 1}
                          value={sel.motionFrame ?? 0}
                          onChange={(e) => {
                            setPlaying(false);
                            update(sel.id, { motionFrame: Number(e.target.value) });
                          }}
                        />
                        <small>{((sel.motionFrame ?? 0) / clip.fps).toFixed(1)}s</small>
                      </div>
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

/** Canvas body of a director node: the latest screenshot, or a hint. */
export function useDirectorSummary(node: CanvasNode) {
  return useMemo(() => {
    const sc = node.data.scene;
    if (!sc) return '空场景';
    const n = (k: string) => sc.objects.filter((o) => o.kind === k).length;
    return `${n('character')} 个人物 · ${n('prop')} 个道具 · ${n('camera')} 个机位`;
  }, [node.data.scene]);
}
