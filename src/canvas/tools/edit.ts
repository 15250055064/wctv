import { saveTemp } from '../media';
import { getProvider } from '../provider';
import type { MediaRef } from '../types';
import { canvas, ctx2d, foregroundMask, inpaint, loadImage, saveCanvas, toBlob, type Progress } from './image';

// 扩图 and 元素编辑, modelled on LibTV's image toolbar. 扩图: the picture is placed on a larger
// canvas (padding chosen per side) and the new area is filled. 元素编辑: marked places are
// changed, removed or moved. ChatGPT does the drawing (or LaMa locally for fills and
// removals); the original pixels outside the edited areas are pasted back unchanged.

export type Engine = 'chatgpt' | 'local';

/** Padding added on each side, in the picture's pixels. */
export interface Pads {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** LibTV allows up to 8192 px; 4096 keeps ChatGPT and LaMa results sharp enough and memory sane. */
const MAX_SIDE = 4096;

/** A ChatGPT image edit: `images` are references, the result is scaled to cover w×h. */
async function chatgptEdit(prompt: string, images: MediaRef[], w: number, h: number, onProgress: Progress) {
  onProgress('ChatGPT 正在生成（约 1 分钟）…');
  const [r] = await getProvider().generate({ kind: 'image', model: 'chatgpt', params: { ratio: `${w}:${h}` }, images, prompt }, (_p, m) => m && onProgress(`ChatGPT：${m}`));
  if (!r?.media) throw new Error('ChatGPT 没有返回图片');
  const img = await loadImage(r.media);
  const out = canvas(w, h);
  const k = Math.max(w / img.width, h / img.height);
  ctx2d(out).drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
  return out;
}

const tempPng = async (c: HTMLCanvasElement, name: string) => saveTemp(await toBlob(c), name);

/** A soft-edged copy of a mask (white = keep the new picture), grown by `grow` px. */
function softMask(mask: HTMLCanvasElement, w: number, h: number, grow: number) {
  const m = canvas(w, h);
  const g = ctx2d(m);
  g.filter = `blur(${Math.max(1, grow)}px)`;
  // Drawing it a few times before the blur grows the area outward.
  for (let i = 0; i < 3; i++) g.drawImage(mask, 0, 0, w, h);
  return m;
}

/** `base` with `top` drawn over it only where `mask` is set (soft edge). */
function blendIn(base: HTMLCanvasElement, top: HTMLCanvasElement, mask: HTMLCanvasElement) {
  const piece = canvas(base.width, base.height);
  const p = ctx2d(piece);
  p.drawImage(mask, 0, 0);
  p.globalCompositeOperation = 'source-in';
  p.drawImage(top, 0, 0);
  const out = canvas(base.width, base.height);
  ctx2d(out).drawImage(base, 0, 0);
  ctx2d(out).drawImage(piece, 0, 0);
  return out;
}

/** Mask canvas → bytes (255 where set) at w×h. */
function maskBytes(mask: HTMLCanvasElement, w: number, h: number) {
  const c = canvas(w, h);
  ctx2d(c).drawImage(mask, 0, 0, w, h);
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] > 40 ? 255 : 0;
  return out;
}

// ---- 扩图 ------------------------------------------------------------------------------------

export async function outpaint(media: MediaRef, pads: Pads, engine: Engine, note: string, name: string, onProgress: Progress): Promise<MediaRef> {
  const src = await loadImage(media);
  let W = Math.round(src.width + pads.left + pads.right);
  let H = Math.round(src.height + pads.top + pads.bottom);
  if (W <= src.width && H <= src.height) throw new Error('请先拖动边框，选出要扩展的区域');
  const k = Math.min(1, MAX_SIDE / Math.max(W, H));
  W = Math.round(W * k);
  H = Math.round(H * k);
  const at = { x: Math.round(pads.left * k), y: Math.round(pads.top * k), w: Math.round(src.width * k), h: Math.round(src.height * k) };
  // The original on a white canvas, like LibTV sends it.
  const padded = canvas(W, H);
  const p = ctx2d(padded);
  p.fillStyle = '#ffffff';
  p.fillRect(0, 0, W, H);
  p.drawImage(src, at.x, at.y, at.w, at.h);
  // Where the original is (white), slightly inset so its edge blends into the new part.
  const keep = canvas(W, H);
  const inset = Math.max(2, Math.round(Math.min(at.w, at.h) * 0.01));
  ctx2d(keep).fillStyle = '#fff';
  ctx2d(keep).fillRect(at.x + (pads.left ? inset : 0), at.y + (pads.top ? inset : 0), at.w - (pads.left ? inset : 0) - (pads.right ? inset : 0), at.h - (pads.top ? inset : 0) - (pads.bottom ? inset : 0));

  let filled: HTMLCanvasElement;
  if (engine === 'chatgpt') {
    const ref = await tempPng(padded, `${name}-扩图底图.png`);
    filled = await chatgptEdit(
      `这张参考图中间是一张照片，四周白色部分是要扩展出来的画布。请把画面自然地延伸到整个画布：原照片的内容、位置和大小完全不变，向外补全场景，透视、光线、色调、质感与原图一致，衔接处看不出痕迹，不要留下白边，不要加文字。${note ? `扩展部分的要求：${note}` : ''}`,
      [ref],
      W,
      H,
      onProgress,
    );
  } else {
    const hole = new Uint8ClampedArray(W * H);
    const kept = maskBytes(keep, W, H);
    for (let i = 0; i < hole.length; i++) hole[i] = kept[i] ? 0 : 255;
    filled = await inpaint(padded, hole, onProgress);
  }
  // The original's own pixels go back on top, so only the new area is generated.
  onProgress('正在合成…');
  const original = canvas(W, H);
  ctx2d(original).drawImage(src, at.x, at.y, at.w, at.h);
  const out = blendIn(filled, original, softMask(keep, W, H, inset));
  return saveCanvas(out, `${name}-扩图.png`);
}

// ---- 元素编辑 ---------------------------------------------------------------------------------

export type MarkAction = 'modify' | 'remove' | 'move';

export interface Mark {
  /** White where the object is; any resolution, same shape as the picture. */
  mask: HTMLCanvasElement;
  action: MarkAction;
  desc: string;
  /** For 移动: where the object's centre goes, as fractions of the picture. */
  to?: { x: number; y: number };
}

export const MARK_COLORS = ['#ff4060', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
export const MAX_MARKS = 5;

/** The box around a mask's set pixels, as fractions (0–1). */
export function maskBox(mask: HTMLCanvasElement) {
  const d = ctx2d(mask).getImageData(0, 0, mask.width, mask.height).data;
  let x0 = mask.width, y0 = mask.height, x1 = -1, y1 = -1;
  for (let y = 0; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++)
      if (d[(y * mask.width + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  return { x: x0 / mask.width, y: y0 / mask.height, w: (x1 - x0 + 1) / mask.width, h: (y1 - y0 + 1) / mask.height };
}

let subjects: { src: HTMLCanvasElement; alpha: Uint8ClampedArray } | null = null;

/**
 * 点选: the subject under (fx, fy) (fractions), found with the cutout model and taken as the
 * connected region around the point. Null when the point isn't on a subject.
 */
export async function subjectAt(src: HTMLCanvasElement, fx: number, fy: number, onProgress: Progress = () => {}): Promise<HTMLCanvasElement | null> {
  if (subjects?.src !== src) subjects = { src, alpha: await foregroundMask(src, onProgress) };
  const { alpha } = subjects;
  const W = src.width;
  const H = src.height;
  const start = Math.min(H - 1, Math.floor(fy * H)) * W + Math.min(W - 1, Math.floor(fx * W));
  if (alpha[start] < 128) return null;
  const seen = new Uint8Array(W * H);
  const stack = [start];
  seen[start] = 1;
  const img = new ImageData(W, H);
  while (stack.length) {
    const j = stack.pop()!;
    img.data[j * 4 + 3] = 255;
    const x = j % W;
    for (const n of [j - 1, j + 1, j - W, j + W]) {
      if (n < 0 || n >= W * H || seen[n] || alpha[n] < 128) continue;
      if ((n === j - 1 && x === 0) || (n === j + 1 && x === W - 1)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  const m = canvas(W, H);
  ctx2d(m).putImageData(img, 0, 0);
  return m;
}

/** The marked picture shown to ChatGPT: numbered colour patches, and arrows for moves. */
function guideImage(src: HTMLCanvasElement, marks: Mark[]) {
  const W = src.width;
  const H = src.height;
  const out = canvas(W, H);
  const g = ctx2d(out);
  g.drawImage(src, 0, 0);
  const line = Math.max(3, Math.round(Math.max(W, H) * 0.004));
  marks.forEach((m, i) => {
    const color = MARK_COLORS[i];
    const tint = canvas(W, H);
    const t = ctx2d(tint);
    t.drawImage(m.mask, 0, 0, W, H);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = color;
    t.fillRect(0, 0, W, H);
    g.globalAlpha = 0.45;
    g.drawImage(tint, 0, 0);
    g.globalAlpha = 1;
    const b = maskBox(m.mask)!;
    const box = { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
    g.strokeStyle = color;
    g.lineWidth = line;
    g.strokeRect(box.x, box.y, box.w, box.h);
    const r = Math.max(14, Math.round(Math.max(W, H) * 0.018));
    g.fillStyle = color;
    g.beginPath();
    g.arc(box.x, box.y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), box.x, box.y);
    if (m.action === 'move' && m.to) {
      const from = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const to = { x: m.to.x * W, y: m.to.y * H };
      g.setLineDash([line * 3, line * 2]);
      g.strokeRect(to.x - box.w / 2, to.y - box.h / 2, box.w, box.h);
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(from.x, from.y);
      g.lineTo(to.x, to.y);
      g.stroke();
      const a = Math.atan2(to.y - from.y, to.x - from.x);
      g.beginPath();
      g.moveTo(to.x, to.y);
      g.lineTo(to.x - r * Math.cos(a - 0.5), to.y - r * Math.sin(a - 0.5));
      g.lineTo(to.x - r * Math.cos(a + 0.5), to.y - r * Math.sin(a + 0.5));
      g.closePath();
      g.fill();
    }
  });
  return out;
}

const COLOR_NAMES = ['红色', '蓝色', '绿色', '橙色', '紫色'];

/** Everything ChatGPT may change: each mark, plus where a moved object lands. */
function editArea(marks: Mark[], W: number, H: number) {
  const area = canvas(W, H);
  const a = ctx2d(area);
  for (const m of marks) {
    a.drawImage(m.mask, 0, 0, W, H);
    const b = m.action === 'move' && m.to ? maskBox(m.mask) : null;
    if (b && m.to) {
      a.fillStyle = '#fff';
      a.fillRect((m.to.x - b.w / 2) * W, (m.to.y - b.h / 2) * H, b.w * W, b.h * H);
    }
  }
  return area;
}

export async function editElements(media: MediaRef, marks: Mark[], engine: Engine, name: string, onProgress: Progress): Promise<MediaRef> {
  const src = await loadImage(media);
  const W = src.width;
  const H = src.height;
  const grow = Math.max(4, Math.round(Math.max(W, H) * 0.012));
  if (engine === 'local') {
    if (marks.some((m) => m.action !== 'remove')) throw new Error('本地只能删除元素；修改和移动请选 ChatGPT');
    const all = canvas(W, H);
    for (const m of marks) ctx2d(all).drawImage(m.mask, 0, 0, W, H);
    const hole = maskBytes(softMask(all, W, H, grow), W, H);
    return saveCanvas(await inpaint(src, hole, onProgress), `${name}-元素编辑.png`);
  }
  const guide = await tempPng(guideImage(src, marks), `${name}-编辑标记.png`);
  const steps = marks.map((m, i) => {
    const who = `${i + 1} 号（${COLOR_NAMES[i]}标记）的对象`;
    if (m.action === 'remove') return `把${who}移除，移除后背景自然融合`;
    if (m.action === 'move') return `把${who}移动到${COLOR_NAMES[i]}箭头指向的虚线框位置，原位置自然补全背景${m.desc ? `（${m.desc}）` : ''}`;
    return `将${who}修改为：${m.desc}`;
  });
  const edited = await chatgptEdit(
    `第 1 张图是原图，第 2 张图在原图上用编号色块标出了要编辑的对象。请在原图基础上只做下面这些修改，其它所有内容（人物、背景、构图、光线、色调、画面比例）保持完全不变：\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n输出修改后的完整画面，画面里不要出现编号、色块、箭头或任何标记。`,
    [media, guide],
    W,
    H,
    onProgress,
  );
  // Only the edited places change; the rest stays the original pixels.
  onProgress('正在合成…');
  const out = blendIn(src, edited, softMask(editArea(marks, W, H), W, H, grow));
  return saveCanvas(out, `${name}-元素编辑.png`);
}
