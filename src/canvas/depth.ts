import { AutoModel, AutoProcessor, RawImage, env, type PreTrainedModel, type Processor, type Tensor } from '@huggingface/transformers';
import { canvasJpeg, encodeFrames } from './frames';
import type { MediaRef } from './types';

// Video depth estimation with Depth Anything V2 (small), on the GPU via WebGPU when available.
// The runtime ships with the app; the model (~47 MB) is fetched from /models/ and the local
// server downloads it on first use, then keeps it (server/index.mjs, visionModel).

const MODEL = 'onnx-community/depth-anything-v2-small';
let loading: Promise<{ model: PreTrainedModel; processor: Processor }> | null = null;

function load() {
  if (loading) return loading;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = '/models/';
  const wasm = env.backends.onnx.wasm;
  if (wasm) wasm.wasmPaths = { mjs: '/ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: '/ort/ort-wasm-simd-threaded.asyncify.wasm' };
  loading = (async () => {
    const processor = await AutoProcessor.from_pretrained(MODEL);
    const gpu = 'gpu' in navigator ? await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null) : null;
    const make = (device: 'webgpu' | 'wasm') => AutoModel.from_pretrained(MODEL, { device, dtype: 'fp16' });
    const model = gpu ? await make('webgpu').catch(() => make('wasm')) : await make('wasm');
    return { model, processor };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

export interface DepthOptions {
  /** Short side of the output, e.g. 480 or 720. */
  short: number;
  duration: number;
  fps: number;
  name: string;
}

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

/**
 * Renders a black-and-white depth video (near = white, far = black) of the video at `url`.
 * Depth is normalised with smoothed percentiles so brightness doesn't flicker frame to frame.
 */
export async function depthVideo(url: string, opt: DepthOptions, onProgress: (p: number, msg: string) => void): Promise<MediaRef> {
  onProgress(0, '正在加载深度模型…');
  const { model, processor } = await load();

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((ok, fail) => {
    video.onloadeddata = () => ok();
    video.onerror = () => fail(new Error('视频无法读取'));
  });
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const k = opt.short / Math.min(vw, vh);
  const W = even(vw * k);
  const H = even(vh * k);

  const input = document.createElement('canvas');
  input.width = W;
  input.height = H;
  const ictx = input.getContext('2d', { willReadFrequently: true })!;
  const small = document.createElement('canvas');
  const sctx = small.getContext('2d')!;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';

  const fps = Math.max(1, Math.min(30, Math.round(opt.fps) || 24));
  const count = Math.max(1, Math.floor(opt.duration * fps));
  let lo = NaN;
  let hi = NaN;

  const frame = async (i: number) => {
    video.currentTime = Math.min(opt.duration - 0.001, (i + 0.5) / fps);
    await new Promise<void>((ok) => (video.onseeked = () => ok()));
    ictx.drawImage(video, 0, 0, W, H);
    const inputs = await processor(RawImage.fromCanvas(input));
    const { predicted_depth } = (await model(inputs)) as { predicted_depth: Tensor };
    const t = predicted_depth.type === 'float32' ? predicted_depth : predicted_depth.to('float32');
    const [h, w] = t.dims.slice(-2);
    const d = t.data as Float32Array;
    // Robust range: 1st..99th percentile of a sample, eased across frames.
    const step = Math.max(1, Math.floor(d.length / 4096));
    const sample: number[] = [];
    for (let j = 0; j < d.length; j += step) sample.push(d[j]);
    sample.sort((a, b) => a - b);
    const flo = sample[Math.floor(sample.length * 0.01)];
    const fhi = sample[Math.floor(sample.length * 0.99)];
    lo = Number.isNaN(lo) ? flo : lo * 0.75 + flo * 0.25;
    hi = Number.isNaN(hi) ? fhi : hi * 0.75 + fhi * 0.25;
    const span = Math.max(1e-6, hi - lo);
    small.width = w;
    small.height = h;
    const img = sctx.createImageData(w, h);
    for (let j = 0; j < w * h; j++) {
      const g = Math.max(0, Math.min(255, ((d[j] - lo) / span) * 255));
      img.data[j * 4] = img.data[j * 4 + 1] = img.data[j * 4 + 2] = g;
      img.data[j * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    octx.drawImage(small, 0, 0, W, H);
    return canvasJpeg(out);
  };

  try {
    return await encodeFrames(opt.name, fps, count, frame, (p) => onProgress(p * 0.97, `正在提取深度 ${Math.round(p * 100)}%`));
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
