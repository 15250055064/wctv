import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { defaultParams, MODELS } from './config';
import { getProvider } from './provider';
import type { MotionClip } from '../director/scene';
import { isGenKind, type CanvasEdge, type CanvasNode, type CanvasNodeData, type MediaRef, type NodeKind } from './types';

// ---------------------------------------------------------------------------
// Style & effect catalogs (placeholder content; swap for a real catalog API)
// ---------------------------------------------------------------------------

export type MaterialKind = 'style' | 'lens';

export interface MaterialItem {
  id: string;
  name: string;
  author: string;
  category: string;
  commercial: boolean;
  uses: number;
  /** Keywords appended to the prompt of the node it is wired into. */
  prompt: string;
  hue: number;
  /** Style only: the base model the style is trained for; it locks the image node's model. */
  model?: string;
  featured?: boolean;
}

export const STYLE_CATEGORIES = ['推荐', '摄影写真', '电商营销', '动漫游戏', '风格插画', '平面设计', '建筑及室内设计', '创意玩法', '文创周边', '小说推文'];
export const LENS_CATEGORIES = ['推荐', '运镜', '转场', '视觉特效', '氛围'];

const s = (id: string, name: string, category: string, model: string, commercial: boolean, uses: number, prompt: string, hue: number, featured = false): MaterialItem => ({
  id,
  name,
  author: '官方',
  category,
  model,
  commercial,
  uses,
  prompt,
  hue,
  featured,
});

export const STYLES: MaterialItem[] = [
  s('s-film', '胶片人像写真', '摄影写真', 'qwen-image', true, 15200, '胶片质感，柔和自然光，细腻颗粒，浅景深人像', 28, true),
  s('s-studio', '电商影棚产品摄影', '电商营销', 'qwen-image', true, 15000, '干净影棚布光，产品居中，柔和投影，高级质感背景', 200, true),
  s('s-semi-thick', '日系半厚涂', '动漫游戏', 'z-image', true, 7200, '日系半厚涂插画，细腻光影，通透色彩', 320, true),
  s('s-cyber', '赛博朋克厚涂', '风格插画', 'qwen-image', true, 5000, '赛博朋克，霓虹灯光，雨夜街道，厚涂笔触，高对比', 285, true),
  s('s-oil', '复古油画', '风格插画', 'z-image', false, 10100, '古典油画质感，厚重笔触，暖色调，伦勃朗光', 32),
  s('s-toy', '3D 潮玩手办', '文创周边', 'lib-image', true, 3300, '3D 潮玩手办，PVC 材质，C4D 渲染，柔和棚拍', 340, true),
  s('s-sheet', '角色三视图设定', '动漫游戏', 'z-image', true, 13000, '角色设定图，正面、侧面、背面三视图，白底，统一比例', 210, true),
  s('s-poster', '极简平面海报', '平面设计', 'qwen-image', true, 2400, '极简主义海报，大面积留白，几何构图，瑞士风格排版', 50),
  s('s-interior', '室内设计效果图', '建筑及室内设计', 'qwen-image', true, 4100, '室内设计效果图，自然采光，北欧风格，真实材质渲染', 100),
  s('s-ink', '国风水墨', '风格插画', 'lib-image', true, 8800, '中国水墨画风格，留白意境，淡彩晕染', 160),
  s('s-pixel', '像素游戏', '动漫游戏', 'lib-image', true, 2100, '16-bit 像素风格，复古游戏画面，有限色板', 260),
  s('s-comic', '美式漫画', '小说推文', 'z-image', false, 1900, '美式漫画风格，粗黑线条，网点阴影，鲜艳配色', 8),
  s('s-clay', '黏土定格', '创意玩法', 'lib-image', true, 1300, '黏土定格动画质感，手工捏制痕迹，微缩场景', 20),
  s('s-novel', '小说推文氛围插画', '小说推文', 'qwen-image', true, 6300, '小说推文插画，氛围感光影，电影构图，情绪化色彩', 225, true),
  s('s-avatar', '萌系头像插画', '风格插画', 'qwen-image', true, 29000, '萌系头像插画，大眼睛，柔和配色，干净背景', 330),
  s('s-arch', '建筑概念渲染', '建筑及室内设计', 'z-image', true, 900, '建筑概念设计渲染，黄金时刻光线，鸟瞰视角', 40),
];

const l = (id: string, name: string, category: string, uses: number, prompt: string, hue: number, featured = false): MaterialItem => ({
  id,
  name,
  author: '官方',
  category,
  commercial: true,
  uses,
  prompt,
  hue,
  featured,
});

export const LENSES: MaterialItem[] = [
  l('l-orbit', '环绕运镜', '运镜', 2300, '镜头围绕主体 360° 平稳环绕拍摄', 210, true),
  l('l-bullet', '子弹时间', '视觉特效', 1800, '时间凝固，镜头绕主体快速移动，周围物体悬停空中', 190, true),
  l('l-fire', '火焰开场', '视觉特效', 1500, '画面由火焰燃烧展开，主体从火光中显现', 15, true),
  l('l-particle', '粒子消散', '视觉特效', 980, '主体逐渐化为发光粒子随风飘散', 270),
  l('l-cloud', '穿云推进', '运镜', 1700, '镜头高速穿过云层向下推进，视野豁然开朗', 200, true),
  l('l-underwater', '水下慢镜', '氛围', 660, '水下慢动作，气泡缓缓上升，光线折射摇曳', 185),
  l('l-mirror', '镜像分身', '视觉特效', 410, '主体在镜面中分裂出多个分身', 300),
  l('l-fpv', 'FPV 俯冲航拍', '运镜', 1200, '穿越机视角高速俯冲，贴地飞行穿梭', 120),
  l('l-explode', '升格爆炸', '视觉特效', 870, '高速摄影慢动作爆炸，碎片四溅', 25),
  l('l-stardust', '星尘降临', '氛围', 760, '星光尘埃从天而降，环绕主体闪烁', 250, true),
  l('l-dolly', '希区柯克变焦', '运镜', 540, '推轨同时反向变焦，背景压缩拉伸，主体大小不变', 160),
  l('l-oneshot', '一镜到底', '转场', 990, '连续长镜头穿梭多个空间，无剪辑过渡', 90),
  l('l-hero', '英雄登场', '运镜', 1300, '低角度仰拍，慢动作走向镜头，逆光剪影', 40),
  l('l-rain', '控雨定格', '视觉特效', 430, '雨滴在空中静止，主体抬手操控雨水', 215),
  l('l-zoomin', '旅拍转场 · 推进', '转场', 620, '画面快速推进穿过主体进入下一场景', 140),
  l('l-spin', '旅拍转场 · 旋转', '转场', 580, '画面整体旋转过渡到下一场景', 330),
];

export const catalogOf = (kind: MaterialKind) => (kind === 'style' ? STYLES : LENSES);
export const findMaterial = (kind: MaterialKind, id?: string) => catalogOf(kind).find((m) => m.id === id);
export const modelLabel = (id?: string) => MODELS.image.find((m) => m.id === id)?.label ?? id ?? '';
export const coverStyle = (hue: number) => ({
  background: `radial-gradient(circle at 30% 25%, hsla(${(hue + 40) % 360}, 80%, 70%, .55), transparent 45%), linear-gradient(135deg, hsl(${hue}, 55%, 22%), hsl(${(hue + 60) % 360}, 65%, 48%))`,
});

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export const ROLE_OPTIONS = {
  gender: ['女性', '男性', '中性'],
  age: ['幼年', '少年', '青年', '中年', '老年'],
  region: ['东亚', '欧美', '中东', '非洲', '其他'],
  era: ['古代', '近代', '现代', '未来'],
  body: ['标准', '纤细', '丰满', '健硕'],
  hair: ['长直发', '大波浪', '波波头', '齐肩短发', '高马尾', '丸子头', '编发', '短发', '寸头'],
  outfit: ['休闲装', '正式装', '印花长裙', '职场', '古风', '科幻'],
  look: ['现代', '古风', '民国', '仙侠', '科幻', '国潮'],
} as const;

export type RoleAttrKey = keyof typeof ROLE_OPTIONS;
export type RoleAttrs = Record<RoleAttrKey, string>;

export const ROLE_ATTR_LABEL: Record<RoleAttrKey, string> = {
  gender: '性别',
  age: '年龄段',
  region: '地区',
  era: '时代',
  body: '身材',
  hair: '发型',
  outfit: '服装',
  look: '造型风格',
};

export const VOICES = ['普通话 · 女', '普通话 · 男', '少女音色', '御姐音色', '青涩青年', '磁性青年', '少年音色', '沉稳中年', '慈祥长者'];

export interface RoleVoice {
  preset: string;
  speed: number;
  pitch: number;
}

export type RoleAssetKind = 'avatar' | 'full' | 'turnaround' | 'expressions';

export const ROLE_ASSETS: { kind: RoleAssetKind; label: string; ratio: string; prompt: string }[] = [
  { kind: 'avatar', label: '头像', ratio: '1:1', prompt: '头像特写，正脸，干净背景' },
  { kind: 'full', label: '全身图', ratio: '9:16', prompt: '全身站姿，白色背景' },
  { kind: 'turnaround', label: '转面板', ratio: '16:9', prompt: '角色设定转面板，正面、侧面、背面三视图，白底' },
  { kind: 'expressions', label: '情绪九宫格', ratio: '1:1', prompt: '情绪九宫格，喜怒哀乐等九种表情' },
];

export interface Role {
  id: string;
  name: string;
  desc: string;
  attrs: RoleAttrs;
  voice: RoleVoice;
  assets: Partial<Record<RoleAssetKind, MediaRef>>;
  official?: boolean;
  createdAt: number;
  status?: 'idle' | 'generating' | 'error';
  progress?: number;
}

const role = (id: string, name: string, attrs: RoleAttrs, voice: string, desc: string): Role => ({
  id,
  name,
  desc,
  attrs,
  voice: { preset: voice, speed: 1, pitch: 1 },
  assets: {},
  official: true,
  createdAt: 0,
});

export const OFFICIAL_ROLES: Role[] = [
  role('o-linxia', '林夏', { gender: '女性', age: '青年', region: '东亚', era: '现代', body: '纤细', hair: '齐肩短发', outfit: '职场', look: '现代' }, '御姐音色', '冷静干练的都市律师，眼神坚定，说话简洁有力'),
  role('o-luchen', '陆沉', { gender: '男性', age: '青年', region: '东亚', era: '古代', body: '标准', hair: '长直发', outfit: '古风', look: '仙侠' }, '磁性青年', '白衣剑修，清冷寡言，背负长剑'),
  role('o-sunian', '苏念', { gender: '女性', age: '少年', region: '东亚', era: '近代', body: '纤细', hair: '编发', outfit: '印花长裙', look: '民国' }, '少女音色', '民国学堂女学生，温婉灵动，手里总抱着书'),
  role('o-leo', 'Leo', { gender: '男性', age: '中年', region: '欧美', era: '现代', body: '健硕', hair: '短发', outfit: '正式装', look: '现代' }, '沉稳中年', '风度翩翩的投资人，银灰鬓角，西装笔挺'),
  role('o-hoshino', '星野', { gender: '中性', age: '青年', region: '东亚', era: '未来', body: '纤细', hair: '波波头', outfit: '科幻', look: '科幻' }, '青涩青年', '赛博都市里的义体黑客，左臂是机械义肢'),
  role('o-granny', '王奶奶', { gender: '女性', age: '老年', region: '东亚', era: '现代', body: '标准', hair: '丸子头', outfit: '休闲装', look: '现代' }, '慈祥长者', '慈祥的社区面馆老板娘，围裙上总沾着面粉'),
];

export const DEFAULT_ROLE_ATTRS: RoleAttrs = { gender: '女性', age: '青年', region: '东亚', era: '现代', body: '标准', hair: '长直发', outfit: '休闲装', look: '现代' };

export function rolePrompt(r: Pick<Role, 'name' | 'desc' | 'attrs'>): string {
  const a = r.attrs;
  return `角色「${r.name}」：${a.region}${a.gender}，${a.age}，${a.era}，${a.body}身材，${a.hair}，${a.outfit}，${a.look}造型。${r.desc}`;
}

export const roleHue = (r: Pick<Role, 'id'>) => [...r.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

// ---------------------------------------------------------------------------
// Toolbox: reusable workflow templates (a saved group of nodes)
// ---------------------------------------------------------------------------

export interface ToolboxTemplate {
  id: string;
  name: string;
  builtin?: boolean;
  hue: number;
  cover?: MediaRef;
  /** Node positions are relative to the template's top-left corner. */
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

type Spec = [key: string, kind: NodeKind, x: number, y: number, data: Partial<CanvasNodeData>];

function preset(id: string, name: string, hue: number, specs: Spec[], links: [string, string][]): ToolboxTemplate {
  const nodes: CanvasNode[] = specs.map(([key, kind, x, y, data]) => ({
    id: key,
    type: kind,
    position: { x, y },
    data: {
      title: data.title ?? key,
      ...(isGenKind(kind) ? { model: MODELS[kind][0].id, params: defaultParams(kind), prompt: '' } : {}),
      ...data,
    },
  }));
  return { id, name, hue, builtin: true, nodes, edges: links.map(([a, b]) => ({ id: `${a}-${b}`, source: a, target: b })) };
}

export const BUILTIN_TOOLBOX: ToolboxTemplate[] = [
  preset(
    't-sheet',
    '角色三视图',
    210,
    [
      ['desc', 'text', 0, 0, { title: '角色描述', text: '在这里描述你的角色外貌、服装和气质' }],
      ['sheet', 'image', 400, 0, { title: '三视图', prompt: '根据角色描述生成正面、侧面、背面三视图，白底，统一比例', params: { ratio: '16:9' } }],
    ],
    [['desc', 'sheet']],
  ),
  preset(
    't-compare',
    '双模型对比写作',
    140,
    [
      ['brief', 'text', 0, 120, { title: '写作要求', text: '在这里写下要写什么、给谁看、什么语气' }],
      ['gpt', 'text', 400, 0, { title: 'ChatGPT 版本', model: 'chatgpt', prompt: '根据写作要求完成文案' }],
      ['claude', 'text', 400, 300, { title: 'Claude 版本', model: 'claude', prompt: '根据写作要求完成文案' }],
    ],
    [
      ['brief', 'gpt'],
      ['brief', 'claude'],
    ],
  ),
  preset(
    't-restyle',
    '参考图改图',
    280,
    [
      ['ref', 'image', 0, 0, { title: '参考图（上传或生成）', prompt: '' }],
      ['new', 'image', 380, 0, { title: '改图结果', prompt: '保持参考图的主体与构图，把风格改为水彩插画' }],
    ],
    [['ref', 'new']],
  ),
  preset(
    't-storyboard',
    '剧情分镜',
    320,
    [
      ['story', 'text', 0, 0, { title: '剧情梗概', text: '在这里写下故事梗概' }],
      ['script', 'script', 400, 0, { title: '分镜脚本', prompt: '把剧情拆成电影化的分镜', params: { shots: 8 } }],
    ],
    [['story', 'script']],
  ),
  preset(
    't-archive',
    '成片留档卡',
    190,
    [
      ['video', 'video', 0, 0, { title: '成片（上传视频）' }],
      ['note', 'text', 420, 0, { title: '制作备注', text: '项目名称：\n交付日期：\n内容简介：\n备注：' }],
      ['desc', 'text', 820, 0, { title: '发布文案', prompt: '根据制作备注写一段视频发布文案，100 字以内' }],
    ],
    [
      ['video', 'note'],
      ['note', 'desc'],
    ],
  ),
  preset(
    't-ecom',
    '电商主图套组',
    60,
    [
      ['points', 'text', 0, 120, { title: '产品卖点', text: '写下产品名称和 3 个核心卖点' }],
      ['main', 'image', 400, 0, { title: '主图', prompt: '电商主图，产品居中，高级质感背景' }],
      ['scene', 'image', 760, 0, { title: '场景图', prompt: '产品使用场景图，生活化氛围' }],
      ['detail', 'image', 400, 360, { title: '细节图', prompt: '产品细节特写，突出材质与工艺' }],
    ],
    [
      ['points', 'main'],
      ['points', 'scene'],
      ['points', 'detail'],
    ],
  ),
];

// ---------------------------------------------------------------------------
// Library store (persisted separately from the canvas)
// ---------------------------------------------------------------------------

/** The user's standing preferences, prepended to every generation of the chosen engines. */
export interface Preferences {
  text: string;
  chatgpt: boolean;
  claude: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { text: '', chatgpt: true, claude: true };

interface LibraryPersisted {
  preferences: Preferences;
  /** Motion-capture clips, usable by any project's director console. */
  motions: MotionClip[];
  roles: Role[];
  toolbox: ToolboxTemplate[];
  favorites: Record<MaterialKind, string[]>;
  recent: Record<MaterialKind, string[]>;
}

interface LibraryState extends LibraryPersisted {
  saveRole(role: Role): void;
  patchRole(id: string, patch: Partial<Role>): void;
  deleteRole(id: string): void;
  addTemplate(t: ToolboxTemplate): void;
  deleteTemplate(id: string): void;
  toggleFavorite(kind: MaterialKind, id: string): void;
  touchRecent(kind: MaterialKind, id: string): void;
  setPreferences(patch: Partial<Preferences>): void;
  saveMotion(m: MotionClip): void;
  deleteMotion(id: string): void;
}

const LIB_KEY = 'libcanvas:library:v1';

function loadLibrary(): Partial<LibraryPersisted> {
  try {
    const data = JSON.parse(localStorage.getItem(LIB_KEY) ?? '{}') as Partial<LibraryPersisted>;
    // A role generation interrupted by a reload can never finish.
    if (data.roles) data.roles = data.roles.map((r) => (r.status === 'generating' ? { ...r, status: 'idle', progress: 0 } : r));
    return data;
  } catch {
    return {};
  }
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  roles: [],
  toolbox: [],
  favorites: { style: [], lens: [] },
  recent: { style: [], lens: [] },
  preferences: DEFAULT_PREFERENCES,
  motions: [],
  ...loadLibrary(),

  saveRole: (r) => set({ roles: get().roles.some((x) => x.id === r.id) ? get().roles.map((x) => (x.id === r.id ? r : x)) : [r, ...get().roles] }),
  patchRole: (id, patch) => set({ roles: get().roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) }),
  deleteRole: (id) => set({ roles: get().roles.filter((r) => r.id !== id) }),
  addTemplate: (t) => set({ toolbox: [t, ...get().toolbox.filter((x) => x.id !== t.id)] }),
  deleteTemplate: (id) => set({ toolbox: get().toolbox.filter((t) => t.id !== id) }),
  toggleFavorite(kind, id) {
    const cur = get().favorites[kind];
    set({ favorites: { ...get().favorites, [kind]: cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur] } });
  },
  saveMotion: (m) => set({ motions: [m, ...get().motions.filter((x) => x.id !== m.id)] }),
  deleteMotion: (id) => set({ motions: get().motions.filter((m) => m.id !== id) }),
  setPreferences: (patch) => set({ preferences: { ...DEFAULT_PREFERENCES, ...get().preferences, ...patch } }),
  touchRecent(kind, id) {
    set({ recent: { ...get().recent, [kind]: [id, ...get().recent[kind].filter((x) => x !== id)].slice(0, 30) } });
  },
}));

useLibrary.subscribe((st) => {
  const { roles, toolbox, favorites, recent, preferences } = st;
  try {
    // Motion clips are large: they live in the archive (library.json), not in localStorage.
    localStorage.setItem(LIB_KEY, JSON.stringify({ roles, toolbox, favorites, recent, preferences }));
  } catch {
    // Storage full: the library keeps working for this session.
  }
});

export const allRoles = () => [...useLibrary.getState().roles, ...OFFICIAL_ROLES];
export const findRole = (id?: string) => allRoles().find((r) => r.id === id);

export function newRole(partial: Partial<Role> = {}): Role {
  return {
    id: nanoid(10),
    name: '新角色',
    desc: '',
    attrs: { ...DEFAULT_ROLE_ATTRS },
    voice: { preset: VOICES[0], speed: 1, pitch: 1 },
    assets: {},
    createdAt: Date.now(),
    status: 'idle',
    ...partial,
  };
}

/** Generates the role's asset set (avatar, full body, turnaround, expressions) in parallel. */
export async function generateRoleAssets(id: string, kinds: RoleAssetKind[] = ROLE_ASSETS.map((a) => a.kind)) {
  const lib = useLibrary.getState();
  const r = lib.roles.find((x) => x.id === id);
  if (!r) return;
  lib.patchRole(id, { status: 'generating', progress: 0 });
  const base = rolePrompt(r);
  const refs = Object.values(r.assets).filter((m): m is MediaRef => m?.kind === 'image');
  let done = 0;
  try {
    await Promise.all(
      ROLE_ASSETS.filter((a) => kinds.includes(a.kind)).map(async (spec) => {
        const [out] = await getProvider().generate(
          { kind: 'image', prompt: `${base}。${spec.prompt}`, model: 'chatgpt', params: { ratio: spec.ratio }, images: refs },
          () => {},
        );
        done++;
        const cur = useLibrary.getState().roles.find((x) => x.id === id);
        if (cur && out?.media) useLibrary.getState().patchRole(id, { assets: { ...cur.assets, [spec.kind]: out.media }, progress: done / kinds.length });
      }),
    );
    useLibrary.getState().patchRole(id, { status: 'idle', progress: 1 });
  } catch {
    useLibrary.getState().patchRole(id, { status: 'error' });
  }
}

/** Plays a line with the browser's built-in speech synthesis as a local voice preview. */
export function previewVoice(voice: RoleVoice, text = '你好，我是你的角色，很高兴和你见面。') {
  if (!('speechSynthesis' in window)) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  const male = /男|青年|中年|长者|少年/.test(voice.preset) && !/少女|御姐|女/.test(voice.preset);
  u.rate = voice.speed;
  u.pitch = Math.max(0, Math.min(2, voice.pitch * (male ? 0.8 : 1.15)));
  const zh = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('zh'));
  if (zh.length) u.voice = zh[(VOICES.indexOf(voice.preset) + zh.length) % zh.length];
  speechSynthesis.speak(u);
  return true;
}
