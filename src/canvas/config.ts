import { DESIGN_OPTIONS, THEMES, UI_STYLE_NAMES } from './designs';
import type { GenKind, NodeKind, ParamValue } from './types';

export interface NodeMeta {
  label: string;
  desc: string;
  icon: string;
  width: number;
}

export const NODE_META: Record<NodeKind, NodeMeta> = {
  text: { label: '文本', desc: '文案，或切到「视频提示词」按 Seedance 2.0 写（ChatGPT / Claude）', icon: 'text', width: 320 },
  image: { label: '图片', desc: 'ChatGPT 生成，或上传本地图片', icon: 'image', width: 300 },
  video: { label: '视频', desc: '上传留档；连到其他节点时截取画面作参考', icon: 'video', width: 360 },
  audio: { label: '音频', desc: '音乐（ACE-Step 出歌 / 合成小样）或配音（Qwen3-TTS，可克隆声音），也可上传', icon: 'audio', width: 320 },
  voice: { label: '配音', desc: '文字转人声：Qwen3-TTS 本地配音，可先让 GPT/Claude 写口播', icon: 'mic', width: 320 },
  script: { label: '脚本', desc: '创意脚本、生成故事板', icon: 'script', width: 340 },
  vprompt: { label: '视频提示词', desc: '按 Seedance 2.0 方法写视频生成提示词', icon: 'film', width: 380 },
  method: { label: '视频玩法', desc: '选一种玩法、写下想法，AI 用 HyperFrames 直接做出成片，可在 Studio 里继续改', icon: 'workflow', width: 430 },
  'video-clip': { label: '智能剪辑', desc: '多个视频片段合为一个', icon: 'clip', width: 420 },
  reference: { label: '参考节点', desc: '备忘文本；连线仅为示意', icon: 'note', width: 260 },
  group: { label: '分组', desc: '把多个节点组织在一起', icon: 'group', width: 0 },
  style: { label: '风格', desc: '画面风格，连到图片 / 文本 / 脚本节点', icon: 'palette', width: 240 },
  lens: { label: '特效', desc: '运镜与特效，连到脚本 / 图片 / 文本节点', icon: 'aperture', width: 240 },
  character: { label: '角色', desc: '引用角色库中的角色', icon: 'smile', width: 260 },
  director: { label: '导演台', desc: '搭建 3D 场景，截图作为构图参考', icon: 'cube', width: 360 },
};

/** Order of entries in the add-node menu. */
export const MENU_KINDS: NodeKind[] = ['text', 'image', 'video', 'audio', 'script', 'director', 'video-clip', 'style', 'lens', 'method', 'character', 'reference'];

export interface ModelDef {
  id: string;
  label: string;
}

/** Engines run through the AI apps installed on this Mac (see server/index.mjs). */
export const MODELS: Record<GenKind, ModelDef[]> = {
  text: [
    { id: 'chatgpt', label: 'ChatGPT' },
    { id: 'claude', label: 'Claude Code' },
  ],
  image: [{ id: 'chatgpt', label: 'ChatGPT' }],
  script: [
    { id: 'chatgpt', label: 'ChatGPT' },
    { id: 'claude', label: 'Claude Code' },
  ],
  audio: [
    { id: 'chatgpt', label: 'ChatGPT' },
    { id: 'claude', label: 'Claude Code' },
  ],
  vprompt: [
    { id: 'chatgpt', label: 'ChatGPT' },
    { id: 'claude', label: 'Claude Code' },
  ],
  // The agent that builds the film (see server/studio.mjs).
  method: [
    { id: 'claude', label: 'Claude Code' },
    { id: 'chatgpt', label: 'ChatGPT' },
  ],
  // Voice engines; the AI that writes the narration is the 'writer' param.
  voice: [
    { id: 'qwen3', label: 'Qwen3-TTS' },
    { id: 'system', label: '系统语音' },
  ],
};

/** Qwen3-TTS CustomVoice speakers. */
export const VOICES: Record<string, string> = {
  Serena: '温柔女声',
  Vivian: '明亮女声',
  Uncle_Fu: '低沉男声',
  Dylan: '京味男声',
  Eric: '川味男声',
  Ryan: '英文男声',
  Aiden: '美式男声',
  Ono_Anna: '日语女声',
  Sohee: '韩语女声',
};

/** Tone presets, sent to Qwen3-TTS as a style instruction. */
export const TONES: Record<string, string> = {
  自然: '',
  温柔: '温柔亲切，语速稍慢',
  激昂: '激昂有力，富有感染力',
  悬疑: '低沉神秘，语速稍慢，营造悬疑感',
  新闻播报: '字正腔圆的新闻播报腔，平稳清晰',
  讲故事: '像讲故事一样生动，有轻重起伏',
  开心: '开心愉快，语调轻快',
  低沉: '低沉克制，略带沙哑',
};

export interface ParamDef {
  key: string;
  label: string;
  options: ParamValue[];
  format?: (v: ParamValue) => string;
  /** Shown (and used) only when this returns true for the node's params. */
  when?: (p: Record<string, ParamValue>) => boolean;
  /** Picking 「自定义」 shows a number field; the value is kept as params[`${key}Custom`]. */
  custom?: { min: number; max: number; unit: string };
}

/** Duration options: 「按文案」 leaves the length to what the request says. */
export const AUTO_LEN = '按文案';
export const CUSTOM_LEN = '自定义';
const lengthParam = (secs: number[], max: number, when?: ParamDef['when']): ParamDef => ({
  key: 'duration',
  label: '时长',
  options: [AUTO_LEN, ...secs, CUSTOM_LEN],
  format: (v) => (typeof v === 'number' ? `${v}秒` : v === AUTO_LEN ? '时长：按文案' : String(v)),
  custom: { min: 1, max, unit: '秒' },
  when,
});

/** The seconds a duration option asks for, or undefined when it is 「按文案」 (or an empty custom value). */
export function secondsOf(params: Record<string, ParamValue>, key = 'duration'): number | undefined {
  const v = params[key];
  const n = Number(v === CUSTOM_LEN ? params[`${key}Custom`] : v);
  return n > 0 ? n : undefined;
}

const isVideoPrompt = (p: Record<string, ParamValue>) => p.mode === '视频提示词';
const isVoice = (p: Record<string, ParamValue>) => p.mode === '配音' || p.mode === '克隆';
const isPresetVoice = (p: Record<string, ParamValue>) => p.mode === '配音';

export const PARAMS: Record<GenKind, ParamDef[]> = {
  text: [
    { key: 'mode', label: '类型', options: ['文案', '视频提示词'] },
    lengthParam([5, 10, 15, 30], 300, isVideoPrompt),
    { key: 'ratio', label: '比例', options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], when: isVideoPrompt },
    { key: 'lang', label: '语言', options: ['中文', 'English'], when: isVideoPrompt },
  ],
  image: [
    { key: 'ratio', label: '比例', options: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'] },
    { key: 'design', label: '设计', options: DESIGN_OPTIONS, format: (v) => (v === '无' ? '设计：无' : String(v)) },
    { key: 'theme', label: '主题', options: Object.keys(THEMES), when: (p) => p.design === '主题配色' },
    { key: 'uiStyle', label: 'UI 风格', options: UI_STYLE_NAMES, when: (p) => p.design === 'UI 风格库' },
  ],
  script: [{ key: 'shots', label: '镜头数', options: [4, 6, 8, 12], format: (v) => `${v}镜` }],
  audio: [
    { key: 'mode', label: '类型', options: ['音乐', '配音', '克隆'], format: (v) => (v === '克隆' ? '克隆声音' : String(v)) },
    { key: 'engine', label: '引擎', options: ['ACE-Step 歌曲', '合成小样'], when: (p) => !isVoice(p) },
    { key: 'vocal', label: '人声', options: ['有人声', '纯音乐'], when: (p) => !isVoice(p) },
    lengthParam([15, 30, 60, 120], 600, (p) => !isVoice(p)),
    { key: 'voice', label: '音色', options: Object.keys(VOICES), format: (v) => `${VOICES[String(v)] ?? v}`, when: isPresetVoice },
    { key: 'tone', label: '语气', options: Object.keys(TONES), when: isPresetVoice },
    { key: 'writer', label: '文案', options: ['原文', 'AI 写口播'], when: isVoice },
    { key: 'tts', label: '引擎', options: ['Qwen3-TTS', '系统语音'], when: isPresetVoice },
  ],
  voice: [
    { key: 'voice', label: '音色', options: Object.keys(VOICES), format: (v) => `${VOICES[String(v)] ?? v}` },
    { key: 'tone', label: '语气', options: Object.keys(TONES) },
    { key: 'writer', label: '文案', options: ['原文', 'ChatGPT 写口播', 'Claude 写口播'] },
  ],
  method: [
    { key: 'ratio', label: '比例', options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] },
    lengthParam([10, 15, 30, 60], 300),
    { key: 'version', label: '方式', options: ['新作品', '改上一版'] },
  ],
  vprompt: [
    lengthParam([5, 10, 15, 30], 300),
    { key: 'ratio', label: '比例', options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] },
    { key: 'lang', label: '语言', options: ['中文', 'English'] },
  ],
};

export function defaultParams(kind: NodeKind): Record<string, ParamValue> {
  const defs = (PARAMS as Record<string, ParamDef[] | undefined>)[kind] ?? [];
  return Object.fromEntries(defs.map((d) => [d.key, d.options[0]]));
}

export function ratioOf(value: ParamValue | undefined, fallback = '16:9'): number {
  const [w, h] = String(value ?? fallback).split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';
export const ALT = isMac ? '⌥' : 'Alt';
