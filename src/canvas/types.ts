import type { Edge, Node } from '@xyflow/react';

export type GenKind = 'text' | 'image' | 'script' | 'audio';
export type NodeKind = GenKind | 'video' | 'director' | 'reference' | 'group' | 'video-clip' | 'style' | 'lens' | 'character';
export type MediaKind = 'image' | 'video' | 'audio';

export interface MediaRef {
  id: string;
  kind: MediaKind;
  name?: string;
  w?: number;
  h?: number;
  /** Video only: a still frame saved as an image, used when the video feeds a generation. */
  poster?: MediaRef;
}

export interface Shot {
  id: string;
  text: string;
}

/** Exactly what a generation sent to the AI app, kept with its result. */
export interface SentRecord {
  model: string;
  prompt: string;
  images: string[];
}

export interface GenOutput {
  id: string;
  createdAt: number;
  text?: string;
  media?: MediaRef;
  shots?: Shot[];
  sent?: SentRecord;
}

export type GenStatus = 'idle' | 'running' | 'done' | 'error';
export type ParamValue = string | number | boolean;

export interface CanvasNodeData extends Record<string, unknown> {
  title: string;
  prompt?: string;
  model?: string;
  params?: Record<string, ParamValue>;
  outputs?: GenOutput[];
  current?: number;
  status?: GenStatus;
  progress?: number;
  /** Latest progress message from the local AI app. */
  statusText?: string;
  /** A video tool working on this node, e.g. "正在分离音视频…". */
  busy?: string;
  error?: string;
  /** Body of text and reference nodes. */
  text?: string;
  /** Style / lens node: catalog item id. */
  materialId?: string;
  /** Character node: role id in the character library. */
  roleId?: string;
  /** Director node: the 3D scene. */
  scene?: import('../director/scene').DirScene;
}

export type CanvasNode = Node<CanvasNodeData, NodeKind>;
export type CanvasEdge = Edge;

export interface HistoryItem {
  id: string;
  kind: 'text' | MediaKind;
  media?: MediaRef;
  text?: string;
  prompt: string;
  model: string;
  createdAt: number;
  rating?: number;
}

export const GEN_KINDS: readonly NodeKind[] = ['text', 'image', 'script', 'audio'];
export const isGenKind = (k?: string): k is GenKind => !!k && (GEN_KINDS as readonly string[]).includes(k);
