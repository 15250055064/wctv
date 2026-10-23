// Local media tools that run as native programs next to the app (no Python): each one is
// downloaded the first time it is used into engines/tools, then works offline.
//   esrgan     Real-ESRGAN (ncnn)       image upscaling            BSD-3-Clause
//   rife       RIFE (ncnn)              video frame interpolation  MIT
//   vtracer    vtracer                  image → SVG                MIT
//   deepfilter DeepFilterNet            speech noise removal       MIT / Apache-2.0
//   ort        ONNX Runtime (native)    runs the Demucs model      MIT
//   demucs     HTDemucs (ONNX)          vocals / accompaniment     MIT
// Trimming, scene splitting and speed changes use the app's own FFmpeg.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ENGINES_DIR } from '../engines.mjs';
import { extractRemote } from './remoteZip.mjs';

const TOOLS_DIR = path.join(ENGINES_DIR, 'tools');
const GH = 'https://github.com';
const ESRGAN_ZIP = `${GH}/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip`;
const RIFE_ZIP = `${GH}/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-macos.zip`;
const RIFE_PREFIX = 'rife-ncnn-vulkan-20221029-macos/';
const ORT_VERSION = '1.30.0';
const NPM_REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com'];
const HF_HOSTS = ['https://huggingface.co', 'https://hf-mirror.com'];

/** What each tool downloads, for the status shown in the app. */
export const TOOL_INFO = {
  esrgan: { name: '高清放大（Real-ESRGAN）', size: '约 50 MB' },
  rife: { name: '补帧（RIFE）', size: '约 36 MB' },
  vtracer: { name: '转矢量（vtracer）', size: '约 3 MB' },
  deepfilter: { name: '音频降噪（DeepFilterNet）', size: '约 28 MB' },
  ort: { name: 'ONNX Runtime 运行库', size: '约 45 MB' },
  demucs: { name: '人声分离模型（HTDemucs）', size: '约 300 MB' },
};

const run = (cmd, args, { cwd, env, onLine, timeout = 60 * 60_000 } = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env });
    let out = '';
    const timer = setTimeout(() => p.kill('SIGTERM'), timeout);
    const take = (d) => {
      out = (out + d).slice(-8000);
      onLine?.(String(d));
    };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('error', (e) => (clearTimeout(timer), reject(e)));
    p.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} 失败（退出码 ${code}）：${out.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`));
    });
  });

async function download(urls, file) {
  let last;
  for (const url of [urls].flat()) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) });
      if (!r.ok) throw new Error(`${r.status}`);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.part`;
      await fsp.writeFile(tmp, Buffer.from(await r.arrayBuffer()));
      await fsp.rename(tmp, file);
      return;
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`下载失败（${path.basename(file)}）：${last?.message}`);
}

export function createTools({ ffmpeg, env }) {
  const pending = new Map();
  const dir = (name) => path.join(TOOLS_DIR, name);
  const ready = (name) => fs.existsSync(path.join(dir(name), '.ready'));

  /** Per-tool install steps; each leaves its files in tools/<name>. */
  const installers = {
    async esrgan(d) {
      const zip = path.join(d, 'esrgan.zip');
      await download(ESRGAN_ZIP, zip);
      await run('unzip', ['-q', '-o', zip, 'realesrgan-ncnn-vulkan', 'models/realesrgan-x4plus.*', 'models/realesrgan-x4plus-anime.*', 'models/realesr-animevideov3-x2.*', '-d', d]);
      await fsp.rm(zip, { force: true });
    },
    async rife(d) {
      await extractRemote(RIFE_ZIP, d, (n) => n === `${RIFE_PREFIX}rife-ncnn-vulkan` || n.startsWith(`${RIFE_PREFIX}rife-v4.6/`), RIFE_PREFIX);
    },
    async vtracer(d) {
      const tgz = path.join(d, 'vtracer.tgz');
      await download(`${GH}/visioncortex/vtracer/releases/download/1.0.0-alpha.4/vtracer-aarch64-apple-darwin.tar.gz`, tgz);
      await run('tar', ['-xzf', tgz, '-C', d]);
      await fsp.rm(tgz, { force: true });
    },
    async deepfilter(d) {
      await download(`${GH}/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-aarch64-apple-darwin`, path.join(d, 'deep-filter'));
    },
    async ort(d) {
      // Only the macOS arm64 build out of the npm package (which carries every platform).
      for (const [pkg, folder, only] of [
        ['onnxruntime-node', 'onnxruntime-node', ['package/package.json', 'package/dist', 'package/bin/napi-v6/darwin/arm64/onnxruntime_binding.node', 'package/bin/napi-v6/darwin/arm64/libonnxruntime.1.dylib']],
        ['onnxruntime-common', 'onnxruntime-node/node_modules/onnxruntime-common', ['package']],
      ]) {
        const tgz = path.join(d, `${pkg}.tgz`);
        await download(NPM_REGISTRIES.map((r) => `${r}/${pkg}/-/${pkg}-${ORT_VERSION}.tgz`), tgz);
        const dest = path.join(d, folder);
        await fsp.mkdir(dest, { recursive: true });
        await run('tar', ['-xzf', tgz, '-C', dest, '--strip-components', '1', ...only]);
        await fsp.rm(tgz, { force: true });
      }
    },
    async demucs(d) {
      await download(HF_HOSTS.map((h) => `${h}/smank/htdemucs-onnx/resolve/main/htdemucs.onnx`), path.join(d, 'htdemucs.onnx'));
    },
  };

  /** Installs a tool the first time it's needed; later calls resolve at once. */
  function ensure(name, onLog) {
    if (ready(name)) return Promise.resolve(dir(name));
    if (!pending.has(name)) {
      pending.set(
        name,
        (async () => {
          onLog?.(`首次使用，正在下载${TOOL_INFO[name].name}（${TOOL_INFO[name].size}）…`);
          const d = dir(name);
          await fsp.rm(d, { recursive: true, force: true });
          await fsp.mkdir(d, { recursive: true });
          await installers[name](d);
          // Downloaded programs carry the quarantine flag; they're ours to run.
          await run('xattr', ['-dr', 'com.apple.quarantine', d]).catch(() => {});
          await run('chmod', ['-R', 'u+rwX', d]);
          for (const bin of ['realesrgan-ncnn-vulkan', 'rife-ncnn-vulkan', 'vtracer', 'deep-filter']) if (fs.existsSync(path.join(d, bin))) await fsp.chmod(path.join(d, bin), 0o755);
          await fsp.writeFile(path.join(d, '.ready'), new Date().toISOString());
          return d;
        })().finally(() => pending.delete(name)),
      );
    }
    return pending.get(name);
  }

  function status() {
    return Object.fromEntries(Object.keys(TOOL_INFO).map((k) => [k, { ...TOOL_INFO[k], installed: ready(k), installing: pending.has(k) }]));
  }

  const ff = (args, opts) => run(ffmpeg, ['-hide_banner', '-y', ...args], opts);

  /** FFmpeg's stderr for `args`, whatever the exit code (`-i file` alone prints the file's description). */
  const stderrOf = (args) =>
    new Promise((resolve) => {
      const p = spawn(ffmpeg, ['-hide_banner', ...args]);
      let out = '';
      p.stderr.on('data', (d) => (out += d));
      p.on('error', () => resolve(''));
      p.on('close', () => resolve(out));
    });
  const probe = (file) => stderrOf(['-i', file]);
  /** Keyframe times in seconds (decodes keyframes only, so it's quick). */
  const keyframes = async (file) => [...(await stderrOf(['-skip_frame', 'nokey', '-i', file, '-an', '-vf', 'showinfo', '-f', 'null', '-'])).matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  /** Seconds of media, for progress. */
  async function duration(file) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(await probe(file));
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  }
  const hasAudio = async (file) => /Stream #\S+.*: Audio:/.test(await probe(file));

  // ---- Image -----------------------------------------------------------------------------

  /** Upscales an image 2× or 4× (4× model, downscaled for 2×); `anime` picks the anime model. */
  async function upscale({ input, out, scale = 4, anime = false, tmp, onLog }) {
    const d = await ensure('esrgan', onLog);
    onLog?.('正在放大…');
    const png = path.join(tmp, 'in.png');
    await ff(['-i', input, '-frames:v', '1', png]);
    const x4 = path.join(tmp, 'x4.png');
    await run(path.join(d, 'realesrgan-ncnn-vulkan'), ['-i', png, '-o', x4, '-n', anime ? 'realesrgan-x4plus-anime' : 'realesrgan-x4plus', '-m', path.join(d, 'models')]);
    if (Number(scale) === 2) await ff(['-i', x4, '-vf', 'scale=iw/2:ih/2:flags=lanczos', out]);
    else await fsp.copyFile(x4, out);
  }

  /** Traces an image into SVG: 'photo' keeps colour detail, 'poster' flattens, 'bw' is line art. */
  async function vectorize({ input, out, preset = 'poster', tmp, onLog }) {
    const d = await ensure('vtracer', onLog);
    onLog?.('正在转换为矢量图…');
    const png = path.join(tmp, 'in.png');
    // Very large images make huge SVGs; 2048 px on the long side is plenty for tracing.
    await ff(['-i', input, '-frames:v', '1', '-vf', "scale='min(2048,iw)':'min(2048,ih)':force_original_aspect_ratio=decrease", png]);
    await run(path.join(d, 'vtracer'), ['--input', png, '--output', out, '--preset', ['photo', 'poster', 'bw'].includes(preset) ? preset : 'poster']);
  }

  // ---- Audio -----------------------------------------------------------------------------

  /** Removes background noise from speech. A video keeps its picture and gets the cleaned sound. */
  async function denoise({ input, out, isVideo, tmp, onLog }) {
    const d = await ensure('deepfilter', onLog);
    if (isVideo && !(await hasAudio(input))) throw new Error('这个视频没有声音');
    onLog?.('正在降噪…');
    const wav = path.join(tmp, 'in.wav');
    await ff(['-i', input, '-vn', '-ac', '1', '-ar', '48000', wav]);
    const outDir = path.join(tmp, 'df');
    await run(path.join(d, 'deep-filter'), ['-D', '-o', outDir, wav]);
    const clean = path.join(outDir, 'in.wav');
    if (isVideo) await ff(['-i', input, '-i', clean, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
    else await ff(['-i', clean, out]);
  }

  /**
   * Splits music into vocals and accompaniment with HTDemucs (4 stems; drums, bass and other
   * are summed into the accompaniment). Long audio is processed in overlapping 7.8 s windows.
   */
  async function separate({ input, vocalsOut, backingOut, tmp, onLog, onProgress }) {
    const [ortDir, demucsDir] = [await ensure('ort', onLog), await ensure('demucs', onLog)];
    onLog?.('正在加载人声分离模型…');
    const ort = createRequire(import.meta.url)(path.join(ortDir, 'onnxruntime-node'));
    const raw = path.join(tmp, 'mix.f32');
    await ff(['-i', input, '-vn', '-f', 'f32le', '-ac', '2', '-ar', '44100', raw]);
    const buf = await fsp.readFile(raw);
    const inter = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    const n = inter.length / 2;
    if (!n) throw new Error('没有读到声音');
    const session = await ort.InferenceSession.create(path.join(demucsDir, 'htdemucs.onnx'), { graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false });
    const SEG = 343_980; // 7.8 s, the model's training segment
    const HOP = Math.round(SEG * 0.75);
    const w = new Float32Array(SEG);
    for (let i = 0; i < SEG; i++) w[i] = Math.min(i + 1, SEG - i);
    const vocals = new Float32Array(2 * n);
    const backing = new Float32Array(2 * n);
    const wsum = new Float32Array(n);
    const windows = Math.max(1, Math.ceil(Math.max(0, n - SEG) / HOP) + 1);
    try {
      for (let k = 0, start = 0; k < windows; k++, start += HOP) {
        onLog?.(`正在分离人声 ${Math.round((k / windows) * 100)}%`);
        onProgress?.(k / windows);
        const mix = new Float32Array(2 * SEG);
        for (let i = 0; i < SEG && start + i < n; i++) {
          mix[i] = inter[2 * (start + i)];
          mix[SEG + i] = inter[2 * (start + i) + 1];
        }
        const { sources } = await session.run({ mix: new ort.Tensor('float32', mix, [1, 2, SEG]) });
        const o = sources.data; // [1, 4 (drums, bass, other, vocals), 2, SEG]
        for (let i = 0; i < SEG && start + i < n; i++) {
          const j = start + i;
          for (let c = 0; c < 2; c++) {
            const at = (s) => o[(s * 2 + c) * SEG + i];
            vocals[2 * j + c] += at(3) * w[i];
            backing[2 * j + c] += (at(0) + at(1) + at(2)) * w[i];
          }
          wsum[j] += w[i];
        }
      }
    } finally {
      await session.release?.();
    }
    for (let j = 0; j < n; j++)
      for (let c = 0; c < 2; c++) {
        vocals[2 * j + c] /= wsum[j] || 1;
        backing[2 * j + c] /= wsum[j] || 1;
      }
    for (const [data, file] of [
      [vocals, vocalsOut],
      [backing, backingOut],
    ]) {
      const f = path.join(tmp, `${path.basename(file)}.f32`);
      await fsp.writeFile(f, Buffer.from(data.buffer));
      await ff(['-f', 'f32le', '-ac', '2', '-ar', '44100', '-i', f, file]);
    }
  }

  // ---- Video -----------------------------------------------------------------------------

  /**
   * Video upscaling with Real-ESRGAN's video model (realesr-animevideov3, ~1 MB): about 0.4 s a
   * frame at 720p and 0.6 s at 1080p on an M1 Max. The photo model is ~10 s a frame, too slow
   * for video. Frames go through in batches straight into the encoder, so disk use stays small;
   * the result is capped at 4K and keeps the sound.
   */
  async function upscaleVideo({ input, out, tmp, onLog, onProgress }) {
    const d = await ensure('esrgan', onLog);
    // Installs from before video upscaling lack the video model; fetch just those two files.
    if (!fs.existsSync(path.join(d, 'models', 'realesr-animevideov3-x2.param'))) {
      onLog?.('正在下载视频高清模型…');
      await extractRemote(ESRGAN_ZIP, d, (n) => n.startsWith('models/realesr-animevideov3-x2.'));
    }
    const info = await probe(input);
    const fps = /([\d.]+) fps/.exec(info)?.[1] ?? '30';
    const total = Math.round((await duration(input)) * Number(fps)) || 1;
    const [, w, h] = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(info) ?? [];
    // Twice the size, at most 3840 on the long side.
    const cap = Math.min(1, 3840 / (2 * Math.max(Number(w) || 1920, Number(h) || 1080)));
    const scale = cap < 1 ? ['-vf', `scale=trunc(iw*${cap.toFixed(4)}/2)*2:trunc(ih*${cap.toFixed(4)}/2)*2:flags=lanczos`] : [];
    const frames = path.join(tmp, 'in');
    const ups = path.join(tmp, 'out');
    await fsp.mkdir(frames, { recursive: true });
    onLog?.('正在拆帧…');
    await ff(['-i', input, '-vsync', '0', '-q:v', '2', path.join(frames, '%08d.jpg')]);
    const names = (await fsp.readdir(frames)).filter((f) => f.endsWith('.jpg')).sort();
    if (!names.length) throw new Error('没有读到画面');
    // The encoder reads the upscaled frames from a pipe as they're made.
    const enc = spawn(ffmpeg, ['-hide_banner', '-y', '-f', 'image2pipe', '-framerate', fps, '-i', '-', '-i', input, '-map', '0:v', '-map', '1:a?', ...scale, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out]);
    let encErr = '';
    enc.stderr.on('data', (c) => (encErr = (encErr + c).slice(-2000)));
    const encoded = new Promise((ok, bad) => enc.on('close', (code) => (code === 0 ? ok() : bad(new Error(`编码失败：${encErr.trim().split('\n').at(-1)}`)))));
    const BATCH = 60;
    try {
      for (let i = 0; i < names.length; i += BATCH) {
        const batch = path.join(tmp, 'batch');
        await fsp.rm(batch, { recursive: true, force: true });
        await fsp.rm(ups, { recursive: true, force: true });
        await fsp.mkdir(batch, { recursive: true });
        await fsp.mkdir(ups, { recursive: true });
        for (const n of names.slice(i, i + BATCH)) await fsp.rename(path.join(frames, n), path.join(batch, n));
        await run(path.join(d, 'realesrgan-ncnn-vulkan'), ['-i', batch, '-o', ups, '-n', 'realesr-animevideov3', '-s', '2', '-f', 'jpg', '-m', path.join(d, 'models')]);
        for (const n of names.slice(i, i + BATCH)) {
          const buf = await fsp.readFile(path.join(ups, n));
          if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
        }
        const done = Math.min(names.length, i + BATCH);
        onProgress?.(done / total);
        onLog?.(`正在高清化 ${Math.round((done / names.length) * 100)}%（${done}/${names.length} 帧）`);
      }
    } finally {
      enc.stdin.end();
    }
    onLog?.('正在合成视频…');
    await encoded;
  }

  /** Doubles the frame rate with RIFE (e.g. 30 → 60 fps), keeping the sound. */
  async function interpolate({ input, out, tmp, onLog, onProgress }) {
    const d = await ensure('rife', onLog);
    const fin = path.join(tmp, 'in');
    const fout = path.join(tmp, 'out');
    await fsp.mkdir(fin, { recursive: true });
    await fsp.mkdir(fout, { recursive: true });
    onLog?.('正在拆帧…');
    const fps = Number(/([\d.]+) fps/.exec(await probe(input))?.[1]) || 30;
    await ff(['-i', input, '-vsync', '0', path.join(fin, '%08d.png')]);
    const total = (await fsp.readdir(fin)).length;
    if (!total) throw new Error('没有读到画面');
    onLog?.(`正在补帧（${total} 帧 → ${total * 2} 帧）…`);
    const timer = setInterval(async () => {
      const done = (await fsp.readdir(fout).catch(() => [])).length;
      onProgress?.(Math.min(0.95, done / (total * 2)));
      onLog?.(`正在补帧 ${Math.round(Math.min(1, done / (total * 2)) * 100)}%`);
    }, 2000);
    try {
      await run(path.join(d, 'rife-ncnn-vulkan'), ['-i', fin, '-o', fout, '-m', path.join(d, 'rife-v4.6'), '-f', '%08d.png']);
    } finally {
      clearInterval(timer);
    }
    onLog?.('正在合成视频…');
    await ff(['-framerate', String(fps * 2), '-i', path.join(fout, '%08d.png'), '-i', input, '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out]);
    return { fps: fps * 2 };
  }

  /**
   * Cuts a video: keeps the given time ranges (in order), optionally changes speed. One range at
   * normal speed that starts on a keyframe is copied as is (seconds); anything else is
   * re-encoded, so every cut is frame-exact.
   */
  async function trim({ input, out, ranges, speed = 1, onLog }) {
    const total = await duration(input);
    const rs = (ranges ?? [])
      .map(([a, b]) => [Math.max(0, Number(a) || 0), Math.min(total || Infinity, Number(b) || 0)])
      .filter(([a, b]) => b - a > 0.05);
    if (!rs.length) throw new Error('没有要保留的片段');
    const sp = Math.max(0.25, Math.min(4, Number(speed) || 1));
    const audio = await hasAudio(input);
    const onKeyframe = rs.length === 1 && sp === 1 && (rs[0][0] < 0.02 || (await keyframes(input)).some((t) => Math.abs(t - rs[0][0]) < 0.02));
    if (onKeyframe) {
      onLog?.('正在剪辑（快速模式）…');
      await ff(['-ss', String(rs[0][0]), '-to', String(rs[0][1]), '-i', input, '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', out]);
      return;
    }
    onLog?.('正在剪辑并重新编码…');
    // atempo takes 0.5–2 per stage; chain stages for speeds outside that.
    const tempo = [];
    for (let t = sp; ; ) {
      if (t > 2) (tempo.push('atempo=2'), (t /= 2));
      else if (t < 0.5) (tempo.push('atempo=0.5'), (t /= 0.5));
      else {
        tempo.push(`atempo=${t.toFixed(4)}`);
        break;
      }
    }
    const parts = rs.map(([a, b], i) => `[0:v]trim=${a}:${b},setpts=(PTS-STARTPTS)/${sp}[v${i}]` + (audio ? `;[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS,${tempo.join(',')}[a${i}]` : ''));
    const cat = rs.map((_, i) => `[v${i}]${audio ? `[a${i}]` : ''}`).join('') + `concat=n=${rs.length}:v=1:a=${audio ? 1 : 0}[v]${audio ? '[a]' : ''}`;
    await ff(['-i', input, '-filter_complex', `${parts.join(';')};${cat}`, '-map', '[v]', ...(audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  }

  /** Finds hard cuts (scene changes) in a video; returns their times in seconds. */
  async function detectScenes({ input, threshold = 0.3, onLog }) {
    onLog?.('正在识别镜头切换…');
    const outText = await run(ffmpeg, ['-hide_banner', '-i', input, '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-']);
    const times = [...outText.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
    // Ignore cuts closer than half a second to the previous one (flashes, fades).
    return times.filter((t, i) => t > 0.3 && (i === 0 || t - times[i - 1] > 0.5));
  }

  /** Splits a video at its scene changes into separate clips (frame-exact, re-encoded). */
  async function splitScenes({ input, outPattern, threshold, onLog, maxClips = 40 }) {
    const total = await duration(input);
    const cuts = (await detectScenes({ input, threshold, onLog })).filter((t) => t < total - 0.3).slice(0, maxClips - 1);
    if (!cuts.length) throw new Error('没有识别到镜头切换：这段视频可能只有一个镜头');
    onLog?.(`识别到 ${cuts.length + 1} 个镜头，正在切分…`);
    await ff(['-i', input, '-map', '0:v', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-force_key_frames', cuts.join(','), '-f', 'segment', '-segment_times', cuts.join(','), '-segment_time_delta', '0.05', '-reset_timestamps', '1', outPattern]);
    return [0, ...cuts].map((start, i) => ({ start, end: cuts[i] ?? total }));
  }

  return { status, ensure, upscale, upscaleVideo, vectorize, denoise, separate, interpolate, trim, splitScenes, detectScenes };
}
