import type { GenKind, NodeKind, ParamValue } from './types';

export interface NodeMeta {
  label: string;
  desc: string;
  icon: string;
  width: number;
}

export const NODE_META: Record<NodeKind, NodeMeta> = {
  text: { label: '文本', desc: 'ChatGPT / Claude Code 生成文案', icon: 'text', width: 320 },
  image: { label: '图片', desc: 'ChatGPT 生成，或上传本地图片', icon: 'image', width: 300 },
  video: { label: '视频', desc: '上传留档；连到其他节点时截取画面作参考', icon: 'video', width: 360 },
  audio: { label: '音频', desc: '上传本地音频，留档保存', icon: 'audio', width: 320 },
  script: { label: '脚本', desc: '创意脚本、生成故事板', icon: 'script', width: 340 },
  'video-clip': { label: '智能剪辑', desc: '多个视频片段合为一个', icon: 'clip', width: 420 },
  reference: { label: '参考节点', desc: '备忘文本；连线仅为示意', icon: 'note', width: 260 },
  group: { label: '分组', desc: '把多个节点组织在一起', icon: 'group', width: 0 },
  style: { label: '风格', desc: '画面风格，连到图片 / 文本 / 脚本节点', icon: 'palette', width: 240 },
  lens: { label: '特效', desc: '运镜与特效，连到脚本 / 图片 / 文本节点', icon: 'aperture', width: 240 },
  character: { label: '角色', desc: '引用角色库中的角色', icon: 'smile', width: 260 },
};

/** Order of entries in the add-node menu. */
export const MENU_KINDS: NodeKind[] = ['text', 'image', 'video', 'audio', 'script', 'video-clip', 'style', 'lens', 'character', 'reference'];

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
};

export interface ParamDef {
  key: string;
  label: string;
  options: ParamValue[];
  format?: (v: ParamValue) => string;
}

export const PARAMS: Record<GenKind, ParamDef[]> = {
  text: [],
  image: [{ key: 'ratio', label: '比例', options: ['1:1', '16:9', '9:16', '4:3', '3:4'] }],
  script: [{ key: 'shots', label: '镜头数', options: [4, 6, 8, 12], format: (v) => `${v}镜` }],
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
