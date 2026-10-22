import { create } from 'zustand';
import { nanoid } from 'nanoid';
import dagre from '@dagrejs/dagre';
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange, type XYPosition } from '@xyflow/react';
import { NODE_META, defaultParams, MODELS } from './config';
import { getProvider } from './provider';
import { videoPoster } from './media';
import { findMethod } from './methods';
import { SEEDANCE_GUIDE, reasonedFormat, vpromptTask } from './seedance';
import { allRoles, findMaterial, findRole, rolePrompt, useLibrary, type ToolboxTemplate } from './library';
import { isGenKind, type CanvasEdge, type CanvasNode, type CanvasNodeData, type GenKind, type GenOutput, type HistoryItem, type MediaRef, type NodeKind, type ParamValue } from './types';

type Graph = { nodes: CanvasNode[]; edges: CanvasEdge[] };

export interface Settings {
  minimap: boolean;
  snap: boolean;
  showEdges: boolean;
  tool: 'move' | 'hand';
  /** Set once the minimap default (now on) has been applied to this project. */
  mapDefaulted?: boolean;
}

interface Persisted {
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  assets: MediaRef[];
  history: HistoryItem[];
  settings: Settings;
}

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'failed';

interface CanvasState extends Persisted {
  past: Graph[];
  future: Graph[];
  saveStatus: SaveStatus;

  commit(): void;
  undo(): void;
  redo(): void;
  onNodesChange(changes: NodeChange<CanvasNode>[]): void;
  onEdgesChange(changes: EdgeChange<CanvasEdge>[]): void;
  onConnect(c: Connection): void;

  setName(name: string): void;
  setSettings(patch: Partial<Settings>): void;
  addNode(kind: NodeKind, position: XYPosition, opts?: { data?: Partial<CanvasNodeData>; from?: string; to?: string; select?: boolean }): string;
  addMediaNode(media: MediaRef, position: XYPosition): string;
  updateData(id: string, patch: Partial<CanvasNodeData>): void;
  select(ids: string[]): void;
  selectAll(): void;
  deleteNodes(ids: string[]): void;
  duplicate(ids: string[], offset?: XYPosition): void;
  cloneInPlace(ids: string[], withEdges: boolean): void;
  copy(ids: string[]): void;
  paste(at?: XYPosition): void;
  group(ids: string[]): void;
  ungroup(ids: string[]): void;
  connectChain(ids: string[]): void;
  tidy(): Map<string, XYPosition>;
  restorePositions(prev: Map<string, XYPosition>): void;
  addAsset(media: MediaRef): void;
  rateHistory(id: string, rating: number): void;
  storyboard(scriptId: string): void;
  run(ids: string[]): Promise<void>;
  insertTemplate(t: ToolboxTemplate, at: XYPosition): void;
  saveGroupToToolbox(groupId: string): ToolboxTemplate | null;
  importJson(json: string): void;
  clear(): void;
}

const STORAGE_KEY = 'libcanvas:v1';
const DEFAULT_SETTINGS: Settings = { minimap: true, snap: false, showEdges: true, tool: 'move', mapDefaulted: true };

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Partial<Persisted>;
    // A generation interrupted by a reload can never finish.
    if (data.nodes) data.nodes = data.nodes.map((n) => (n.data.status === 'running' ? { ...n, data: { ...n.data, status: 'idle', progress: 0 } } : n));
    return data;
  } catch {
    return {};
  }
}

export const sizeOf = (n: CanvasNode) => ({
  w: n.measured?.width ?? n.width ?? (Number(n.style?.width) || NODE_META[n.type ?? 'text'].width || 300),
  h: n.measured?.height ?? n.height ?? (Number(n.style?.height) || 240),
});

export function absPos(n: CanvasNode, nodes: CanvasNode[]): XYPosition {
  const parent = n.parentId ? nodes.find((p) => p.id === n.parentId) : undefined;
  if (!parent) return n.position;
  const pp = absPos(parent, nodes);
  return { x: pp.x + n.position.x, y: pp.y + n.position.y };
}

export const currentOutput = (d: CanvasNodeData): GenOutput | undefined => d.outputs?.[d.current ?? d.outputs.length - 1];

/** Expand a set of ids with the children of any group in it. */
function withChildren(ids: Set<string>, nodes: CanvasNode[]): Set<string> {
  const out = new Set(ids);
  for (const n of nodes) if (n.parentId && out.has(n.parentId)) out.add(n.id);
  return out;
}

/** Parents must precede children in React Flow's node array. */
function sortParentsFirst(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes.filter((n) => n.type === 'group'), ...nodes.filter((n) => n.type !== 'group')];
}

function cloneGraph(nodes: CanvasNode[], edges: CanvasEdge[], ids: Set<string>, offset: XYPosition, keepIncoming: boolean) {
  const idMap = new Map<string, string>();
  for (const id of ids) idMap.set(id, nanoid(8));
  const newNodes: CanvasNode[] = nodes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const parentCopied = n.parentId && idMap.has(n.parentId);
      return {
        ...structuredClone(n),
        id: idMap.get(n.id)!,
        parentId: parentCopied ? idMap.get(n.parentId!) : n.parentId,
        position: parentCopied ? n.position : { x: n.position.x + offset.x, y: n.position.y + offset.y },
        selected: true,
        data: { ...structuredClone(n.data), status: n.data.status === 'running' ? 'idle' : n.data.status },
      };
    });
  const newEdges: CanvasEdge[] = edges
    .filter((e) => ids.has(e.target) && (ids.has(e.source) || keepIncoming))
    .map((e) => ({ ...e, id: nanoid(8), source: idMap.get(e.source) ?? e.source, target: idMap.get(e.target)!, selected: false }));
  return { newNodes, newEdges };
}

let clipboard: Graph | null = null;

/** Whether `text` contains @name as a whole mention (so "@图片 1" doesn't also match "@图片 10"). */
function mentions(text: string, name: string): boolean {
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

export interface ComposedRequest {
  kind: GenKind;
  model: string;
  params: Record<string, ParamValue>;
  /** Exactly the text the AI app receives. */
  prompt: string;
  images: MediaRef[];
  /** Upstream videos; a still frame of each is added to the images when the request is sent. */
  videos: { nodeId: string; title: string; media: MediaRef }[];
  /** What went in, for the "发送内容" preview. */
  parts: { label: string; detail: string }[];
  /** Connected things that don't take part, and why. */
  notes: string[];
}

/**
 * Builds the request for a generation node from everything wired into it plus the user's
 * preferences and @-mentioned characters. Used both to run and to preview, so what the
 * preview shows is what gets sent.
 */
export function composeRequest(id: string, nodes: CanvasNode[], edges: CanvasEdge[]): ComposedRequest | null {
  const node = nodes.find((n) => n.id === id);
  if (!node || !isGenKind(node.type)) return null;
  const kind = node.type;
  const d = node.data;
  // Saved canvases may still name models that no longer exist.
  const model = MODELS[kind].some((m) => m.id === d.model) ? d.model! : MODELS[kind][0].id;
  const params = d.params ?? {};
  const userPrompt = (d.prompt ?? '').trim();
  const blocks: string[] = [];
  const parts: ComposedRequest['parts'] = [];
  const notes: string[] = [];
  const images: MediaRef[] = [];
  const videos: ComposedRequest['videos'] = [];
  /** What each attached image is, in attachment order, so prompts can say @图片N. */
  const imageLabels: string[] = [];
  const roleIds = new Set<string>();
  let shotCount = 0;
  /** Voice nodes: connected text to read out as-is. */
  const rawTexts: string[] = [];

  // Sources: wired-in nodes, plus any node @-mentioned in the prompt (same effect as a wire).
  const upstreamIds = edges.filter((x) => x.target === id).map((x) => x.source);
  const mentionedIds = nodes
    .filter((n) => n.id !== id && n.type !== 'group' && n.type !== 'character' && !upstreamIds.includes(n.id) && mentions(userPrompt, n.data.title))
    .map((n) => n.id);
  for (const sid of [...upstreamIds, ...mentionedIds]) {
    const src = nodes.find((n) => n.id === sid);
    if (!src) continue;
    const title = mentionedIds.includes(sid) ? `${src.data.title}（@引用）` : src.data.title;
    const out = currentOutput(src.data);
    if (src.type === 'reference') {
      notes.push(`参考节点「${title}」只是备忘，不参与生成`);
      continue;
    }
    if (src.type === 'text') {
      if (src.data.text?.trim()) {
        blocks.push(`【参考文本 · ${title}】\n${src.data.text.trim()}`);
        rawTexts.push(src.data.text.trim());
        parts.push({ label: '参考文本', detail: title });
      } else notes.push(`文本节点「${title}」是空的`);
    }
    if (src.type === 'script') {
      if (out?.shots?.length) {
        blocks.push(`【分镜脚本 · ${title}】\n${out.shots.map((s) => s.text).join('\n')}`);
        parts.push({ label: '分镜脚本', detail: `${title}（${out.shots.length} 镜）` });
        shotCount += out.shots.length;
        rawTexts.push(out.shots.map((s) => s.text).join('\n'));
      } else notes.push(`脚本节点「${title}」还没有生成分镜`);
    }
    if (src.type === 'vprompt') {
      if (out?.shots?.length) {
        blocks.push(`【视频提示词 · ${title}】\n${out.shots.map((s) => `${s.meta ? `（${s.meta}）` : ''}${s.text}`).join('\n')}`);
        parts.push({ label: '视频提示词', detail: `${title}（${out.shots.length} 条）` });
      } else notes.push(`视频提示词节点「${title}」还没有生成内容`);
    }
    if (src.type === 'method') {
      const m = findMethod(src.data.methodId);
      if (m) {
        const hint = m.forKind[kind];
        blocks.push(`${m.rules}${hint ? `\n- 本节点（${NODE_META[kind].label}）的写法：${hint}` : ''}`);
        parts.push({ label: '视频玩法', detail: m.name });
      } else notes.push(`视频玩法节点「${title}」还没选择玩法`);
    }
    if (src.type === 'style') {
      const m = findMaterial('style', src.data.materialId);
      if (m) {
        blocks.push(`【画面风格 · ${m.name}】${m.prompt}`);
        parts.push({ label: '风格', detail: m.name });
      } else notes.push(`风格节点「${title}」还没选择风格`);
    }
    if (src.type === 'lens') {
      const m = findMaterial('lens', src.data.materialId);
      if (m) {
        blocks.push(`【特效与运镜 · ${m.name}】${m.prompt}${kind === 'image' ? '（请把这种运镜/特效的瞬间感体现在画面构图中）' : '（请在镜头设计中使用这种运镜/特效）'}`);
        parts.push({ label: '特效/运镜', detail: m.name });
      } else notes.push(`特效节点「${title}」还没选择特效`);
    }
    if (src.type === 'character') {
      if (src.data.roleId) roleIds.add(src.data.roleId);
      else notes.push(`角色节点「${title}」还没选择角色`);
    }
    if (out?.media?.kind === 'image') {
      images.push(out.media);
      imageLabels.push(`节点「${title}」的图片`);
      parts.push({ label: '参考图', detail: title });
    }
    if (out?.media?.kind === 'video') {
      videos.push({ nodeId: src.id, title, media: out.media });
      parts.push({ label: '视频画面', detail: `${title}（截取一帧作为参考图）` });
    }
    if (out?.media?.kind === 'audio') notes.push(`音频「${title}」暂时不能作为生成输入`);
    if ((src.type === 'image' || src.type === 'video') && !out?.media) notes.push(`「${title}」还没有内容`);
  }

  for (const r of allRoles()) if (mentions(userPrompt, r.name)) roleIds.add(r.id);
  for (const rid of roleIds) {
    const r = findRole(rid);
    if (!r) continue;
    blocks.push(`【角色设定】${rolePrompt(r)}`);
    const refs = (['avatar', 'full', 'turnaround'] as const).map((k) => r.assets[k]).filter((m): m is MediaRef => !!m);
    images.push(...refs);
    const assetName = { avatar: '头像', full: '全身', turnaround: '三视图' } as const;
    for (const k of ['avatar', 'full', 'turnaround'] as const) if (r.assets[k]) imageLabels.push(`角色「${r.name}」的${assetName[k]}`);
    parts.push({ label: '角色', detail: `${r.name}${refs.length ? `（含 ${refs.length} 张角色图）` : '（只有文字设定，生成角色资产后会附带角色图）'}` });
  }

  const prefs = useLibrary.getState().preferences;
  const usePrefs = !!prefs?.text.trim() && (model === 'claude' ? prefs.claude : prefs.chatgpt);

  let task = userPrompt || (blocks.length || images.length || videos.length ? '根据下面提供的内容完成创作。' : '');
  if (!task.trim()) return { kind, model, params, prompt: '', images, videos, parts, notes };
  if (kind === 'voice' && String(params.writer ?? '原文') === '原文') {
    // Read the text exactly as written: no AI involved.
    const raw = [userPrompt, ...rawTexts].filter(Boolean).join('\n');
    return { kind, model, params, prompt: raw, images: [], videos: [], parts: parts.filter((x) => x.label === '参考文本' || x.label === '分镜脚本'), notes };
  }
  if (kind === 'voice') {
    task = `${task}\n把以上内容写成一段适合配音朗读的中文口播稿：口语化、短句，一句一个意思，按语义分行（一行一句），开头一句要能抓住人；保留原文的事实、数字和观点，不编造。\n${reasonedFormat('text', '只写要朗读的口播正文，一行一句；不要标题、括号说明、舞台指示或表情符号。')}`;
  } else if (kind === 'audio' && String(params.engine ?? '').startsWith('ACE')) {
    const secs = Number(params.duration ?? 30);
    const vocal = params.vocal !== '纯音乐';
    task = `${task}\n请为本地音乐模型 ACE-Step 写一首约 ${secs} 秒的${vocal ? '歌曲' : '纯音乐'}的作曲说明，只输出 JSON，不要其他文字：
{"title":"曲名","caption":"英文风格描述","lyrics":"歌词与段落","language":"歌词语言代码","description":"一句中文说明：风格、情绪和用途"}
规则：
- caption 用英文、逗号分隔的短语，组合描述：流派风格、情绪氛围、主要乐器、音色质感（warm、crisp、airy…）、年代或制作风格、${vocal ? '人声特征（如 female vocal, breathy / male vocal, warm）、' : ''}速度节奏、结构提示（如 building intro, catchy chorus, fade-out ending）。要具体，不要互相冲突的风格。
- lyrics：${vocal ? `写完整歌词，用 [Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro] 等结构标签分段，标签最多带一个演唱提示（如 [Chorus - anthemic]），不要堆叠多个提示；歌词长度适合约 ${secs} 秒；默认用中文歌词，用户要求其他语言时用对应语言` : '只写器乐段落标签，例如 "[Intro]\\n[Instrumental]\\n[Build]\\n[Outro]"，不要歌词'}。
- caption 与 lyrics 的乐器、情绪要一致。language 用 zh、en、ja、ko 等代码。`;
  } else if (kind === 'audio') {
    // The AI writes the score; the app synthesizes it locally (see synth.ts).
    const secs = Number(params.duration ?? 30);
    task = `${task}\n请根据以上要求创作一段约 ${secs} 秒的纯音乐，用下面的 JSON 乐谱格式输出，只输出 JSON，不要任何其他文字。
{"title":"曲名","bpm":数字,"beatsPerBar":4,"description":"一句话描述风格与情绪","tracks":[{"instrument":"乐器","volume":0到1,"pan":-1到1,"notes":[[起始拍,时值拍数,"音高",力度0到1]]}]}
规则：instrument 只能是 piano、pad、strings、bass、lead、pluck、bell、drums 之一；音高用 C4、F#3、Bb2 这样的写法；drums 声部的音高改用 kick、snare、clap、hat、openhat、tom、crash；起始拍从 0 开始，按 bpm 计算总长约 ${secs} 秒；安排 3 到 6 个声部，包含旋律、和声与低音，需要节奏感时加 drums；音符要足够密集、完整覆盖整段时长，有起承转合。`;
  } else if (kind === 'script' && params.mode === 'breakdown') {
    // Shot breakdown of a video: the prompt already lists the keyframes and what to analyse.
    task = `${task}\n每行写一个镜头，格式为「镜头N（时间点）：分析内容」，只输出这些行，不要任何其他内容。`;
  } else if (kind === 'script') {
    const n = Number(params.shots ?? 6);
    task = `${task}\n结合下面提供的全部内容，把这个创意拆成 ${n} 个电影分镜。\n${reasonedFormat('script', `每行写一个镜头，格式为「镜头N：画面描述（包含景别与运镜）」（连入了视频玩法时按玩法要求的格式），一共 ${n} 行。`)}`;
  } else if (kind === 'vprompt') {
    task = `${task}\n${vpromptTask(params, shotCount)}\n${reasonedFormat('vprompt', '每条提示词先写一行标题，格式为「【提示词N｜对应镜头｜时长｜文生视频/图生视频/首尾帧｜参考图作用（没有就写 无）】」，下一行起写提示词正文；条与条之间空一行。')}`;
  } else if (kind === 'text') {
    task = `${task}\n${reasonedFormat('text', '直接写出正文。')}`;
  }
  if (!task.trim()) return { kind, model, params, prompt: '', images, videos, parts, notes };

  const sections: string[] = [];
  if (usePrefs) {
    sections.push(`【我的偏好与习惯（在不违背本次要求的前提下遵循）】\n${prefs.text.trim()}`);
    parts.unshift({ label: '我的偏好', detail: `${prefs.text.trim().length} 字` });
  } else if (prefs?.text.trim()) notes.push(`「我的偏好」已设置为不用于 ${model === 'claude' ? 'Claude' : 'ChatGPT'}`);
  sections.push(`【本次任务】\n${task.trim()}`);
  if (kind === 'vprompt') sections.push(SEEDANCE_GUIDE);
  sections.push(...blocks);
  if (images.length + videos.length) {
    const labels = [...imageLabels, ...videos.map((v) => `视频「${v.title}」截取的一帧`)];
    sections.push(`【参考图清单】已随本次请求按顺序附上 ${labels.length} 张图片，请逐张查看，在生成思路里说明你从每张图里读到了什么、怎么用的：\n${labels.map((l, i) => `图片${i + 1}：${l}`).join('\n')}`);
  }
  return { kind, model, params, prompt: sections.join('\n\n'), images, videos, parts, notes };
}

const persisted = loadPersisted();

export const useCanvas = create<CanvasState>()((set, get) => {
  const patchNode = (id: string, patch: Partial<CanvasNodeData>) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) });

  return {
    name: '未命名画布',
    nodes: [],
    edges: [],
    assets: [],
    history: [],
    ...persisted,
    // Projects saved before the minimap was on by default get it switched on once.
    settings: { ...DEFAULT_SETTINGS, ...persisted.settings, ...(persisted.settings?.mapDefaulted ? {} : { minimap: true, mapDefaulted: true }) },
    past: [],
    future: [],
    saveStatus: 'saved',

    commit() {
      const { nodes, edges, past } = get();
      set({ past: [...past.slice(-99), structuredClone({ nodes, edges })], future: [] });
    },
    undo() {
      const { past, future, nodes, edges } = get();
      const prev = past.at(-1);
      if (!prev) return;
      set({ past: past.slice(0, -1), future: [...future, structuredClone({ nodes, edges })], ...prev });
    },
    redo() {
      const { past, future, nodes, edges } = get();
      const next = future.at(-1);
      if (!next) return;
      set({ future: future.slice(0, -1), past: [...past, structuredClone({ nodes, edges })], ...next });
    },
    onNodesChange(changes) {
      if (changes.some((c) => c.type === 'remove')) get().commit();
      set({ nodes: applyNodeChanges(changes, get().nodes) });
    },
    onEdgesChange(changes) {
      if (changes.some((c) => c.type === 'remove')) get().commit();
      set({ edges: applyEdgeChanges(changes, get().edges) });
    },
    onConnect(c) {
      get().commit();
      set({ edges: addEdge({ ...c, id: nanoid(8) }, get().edges) });
    },

    setName: (name) => set({ name }),
    setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),

    addNode(kind, position, opts = {}) {
      get().commit();
      const id = nanoid(8);
      const { nodes, edges } = get();
      const meta = NODE_META[kind];
      const count = nodes.filter((n) => n.type === kind).length + 1;
      const node: CanvasNode = {
        id,
        type: kind,
        position,
        selected: opts.select ?? true,
        data: {
          title: `${meta.label} ${count}`,
          ...(isGenKind(kind) ? { model: MODELS[kind][0].id, params: defaultParams(kind), prompt: '' } : {}),
          ...opts.data,
        },
        ...(kind === 'group' ? { style: { width: 600, height: 400 } } : {}),
      };
      const others = opts.select === false ? nodes : nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      set({
        nodes: sortParentsFirst([...others, node]),
        edges: [opts.from && { source: opts.from, target: id }, opts.to && { source: id, target: opts.to }].reduce(
          (acc, c) => (c ? addEdge({ id: nanoid(8), ...c, sourceHandle: null, targetHandle: null }, acc) : acc),
          edges,
        ),
      });
      return id;
    },
    addMediaNode(media, position) {
      return get().addNode(media.kind, position, {
        data: { ...(media.name ? { title: media.name.replace(/\.[^.]+$/, '') } : {}), outputs: [{ id: nanoid(6), createdAt: Date.now(), media }], current: 0, status: 'done' },
      });
    },
    updateData: patchNode,
    select(ids) {
      const s = new Set(ids);
      set({ nodes: get().nodes.map((n) => ({ ...n, selected: s.has(n.id) })) });
    },
    selectAll: () => set({ nodes: get().nodes.map((n) => ({ ...n, selected: true })) }),

    deleteNodes(ids) {
      if (!ids.length) return;
      get().commit();
      const { nodes, edges } = get();
      const del = withChildren(new Set(ids), nodes);
      set({
        nodes: nodes.filter((n) => !del.has(n.id)),
        edges: edges.filter((e) => !del.has(e.source) && !del.has(e.target) && !e.selected),
      });
    },
    duplicate(ids, offset = { x: 40, y: 40 }) {
      if (!ids.length) return;
      get().commit();
      const { nodes, edges } = get();
      const { newNodes, newEdges } = cloneGraph(nodes, edges, withChildren(new Set(ids), nodes), offset, true);
      set({ nodes: sortParentsFirst([...nodes.map((n) => ({ ...n, selected: false })), ...newNodes]), edges: [...edges, ...newEdges] });
    },
    cloneInPlace(ids, withEdges) {
      // Alt-drag: leave unselected copies behind while the originals keep moving.
      const { nodes, edges } = get();
      const { newNodes, newEdges } = cloneGraph(nodes, edges, withChildren(new Set(ids), nodes), { x: 0, y: 0 }, withEdges);
      set({ nodes: sortParentsFirst([...nodes, ...newNodes.map((n) => ({ ...n, selected: false }))]), edges: withEdges ? [...edges, ...newEdges] : edges });
    },
    copy(ids) {
      const { nodes, edges } = get();
      const all = withChildren(new Set(ids), nodes);
      clipboard = structuredClone({ nodes: nodes.filter((n) => all.has(n.id)), edges: edges.filter((e) => all.has(e.source) && all.has(e.target)) });
    },
    paste(at) {
      if (!clipboard?.nodes.length) return;
      get().commit();
      const tops = clipboard.nodes.filter((n) => !n.parentId || !clipboard!.nodes.some((p) => p.id === n.parentId));
      const minX = Math.min(...tops.map((n) => n.position.x));
      const minY = Math.min(...tops.map((n) => n.position.y));
      const offset = at ? { x: at.x - minX, y: at.y - minY } : { x: 40, y: 40 };
      const { newNodes, newEdges } = cloneGraph(clipboard.nodes, clipboard.edges, new Set(clipboard.nodes.map((n) => n.id)), offset, false);
      const { nodes, edges } = get();
      set({ nodes: sortParentsFirst([...nodes.map((n) => ({ ...n, selected: false })), ...newNodes]), edges: [...edges, ...newEdges] });
      // Successive pastes cascade instead of stacking exactly on top of each other.
      if (!at) clipboard = { nodes: newNodes, edges: newEdges };
    },

    group(ids) {
      const { nodes } = get();
      const members = nodes.filter((n) => ids.includes(n.id) && !n.parentId && n.type !== 'group');
      if (!members.length) return;
      get().commit();
      const pad = 32;
      const header = 28;
      const boxes = members.map((n) => ({ ...n.position, ...sizeOf(n) }));
      const minX = Math.min(...boxes.map((b) => b.x)) - pad;
      const minY = Math.min(...boxes.map((b) => b.y)) - pad - header;
      const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
      const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
      const gid = nanoid(8);
      const groupNode: CanvasNode = {
        id: gid,
        type: 'group',
        position: { x: minX, y: minY },
        style: { width: maxX - minX, height: maxY - minY },
        data: { title: `分组 ${nodes.filter((n) => n.type === 'group').length + 1}` },
        selected: true,
      };
      const memberIds = new Set(members.map((m) => m.id));
      set({
        nodes: sortParentsFirst([
          groupNode,
          ...nodes.map((n) =>
            memberIds.has(n.id) ? { ...n, parentId: gid, selected: false, position: { x: n.position.x - minX, y: n.position.y - minY } } : { ...n, selected: false },
          ),
        ]),
      });
    },
    ungroup(ids) {
      const { nodes } = get();
      const groups = new Set(
        nodes.filter((n) => ids.includes(n.id)).flatMap((n) => (n.type === 'group' ? [n.id] : n.parentId ? [n.parentId] : [])),
      );
      if (!groups.size) return;
      get().commit();
      set({
        nodes: nodes
          .filter((n) => !groups.has(n.id))
          .map((n) => (n.parentId && groups.has(n.parentId) ? { ...n, parentId: undefined, extent: undefined, position: absPos(n, nodes), selected: true } : n)),
      });
    },
    connectChain(ids) {
      const { nodes, edges } = get();
      const sel = nodes.filter((n) => ids.includes(n.id) && n.type !== 'group').sort((a, b) => absPos(a, nodes).x - absPos(b, nodes).x);
      if (sel.length < 2) return;
      get().commit();
      let next = edges;
      for (let i = 0; i < sel.length - 1; i++) {
        const [s, t] = [sel[i].id, sel[i + 1].id];
        if (!next.some((e) => e.source === s && e.target === t)) next = addEdge({ id: nanoid(8), source: s, target: t, sourceHandle: null, targetHandle: null }, next);
      }
      set({ edges: next });
    },

    tidy() {
      get().commit();
      const { nodes, edges } = get();
      const top = nodes.filter((n) => !n.parentId);
      const topOf = (id: string): string => {
        const n = nodes.find((x) => x.id === id);
        return n?.parentId ? topOf(n.parentId) : id;
      };
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 140 });
      g.setDefaultEdgeLabel(() => ({}));
      for (const n of top) {
        const { w, h } = sizeOf(n);
        g.setNode(n.id, { width: w, height: h });
      }
      for (const e of edges) {
        const [s, t] = [topOf(e.source), topOf(e.target)];
        if (s !== t) g.setEdge(s, t);
      }
      dagre.layout(g);
      const prev = new Map(top.map((n) => [n.id, n.position]));
      set({
        nodes: nodes.map((n) => {
          if (n.parentId) return n;
          const p = g.node(n.id);
          const { w, h } = sizeOf(n);
          return { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } };
        }),
      });
      return prev;
    },
    restorePositions(prev) {
      set({ nodes: get().nodes.map((n) => (prev.has(n.id) ? { ...n, position: prev.get(n.id)! } : n)) });
    },

    addAsset: (media) => set({ assets: [media, ...get().assets] }),
    rateHistory: (id, rating) => set({ history: get().history.map((h) => (h.id === id ? { ...h, rating } : h)) }),

    storyboard(scriptId) {
      const { nodes } = get();
      const script = nodes.find((n) => n.id === scriptId);
      const shots = script && currentOutput(script.data)?.shots;
      if (!script || !shots?.length) return;
      get().commit();
      const base = absPos(script, nodes);
      const x = base.x + sizeOf(script).w + 160;
      const newNodes: CanvasNode[] = [];
      const newEdges: CanvasEdge[] = [];
      shots.forEach((shot, i) => {
        const id = nanoid(8);
        newNodes.push({
          id,
          type: 'image',
          position: { x: x + (i % 3) * 340, y: base.y + Math.floor(i / 3) * 280 },
          data: { title: `分镜 ${i + 1}`, prompt: shot.text, model: MODELS.image[0].id, params: { ...defaultParams('image'), ratio: '16:9' } },
          selected: true,
        });
        newEdges.push({ id: nanoid(8), source: scriptId, target: id });
      });
      set({ nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...newNodes], edges: [...get().edges, ...newEdges] });
    },

    async run(ids) {
      const { nodes, edges } = get();
      const runnable = new Set(nodes.filter((n) => ids.includes(n.id) && isGenKind(n.type) && n.data.status !== 'running').map((n) => n.id));
      // Split into topological levels: upstream results feed downstream nodes in the
      // same batch, while nodes on one level generate in parallel.
      const inner = edges.filter((e) => runnable.has(e.source) && runnable.has(e.target));
      const indeg = new Map([...runnable].map((id) => [id, 0]));
      for (const e of inner) indeg.set(e.target, indeg.get(e.target)! + 1);
      const levels: string[][] = [];
      let level = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
      while (level.length) {
        levels.push(level);
        const next: string[] = [];
        for (const e of inner.filter((x) => level.includes(x.source))) {
          indeg.set(e.target, indeg.get(e.target)! - 1);
          if (indeg.get(e.target) === 0) next.push(e.target);
        }
        level = next;
      }

      const runOne = async (id: string) => {
        const node = get().nodes.find((n) => n.id === id);
        if (!node || !isGenKind(node.type)) return;
        const kind = node.type;
        const d = node.data;
        try {
          const req = composeRequest(id, get().nodes, get().edges)!;
          if (!req.prompt) throw new Error('请先输入提示词，或连接文本、图片等内容');
          const model = req.model;
          // Videos feed generations through a still frame, saved once on the video's output.
          for (const v of req.videos) {
            const poster = await videoPoster(v.media);
            if (!poster) continue;
            req.images.push(poster);
            if (!v.media.poster) {
              const src = get().nodes.find((n) => n.id === v.nodeId);
              const outputs = src?.data.outputs?.map((o) => (o.media?.id === v.media.id ? { ...o, media: { ...o.media, poster } } : o));
              if (outputs) patchNode(v.nodeId, { outputs });
            }
          }
          const results = await getProvider().generate(
            { kind, prompt: req.prompt, model, params: req.params, images: req.images },
            (progress, statusText) => patchNode(id, { progress, statusText }),
          );
          const sent = { model, prompt: req.prompt, images: req.images.map((m) => m.id) };
          const outs: GenOutput[] = results.map((r) => ({ ...r, id: nanoid(6), createdAt: Date.now(), sent }));
          const latest = get().nodes.find((n) => n.id === id)?.data;
          if (!latest) return;
          const outputs = [...(latest.outputs ?? []), ...outs];
          patchNode(id, {
            outputs,
            current: outputs.length - outs.length,
            status: 'done',
            progress: 1,
            ...(kind === 'text' && outs[0]?.text ? { text: outs[0].text } : {}),
          });
          const items: HistoryItem[] = outs
            .filter((o) => o.media || o.text)
            .map((o) => ({ id: o.id, kind: o.media?.kind ?? 'text', media: o.media, text: o.text, prompt: d.prompt ?? '', model, createdAt: o.createdAt }));
          set({ history: [...items, ...get().history].slice(0, 500) });
        } catch (err) {
          patchNode(id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
        }
      };

      const ordered = new Set(levels.flat());
      for (const id of runnable) {
        if (ordered.has(id)) patchNode(id, { status: 'running', progress: 0, error: undefined, statusText: undefined });
        else patchNode(id, { status: 'error', error: '节点处于循环连线中，无法确定生成顺序' });
      }
      for (const lv of levels) await Promise.all(lv.map(runOne));
    },

    insertTemplate(t, at) {
      if (!t.nodes.length) return;
      get().commit();
      const idMap = new Map(t.nodes.map((n) => [n.id, nanoid(8)]));
      const pad = 32;
      const header = 28;
      const placed: CanvasNode[] = structuredClone(t.nodes).map((n) => ({
        ...n,
        id: idMap.get(n.id)!,
        parentId: undefined,
        selected: false,
        position: { x: at.x + pad + n.position.x, y: at.y + pad + header + n.position.y },
        data: { ...n.data, status: n.data.status === 'running' ? 'idle' : n.data.status },
      }));
      const links: CanvasEdge[] = t.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({ id: nanoid(8), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
      set({ nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), ...placed], edges: [...get().edges, ...links] });
      // Wrap the inserted workflow in a group named after the template, like LibTV.
      get().group(placed.map((n) => n.id));
      const g = get().nodes.find((n) => n.type === 'group' && n.selected);
      if (g) patchNode(g.id, { title: t.name });
      // group() pushed its own undo step; fold it into the insert so one undo removes everything.
      set({ past: get().past.slice(0, -1) });
    },
    saveGroupToToolbox(groupId) {
      const { nodes, edges } = get();
      const g = nodes.find((n) => n.id === groupId && n.type === 'group');
      const children = nodes.filter((n) => n.parentId === groupId);
      if (!g || !children.length) return null;
      const ids = new Set(children.map((n) => n.id));
      const minX = Math.min(...children.map((n) => n.position.x));
      const minY = Math.min(...children.map((n) => n.position.y));
      const cover = children.map((n) => currentOutput(n.data)?.media).find((m) => m && m.kind !== 'audio');
      const t: ToolboxTemplate = {
        id: nanoid(10),
        name: g.data.title,
        hue: [...g.data.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11),
        cover,
        nodes: structuredClone(children).map((n) => ({
          ...n,
          parentId: undefined,
          selected: false,
          position: { x: n.position.x - minX, y: n.position.y - minY },
          data: { ...n.data, status: n.data.status === 'running' ? 'idle' : n.data.status },
        })),
        edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ id: e.id, source: e.source, target: e.target })),
      };
      useLibrary.getState().addTemplate(t);
      return t;
    },

    importJson(json) {
      const data = JSON.parse(json) as Partial<Persisted>;
      if (!Array.isArray(data.nodes)) throw new Error('不是有效的画布文件');
      get().commit();
      set({ nodes: data.nodes, edges: data.edges ?? [], name: data.name ?? get().name });
    },
    clear() {
      get().commit();
      set({ nodes: [], edges: [] });
    },
  };
});

// Autosave the graph (media blobs are already in IndexedDB).
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useCanvas.subscribe((s, prev) => {
  if (s.nodes === prev.nodes && s.edges === prev.edges && s.name === prev.name && s.assets === prev.assets && s.history === prev.history && s.settings === prev.settings) return;
  if (s.saveStatus !== 'unsaved') useCanvas.setState({ saveStatus: 'unsaved' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    useCanvas.setState({ saveStatus: 'saving' });
    const { name, nodes, edges, assets, history, settings } = useCanvas.getState();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, nodes, edges, assets, history, settings }));
      useCanvas.setState({ saveStatus: 'saved' });
    } catch {
      useCanvas.setState({ saveStatus: 'failed' });
    }
  }, 600);
});

export function exportJson(): string {
  const { name, nodes, edges } = useCanvas.getState();
  return JSON.stringify({ name, nodes, edges }, null, 2);
}
