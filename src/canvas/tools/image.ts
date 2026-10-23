import { getMediaUrl, putMedia } from '../media';
import type { MediaRef } from '../types';
import { ort, release, runModel, session, withDownloads } from './ai';

// On-device image tools. Everything runs in the app (WebGPU when available); models come
// from /models/ and download on first use. Results are saved into the project folder.

export type Progress = (msg: string) => void;

// ---- Canvas helpers ------------------------------------------------------------------------

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

/** Draws an archived image onto a new canvas at its own size. */
export async function loadImage(media: MediaRef): Promise<HTMLCanvasElement> {
  const url = await getMediaUrl(media.id);
  if (!url) throw new Error('找不到图片文件');
  const img = new Image();
  // onload rather than decode(): decode() can wait indefinitely while the window isn't painting.
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok();
    img.onerror = () => fail(new Error('图片无法读取'));
    img.src = url;
  });
  const c = canvas(img.naturalWidth, img.naturalHeight);
  ctx2d(c).drawImage(img, 0, 0);
  return c;
}

export const toBlob = (c: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('图片编码失败'))), type, quality));

/** Saves a canvas into the project as a new image. */
export async function saveCanvas(c: HTMLCanvasElement, name: string, type = 'image/png', quality?: number): Promise<MediaRef> {
  return putMedia(await toBlob(c, type, quality), 'image', name, { w: c.width, h: c.height });
}

// ---- IS-Net: foreground mask ------------------------------------------------------------------
// IS-Net (DIS, Apache-2.0) runs on Apple GPUs through WebGPU in a fraction of a second.
// BiRefNet was tried first: one of its layers exceeds the GPU's storage-buffer limit, and on the
// CPU it needs ~8.5 GB of memory.

const ISNET = 'isnet/isnet-general-use.onnx';
const ISNET_SIZE = 1024;

/** Foreground opacity (0–255) for every pixel of `src`, at the source's own size. */
export async function foregroundMask(src: HTMLCanvasElement, onProgress: Progress = () => {}): Promise<Uint8ClampedArray> {
  onProgress('正在加载抠图模型…');
  await withDownloads(() => session(ISNET), onProgress);
  onProgress('正在识别主体…');
  const S = ISNET_SIZE;
  const small = canvas(S, S);
  ctx2d(small).drawImage(src, 0, 0, S, S);
  const p = ctx2d(small).getImageData(0, 0, S, S).data;
  const N = S * S;
  const x = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) x[c * N + i] = p[i * 4 + c] / 255 - 0.5;
  const r = await runModel(ISNET, { input_image: new ort.Tensor('float32', x, [1, 3, S, S]) });
  const o = r.output_image.data as Float32Array;
  // Low-confidence areas (blurred passers-by, glow) go clear and the subject goes solid;
  // the smooth step keeps soft edges such as hair.
  const m = ctx2d(small).createImageData(S, S);
  for (let i = 0; i < N; i++) {
    const t = Math.min(1, Math.max(0, (o[i] - 0.15) / 0.7));
    const v = t * t * (3 - 2 * t) * 255;
    m.data.set([v, v, v, 255], i * 4);
  }
  ctx2d(small).putImageData(m, 0, 0);
  const full = canvas(src.width, src.height);
  const fctx = ctx2d(full);
  fctx.imageSmoothingQuality = 'high';
  fctx.drawImage(small, 0, 0, src.width, src.height);
  const d = fctx.getImageData(0, 0, src.width, src.height).data;
  const alpha = new Uint8ClampedArray(src.width * src.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4];
  return alpha;
}

export const releaseMask = () => release(ISNET);

/** The subject cut out onto a transparent background. */
export function applyAlpha(src: HTMLCanvasElement, alpha: Uint8ClampedArray) {
  const out = canvas(src.width, src.height);
  const o = ctx2d(out);
  const img = ctx2d(src).getImageData(0, 0, src.width, src.height);
  for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = Math.round((img.data[i * 4 + 3] * alpha[i]) / 255);
  o.putImageData(img, 0, 0);
  return out;
}

export async function cutout(media: MediaRef, name: string, onProgress: Progress): Promise<MediaRef> {
  const src = await loadImage(media);
  const alpha = await foregroundMask(src, onProgress);
  onProgress('正在保存透明背景图片…');
  return saveCanvas(applyAlpha(src, alpha), `${name}-抠图.png`);
}

// ---- LaMa: fill a masked area ---------------------------------------------------------------

const LAMA = 'Carve/LaMa-ONNX/lama_fp32.onnx';
const LAMA_SIZE = 512;

/**
 * Fills the masked pixels of `src` (mask: 0–255, 255 = remove) with LaMa. The model works at
 * 512×512, so it runs on a square crop around the mask and only masked pixels are replaced,
 * which keeps the rest of the image at full resolution.
 */
export async function inpaint(src: HTMLCanvasElement, mask: Uint8ClampedArray, onProgress: Progress = () => {}): Promise<HTMLCanvasElement> {
  const W = src.width;
  const H = src.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x] > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return src;
  // A square crop with context around the hole, at least 512 px when the image allows.
  const side = Math.min(Math.max(W, H), Math.max(LAMA_SIZE, Math.round(Math.max(x1 - x0, y1 - y0) * 2)));
  const cw = Math.min(side, W);
  const ch = Math.min(side, H);
  const cx = Math.max(0, Math.min(W - cw, Math.round((x0 + x1) / 2 - side / 2)));
  const cy = Math.max(0, Math.min(H - ch, Math.round((y0 + y1) / 2 - side / 2)));
  const out = canvas(W, H);
  ctx2d(out).drawImage(src, 0, 0);
  await inpaintRect(out, mask, { x: cx, y: cy, w: cw, h: ch }, onProgress);
  return out;
}

/**
 * LaMa on one rectangle of `img` (in place): the rectangle is scaled to 512×512 (it needn't be
 * square), filled, scaled back, and only its masked pixels are replaced, with a soft edge.
 */
export async function inpaintRect(img: HTMLCanvasElement, mask: Uint8ClampedArray, r: { x: number; y: number; w: number; h: number }, onProgress: Progress = () => {}) {
  const W = img.width;
  const cx = Math.max(0, Math.round(r.x));
  const cy = Math.max(0, Math.round(r.y));
  const cw = Math.max(1, Math.min(W - cx, Math.round(r.w)));
  const ch = Math.max(1, Math.min(img.height - cy, Math.round(r.h)));
  const S = LAMA_SIZE;
  const small = canvas(S, S);
  const sctx = ctx2d(small);
  sctx.drawImage(img, cx, cy, cw, ch, 0, 0, S, S);
  const pix = sctx.getImageData(0, 0, S, S).data;
  // The mask for this rectangle, slightly grown so edges of the object don't survive the resize.
  const mcan = canvas(cw, ch);
  const mimg = ctx2d(mcan).createImageData(cw, ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const v = mask[(cy + y) * W + cx + x];
      mimg.data.set([v, v, v, 255], (y * cw + x) * 4);
    }
  ctx2d(mcan).putImageData(mimg, 0, 0);
  const msmall = canvas(S, S);
  const mctx = ctx2d(msmall);
  mctx.filter = 'blur(2px)';
  mctx.drawImage(mcan, 0, 0, S, S);
  const mpix = mctx.getImageData(0, 0, S, S).data;

  const N = S * S;
  const image = new Float32Array(3 * N);
  const hole = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++) image[c * N + i] = pix[i * 4 + c] / 255;
    hole[i] = mpix[i * 4] > 20 ? 1 : 0;
  }
  onProgress('正在加载修补模型…');
  await withDownloads(() => session(LAMA), onProgress);
  onProgress('正在修补画面…');
  const res = await runModel(LAMA, { image: new ort.Tensor('float32', image, [1, 3, S, S]), mask: new ort.Tensor('float32', hole, [1, 1, S, S]) });
  const o = res.output.data as Float32Array;
  const filled = sctx.createImageData(S, S);
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++) filled.data[i * 4 + c] = o[c * N + i];
    filled.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(filled, 0, 0);

  // Paste back: scale the result to the rectangle, then replace only the (feathered) masked pixels.
  const back = canvas(cw, ch);
  const bctx = ctx2d(back);
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, cw, ch);
  const fill = bctx.getImageData(0, 0, cw, ch).data;
  const ictx = ctx2d(img);
  const region = ictx.getImageData(cx, cy, cw, ch);
  const feather = canvas(cw, ch);
  const fctx = ctx2d(feather);
  fctx.filter = 'blur(3px)';
  fctx.drawImage(mcan, 0, 0);
  const soft = fctx.getImageData(0, 0, cw, ch).data;
  for (let i = 0; i < cw * ch; i++) {
    const a = Math.min(1, Math.max(mask[(cy + Math.floor(i / cw)) * W + cx + (i % cw)], soft[i * 4]) / 255);
    if (!a) continue;
    for (let c = 0; c < 3; c++) region.data[i * 4 + c] = region.data[i * 4 + c] * (1 - a) + fill[i * 4 + c] * a;
  }
  ictx.putImageData(region, cx, cy);
}

export const releaseInpaint = () => release(LAMA);

// ---- OCR: PP-OCRv4 (detection + recognition) -------------------------------------------------

const OCR_DET = 'SWHL/RapidOCR/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx';
const OCR_REC = 'SWHL/RapidOCR/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx';
let ocrDict: Promise<string[]> | null = null;

/** Loads the text detector (downloading it the first time), reporting progress. */
export const loadTextDetector = (onProgress: Progress) => withDownloads(() => session(OCR_DET), onProgress);

/**
 * Where text is in a picture (PP-OCRv4 detection only, no reading): boxes in the picture's
 * pixels, in reading order. Quick enough to run on every frame of a video.
 */
export async function detectTextBoxes(src: HTMLCanvasElement): Promise<{ x: number; y: number; w: number; h: number }[]> {
  await session(OCR_DET);
  // Detection at up to 960 px, sides rounded to multiples of 32.
  const k = Math.min(1, 960 / Math.max(src.width, src.height));
  const dw = Math.max(32, Math.round((src.width * k) / 32) * 32);
  const dh = Math.max(32, Math.round((src.height * k) / 32) * 32);
  const dc = canvas(dw, dh);
  ctx2d(dc).drawImage(src, 0, 0, dw, dh);
  const dp = ctx2d(dc).getImageData(0, 0, dw, dh).data;
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const N = dw * dh;
  const x = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) x[c * N + i] = (dp[i * 4 + c] / 255 - mean[c]) / std[c];
  const dr = await runModel(OCR_DET, { x: new ort.Tensor('float32', x, [1, 3, dh, dw]) });
  const prob = Object.values(dr)[0].data as Float32Array;

  // Connected regions above the threshold become boxes (axis-aligned), grown like DB's unclip.
  const seen = new Uint8Array(N);
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < N; i++) {
    if (seen[i] || prob[i] < 0.3) continue;
    let x0 = dw, y0 = dh, x1 = 0, y1 = 0, sum = 0, n = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const px = j % dw;
      const py = (j - px) / dw;
      sum += prob[j];
      n++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (const nb of [j - 1, j + 1, j - dw, j + dw]) {
        if (nb < 0 || nb >= N || seen[nb] || prob[nb] < 0.3) continue;
        if ((nb === j - 1 && px === 0) || (nb === j + 1 && px === dw - 1)) continue;
        seen[nb] = 1;
        stack.push(nb);
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (sum / n < 0.6 || Math.min(w, h) < 3) continue;
    const d = (w * h * 1.6) / (2 * (w + h));
    boxes.push({ x0: Math.max(0, x0 - d), y0: Math.max(0, y0 - d), x1: Math.min(dw, x1 + 1 + d), y1: Math.min(dh, y1 + 1 + d) });
  }
  // Reading order: top to bottom, then left to right within a line.
  boxes.sort((a, b) => (Math.abs(a.y0 - b.y0) < Math.min(a.y1 - a.y0, b.y1 - b.y0) / 2 ? a.x0 - b.x0 : a.y0 - b.y0));

  const sx = src.width / dw;
  const sy = src.height / dh;
  return boxes.map((b) => ({ x: b.x0 * sx, y: b.y0 * sy, w: (b.x1 - b.x0) * sx, h: (b.y1 - b.y0) * sy }));
}

/** Text boxes in reading order, each with its recognised text. */
export async function recognizeText(src: HTMLCanvasElement, onProgress: Progress = () => {}): Promise<{ text: string; box: [number, number, number, number] }[]> {
  onProgress('正在加载文字识别模型…');
  const [, , dict] = await withDownloads(
    () => Promise.all([session(OCR_DET), session(OCR_REC), (ocrDict ??= fetch('/models/ocr/ppocr_keys_v1.txt').then((r) => r.text()).then((t) => t.split('\n').map((l) => l.replace(/\r$/, ''))))]),
    onProgress,
  );
  onProgress('正在识别文字…');
  const boxes = await detectTextBoxes(src);
  const lines: { text: string; box: [number, number, number, number] }[] = [];
  for (const { x: bx, y: by, w: bw, h: bh } of boxes) {
    const rw = Math.max(16, Math.min(1600, Math.round((48 * bw) / bh)));
    const rc = canvas(rw, 48);
    ctx2d(rc).drawImage(src, bx, by, bw, bh, 0, 0, rw, 48);
    const rp = ctx2d(rc).getImageData(0, 0, rw, 48).data;
    const RN = rw * 48;
    const rx = new Float32Array(3 * RN);
    for (let i = 0; i < RN; i++) for (let c = 0; c < 3; c++) rx[c * RN + i] = (rp[i * 4 + c] / 255 - 0.5) / 0.5;
    const rr = await runModel(OCR_REC, { x: new ort.Tensor('float32', rx, [1, 3, 48, rw]) });
    const out = Object.values(rr)[0];
    const [, T, C] = out.dims;
    const p = out.data as Float32Array;
    let text = '';
    let last = 0;
    for (let t = 0; t < T; t++) {
      let best = 0;
      for (let c = 1; c < C; c++) if (p[t * C + c] > p[t * C + best]) best = c;
      if (best && best !== last) text += best === C - 1 ? ' ' : (dict[best - 1] ?? '');
      last = best;
    }
    if (text.trim()) lines.push({ text: text.trim(), box: [Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh)] });
  }
  return lines;
}

// ---- Palette ---------------------------------------------------------------------------------

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** The image's main colours (k-means on a sample), most common first. */
export function palette(src: HTMLCanvasElement, k = 6): { hex: string; share: number }[] {
  const s = canvas(Math.min(160, src.width), Math.min(160, Math.round((src.height * Math.min(160, src.width)) / src.width)));
  ctx2d(s).drawImage(src, 0, 0, s.width, s.height);
  const d = ctx2d(s).getImageData(0, 0, s.width, s.height).data;
  const px: number[][] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]);
  if (!px.length) return [];
  // k-means++ start, then a few rounds.
  const centers = [px[Math.floor(px.length / 2)]];
  while (centers.length < k) {
    let far = px[0], best = -1;
    for (const p of px) {
      const dist = Math.min(...centers.map((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2));
      if (dist > best) (best = dist), (far = p);
    }
    centers.push(far);
  }
  const owner = new Uint8Array(px.length);
  for (let round = 0; round < 8; round++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => {
      let bi = 0, bd = Infinity;
      centers.forEach((c, j) => {
        const dd = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (dd < bd) (bd = dd), (bi = j);
      });
      owner[i] = bi;
      acc[bi][0] += p[0];
      acc[bi][1] += p[1];
      acc[bi][2] += p[2];
      acc[bi][3]++;
    });
    acc.forEach((a, j) => a[3] && (centers[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]));
  }
  const counts = centers.map((_, j) => owner.filter((o) => o === j).length);
  return centers
    .map((c, j) => ({ hex: hex(c[0], c[1], c[2]), share: counts[j] / px.length }))
    .filter((c) => c.share > 0.01)
    .sort((a, b) => b.share - a.share);
}

/** A swatch card: one band per colour, with its hex code and share. */
export function paletteCard(colors: { hex: string; share: number }[]) {
  const c = canvas(1200, 520);
  const g = ctx2d(c);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  const w = c.width / colors.length;
  colors.forEach((col, i) => {
    g.fillStyle = col.hex;
    g.fillRect(i * w, 0, w, 400);
    g.fillStyle = '#1a1a1a';
    g.font = '600 30px "PingFang SC", sans-serif';
    g.fillText(col.hex.toUpperCase(), i * w + 20, 455);
    g.fillStyle = '#888888';
    g.font = '24px "PingFang SC", sans-serif';
    g.fillText(`${Math.round(col.share * 100)}%`, i * w + 20, 495);
  });
  return c;
}

// ---- Compress / convert ----------------------------------------------------------------------

export const FORMATS = { JPEG: 'image/jpeg', WebP: 'image/webp', PNG: 'image/png' } as const;

/** Re-encodes an image (optionally smaller); returns the new file and both sizes. */
export async function compress(media: MediaRef, opts: { format: keyof typeof FORMATS; quality: number; maxSide: number }, name: string) {
  const src = await loadImage(media);
  const k = opts.maxSide ? Math.min(1, opts.maxSide / Math.max(src.width, src.height)) : 1;
  const out = canvas(src.width * k, src.height * k);
  const g = ctx2d(out);
  if (opts.format === 'JPEG') {
    // JPEG has no transparency: put it on white rather than black.
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, out.width, out.height);
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, out.width, out.height);
  const type = FORMATS[opts.format];
  const blob = await toBlob(out, type, type === 'image/png' ? undefined : opts.quality);
  const before = (await fetch((await getMediaUrl(media.id))!).then((r) => r.blob())).size;
  const ext = { JPEG: 'jpg', WebP: 'webp', PNG: 'png' }[opts.format];
  const saved = await putMedia(blob, 'image', `${name}.${ext}`, { w: out.width, h: out.height });
  return { media: saved, before, after: blob.size };
}

export { ort };
