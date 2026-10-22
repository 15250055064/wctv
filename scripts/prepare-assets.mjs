// Puts the on-device runtimes (and the small pose model) under public/ so motion capture and
// depth estimation run from the app itself. Runs before every build. The depth model is not
// shipped: the local server downloads it on first use (server/index.mjs, visionModel).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

async function download(url, file, minBytes) {
  if (fs.existsSync(file) && fs.statSync(file).size >= minBytes) return;
  console.log(`Downloading ${path.basename(file)}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// MediaPipe pose (motion capture).
const mp = path.join(pub, 'mediapipe');
const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
// Electron's Chromium always has WASM SIMD, so only the default (non-module, SIMD) build loads.
fs.rmSync(path.join(mp, 'wasm'), { recursive: true, force: true });
fs.mkdirSync(path.join(mp, 'wasm'), { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) fs.copyFileSync(path.join(wasmSrc, f), path.join(mp, 'wasm', f));
await download(
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  path.join(mp, 'pose_landmarker_full.task'),
  1_000_000,
);

// ONNX Runtime Web (the build transformers.js loads) for depth video.
const ort = path.join(pub, 'ort');
fs.mkdirSync(ort, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'])
  fs.copyFileSync(path.join(root, 'node_modules', 'onnxruntime-web', 'dist', f), path.join(ort, f));
// Older builds shipped the depth model in public/models; it now downloads on first use.
fs.rmSync(path.join(pub, 'models'), { recursive: true, force: true });

console.log('On-device runtimes ready');
