import { create } from 'zustand';
import type { XYPosition } from '@xyflow/react';
import type { MaterialKind } from './library';
import type { MediaRef, SentRecord } from './types';

export interface MenuState {
  /** Screen position of the popup. */
  x: number;
  y: number;
  /** Where a new node goes on the canvas. */
  flow: XYPosition;
  /** Dragging a connection into empty space: the new node gets wired to this node. */
  from?: string;
  /** Open upwards from (x, y), for the bottom dock button. */
  anchor?: 'above';
}

export interface ContextMenuState extends MenuState {
  nodeId?: string;
}

export type Panel = 'assets' | 'history' | 'shortcuts' | null;

interface UIState {
  menu: MenuState | null;
  ctx: ContextMenuState | null;
  panel: Panel;
  search: boolean;
  preview: MediaRef | null;
  tidyPrev: Map<string, XYPosition> | null;
  toast: string | null;
  /** Where "上传" from a menu should drop the files. */
  uploadAt: XYPosition | null;
  /** Style / effect library; with targetNodeId it picks for that style or lens node. */
  library: { kind: MaterialKind; targetNodeId?: string } | null;
  toolbox: boolean;
  /** Character studio; roleId opens a role, 'new' opens the create flow. */
  studio: { roleId?: string; pickFor?: string } | null;
  /** Project manager window. */
  projects: boolean;
  /** "My preferences" window. */
  prefs: boolean;
  /** Video crop / shot-breakdown windows, for a video node. */
  cropFor: string | null;
  breakdownFor: string | null;
  /** "What was sent" viewer for a generated result. */
  sentView: { title: string; sent: SentRecord } | null;
  /** Right-click menu on an asset tile. */
  tileMenu: { x: number; y: number; media: MediaRef } | null;
  set(patch: Partial<Omit<UIState, 'set' | 'togglePanel' | 'notify'>>): void;
  togglePanel(p: Exclude<Panel, null>): void;
  notify(msg: string): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUI = create<UIState>()((set, get) => ({
  menu: null,
  ctx: null,
  panel: null,
  search: false,
  preview: null,
  tidyPrev: null,
  toast: null,
  uploadAt: null,
  library: null,
  toolbox: false,
  studio: null,
  projects: false,
  prefs: false,
  sentView: null,
  cropFor: null,
  breakdownFor: null,
  tileMenu: null,
  set: (patch) => set(patch),
  togglePanel: (p) => set({ panel: get().panel === p ? null : p }),
  notify(msg) {
    clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 2200);
  },
}));

/** Opens the hidden file input; files land at `at` (flow coordinates). */
export function requestUpload(at: XYPosition) {
  useUI.getState().set({ uploadAt: at, menu: null, ctx: null });
  document.getElementById('lc-upload')?.click();
}
