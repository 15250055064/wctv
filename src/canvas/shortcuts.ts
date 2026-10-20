import { ALT, MOD, isMac } from './config';

export type ShortcutId =
  | 'new-node'
  | 'generate'
  | 'group'
  | 'ungroup'
  | 'connect'
  | 'duplicate'
  | 'copy'
  | 'cut'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit'
  | 'zoom-100'
  | 'tool-move'
  | 'tool-hand'
  | 'tidy'
  | 'search'
  | 'select-all'
  | 'delete'
  | 'escape';

export interface ShortcutDef {
  id: ShortcutId;
  combo: string[];
  label: string;
  group: 'creation' | 'zoom' | 'move' | 'other';
  /** Still fires while typing in a text field. */
  allowInInput?: boolean;
  hidden?: boolean;
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'new-node', combo: ['tab'], label: '新建节点', group: 'creation' },
  { id: 'generate', combo: ['mod+enter'], label: '生成', group: 'creation', allowInInput: true },
  { id: 'group', combo: ['mod+g', 'alt+g'], label: '分组', group: 'creation' },
  { id: 'ungroup', combo: ['mod+shift+g', 'alt+shift+g'], label: '取消分组', group: 'creation' },
  { id: 'connect', combo: ['mod+l'], label: '连接选中节点', group: 'creation' },
  { id: 'duplicate', combo: ['mod+d'], label: '复制节点及连线', group: 'creation' },
  { id: 'copy', combo: ['mod+c'], label: '复制', group: 'creation' },
  { id: 'cut', combo: ['mod+x'], label: '剪切', group: 'creation' },
  { id: 'undo', combo: ['mod+z'], label: '撤销', group: 'creation' },
  { id: 'redo', combo: ['mod+shift+z', 'mod+y'], label: '重做', group: 'creation' },
  { id: 'zoom-in', combo: ['mod+=', 'mod+shift+='], label: '放大', group: 'zoom' },
  { id: 'zoom-out', combo: ['mod+-'], label: '缩小', group: 'zoom' },
  { id: 'fit', combo: ['mod+0', 'shift+1'], label: '适合屏幕', group: 'zoom' },
  { id: 'zoom-100', combo: ['mod+1'], label: '缩放至 100%', group: 'zoom' },
  { id: 'tool-move', combo: ['v'], label: '移动工具', group: 'move' },
  { id: 'tool-hand', combo: ['h'], label: '抓手工具', group: 'move' },
  { id: 'tidy', combo: ['alt+shift+f'], label: '整理画布', group: 'move' },
  { id: 'search', combo: ['mod+f'], label: '搜索节点', group: 'other', allowInInput: true },
  { id: 'select-all', combo: ['mod+a'], label: '全选', group: 'other' },
  { id: 'delete', combo: ['delete', 'backspace'], label: '删除', group: 'other' },
  { id: 'escape', combo: ['escape'], label: '取消', group: 'other', hidden: true },
];

/** Shortcuts the panel lists that are gestures, not key combos. */
export const GESTURES: { group: ShortcutDef['group']; label: string; keys: string }[] = [
  { group: 'creation', label: '节点复制', keys: `${ALT} + 拖动节点` },
  { group: 'creation', label: '创建副本（含连线）', keys: `⇧ ${ALT} + 拖动` },
  { group: 'creation', label: '粘贴（含剪贴板图片）', keys: `${MOD} V` },
  { group: 'creation', label: '新建节点', keys: '双击画布' },
  { group: 'zoom', label: '触控板', keys: '双指捏合' },
  { group: 'zoom', label: '鼠标', keys: `${MOD} + 滚轮` },
  { group: 'move', label: '键盘', keys: 'Space + 拖动' },
  { group: 'move', label: '触控板', keys: '双指滑动' },
  { group: 'move', label: '鼠标', keys: '中键拖动' },
  { group: 'other', label: '多选', keys: `Shift 框选 / ${MOD} 点击` },
];

const KEY_LABEL: Record<string, string> = isMac
  ? { mod: '⌘', alt: '⌥', shift: '⇧', enter: '↵', tab: 'Tab', delete: 'Del', backspace: '⌫', escape: 'Esc' }
  : { mod: 'Ctrl', alt: 'Alt', shift: 'Shift', enter: 'Enter', tab: 'Tab', delete: 'Del', backspace: 'Backspace', escape: 'Esc' };

export const formatCombo = (combo: string) =>
  combo
    .split('+')
    .map((k) => KEY_LABEL[k] ?? k.toUpperCase())
    .join(' ');

/** Normalize a keydown into "mod+alt+shift+key" using the physical key, so Alt/⌥ combos work. */
export function eventCombo(e: KeyboardEvent): string {
  const code = e.code;
  let key: string;
  if (code.startsWith('Key')) key = code.slice(3).toLowerCase();
  else if (code.startsWith('Digit')) key = code.slice(5);
  else if (code === 'Equal' || code === 'NumpadAdd') key = '=';
  else if (code === 'Minus' || code === 'NumpadSubtract') key = '-';
  else key = e.key.toLowerCase();
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

export function matchShortcut(e: KeyboardEvent): ShortcutDef | undefined {
  const combo = eventCombo(e);
  return SHORTCUTS.find((s) => s.combo.includes(combo));
}
