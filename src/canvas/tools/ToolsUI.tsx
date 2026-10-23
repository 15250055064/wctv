import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { nanoid } from 'nanoid';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from '../Icon';
import { revealInFinder, useMediaUrl } from '../media';
import { currentProjectId } from '../project';
import { currentOutput, useCanvas } from '../store';
import { useUI } from '../ui';
import { addGraph, mediaNode, rightOf, titleBase } from '../videoTools';
import type { CanvasNode, MediaKind, MediaRef } from '../types';
import type { Area, BackgroundMode, SubtitleZone } from './video';

// The local media tools in the app: a 工具 menu on image, audio and video nodes, an options
// window per tool, and the code that runs a tool and puts its results on the canvas.
// The heavy parts (models, ONNX runtime) are imported only when a tool runs.

export type Tool = { name: string; label: string; icon: string; desc: string; /** Opens the options window instead of running at once. */ dialog?: boolean };

export const IMAGE_TOOLS: Tool[] = [
  { name: 'cutout', label: '一键抠图', icon: 'magnet', desc: '去掉背景，得到透明底的主体' },
  { name: 'decompose', label: '图片拆解', icon: 'layers', desc: '拆成背景 + 主体图层，可导出 PSD', dialog: true },
  { name: 'eraser', label: '魔法橡皮擦', icon: 'trash', desc: '涂抹要去掉的东西，自动补全画面', dialog: true },
  { name: 'upscale', label: '高清放大', icon: 'expand', desc: '放大 2 倍或 4 倍，补出细节', dialog: true },
  { name: 'blur', label: '背景虚化', icon: 'aperture', desc: '主体清晰、背景按远近虚化，也可导出景深图', dialog: true },
  { name: 'vectorize', label: '转矢量 SVG', icon: 'shapes', desc: '描摹成可无限放大的矢量图', dialog: true },
  { name: 'ocr', label: '识别文字', icon: 'text', desc: '把图里的文字提取成文本' },
  { name: 'palette', label: '提取配色', icon: 'palette', desc: '找出主要颜色和色值' },
  { name: 'compress', label: '压缩 / 转格式', icon: 'download', desc: '转 JPEG、WebP、PNG，调整质量和尺寸', dialog: true },
];
export const AUDIO_TOOLS: Tool[] = [
  { name: 'transcribe', label: '转文字', icon: 'text', desc: '识别说话或歌词，带时间', dialog: true },
  { name: 'separate', label: '人声伴奏分离', icon: 'audio', desc: '拆成人声和伴奏两个文件' },
  { name: 'denoise', label: '降噪', icon: 'mic', desc: '去掉人声录音里的背景噪音' },
];
export const VIDEO_TOOLS: Tool[] = [
  { name: 'trim', label: '剪辑修剪', icon: 'clip', desc: '剪头尾、保留多段、变速', dialog: true },
  { name: 'scenes', label: '自动分镜', icon: 'film', desc: '按镜头切换拆成多个片段', dialog: true },
  { name: 'vupscale', label: '视频高清', icon: 'sparkles', desc: '分辨率翻倍，最高 4K', dialog: true },
  { name: 'interpolate', label: '补帧变流畅', icon: 'play', desc: '帧率翻倍（如 30 → 60 帧）' },
  { name: 'bgremove', label: '视频去背景', icon: 'magnet', desc: '透明背景、绿幕或白底', dialog: true },
  { name: 'subtitles', label: '智能去字幕', icon: 'text', desc: '自动找出每帧的字幕并抹掉', dialog: true },
  { name: 'watermark', label: '视频去水印', icon: 'trash', desc: '框出固定位置的水印或字幕', dialog: true },
  ...AUDIO_TOOLS,
];
const TOOLS_BY_KIND: Record<MediaKind, Tool[]> = { image: IMAGE_TOOLS, audio: AUDIO_TOOLS, video: VIDEO_TOOLS };

// ---- Running a tool ------------------------------------------------------------------------

const nodeMedia = (id: string) => {
  const n = useCanvas.getState().nodes.find((x) => x.id === id);
  const m = n && currentOutput(n.data)?.media;
  return n && m ? { node: n, media: m } : null;
};
const setBusy = (id: string, busy?: string) => useCanvas.getState().updateData(id, { busy });
const notify = (m: string) => useUI.getState().notify(m);

/** A server tool (server/tools): starts the job and follows it; resolves with the files it made. */
async function serverTool(name: string, body: object, onProgress: (m: string) => void) {
  const res = await fetch(`/api/tools/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, project: currentProjectId() }) }).catch(() => {
    throw new Error('本地服务未启动：请重新打开 WCcanvastv');
  });
  const { id, error } = await res.json();
  if (!res.ok) throw new Error(error ?? `请求失败（${res.status}）`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const job = await fetch(`/api/jobs/${id}`).then((r) => r.json());
    if (job.log?.length) onProgress(job.log[job.log.length - 1]);
    if (job.status === 'done') return job.files as (MediaRef & { label?: string; seconds?: number })[];
    if (job.status !== 'running') throw new Error(job.error ?? '处理失败');
  }
}

type Result = { media?: MediaRef; text?: string; title: string };

/** Puts results to the right of the source node, connected to it, as one undo step. */
function place(src: CanvasNode, results: Result[]) {
  const nodes: CanvasNode[] = [];
  let at = rightOf(src, 360, 300);
  for (const r of results) {
    const h = r.media?.w && r.media?.h ? (360 * r.media.h) / r.media.w : r.text ? 260 : 120;
    const n: CanvasNode = r.media ? mediaNode(r.media, at.x, at.y, r.title) : { id: nanoid(8), type: 'text', position: at, data: { title: r.title, text: r.text } };
    nodes.push(n);
    at = { x: at.x, y: at.y + h + 90 };
  }
  addGraph(
    nodes,
    nodes.map((n) => ({ source: src.id, target: n.id })),
  );
  return nodes;
}

/** Runs a tool on a node: busy overlay while it works, results on the canvas, errors as a toast. */
async function run(id: string, label: string, work: (m: { node: CanvasNode; media: MediaRef }, say: (msg: string) => void) => Promise<Result[] | void>) {
  const src = nodeMedia(id);
  if (!src) return notify('这个节点还没有内容');
  const say = (msg: string) => setBusy(id, msg);
  say(`${label}…`);
  try {
    const results = await work(src, say);
    if (results?.length) place(src.node, results);
  } catch (err) {
    notify(`${label}失败：${err instanceof Error ? err.message : err}`);
  } finally {
    setBusy(id, undefined);
  }
}

const serverResults = (files: (MediaRef & { label?: string })[], base: string, fallback: string): Result[] =>
  files.map((f) => ({ media: { id: f.id, kind: f.kind, name: f.name, ...(f.w && f.h ? { w: f.w, h: f.h } : {}) }, title: `${base} · ${f.label ?? fallback}` }));

export async function runTool(name: string, id: string, opts: Record<string, unknown> = {}) {
  // File and node names: the source's title without bracketed notes such as a clip's time range.
  const base = (n: CanvasNode) => titleBase(n).replace(/[（(][^）)]*[）)]/g, '').trim().slice(0, 30) || '素材';
  switch (name) {
    case 'cutout':
      return run(id, '一键抠图', async ({ node, media }, say) => {
        const t = await import('./image');
        return [{ media: await t.cutout(media, base(node), say), title: `${base(node)} · 抠图` }];
      });
    case 'ocr':
      return run(id, '识别文字', async ({ node, media }, say) => {
        const t = await import('./image');
        const lines = await t.recognizeText(await t.loadImage(media), say);
        if (!lines.length) throw new Error('没有识别到文字');
        return [{ text: lines.map((l) => l.text).join('\n'), title: `${base(node)} · 文字` }];
      });
    case 'palette':
      return run(id, '提取配色', async ({ node, media }) => {
        const t = await import('./image');
        const colors = t.palette(await t.loadImage(media));
        if (!colors.length) throw new Error('没有读到颜色');
        const list = colors.map((c) => `${c.hex.toUpperCase()}  ${Math.round(c.share * 100)}%`).join('\n');
        navigator.clipboard.writeText(colors.map((c) => c.hex.toUpperCase()).join(' ')).catch(() => {});
        notify('色值已复制到剪贴板');
        return [
          { media: await t.saveCanvas(t.paletteCard(colors), `${base(node)}-配色.png`), title: `${base(node)} · 配色` },
          { text: list, title: `${base(node)} · 色值` },
        ];
      });
    case 'upscale':
      return run(id, '高清放大', async ({ node, media }, say) => serverResults(await serverTool('upscale', { id: media.id, scale: opts.scale, anime: opts.anime }, say), base(node), `放大 ${opts.scale} 倍`));
    case 'vectorize':
      return run(id, '转矢量', async ({ node, media }, say) => serverResults(await serverTool('vectorize', { id: media.id, preset: opts.preset }, say), base(node), '矢量 SVG'));
    case 'blur':
      return run(id, '背景虚化', async ({ node, media }, say) => {
        const t = await import('./image');
        const { blurred, depthMap } = await t.depthBlur(await t.loadImage(media), Number(opts.strength) || 1, say);
        const out: Result[] = [{ media: await t.saveCanvas(blurred, `${base(node)}-虚化.png`), title: `${base(node)} · 背景虚化` }];
        if (opts.depthMap) out.push({ media: await t.saveCanvas(depthMap, `${base(node)}-景深图.png`), title: `${base(node)} · 景深图` });
        return out;
      });
    case 'compress':
      return run(id, '压缩 / 转格式', async ({ node, media }) => {
        const t = await import('./image');
        const r = await t.compress(media, opts as { format: 'JPEG' | 'WebP' | 'PNG'; quality: number; maxSide: number }, `${base(node)}-${opts.format}`);
        const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
        notify(`${kb(r.before)} → ${kb(r.after)}（${r.after < r.before ? `小了 ${Math.round((1 - r.after / r.before) * 100)}%` : '没有变小'}）`);
        return [{ media: r.media, title: `${base(node)} · ${opts.format} ${kb(r.after)}` }];
      });
    case 'eraser':
      return run(id, '魔法橡皮擦', async ({ node }, say) => {
        const t = await import('./image');
        const result = opts.canvas as HTMLCanvasElement;
        say('正在保存…');
        return [{ media: await t.saveCanvas(result, `${base(node)}-擦除.png`), title: `${base(node)} · 擦除后` }];
      });
    case 'decompose':
      return run(id, '图片拆解', async ({ node, media }, say) => {
        const d = await import('./decompose');
        const r = await d.decompose(media, opts.background === 'local' ? 'local' : 'chatgpt', base(node), say);
        placeLayers(node, r);
        notify(`已拆成背景和 ${r.layers.length} 个主体图层，选中分组可以「导出 PSD」`);
      });
    case 'transcribe':
      return run(id, '转文字', async ({ node, media }, say) => {
        const sp = await import('./speech');
        const segs = await sp.transcribe(media, String(opts.language ?? 'zh'), say);
        if (!segs.length) throw new Error('没有识别到说话或歌词');
        return [{ text: opts.timestamps === false ? segs.map((s) => s.text).join('\n') : sp.timedText(segs), title: `${base(node)} · 文字` }];
      });
    case 'separate':
      return run(id, '人声伴奏分离', async ({ node, media }, say) => serverResults(await serverTool('separate', { id: media.id }, say), base(node), '分离'));
    case 'denoise':
      return run(id, '降噪', async ({ node, media }, say) => serverResults(await serverTool('denoise', { id: media.id }, say), base(node), '降噪'));
    case 'vupscale':
      return run(id, '视频高清', async ({ node, media }, say) => serverResults(await serverTool('vupscale', { id: media.id }, say), base(node), '高清'));
    case 'interpolate':
      return run(id, '补帧', async ({ node, media }, say) => serverResults(await serverTool('interpolate', { id: media.id }, say), base(node), '补帧'));
    case 'trim':
      return run(id, '剪辑', async ({ node, media }, say) => serverResults(await serverTool('trim', { id: media.id, ranges: opts.ranges, speed: opts.speed }, say), base(node), '剪辑'));
    case 'scenes':
      return run(id, '自动分镜', async ({ node, media }, say) => {
        const files = await serverTool('scenes', { id: media.id, threshold: opts.threshold }, say);
        notify(`已拆成 ${files.length} 个镜头`);
        return serverResults(files, base(node), '镜头');
      });
    case 'bgremove':
      return run(id, '视频去背景', async ({ node, media }, say) => {
        const v = await import('./video');
        const r = await v.removeVideoBackground(media, opts.mode as BackgroundMode, base(node), say);
        if (r.truncated) notify('视频超过 2 分钟，只处理了前 120 秒');
        return [{ media: r.media, title: `${base(node)} · 去背景（${opts.mode}）` }];
      });
    case 'subtitles':
      return run(id, '智能去字幕', async ({ node, media }, say) => {
        const v = await import('./video');
        const r = await v.removeVideoSubtitles(media, opts.zone as SubtitleZone, base(node), say);
        if (r.truncated) notify('视频超过 2 分钟，只处理了前 120 秒');
        return [{ media: r.media, title: `${base(node)} · 去字幕` }];
      });
    case 'watermark':
      return run(id, '视频去水印', async ({ node, media }, say) => {
        const v = await import('./video');
        const r = await v.removeVideoWatermark(media, opts.areas as Area[], base(node), say);
        if (r.truncated) notify('视频超过 2 分钟，只处理了前 120 秒');
        return [{ media: r.media, title: `${base(node)} · 去水印` }];
      });
  }
}

/** Decomposition result: background and subject layers side by side in a group that can export a PSD. */
function placeLayers(src: CanvasNode, r: import('./decompose').Decomposition) {
  const W = 300;
  const at = rightOf(src, (W + 40) * (r.layers.length + 1), 400);
  const items = [{ media: r.background, name: '背景', x: 0, y: 0 }, ...r.layers];
  const nodes = items.map((l, i) => {
    const n = mediaNode(l.media, at.x + i * (W + 40), at.y, `${titleBase(src).slice(0, 20)} · ${l.name}`);
    n.data.layer = { x: l.x, y: l.y, order: i };
    return n;
  });
  addGraph(nodes, [{ source: src.id, target: nodes[0].id }]);
  const s = useCanvas.getState();
  s.group(nodes.map((n) => n.id));
  const g = useCanvas.getState().nodes.find((n) => n.type === 'group' && n.selected);
  if (g) s.updateData(g.id, { title: `拆解 · ${titleBase(src).slice(0, 20)}`, psd: { w: r.width, h: r.height, name: `${titleBase(src).slice(0, 20)}-拆解` } });
}

/** 导出 PSD on a decomposition group: its layers in stacking order, at their original positions. */
export async function exportGroupPsd(groupId: string) {
  const s = useCanvas.getState();
  const g = s.nodes.find((n) => n.id === groupId);
  if (!g?.data.psd) return;
  const layers = s.nodes
    .filter((n) => n.parentId === groupId && n.data.layer)
    .map((n) => ({ layer: n.data.layer!, media: currentOutput(n.data)?.media, name: n.data.title.split(' · ').pop() ?? n.data.title }))
    .filter((l): l is { layer: { x: number; y: number; order: number }; media: MediaRef; name: string } => l.media?.kind === 'image')
    .sort((a, b) => a.layer.order - b.layer.order);
  if (!layers.length) return notify('分组里没有图层');
  setBusy(groupId, '正在生成 PSD…');
  try {
    const d = await import('./decompose');
    const saved = await d.exportPsd({ width: g.data.psd.w, height: g.data.psd.h, layers: layers.map((l) => ({ name: l.name, media: l.media, x: l.layer.x, y: l.layer.y })) }, g.data.psd.name, () => {});
    revealInFinder(saved.id);
    notify(`已导出 ${layers.length} 个图层的 PSD，已在访达中显示`);
  } catch (err) {
    notify(`导出 PSD 失败：${err instanceof Error ? err.message : err}`);
  } finally {
    setBusy(groupId, undefined);
  }
}

// ---- The 工具 menu -------------------------------------------------------------------------

/** Opens a tool on a node: its options window, or straight to work when it has none. */
export function openTool(t: Tool, nodeId: string) {
  if (t.dialog) useUI.getState().set({ tool: { name: t.name, nodeId } });
  else runTool(t.name, nodeId);
}

/** 工具 ▾ on a media node's toolbar: every local tool for that kind of file. */
export function MediaToolsButton({ id, kind }: { id: string; kind: MediaKind }) {
  const [open, setOpen] = useState(false);
  /** Opens toward the side of the screen with room for it. */
  const [toLeft, setToLeft] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const tools = TOOLS_BY_KIND[kind];
  return (
    <div className="tools-wrap" ref={ref}>
      <button
        className={open ? 'on' : ''}
        onClick={(e) => {
          setToLeft(e.currentTarget.getBoundingClientRect().left + 310 > window.innerWidth);
          setOpen(!open);
        }}
        title="本地处理工具：不花钱，在这台 Mac 上运行"
      >
        <Icon name="bolt" size={14} />
        <span>{kind === 'video' ? '更多工具' : '工具'}</span>
        <Icon name="down" size={12} />
      </button>
      {open && (
        <div className={`tools-pop nowheel ${toLeft ? 'to-left' : ''}`}>
          {tools.map((t, i) => (
            <button
              key={t.name}
              className={kind === 'video' && i === VIDEO_TOOLS.length - AUDIO_TOOLS.length ? 'tools-sep' : ''}
              onClick={() => {
                setOpen(false);
                openTool(t, id);
              }}
            >
              <Icon name={t.icon} size={15} />
              <span className="tools-text">
                <b>{t.label}</b>
                <small>{t.desc}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Options windows -----------------------------------------------------------------------

function Seg<T extends string | number>({ value, options, onChange, format }: { value: T; options: readonly T[]; onChange: (v: T) => void; format?: (v: T) => string }) {
  return (
    <div className="seg tool-seg">
      {options.map((o) => (
        <button key={String(o)} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

const TITLES: Record<string, string> = Object.fromEntries([...IMAGE_TOOLS, ...VIDEO_TOOLS].map((t) => [t.name, t.label]));

export function ToolDialog() {
  const { tool, set } = useUI(useShallow((s) => ({ tool: s.tool, set: s.set })));
  const node = useCanvas((s) => (tool ? s.nodes.find((n) => n.id === tool.nodeId) : undefined));
  const media = node ? currentOutput(node.data)?.media : undefined;
  if (!tool || !node || !media) return null;
  const close = () => set({ tool: null });
  const go = (opts: Record<string, unknown> = {}) => {
    close();
    runTool(tool.name, node.id, opts);
  };
  const wide = ['eraser', 'watermark', 'trim'].includes(tool.name);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className={`lib-modal tool-modal ${wide ? 'tool-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">{TITLES[tool.name]}</h3>
          <div className="grow" />
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="prefs-body">
          {tool.name === 'upscale' && <UpscaleOptions go={go} close={close} />}
          {tool.name === 'vectorize' && <VectorizeOptions go={go} close={close} />}
          {tool.name === 'blur' && <BlurOptions go={go} close={close} />}
          {tool.name === 'compress' && <CompressOptions media={media} go={go} close={close} />}
          {tool.name === 'decompose' && <DecomposeOptions go={go} close={close} />}
          {tool.name === 'transcribe' && <TranscribeOptions go={go} close={close} />}
          {tool.name === 'scenes' && <ScenesOptions go={go} close={close} />}
          {tool.name === 'bgremove' && <BgRemoveOptions go={go} close={close} />}
          {tool.name === 'vupscale' && <VideoUpscaleOptions go={go} close={close} />}
          {tool.name === 'subtitles' && <SubtitleOptions go={go} close={close} />}
          {tool.name === 'eraser' && <EraserEditor media={media} go={go} close={close} />}
          {tool.name === 'watermark' && <WatermarkEditor media={media} go={go} close={close} />}
          {tool.name === 'trim' && <TrimEditor media={media} go={go} close={close} />}
        </div>
      </div>
    </div>
  );
}

type OptProps = { go: (o?: Record<string, unknown>) => void; close: () => void };

function Actions({ close, onGo, label = '开始', disabled }: { close: () => void; onGo: () => void; label?: string; disabled?: boolean }) {
  return (
    <div className="row">
      <button className="text-btn" onClick={close}>
        取消
      </button>
      <button className="primary-btn" disabled={disabled} onClick={onGo}>
        {label}
      </button>
    </div>
  );
}

function UpscaleOptions({ go, close }: OptProps) {
  const [scale, setScale] = useState(4);
  const [anime, setAnime] = useState(false);
  return (
    <>
      <p className="muted">用 Real-ESRGAN 在本机放大并补出细节。首次使用会下载约 50 MB。1000 像素左右的图放大 4 倍约 10–20 秒。</p>
      <h4 className="bd-h">倍数</h4>
      <Seg value={scale} options={[2, 4] as const} onChange={setScale} format={(v) => `${v} 倍`} />
      <h4 className="bd-h">画面类型</h4>
      <Seg value={anime ? '动漫插画' : '照片'} options={['照片', '动漫插画'] as const} onChange={(v) => setAnime(v === '动漫插画')} />
      <Actions close={close} onGo={() => go({ scale, anime })} label="开始放大" />
    </>
  );
}

function VideoUpscaleOptions({ go, close }: OptProps) {
  return (
    <>
      <p className="muted">用 Real-ESRGAN 视频模型在本机把分辨率放大 2 倍（720p → 1440p，1080p → 4K），画面更清晰，声音保留。首次使用会下载约 50 MB。</p>
      <p className="muted">比较耗时：1080p 每 10 秒视频约 4 分钟，720p 约 2 分钟。会让细小纹理略微变平滑，适合 AI 生成视频和偏糊的素材。</p>
      <Actions close={close} onGo={() => go()} label="开始高清" />
    </>
  );
}

function SubtitleOptions({ go, close }: OptProps) {
  const [zone, setZone] = useState<SubtitleZone>('底部');
  return (
    <>
      <p className="muted">逐帧识别画面里的文字，只抹掉所选区域里的字幕，并用 AI 补出背后的画面，声音保留。1080p 每 10 秒视频约 4–5 分钟。首次使用会下载约 210 MB 模型（用过去水印则已下载）。</p>
      <h4 className="bd-h">字幕位置</h4>
      <Seg value={zone} options={['底部', '上下', '全画面'] as const} onChange={setZone} format={(v) => ({ 底部: '底部', 上下: '顶部 + 底部', 全画面: '全画面所有文字' })[v]} />
      <p className="muted small">字幕位置固定、或者识别不到（艺术字、很小的字）时，改用「视频去水印」手动框选。</p>
      <Actions close={close} onGo={() => go({ zone })} label="开始去字幕" />
    </>
  );
}

function VectorizeOptions({ go, close }: OptProps) {
  const [preset, setPreset] = useState<'poster' | 'photo' | 'bw'>('poster');
  const names = { poster: '海报 / 插画', photo: '照片', bw: '黑白线稿' } as const;
  return (
    <>
      <p className="muted">用 vtracer 把图片描摹成 SVG 矢量图，放大不糊，可以在 Illustrator、Figma 里继续编辑。色块分明的插画、Logo、海报效果最好。</p>
      <h4 className="bd-h">风格</h4>
      <Seg value={preset} options={['poster', 'photo', 'bw'] as const} onChange={setPreset} format={(v) => names[v]} />
      <Actions close={close} onGo={() => go({ preset })} label="开始转换" />
    </>
  );
}

function BlurOptions({ go, close }: OptProps) {
  const [strength, setStrength] = useState(1);
  const [depthMap, setDepthMap] = useState(false);
  return (
    <>
      <p className="muted">自动找到主体，让它保持清晰，其余部分按远近虚化，像大光圈镜头拍的效果。</p>
      <h4 className="bd-h">虚化程度</h4>
      <Seg value={strength} options={[0.6, 1, 1.6] as const} onChange={setStrength} format={(v) => ({ 0.6: '轻', 1: '中', 1.6: '强' })[v] ?? ''} />
      <label className="lib-check tool-check">
        <input type="checkbox" checked={depthMap} onChange={(e) => setDepthMap(e.target.checked)} />
        同时导出景深图（黑白，越近越白）
      </label>
      <Actions close={close} onGo={() => go({ strength, depthMap })} />
    </>
  );
}

function CompressOptions({ media, go, close }: OptProps & { media: MediaRef }) {
  const [format, setFormat] = useState<'JPEG' | 'WebP' | 'PNG'>('WebP');
  const [quality, setQuality] = useState(0.82);
  const [maxSide, setMaxSide] = useState(0);
  return (
    <>
      <p className="muted">
        原图 {media.w && media.h ? `${media.w}×${media.h}` : ''}。WebP 体积最小，JPEG 兼容最好，PNG 无损且保留透明。
      </p>
      <h4 className="bd-h">格式</h4>
      <Seg value={format} options={['WebP', 'JPEG', 'PNG'] as const} onChange={setFormat} />
      {format !== 'PNG' && (
        <>
          <h4 className="bd-h">质量 {Math.round(quality * 100)}</h4>
          <input className="tool-range" type="range" min={0.4} max={1} step={0.02} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
        </>
      )}
      <h4 className="bd-h">最长边</h4>
      <Seg value={maxSide} options={[0, 3840, 2048, 1080] as const} onChange={setMaxSide} format={(v) => (v ? `${v} 像素` : '原尺寸')} />
      <Actions close={close} onGo={() => go({ format, quality, maxSide })} />
    </>
  );
}

function DecomposeOptions({ go, close }: OptProps) {
  const [background, setBackground] = useState<'chatgpt' | 'local'>('chatgpt');
  return (
    <>
      <p className="muted">把图片拆成「背景」和每个「主体」图层，放在一个分组里，可以单独移动、替换，选中分组可「导出 PSD」用 Photoshop 打开。</p>
      <h4 className="bd-h">主体挪走后，背后的部分怎么补</h4>
      <Seg value={background} options={['chatgpt', 'local'] as const} onChange={setBackground} format={(v) => (v === 'chatgpt' ? 'ChatGPT 重绘（效果好）' : '本地修补（快、免费）')} />
      <p className="muted small">{background === 'chatgpt' ? '约 1 分钟，会消耗一次 ChatGPT 生图额度。' : '几秒完成，不消耗额度；大面积补全时细节会比较模糊。'}</p>
      <Actions close={close} onGo={() => go({ background })} label="开始拆解" />
    </>
  );
}

function TranscribeOptions({ go, close }: OptProps) {
  // No 自动: the web Whisper doesn't detect the language and would assume English.
  const [language, setLanguage] = useState('zh');
  const [timestamps, setTimestamps] = useState(true);
  return (
    <>
      <p className="muted">用 Whisper 在本机识别说话或歌词。首次使用会下载约 560 MB 的模型，之后 1 分钟的音频几秒钟就能识别完。</p>
      <h4 className="bd-h">语言</h4>
      <Seg value={language} options={['zh', 'en', 'ja', 'ko', 'yue'] as const} onChange={setLanguage} format={(v) => ({ zh: '中文', en: '英文', ja: '日语', ko: '韩语', yue: '粤语' })[v] ?? v} />
      <label className="lib-check tool-check">
        <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} />
        每句带时间（方便对字幕）
      </label>
      <Actions close={close} onGo={() => go({ language, timestamps })} label="开始识别" />
    </>
  );
}

function ScenesOptions({ go, close }: OptProps) {
  const [threshold, setThreshold] = useState(0.3);
  return (
    <>
      <p className="muted">自动识别镜头切换，把视频拆成一个个镜头片段（每段都精确到帧），方便挑选和重新剪辑。</p>
      <h4 className="bd-h">灵敏度</h4>
      <Seg value={threshold} options={[0.45, 0.3, 0.2] as const} onChange={setThreshold} format={(v) => ({ 0.45: '只认硬切', 0.3: '标准', 0.2: '灵敏' })[v] ?? ''} />
      <Actions close={close} onGo={() => go({ threshold })} label="开始拆分" />
    </>
  );
}

function BgRemoveOptions({ go, close }: OptProps) {
  const [mode, setMode] = useState<BackgroundMode>('透明');
  const desc: Record<BackgroundMode, string> = {
    透明: 'WebM 透明视频，体积小，可以在应用和网页里直接预览、叠加。',
    '透明 ProRes': 'ProRes 4444 .mov，带透明通道，适合 Final Cut、Premiere、达芬奇；文件很大。',
    绿幕: '主体放在绿幕上，任何剪辑软件都能抠。',
    白底: '主体放在纯白背景上。',
  };
  return (
    <>
      <p className="muted">逐帧识别主体去掉背景，保留原声音。10 秒 1080p 视频约 2–3 分钟，最长处理 2 分钟。</p>
      <h4 className="bd-h">输出</h4>
      <Seg value={mode} options={['透明', '透明 ProRes', '绿幕', '白底'] as const} onChange={setMode} />
      <p className="muted small">{desc[mode]}</p>
      <Actions close={close} onGo={() => go({ mode })} />
    </>
  );
}

// ---- Editors with a picture: eraser brush, watermark boxes, trim timeline -------------------

/** Keeps a drag going outside the element; harmless if the pointer can't be captured. */
const capture = (e: ReactPointerEvent<Element>) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // e.g. a pointer that's already gone
  }
};

/** Fits a w×h picture into the window's editing area. */
const fit = (w: number, h: number, maxW = 860, maxH = 520) => {
  const k = Math.min(maxW / w, maxH / h, 1);
  return { w: Math.round(w * k), h: Math.round(h * k) };
};

function EraserEditor({ media, go, close }: OptProps & { media: MediaRef }) {
  const url = useMediaUrl(media.id);
  const base = useRef<HTMLCanvasElement | null>(null);
  const paint = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(36);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState({ w: 0, h: 0 });
  const [painted, setPainted] = useState(false);
  const drawing = useRef(false);
  const history = useRef<ImageData[]>([]);

  useEffect(() => {
    if (!url) return;
    import('./image').then(async (t) => {
      const c = await t.loadImage(media);
      base.current = c;
      setView(fit(c.width, c.height));
    });
  }, [url, media]);

  const stroke = (e: ReactPointerEvent<HTMLCanvasElement>, start: boolean) => {
    const c = paint.current!;
    const g = c.getContext('2d')!;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    const y = ((e.clientY - r.top) / r.height) * c.height;
    if (start) history.current.push(g.getImageData(0, 0, c.width, c.height));
    g.fillStyle = 'rgba(255, 64, 96, 0.55)';
    g.beginPath();
    g.arc(x, y, (size / r.width) * c.width, 0, Math.PI * 2);
    g.fill();
    setPainted(true);
  };

  const erase = async () => {
    const src = base.current;
    const c = paint.current;
    if (!src || !c) return;
    setBusy('正在擦除…');
    try {
      const t = await import('./image');
      const m = t.canvas(src.width, src.height);
      t.ctx2d(m).drawImage(c, 0, 0, src.width, src.height);
      const d = t.ctx2d(m).getImageData(0, 0, src.width, src.height).data;
      const mask = new Uint8ClampedArray(src.width * src.height);
      for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 10 ? 255 : 0;
      const out = await t.inpaint(src, mask, setBusy);
      go({ canvas: out });
    } catch (err) {
      setBusy('');
      useUI.getState().notify(`擦除失败：${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <>
      <p className="muted">用画笔涂抹要去掉的东西（人、杂物、文字、水印），点「擦除」后自动补全背景。首次使用会下载约 210 MB 的模型。</p>
      <div className="tool-stage" style={{ width: view.w || undefined, height: view.h || undefined }}>
        {url && <img src={url} alt="" draggable={false} style={{ width: view.w, height: view.h }} />}
        {view.w > 0 && (
          <canvas
            ref={paint}
            width={view.w * 2}
            height={view.h * 2}
            style={{ width: view.w, height: view.h, cursor: 'crosshair' }}
            onPointerDown={(e) => {
              drawing.current = true;
              capture(e);
              stroke(e, true);
            }}
            onPointerMove={(e) => drawing.current && stroke(e, false)}
            onPointerUp={() => (drawing.current = false)}
          />
        )}
      </div>
      <div className="tool-bar">
        <span className="muted small">画笔</span>
        <input className="tool-range" type="range" min={8} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        <button
          className="text-btn"
          disabled={!history.current.length}
          onClick={() => {
            const prev = history.current.pop();
            if (prev) paint.current?.getContext('2d')?.putImageData(prev, 0, 0);
            setPainted(history.current.length > 0);
          }}
        >
          撤销
        </button>
        <button
          className="text-btn"
          onClick={() => {
            const c = paint.current;
            c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
            history.current = [];
            setPainted(false);
          }}
        >
          清空
        </button>
        <div className="grow" />
        {busy && <span className="muted small">{busy}</span>}
      </div>
      <Actions close={close} onGo={erase} label="擦除" disabled={!painted || !!busy} />
    </>
  );
}

/** Drag boxes over the video's first frame; each box is erased from every frame. */
function WatermarkEditor({ media, go, close }: OptProps & { media: MediaRef }) {
  const url = useMediaUrl(media.id);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [areas, setAreas] = useState<Area[]>([]);
  const [draft, setDraft] = useState<Area | null>(null);
  // The box being dragged also lives in a ref: mouse-up may come before a re-render.
  const draftRef = useRef<Area | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const show = (a: Area | null) => {
    draftRef.current = a;
    setDraft(a);
  };
  const stage = useRef<HTMLDivElement>(null);
  const pos = (e: ReactPointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  return (
    <>
      <p className="muted">在画面上拖出方框，框住水印、台标或字幕（可以框多个），每一帧的这些位置都会被擦掉并补全。适合位置固定的水印；10 秒 1080p 视频约 4–5 分钟。</p>
      <div
        ref={stage}
        className="tool-stage"
        style={{ width: view.w || undefined, height: view.h || undefined, cursor: 'crosshair' }}
        onPointerDown={(e) => {
          capture(e);
          origin.current = pos(e);
          show({ ...origin.current, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!origin.current) return;
          const p = pos(e);
          const o = origin.current;
          show({ x: Math.min(o.x, p.x), y: Math.min(o.y, p.y), w: Math.abs(p.x - o.x), h: Math.abs(p.y - o.y) });
        }}
        onPointerUp={() => {
          const d = draftRef.current;
          if (d && d.w > 0.01 && d.h > 0.01) setAreas((prev) => [...prev, d]);
          origin.current = null;
          show(null);
        }}
      >
        {url && (
          <video
            src={`${url}#t=0.5`}
            muted
            playsInline
            preload="auto"
            style={{ width: view.w || '100%', height: view.h || undefined }}
            onLoadedMetadata={(e) => setView(fit(e.currentTarget.videoWidth, e.currentTarget.videoHeight))}
          />
        )}
        {[...areas, ...(draft ? [draft] : [])].map((a, i) => (
          <div key={i} className="tool-box" style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }} />
        ))}
      </div>
      <div className="tool-bar">
        <span className="muted small">{areas.length ? `已框选 ${areas.length} 处` : '还没有框选'}</span>
        <button className="text-btn" disabled={!areas.length} onClick={() => setAreas(areas.slice(0, -1))}>
          撤销
        </button>
      </div>
      <Actions close={close} onGo={() => go({ areas })} label="开始去除" disabled={!areas.length} />
    </>
  );
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Keep one or more ranges of a video, optionally at another speed. */
function TrimEditor({ media, go, close }: OptProps & { media: MediaRef }) {
  const url = useMediaUrl(media.id);
  const video = useRef<HTMLVideoElement>(null);
  const [dur, setDur] = useState(0);
  const [now, setNow] = useState(0);
  const [ranges, setRanges] = useState<[number, number][]>([]);
  const [active, setActive] = useState(0);
  const [speed, setSpeed] = useState(1);
  const total = useMemo(() => ranges.reduce((a, [s, e]) => a + Math.max(0, e - s), 0) / speed, [ranges, speed]);
  const track = useRef<HTMLDivElement>(null);
  const moveEdge = (list: [number, number][], at: number, edge: 0 | 1, t: number) =>
    list.map((r, i) => (i === at ? ((edge === 0 ? [Math.min(t, r[1] - 0.1), r[1]] : [r[0], Math.max(t, r[0] + 0.1)]) as [number, number]) : r));
  const setEdge = (edge: 0 | 1) => setRanges(moveEdge(ranges, active, edge, now));
  const seek = (t: number) => {
    if (video.current) video.current.currentTime = t;
    setNow(t);
  };
  /** Dragging on the track: an edge handle moves that end of the active segment, anywhere else seeks. */
  const drag = (e: ReactPointerEvent, edge: 0 | 1 | null) => {
    e.stopPropagation();
    const box = track.current!.getBoundingClientRect();
    const at = (x: number) => Math.max(0, Math.min(dur, ((x - box.left) / box.width) * dur));
    const apply = (x: number) => {
      const t = at(x);
      if (edge !== null) setRanges((rs) => moveEdge(rs, active, edge, t));
      seek(t);
    };
    apply(e.clientX);
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <>
      <p className="muted">在下方时间条上点击跳到某一刻，拖动片段两端的白色把手选保留范围（也可以播放到某处点「设为开头 / 设为结尾」）。需要保留多段时点「＋ 再保留一段」，各段按顺序拼接。</p>
      <div className="tool-stage tool-video">
        {url && (
          <video
            ref={video}
            src={url}
            controls
            playsInline
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              setDur(d);
              setRanges([[0, d]]);
            }}
            onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          />
        )}
      </div>
      {dur > 0 && (
        <>
          <div className="trim-track" ref={track} onPointerDown={(e) => drag(e, null)}>
            {ranges.map(([s, e], i) => (
              <div key={i} className={`trim-range ${i === active ? 'on' : ''}`} style={{ left: `${(s / dur) * 100}%`, width: `${((e - s) / dur) * 100}%` }} onPointerDown={() => setActive(i)}>
                {i === active && (
                  <>
                    <span className="trim-edge l" onPointerDown={(e) => drag(e, 0)} />
                    <span className="trim-edge r" onPointerDown={(e) => drag(e, 1)} />
                  </>
                )}
              </div>
            ))}
            <div className="trim-head" style={{ left: `${(now / dur) * 100}%` }} />
          </div>
          <div className="tool-bar">
            <span className="small">
              当前 {fmt(now)} · 片段 {active + 1}：{fmt(ranges[active]?.[0] ?? 0)} – {fmt(ranges[active]?.[1] ?? 0)}
            </span>
            <div className="grow" />
            <button className="text-btn" onClick={() => setEdge(0)}>
              设为开头
            </button>
            <button className="text-btn" onClick={() => setEdge(1)}>
              设为结尾
            </button>
            <button
              className="text-btn"
              onClick={() => {
                setRanges([...ranges, [now, Math.min(dur, now + Math.max(1, dur / 10))]]);
                setActive(ranges.length);
              }}
            >
              ＋ 再保留一段
            </button>
            {ranges.length > 1 && (
              <button
                className="text-btn"
                onClick={() => {
                  setRanges(ranges.filter((_, i) => i !== active));
                  setActive(0);
                }}
              >
                删除这段
              </button>
            )}
          </div>
          <h4 className="bd-h">速度</h4>
          <Seg value={speed} options={[0.5, 0.75, 1, 1.25, 1.5, 2] as const} onChange={setSpeed} format={(v) => `${v}×`} />
          <p className="muted small">剪好后约 {total.toFixed(1)} 秒。</p>
        </>
      )}
      <Actions close={close} onGo={() => go({ ranges, speed })} label="导出剪辑" disabled={!ranges.length} />
    </>
  );
}
