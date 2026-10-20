import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { nanoid } from 'nanoid';
import { useShallow } from 'zustand/react/shallow';
import { MODELS, defaultParams } from './config';
import { Icon } from './Icon';
import { useMediaUrl } from './media';
import { currentProjectId } from './project';
import { absPos, currentOutput, sizeOf, useCanvas } from './store';
import { useUI } from './ui';
import type { CanvasEdge, CanvasNode, MediaRef } from './types';

async function videoApi<T>(tool: string, body: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/video/${tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, project: currentProjectId() }),
    });
  } catch {
    throw new Error('本地服务未启动：请重新打开 WCcanvastv');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`);
  return data as T;
}

const nodeOf = (id: string) => useCanvas.getState().nodes.find((n) => n.id === id);
const videoOf = (id: string) => {
  const n = nodeOf(id);
  const m = n && currentOutput(n.data)?.media;
  return n && m?.kind === 'video' ? { node: n, media: m } : null;
};
const setBusy = (id: string, busy?: string) => useCanvas.getState().updateData(id, { busy });

/**
 * Where to put a w×h block of new nodes next to `n`: to its right, moved down past whatever
 * already sits there (earlier results), then further right if that column is full.
 */
function rightOf(n: CanvasNode, w = 360, h = 300) {
  const nodes = useCanvas.getState().nodes;
  const p = absPos(n, nodes);
  const boxes = nodes.filter((m) => !m.parentId && m.id !== n.id).map((m) => ({ ...absPos(m, nodes), ...sizeOf(m) }));
  const gap = 60;
  const free = (x: number, y: number) => !boxes.some((b) => x < b.x + b.w + gap && x + w + gap > b.x && y < b.y + b.h + gap && y + h + gap > b.y);
  for (let col = 0; col < 6; col++) {
    const x = p.x + sizeOf(n).w + 160 + col * (w + 120);
    for (let y = p.y; y < p.y + 4000; y += 40) if (free(x, y)) return { x, y };
  }
  return { x: p.x + sizeOf(n).w + 160, y: p.y };
}

function mediaNode(media: MediaRef, x: number, y: number, title: string): CanvasNode {
  return {
    id: nanoid(8),
    type: media.kind,
    position: { x, y },
    data: { title, outputs: [{ id: nanoid(6), createdAt: Date.now(), media }], current: 0, status: 'done' },
  };
}

/** Adds nodes and edges as one undo step. */
function addGraph(nodes: CanvasNode[], edges: Omit<CanvasEdge, 'id'>[]) {
  const s = useCanvas.getState();
  s.commit();
  useCanvas.setState({
    nodes: [...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...nodes],
    edges: [...s.edges, ...edges.map((e) => ({ ...e, id: nanoid(8) }))],
  });
}

const titleBase = (n: CanvasNode) => n.data.title.replace(/[-·\s]*(无声|音频|裁切)$/, '');

// ---------------------------------------------------------------------------
// Audio / video separation
// ---------------------------------------------------------------------------

export async function separateAudio(id: string) {
  const v = videoOf(id);
  if (!v) return;
  const notify = useUI.getState().notify;
  setBusy(id, '正在分离音视频…');
  try {
    const r = await videoApi<{ video: MediaRef; audio: MediaRef }>('separate', { id: v.media.id });
    const h = r.video.w && r.video.h ? (360 * r.video.h) / r.video.w : 200;
    const at = rightOf(v.node, 360, h + 90 + 160);
    const base = titleBase(v.node);
    const video = mediaNode(r.video, at.x, at.y, `${base} · 无声`);
    const audio = mediaNode(r.audio, at.x, at.y + h + 90, `${base} · 音频`);
    addGraph([video, audio], [
      { source: id, target: video.id },
      { source: id, target: audio.id },
    ]);
    notify('已分离出无声视频和音频，文件已存进项目文件夹');
  } catch (err) {
    notify(err instanceof Error ? err.message : String(err));
  } finally {
    setBusy(id, undefined);
  }
}

// ---------------------------------------------------------------------------
// Toolbar buttons on a selected video node
// ---------------------------------------------------------------------------

export function VideoToolButtons({ id }: { id: string }) {
  const set = useUI((s) => s.set);
  return (
    <>
      <button onClick={() => set({ breakdownFor: id })} title="识别镜头切换、截取关键帧，并由 AI 逐镜头分析">
        <Icon name="film" size={14} />
        <span>逐帧拉片</span>
      </button>
      <button onClick={() => set({ cropFor: id })} title="裁切画面，导出新视频">
        <Icon name="expand" size={14} />
        <span>画面裁切</span>
      </button>
      <button onClick={() => separateAudio(id)} title="拆成无声视频和音频两个文件">
        <Icon name="audio" size={14} />
        <span>音视频分离</span>
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number };

const RATIOS: [string, number | null][] = [
  ['自由', null],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['2.39:1', 2.39],
];

/** The largest centred rect of pixel aspect `a` inside a W×H frame, in fractions. */
function fitRatio(a: number, W: number, H: number): Rect {
  const frame = W / H;
  const w = a >= frame ? 1 : (a * H) / W;
  const h = a >= frame ? W / H / a : 1;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export function CropModal() {
  const { cropFor, set, notify } = useUI(useShallow((s) => ({ cropFor: s.cropFor, set: s.set, notify: s.notify })));
  const node = useCanvas((s) => (cropFor ? s.nodes.find((n) => n.id === cropFor) : undefined));
  const media = node && currentOutput(node.data)?.media;
  const url = useMediaUrl(media?.id);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [ratio, setRatio] = useState<number | null>(null);
  const [busy, setBusyState] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'resize'; sx: number; sy: number; start: Rect } | null>(null);

  useEffect(() => {
    setRect({ x: 0, y: 0, w: 1, h: 1 });
    setRatio(null);
    setDims(null);
  }, [cropFor]);

  if (!cropFor || !node || !media) return null;
  const close = () => !busy && set({ cropFor: null });

  const onDown = (mode: 'move' | 'resize') => (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: rect };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const b = box.current?.getBoundingClientRect();
    if (!d || !b) return;
    const dx = (e.clientX - d.sx) / b.width;
    const dy = (e.clientY - d.sy) / b.height;
    if (d.mode === 'move') {
      setRect({ ...d.start, x: Math.max(0, Math.min(1 - d.start.w, d.start.x + dx)), y: Math.max(0, Math.min(1 - d.start.h, d.start.y + dy)) });
    } else {
      let w = Math.max(0.05, Math.min(1 - d.start.x, d.start.w + dx));
      let h = Math.max(0.05, Math.min(1 - d.start.y, d.start.h + dy));
      if (ratio && dims) {
        // Keep the pixel aspect: follow the horizontal drag, then shrink both if it would overflow.
        h = (w * dims.w) / dims.h / ratio;
        if (d.start.y + h > 1) {
          h = 1 - d.start.y;
          w = (h * ratio * dims.h) / dims.w;
        }
      }
      setRect({ ...d.start, w, h });
    }
  };

  const pick = (r: number | null) => {
    setRatio(r);
    setRect(r && dims ? fitRatio(r, dims.w, dims.h) : { x: 0, y: 0, w: 1, h: 1 });
  };

  const apply = async () => {
    setBusyState(true);
    try {
      const r = await videoApi<{ video: MediaRef }>('crop', { id: media.id, ...rect });
      const vw = r.video.w ?? 16;
      const vh = r.video.h ?? 9;
      const ow = vh > vw ? 288 : 360;
      const at = rightOf(node, ow, (ow * vh) / vw + 40);
      const out = mediaNode(r.video, at.x, at.y, `${titleBase(node)} · 裁切`);
      addGraph([out], [{ source: node.id, target: out.id }]);
      notify(`已导出裁切后的视频（${r.video.w}×${r.video.h}）`);
      set({ cropFor: null });
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyState(false);
    }
  };

  const px = dims ? `${Math.round(rect.w * dims.w)} × ${Math.round(rect.h * dims.h)}` : '';
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal crop-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">画面裁切 · {node.data.title}</h3>
          <div className="grow" />
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="crop-body">
          <div className="crop-stage" ref={box} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
            {url && (
              <video
                src={url}
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  setDims({ w: v.videoWidth, h: v.videoHeight });
                  v.currentTime = Math.min(1, (v.duration || 2) / 2);
                }}
              />
            )}
            <div className="crop-rect" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} onPointerDown={onDown('move')}>
              <span className="crop-size">{px}</span>
              <i className="crop-handle" onPointerDown={onDown('resize')} />
            </div>
          </div>
          <div className="crop-bar">
            <div className="seg">
              {RATIOS.map(([label, r]) => (
                <button key={label} className={ratio === r ? 'on' : ''} disabled={!dims && r !== null} onClick={() => pick(r)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="grow" />
            <span className="muted small">拖动框选区域，右下角调整大小</span>
            <button className="primary-btn" disabled={busy || !dims} onClick={apply}>
              {busy ? '正在导出…' : '导出裁切视频'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shot breakdown
// ---------------------------------------------------------------------------

const DIMENSIONS = [
  { key: 'shot', label: '分镜', desc: '景别、构图、画面内容与人物动作' },
  { key: 'camera', label: '运镜', desc: '推测的镜头运动（推、拉、摇、移、跟、升降或固定）' },
  { key: 'light', label: '光影色调', desc: '光线方向与质感、色彩基调和氛围' },
  { key: 'sound', label: '声音音乐', desc: '根据画面推测适合的音乐与音效（注明为推测）' },
] as const;

const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export async function runBreakdown(id: string, opts: { dims: string[]; max: number; engine: string }) {
  const v = videoOf(id);
  if (!v) return;
  const notify = useUI.getState().notify;
  setBusy(id, '正在识别镜头切换、截取关键帧…');
  try {
    const kf = await videoApi<{ duration: number; frames: (MediaRef & { time: number })[] }>('keyframes', { id: v.media.id, max: opts.max });
    const cols = Math.min(4, kf.frames.length);
    const fw = 300;
    const fh = (kf.frames[0]?.w && kf.frames[0]?.h ? (fw * kf.frames[0].h) / kf.frames[0].w : 170) + 70;
    const at = rightOf(v.node, cols * (fw + 40) + 120 + 340, Math.max(Math.ceil(kf.frames.length / cols) * fh, 400));
    const frames = kf.frames.map((f, i) => mediaNode(f, at.x + (i % cols) * (fw + 40), at.y + Math.floor(i / cols) * fh, `关键帧 ${clock(f.time)}`));
    const dims = DIMENSIONS.filter((d) => opts.dims.includes(d.key));
    const name = titleBase(v.node);
    const prompt =
      `以下 ${frames.length} 张参考图是视频「${name}」（时长 ${clock(kf.duration)}）按时间顺序截取的关键帧，` +
      `分别位于 ${kf.frames.map((f) => clock(f.time)).join('、')}，每张代表一个镜头的开始。` +
      `请像专业剪辑师拉片一样，逐个镜头分析：${dims.map((d) => `${d.label}（${d.desc}）`).join('；')}。`;
    const script: CanvasNode = {
      id: nanoid(8),
      type: 'script',
      position: { x: at.x + cols * (fw + 40) + 120, y: at.y },
      selected: true,
      data: {
        title: `拉片 · ${name}`,
        model: MODELS.script.some((m) => m.id === opts.engine) ? opts.engine : MODELS.script[0].id,
        params: { ...defaultParams('script'), mode: 'breakdown', shots: frames.length },
        prompt,
      },
    };
    addGraph(
      [...frames, script],
      [{ source: id, target: frames[0].id }, ...frames.map((f) => ({ source: f.id, target: script.id }))],
    );
    setBusy(id, undefined);
    notify(`截取了 ${frames.length} 个镜头的关键帧，正在逐镜头分析…`);
    await useCanvas.getState().run([script.id]);
  } catch (err) {
    notify(err instanceof Error ? err.message : String(err));
  } finally {
    setBusy(id, undefined);
  }
}

export function BreakdownModal() {
  const { breakdownFor, set } = useUI(useShallow((s) => ({ breakdownFor: s.breakdownFor, set: s.set })));
  const node = useCanvas((s) => (breakdownFor ? s.nodes.find((n) => n.id === breakdownFor) : undefined));
  const [dims, setDims] = useState<string[]>(['shot', 'camera', 'light']);
  const [max, setMax] = useState(12);
  const [engine, setEngine] = useState('chatgpt');
  if (!breakdownFor || !node) return null;
  const close = () => set({ breakdownFor: null });
  const toggle = (k: string) => setDims(dims.includes(k) ? dims.filter((x) => x !== k) : [...dims, k]);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal breakdown-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">逐帧拉片 · {node.data.title}</h3>
          <div className="grow" />
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="prefs-body">
          <p className="muted">自动识别镜头切换并截取每个镜头的关键帧，再把关键帧交给 AI 逐镜头分析，结果生成为一个分镜脚本节点。</p>
          <h4 className="bd-h">拆解维度</h4>
          <div className="bd-dims">
            {DIMENSIONS.map((d) => (
              <label key={d.key} className={`bd-dim ${dims.includes(d.key) ? 'on' : ''}`}>
                <input type="checkbox" checked={dims.includes(d.key)} onChange={() => toggle(d.key)} />
                <b>{d.label}</b>
                <small>{d.desc}</small>
              </label>
            ))}
          </div>
          <div className="fields">
            <label className="field">
              <span>最多镜头数</span>
              <select className="pp-select" value={max} onChange={(e) => setMax(Number(e.target.value))}>
                {[6, 9, 12, 16, 24].map((n) => (
                  <option key={n} value={n}>
                    {n} 个
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>分析用的 AI</span>
              <select className="pp-select" value={engine} onChange={(e) => setEngine(e.target.value)}>
                {MODELS.script.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small">声音音乐只能根据画面推测，AI 听不到视频里的声音。</p>
          <div className="row">
            <button className="text-btn" onClick={close}>
              取消
            </button>
            <button
              className="primary-btn"
              disabled={!dims.length}
              onClick={() => {
                close();
                runBreakdown(node.id, { dims, max, engine });
              }}
            >
              开始拉片
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
