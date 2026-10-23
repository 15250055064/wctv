import { encodeFrames, canvasJpeg } from '../frames';
import { getMediaUrl } from '../media';
import type { MediaRef } from '../types';
import { canvas, ctx2d, detectTextBoxes, foregroundMask, inpaint, inpaintRect, loadTextDetector, toBlob, type Progress } from './image';

// Frame-by-frame video tools: background removal (IS-Net), watermark removal (LaMa) and
// subtitle removal (PP-OCRv4 finds the text, LaMa fills it).
// Frames are read from a <video> element, processed in the app and encoded by the local server,
// which also copies the source's sound onto the result.

const MAX_SECONDS = 120;

/** Runs `perFrame` on every frame of an archived video and encodes the results. */
async function eachFrame(
  media: MediaRef,
  opts: { name: string; alpha?: boolean | 'prores'; maxSide?: number },
  perFrame: (frame: HTMLCanvasElement, i: number) => Promise<HTMLCanvasElement>,
  onProgress: Progress,
): Promise<{ media: MediaRef; truncated: boolean }> {
  const url = await getMediaUrl(media.id);
  if (!url) throw new Error('找不到视频文件');
  const info = await fetch('/api/video/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: media.id }) }).then((r) => r.json());
  if (!info.duration) throw new Error('读取不到视频时长');
  const duration = Math.min(info.duration, MAX_SECONDS);
  const fps = Math.max(1, Math.min(60, Math.round(info.fps) || 25));
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((ok, fail) => {
    video.onloadeddata = () => ok();
    video.onerror = () => fail(new Error('视频无法读取'));
  });
  const k = opts.maxSide ? Math.min(1, opts.maxSide / Math.max(video.videoWidth, video.videoHeight)) : 1;
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const frame = canvas(even(video.videoWidth * k), even(video.videoHeight * k));
  const fctx = ctx2d(frame);
  const count = Math.max(1, Math.floor(duration * fps));
  try {
    const out = await encodeFrames(
      opts.name,
      fps,
      count,
      async (i) => {
        video.currentTime = Math.min(duration - 0.001, (i + 0.5) / fps);
        await new Promise<void>((ok) => (video.onseeked = () => ok()));
        fctx.drawImage(video, 0, 0, frame.width, frame.height);
        const done = await perFrame(frame, i);
        return opts.alpha ? toBlob(done) : canvasJpeg(done);
      },
      (p) => onProgress(`正在处理画面 ${Math.round(p * 100)}%（共 ${count} 帧）`),
      { alpha: opts.alpha, audioFrom: media.id },
    );
    return { media: out, truncated: info.duration > MAX_SECONDS };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

export type BackgroundMode = '透明' | '透明 ProRes' | '绿幕' | '白底';

/**
 * Removes the background from every frame. 透明 keeps transparency as WebM (small, plays in the
 * app); 透明 ProRes as ProRes 4444 .mov for editing software; 绿幕 / 白底 put the subject on a
 * flat colour (.mp4). The mask is eased between frames so edges don't flicker.
 */
export async function removeVideoBackground(media: MediaRef, mode: BackgroundMode, name: string, onProgress: Progress) {
  let prev: Float32Array | null = null;
  return eachFrame(
    media,
    { name: `${name}-去背景${mode.startsWith('透明') ? '' : `-${mode}`}`, alpha: mode === '透明 ProRes' ? 'prores' : mode === '透明', maxSide: 1920 },
    async (frame, i) => {
      // Only the first frame reports (model loading); after that the frame count does.
      const raw = await foregroundMask(frame, i ? undefined : onProgress);
      const eased = new Float32Array(raw.length);
      for (let j = 0; j < raw.length; j++) eased[j] = prev ? raw[j] * 0.7 + prev[j] * 0.3 : raw[j];
      prev = eased;
      const out = canvas(frame.width, frame.height);
      const o = ctx2d(out);
      if (!mode.startsWith('透明')) {
        o.fillStyle = mode === '绿幕' ? '#00b140' : '#ffffff';
        o.fillRect(0, 0, out.width, out.height);
      }
      const cut = canvas(frame.width, frame.height);
      const img = ctx2d(frame).getImageData(0, 0, frame.width, frame.height);
      for (let j = 0; j < eased.length; j++) img.data[j * 4 + 3] = eased[j];
      ctx2d(cut).putImageData(img, 0, 0);
      o.drawImage(cut, 0, 0);
      return out;
    },
    onProgress,
  );
}

/** A rectangle in fractions of the frame (0–1). */
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Erases a fixed area (a logo, a watermark, a caption) from every frame with LaMa. */
export async function removeVideoWatermark(media: MediaRef, areas: Area[], name: string, onProgress: Progress) {
  let masks: Uint8ClampedArray[] | null = null;
  return eachFrame(
    media,
    { name: `${name}-去水印`, maxSide: 1920 },
    async (frame, i) => {
      // One mask per area, so far-apart areas each get a tight crop.
      masks ??= areas.map((a) => {
        const m = new Uint8ClampedArray(frame.width * frame.height);
        // A few pixels of margin so the watermark's soft edges go too.
        const x0 = Math.max(0, Math.floor(a.x * frame.width) - 4);
        const y0 = Math.max(0, Math.floor(a.y * frame.height) - 4);
        const x1 = Math.min(frame.width, Math.ceil((a.x + a.w) * frame.width) + 4);
        const y1 = Math.min(frame.height, Math.ceil((a.y + a.h) * frame.height) + 4);
        for (let y = y0; y < y1; y++) m.fill(255, y * frame.width + x0, y * frame.width + x1);
        return m;
      });
      let out = frame;
      for (const m of masks) out = await inpaint(out, m, i ? undefined : onProgress);
      return out;
    },
    onProgress,
  );
}

export type SubtitleZone = '底部' | '上下' | '全画面';

type Box = { x: number; y: number; w: number; h: number };

/** Word boxes on the same line, close together, joined into one box per line of text. */
function joinLines(boxes: Box[]): Box[] {
  const lines: Box[] = [];
  for (const b of [...boxes].sort((p, q) => p.x - q.x)) {
    const l = lines.find((l) => {
      const overlap = Math.min(l.y + l.h, b.y + b.h) - Math.max(l.y, b.y);
      return overlap > Math.min(l.h, b.h) / 2 && b.x - (l.x + l.w) < Math.max(l.h, b.h) * 1.5;
    });
    if (!l) {
      lines.push({ ...b });
      continue;
    }
    const x1 = Math.max(l.x + l.w, b.x + b.w);
    const y1 = Math.max(l.y + l.h, b.y + b.h);
    l.x = Math.min(l.x, b.x);
    l.y = Math.min(l.y, b.y);
    l.w = x1 - l.x;
    l.h = y1 - l.y;
  }
  return lines;
}

/**
 * Finds burned-in subtitles in every frame and fills them in. Only text in `zone` counts, so
 * signs and logos elsewhere stay. Each line is filled in overlapping tiles up to three times as
 * wide as they are tall (LaMa works on squares; one tile covers a usual subtitle line), left to right, each tile seeing the cleaned part
 * before it. Text found in the previous frame is erased too, so fading captions don't flash.
 */
export async function removeVideoSubtitles(media: MediaRef, zone: SubtitleZone, name: string, onProgress: Progress) {
  let prev: Box[] = [];
  let ready = false;
  let first = true;
  return eachFrame(
    media,
    { name: `${name}-去字幕`, maxSide: 1920 },
    async (frame) => {
      const W = frame.width;
      const H = frame.height;
      if (!ready) await loadTextDetector(onProgress);
      ready = true;
      const inZone = (b: Box) => {
        const cy = (b.y + b.h / 2) / H;
        if (b.h > H * 0.2) return false;
        return zone === '全画面' || cy > 0.62 || (zone === '上下' && cy < 0.25);
      };
      const found = joinLines((await detectTextBoxes(frame)).filter(inZone));
      const lines = joinLines([...found, ...prev]);
      prev = found;
      if (!lines.length) return frame;

      const mask = new Uint8ClampedArray(W * H);
      const grown = lines.map((l) => {
        const pad = Math.max(4, l.h * 0.25);
        const x0 = Math.max(0, Math.floor(l.x - pad));
        const y0 = Math.max(0, Math.floor(l.y - pad));
        const x1 = Math.min(W, Math.ceil(l.x + l.w + pad));
        const y1 = Math.min(H, Math.ceil(l.y + l.h + pad));
        for (let y = y0; y < y1; y++) mask.fill(255, y * W + x0, y * W + x1);
        return { x0, y0, x1, y1 };
      });
      for (const g of grown) {
        // A band of context above and below, and tiles up to three times as wide as the band is tall.
        const th = Math.min(H, Math.max(128, (g.y1 - g.y0) * 3));
        const ty = Math.max(0, Math.min(H - th, Math.round((g.y0 + g.y1) / 2 - th / 2)));
        const tw = Math.min(W, th * 3);
        const step = Math.round(tw / 2);
        let tx = Math.max(0, Math.min(W - tw, Math.round((g.x0 + g.x1) / 2 - tw / 2), g.x0 - Math.round(th / 2)));
        for (;;) {
          await inpaintRect(frame, mask, { x: tx, y: ty, w: tw, h: th }, first ? onProgress : undefined);
          first = false;
          if (tx + tw >= Math.min(W, g.x1 + 1)) break;
          // The left half is done; the next tile redoes the right half with it as context.
          for (let y = g.y0; y < g.y1; y++) mask.fill(0, y * W + Math.max(g.x0, tx), y * W + Math.min(g.x1, tx + step));
          tx = Math.min(W - tw, tx + step);
        }
      }
      return frame;
    },
    onProgress,
  );
}
