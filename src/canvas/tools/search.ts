import { AutoModel, AutoProcessor, AutoTokenizer, RawImage, Tensor, type PreTrainedModel, type PreTrainedTokenizer, type Processor } from '@huggingface/transformers';
import { getMediaUrl } from '../media';
import type { MediaRef } from '../types';
import { hasWebGPU, setupAI, withDownloads } from './ai';
import { canvas, ctx2d, type Progress } from './image';

// 智能素材搜索: find pictures and videos by describing them in Chinese ("穿风衣的女生", "夜景").
// Chinese-CLIP turns each file and the description into vectors; the closest files win.
// The ONNX export is one model taking text and picture together, so a file is encoded with a
// one-character text and a query with a blank picture. Vectors are kept per file in this
// browser's storage, so each file is only read once.

const CLIP = 'Xenova/chinese-clip-vit-base-patch16';
const CACHE = 'wctv-clip:';

let parts: Promise<{ model: PreTrainedModel; tokenizer: PreTrainedTokenizer; processor: Processor }> | null = null;
function load(onProgress: Progress) {
  setupAI();
  parts ??= withDownloads(async () => {
    const [model, tokenizer, processor] = await Promise.all([
      AutoModel.from_pretrained(CLIP, { device: (await hasWebGPU()) ? 'webgpu' : 'wasm', dtype: 'q4f16' }),
      AutoTokenizer.from_pretrained(CLIP),
      AutoProcessor.from_pretrained(CLIP),
    ]);
    return { model, tokenizer, processor };
  }, onProgress);
  parts.catch(() => (parts = null));
  return parts;
}

const unit = (v: Float32Array) => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
};

async function encode(text: string, picture: HTMLCanvasElement, onProgress: Progress) {
  const { model, tokenizer, processor } = await load(onProgress);
  const tokens = tokenizer([text], { padding: true, truncation: true });
  const { pixel_values } = await processor(RawImage.fromCanvas(picture));
  const out = (await model({ ...tokens, pixel_values })) as { text_embeds: Tensor; image_embeds: Tensor };
  return { text: unit(out.text_embeds.data as Float32Array), image: unit(out.image_embeds.data as Float32Array) };
}

let blank: HTMLCanvasElement | null = null;

/** A picture (or a video's frame) drawn small enough for the model. */
async function still(media: MediaRef): Promise<HTMLCanvasElement | null> {
  const url = await getMediaUrl(media.id);
  if (!url) return null;
  const el = media.kind === 'video' ? document.createElement('video') : new Image();
  const ok = await new Promise<boolean>((done) => {
    const t = setTimeout(() => done(false), 15000);
    if (el instanceof HTMLVideoElement) {
      el.muted = true;
      el.preload = 'auto';
      el.onloadeddata = () => {
        el.currentTime = Math.min(1, (el.duration || 2) / 2);
      };
      el.onseeked = () => (clearTimeout(t), done(true));
    } else el.onload = () => (clearTimeout(t), done(true));
    el.onerror = () => (clearTimeout(t), done(false));
    el.src = url;
  });
  if (!ok) return null;
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  const k = 336 / Math.max(w, h);
  const c = canvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  ctx2d(c).drawImage(el, 0, 0, c.width, c.height);
  if (el instanceof HTMLVideoElement) el.removeAttribute('src');
  return c;
}

const toB64 = (v: Float32Array) => btoa(String.fromCharCode(...new Uint8Array(v.buffer)));
const fromB64 = (s: string) => new Float32Array(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer);
function cached(key: string) {
  try {
    const s = localStorage.getItem(CACHE + key);
    return s ? fromB64(s) : null;
  } catch {
    return null;
  }
}
function remember(key: string, v: Float32Array) {
  try {
    localStorage.setItem(CACHE + key, toB64(v));
  } catch {
    // Storage full: the vector is just computed again next time.
  }
}

export interface Hit {
  media: MediaRef;
  score: number;
}

/**
 * The files that best match `query`, best first. `files` carry an mtime so a changed file is
 * read again. Only pictures and videos take part.
 */
export async function searchMedia(query: string, files: (MediaRef & { mtime?: number })[], onProgress: Progress, limit = 12): Promise<Hit[]> {
  const items = files.filter((f) => f.kind === 'image' || f.kind === 'video');
  onProgress('正在加载搜索模型…');
  blank ??= (() => {
    const c = canvas(224, 224);
    ctx2d(c).fillStyle = '#808080';
    ctx2d(c).fillRect(0, 0, 224, 224);
    return c;
  })();
  const q = (await encode(query, blank, onProgress)).text;
  const hits: Hit[] = [];
  let read = 0;
  for (const f of items) {
    const key = `${f.id}@${f.mtime ?? 0}`;
    let v = cached(key);
    if (!v) {
      onProgress(`正在读取素材 ${++read}（共 ${items.length} 个，只在第一次搜索时读取）`);
      const pic = await still(f);
      if (!pic) continue;
      v = (await encode('图', pic, onProgress)).image;
      remember(key, v);
    }
    let score = 0;
    for (let i = 0; i < v.length; i++) score += v[i] * q[i];
    // A match in the file name counts too.
    if (f.name && query.trim() && f.name.includes(query.trim())) score += 0.1;
    hits.push({ media: f, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
