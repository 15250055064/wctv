import { getMediaUrl, saveFile } from '../media';
import { getProvider } from '../provider';
import type { MediaRef } from '../types';
import { canvas, ctx2d, foregroundMask, inpaint, loadImage, saveCanvas, type Progress } from './image';

// Image decomposition: the picture becomes a stack of layers, a clean background plus one
// transparent layer per subject, ready to rearrange on the canvas or export as a PSD.
// Subjects come from the cutout model (separate regions = separate layers); the background
// behind them is redrawn by ChatGPT (better, uses quota) or filled locally with LaMa (free).

export interface Layer {
  media: MediaRef;
  name: string;
  /** Position in the original picture, in pixels. */
  x: number;
  y: number;
}

export interface Decomposition {
  width: number;
  height: number;
  background: MediaRef;
  layers: Layer[];
}

/** Separate subjects: connected regions of the mask, largest first. */
function regions(alpha: Uint8ClampedArray, W: number, H: number) {
  // Work on a grid of at most 512 px so labelling stays quick.
  const k = Math.min(1, 512 / Math.max(W, H));
  const gw = Math.max(1, Math.round(W * k));
  const gh = Math.max(1, Math.round(H * k));
  const on = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) on[y * gw + x] = alpha[Math.min(H - 1, Math.floor(y / k)) * W + Math.min(W - 1, Math.floor(x / k))] > 128 ? 1 : 0;
  const label = new Int32Array(gw * gh);
  const found: { id: number; area: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || label[i]) continue;
    const id = found.length + 1;
    const r = { id, area: 0, x0: gw, y0: gh, x1: 0, y1: 0 };
    const stack = [i];
    label[i] = id;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % gw;
      const y = (j - x) / gw;
      r.area++;
      r.x0 = Math.min(r.x0, x);
      r.x1 = Math.max(r.x1, x);
      r.y0 = Math.min(r.y0, y);
      r.y1 = Math.max(r.y1, y);
      // 8-connected, so thin parts (an arm, a strap) stay with their subject.
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (on[n] && !label[n]) {
            label[n] = id;
            stack.push(n);
          }
        }
    }
    found.push(r);
  }
  // Specks under 0.5% of the picture are noise, not subjects.
  const big = found.filter((r) => r.area >= gw * gh * 0.005).sort((a, b) => b.area - a.area);
  return { big, label, gw, gh, k };
}

/** The background with the subjects removed, at the picture's size. */
async function cleanBackground(media: MediaRef, src: HTMLCanvasElement, alpha: Uint8ClampedArray, mode: 'chatgpt' | 'local', onProgress: Progress) {
  if (mode === 'chatgpt') {
    onProgress('ChatGPT 正在重绘去掉主体后的背景（约 1 分钟）…');
    const [r] = await getProvider().generate(
      {
        kind: 'image',
        model: 'chatgpt',
        params: { ratio: `${src.width}:${src.height}` },
        images: [media],
        prompt: '请把这张参考图里的所有前景主体（人物、动物、产品等主要物体）完全去掉，补全它们背后被挡住的背景。其他一切保持不变：构图、视角、光线、色调、画面比例都和参考图一致。不要添加任何新东西，不要文字。',
      },
      (_p, m) => m && onProgress(`ChatGPT：${m}`),
    );
    const out = await loadImage(r.media!);
    // Cover-fit to the original size, in case the size differs.
    const bg = canvas(src.width, src.height);
    const s = Math.max(src.width / out.width, src.height / out.height);
    ctx2d(bg).drawImage(out, (src.width - out.width * s) / 2, (src.height - out.height * s) / 2, out.width * s, out.height * s);
    return bg;
  }
  // Local: LaMa fills the subjects' area, grown a little so no outline is left behind.
  const grown = canvas(src.width, src.height);
  const g = ctx2d(grown);
  const m = g.createImageData(src.width, src.height);
  for (let i = 0; i < alpha.length; i++) {
    const v = alpha[i] > 20 ? 255 : 0;
    m.data.set([v, v, v, 255], i * 4);
  }
  g.putImageData(m, 0, 0);
  const blur = canvas(src.width, src.height);
  const b = ctx2d(blur);
  b.filter = `blur(${Math.max(2, Math.round(Math.max(src.width, src.height) * 0.006))}px)`;
  b.drawImage(grown, 0, 0);
  const d = b.getImageData(0, 0, src.width, src.height).data;
  const hole = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < hole.length; i++) hole[i] = d[i * 4] > 8 ? 255 : 0;
  return inpaint(src, hole, onProgress);
}

export async function decompose(media: MediaRef, mode: 'chatgpt' | 'local', name: string, onProgress: Progress): Promise<Decomposition> {
  const src = await loadImage(media);
  const W = src.width;
  const H = src.height;
  const alpha = await foregroundMask(src, onProgress);
  const { big, label, gw, k } = regions(alpha, W, H);
  if (!big.length) throw new Error('没有识别到可以拆出的主体');

  onProgress(`识别到 ${big.length} 个主体，正在拆分图层…`);
  const pixels = ctx2d(src).getImageData(0, 0, W, H).data;
  const layers: Layer[] = [];
  for (const [n, r] of big.slice(0, 12).entries()) {
    // The region's box in full resolution, with a little margin for soft edges.
    const pad = Math.round(2 / k);
    const x0 = Math.max(0, Math.floor(r.x0 / k) - pad);
    const y0 = Math.max(0, Math.floor(r.y0 / k) - pad);
    const x1 = Math.min(W, Math.ceil((r.x1 + 1) / k) + pad);
    const y1 = Math.min(H, Math.ceil((r.y1 + 1) / k) + pad);
    const lw = x1 - x0;
    const lh = y1 - y0;
    const layer = canvas(lw, lh);
    const img = ctx2d(layer).createImageData(lw, lh);
    for (let y = 0; y < lh; y++)
      for (let x = 0; x < lw; x++) {
        const sx = x0 + x;
        const sy = y0 + y;
        const gx = Math.min(gw - 1, Math.floor(sx * k));
        const gy = Math.floor(sy * k);
        // Pixels near this region (its own label, or unlabelled soft edge) belong to it.
        const lab = label[gy * gw + gx];
        if (lab && lab !== r.id) continue;
        const si = (sy * W + sx) * 4;
        img.data.set([pixels[si], pixels[si + 1], pixels[si + 2], alpha[sy * W + sx]], (y * lw + x) * 4);
      }
    ctx2d(layer).putImageData(img, 0, 0);
    const label_ = big.length === 1 ? '主体' : `主体 ${n + 1}`;
    layers.push({ media: await saveCanvas(layer, `${name}-${label_}.png`), name: label_, x: x0, y: y0 });
  }

  const bg = await cleanBackground(media, src, alpha, mode, onProgress);
  onProgress('正在保存背景图层…');
  const background = await saveCanvas(bg, `${name}-背景.png`);
  return { width: W, height: H, background, layers };
}

/**
 * Writes a layered PSD (background at the bottom, then each layer at its position) into the
 * project folder and returns its archive id. ag-psd loads only when a PSD is exported.
 */
export async function exportPsd(doc: { width: number; height: number; layers: { name: string; media: MediaRef; x: number; y: number }[] }, name: string, onProgress: Progress): Promise<{ id: string; name: string }> {
  onProgress('正在生成 PSD…');
  const { writePsd } = await import('ag-psd');
  const composite = canvas(doc.width, doc.height);
  const children = [];
  for (const l of doc.layers) {
    const c = await loadImage(l.media);
    ctx2d(composite).drawImage(c, l.x, l.y);
    children.push({ name: l.name, canvas: c, left: Math.round(l.x), top: Math.round(l.y) });
  }
  const buf = writePsd({ width: doc.width, height: doc.height, canvas: composite, children }, { generateThumbnail: true });
  const blob = new Blob([buf], { type: 'image/vnd.adobe.photoshop' });
  // Saved into the project like any other file; Photoshop, Affinity, Photopea open it.
  return saveFile(blob, `${name}.psd`);
}

/** A data URL for previews of archived media (used by the decomposition dialog). */
export const mediaUrl = (m: MediaRef) => getMediaUrl(m.id);
