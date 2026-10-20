// Puts MediaPipe's runtime and the pose model under public/mediapipe so motion capture
// runs offline from the app itself. Runs before every build; downloads the model once.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'mediapipe');
const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';

fs.mkdirSync(path.join(out, 'wasm'), { recursive: true });
for (const f of fs.readdirSync(wasmSrc)) fs.copyFileSync(path.join(wasmSrc, f), path.join(out, 'wasm', f));

const model = path.join(out, 'pose_landmarker_full.task');
if (!fs.existsSync(model) || fs.statSync(model).size < 1_000_000) {
  console.log('Downloading pose model…');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`pose model download failed: ${res.status}`);
  fs.writeFileSync(model, Buffer.from(await res.arrayBuffer()));
}
console.log(`MediaPipe assets ready (${(fs.statSync(model).size / 1e6).toFixed(1)} MB model)`);
