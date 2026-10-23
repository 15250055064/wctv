import { env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';

// One setup for every on-device model: transformers.js and plain ONNX sessions share the
// runtime it imports (onnxruntime-web, WebGPU first). Models load from /models/, which the
// local server downloads on first use (server/index.mjs, visionModel).

let configured = false;
export function setupAI() {
  if (configured) return;
  configured = true;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = '/models/';
  const wasm = env.backends.onnx.wasm;
  // Built app: the copy in /ort (scripts/prepare-assets.mjs). Dev server: Vite won't import()
  // files from /public, so use the package's own copy.
  const dir = import.meta.env.DEV ? '/node_modules/onnxruntime-web/dist' : '/ort';
  if (wasm) wasm.wasmPaths = { mjs: `${dir}/ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${dir}/ort-wasm-simd-threaded.asyncify.wasm` };
}

let gpu: Promise<boolean> | null = null;
export const hasWebGPU = () =>
  (gpu ??= (async () => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    return !!nav.gpu && !!(await nav.gpu.requestAdapter().catch(() => null));
  })());

/**
 * While the local server downloads model files (first use), reports "正在下载模型 x%".
 * Returns a function that stops watching.
 */
export function watchDownloads(onMessage: (msg: string) => void): () => void {
  let alive = true;
  const tick = async () => {
    try {
      const r = await fetch('/api/models/progress');
      const files = Object.values((await r.json()) as Record<string, { done: number; total: number }>);
      if (alive && files.length) {
        const done = files.reduce((a, f) => a + f.done, 0);
        const total = files.reduce((a, f) => a + f.total, 0);
        onMessage(total ? `首次使用，正在下载模型 ${Math.round((done / total) * 100)}%（${Math.round(done / 1e6)}/${Math.round(total / 1e6)} MB）` : `首次使用，正在下载模型（${Math.round(done / 1e6)} MB）`);
      }
    } catch {
      // the next tick tries again
    }
    if (alive) setTimeout(tick, 1000);
  };
  tick();
  return () => {
    alive = false;
  };
}

/** Runs `load` while showing download progress; the usual way to open a model. */
export async function withDownloads<T>(load: () => Promise<T>, onMessage: (msg: string) => void): Promise<T> {
  const stop = watchDownloads(onMessage);
  try {
    return await load();
  } finally {
    stop();
  }
}

const sessions = new Map<string, Promise<ort.InferenceSession>>();
/** Models whose WebGPU run failed (some ops exceed GPU limits); they use WebAssembly from then on. */
const cpuOnly = new Set<string>();

/** An ONNX session for a model file under /models/, kept for reuse. */
/** Sessions are created one at a time: the WebGPU backend refuses to build two at once. */
let creating: Promise<unknown> = Promise.resolve();

export function session(file: string): Promise<ort.InferenceSession> {
  setupAI();
  if (!sessions.has(file)) {
    const p = creating.then(async () => ort.InferenceSession.create(`/models/${file}`, { executionProviders: !cpuOnly.has(file) && (await hasWebGPU()) ? ['webgpu', 'wasm'] : ['wasm'] }));
    creating = p.catch(() => {});
    p.catch(() => sessions.delete(file));
    sessions.set(file, p);
  }
  return sessions.get(file)!;
}

/** Runs a model; if the GPU can't run it, switches that model to WebAssembly and runs again. */
/**
 * Model runs wait for each other: the WebGPU backend is one shared device, and overlapping
 * runs (of one model or two) can hang it.
 */
let queue: Promise<unknown> = Promise.resolve();

export function runModel(file: string, feeds: Record<string, ort.Tensor>): Promise<ort.InferenceSession.OnnxValueMapType> {
  const run = async () => {
    try {
      return await (await session(file)).run(feeds);
    } catch (err) {
      if (cpuOnly.has(file)) throw err;
      cpuOnly.add(file);
      await release(file);
      return (await session(file)).run(feeds);
    }
  };
  const p = queue.then(run);
  queue = p.catch(() => {});
  return p;
}

/** Frees a model's memory once a tool is done with it. */
export async function release(file: string) {
  const s = await sessions.get(file)?.catch(() => null);
  sessions.delete(file);
  await s?.release().catch(() => {});
}

export { ort };
