// Puts the on-device models and their runtimes under public/ so motion capture and depth
// estimation run offline from the app itself. Runs before every build; downloads models once.
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
fs.mkdirSync(path.join(mp, 'wasm'), { recursive: true });
for (const f of fs.readdirSync(wasmSrc)) fs.copyFileSync(path.join(wasmSrc, f), path.join(mp, 'wasm', f));
await download(
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  path.join(mp, 'pose_landmarker_full.task'),
  1_000_000,
);

// ONNX Runtime Web (the build transformers.js loads) and Depth Anything V2 (depth video).
const ort = path.join(pub, 'ort');
fs.mkdirSync(ort, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'])
  fs.copyFileSync(path.join(root, 'node_modules', 'onnxruntime-web', 'dist', f), path.join(ort, f));
const DEPTH = 'onnx-community/depth-anything-v2-small';
const depthDir = path.join(pub, 'models', DEPTH);
for (const [f, min] of [
  ['config.json', 100],
  ['preprocessor_config.json', 100],
  ['onnx/model_fp16.onnx', 10_000_000],
])
  await download(`https://huggingface.co/${DEPTH}/resolve/main/${f}`, path.join(depthDir, f), min);

console.log('On-device model assets ready');
