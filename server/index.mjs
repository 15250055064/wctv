#!/usr/bin/env node
// WCcanvastv local server: serves the built app, archives media on disk, and runs
// generations through the AI apps installed on this Mac (ChatGPT's Codex CLI and
// Claude Code) using their existing logins — no API keys.
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createEngines, ENGINES_DIR } from './engines.mjs';
import { createStudio } from './studio.mjs';
import { createTools, TOOL_INFO } from './tools/index.mjs';

const PORT = Number(process.env.PORT || 5174);
const HOST = '127.0.0.1';
const LEGACY_ARCHIVE = path.join(os.homedir(), 'Movies', 'LibCanvas');
const ARCHIVE = path.resolve(process.env.WCCANVASTV_DIR || process.env.LIBCANVAS_DIR || path.join(os.homedir(), 'Movies', 'WCcanvastv'));
// The app used to be called LibCanvas: carry its archive over once.
if (!process.env.WCCANVASTV_DIR && !process.env.LIBCANVAS_DIR && !fs.existsSync(ARCHIVE) && fs.existsSync(LEGACY_ARCHIVE)) fs.renameSync(LEGACY_ARCHIVE, ARCHIVE);
const META_DIR = path.join(ARCHIVE, '.libcanvas');
const LEGACY_STATE_FILE = path.join(META_DIR, 'state.json');
const LIBRARY_FILE = path.join(META_DIR, 'library.json');
const APP_FILE = path.join(META_DIR, 'app.json');
const JOBS_DIR = path.join(META_DIR, 'jobs');
const PROJECT_FILE = 'project.libcanvas.json';
const STUDIO_FOLDER = '制作';
// Working files a tool sends to ChatGPT (e.g. 扩图's padded picture): not assets, so the
// archive listing skips them and they're deleted after a day.
const TEMP_FOLDER = '临时';
const TEMP_DIR = path.join(ARCHIVE, TEMP_FOLDER);
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const CODEX_IMAGES = path.join(os.homedir(), '.codex', 'generated_images');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};
const KIND_BY_EXT = { image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'], video: ['.mp4', '.mov', '.webm', '.m4v'], audio: ['.mp3', '.wav', '.m4a'] };
const kindOf = (file) => Object.keys(KIND_BY_EXT).find((k) => KIND_BY_EXT[k].includes(path.extname(file).toLowerCase())) ?? 'file';

// ---------------------------------------------------------------------------
// Locating the local AI apps
// ---------------------------------------------------------------------------

function findBin(name, extra) {
  const dirs = (process.env.PATH || '').split(':').map((d) => path.join(d, name));
  for (const p of [...extra, ...dirs]) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // keep looking
    }
  }
  return null;
}

const HOME = os.homedir();
const CODEX = findBin('codex', [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  path.join(HOME, 'Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'),
  '/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex',
  path.join(HOME, '.local/node/bin/codex'),
  path.join(HOME, '.local/bin/codex'),
  path.join(HOME, '.npm-global/bin/codex'),
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
]);
const APP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Bundled into the Mac app as bin/ffmpeg; in development it comes from the ffmpeg-static package.
const FFMPEG = findBin('ffmpeg', [
  path.join(APP_ROOT, 'bin', 'ffmpeg'),
  path.join(APP_ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg'),
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
]);
const CLAUDE = findBin('claude', [
  path.join(HOME, '.local/node/bin/claude'),
  path.join(HOME, '.local/bin/claude'),
  path.join(HOME, '.claude/local/claude'),
  path.join(HOME, '.npm-global/bin/claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
]);

// Spawned CLIs need a PATH that can find node and the usual tools even when this
// server was started from Finder.
const CHILD_ENV = {
  ...process.env,
  PATH: [path.dirname(process.execPath), path.join(HOME, '.local/node/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH].filter(Boolean).join(':'),
};

function run(bin, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, env: CHILD_ENV }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` }));
  });
}

let engineCache = { at: 0, value: null };
async function engines() {
  if (engineCache.value && Date.now() - engineCache.at < 20000) return engineCache.value;
  const [cx, cl] = await Promise.all([
    CODEX ? run(CODEX, ['login', 'status']) : null,
    CLAUDE ? run(CLAUDE, ['auth', 'status']) : null,
  ]);
  let claudeLoggedIn = false;
  try {
    claudeLoggedIn = !!(cl && JSON.parse(cl.out).loggedIn);
  } catch {
    claudeLoggedIn = false;
  }
  const value = {
    chatgpt: { available: !!CODEX, loggedIn: !!cx?.ok && /logged in/i.test(cx.out), text: true, image: true },
    claude: { available: !!CLAUDE, loggedIn: claudeLoggedIn, text: true, image: false },
    archive: ARCHIVE,
  };
  engineCache = { at: Date.now(), value };
  return value;
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` };
}
const safeName = (name) =>
  (name || 'file')
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'file';

/** A fresh archive path like 项目名/2026-10-20/115930-name.ext that doesn't clobber anything. */
/** Each kind of file has its own folder in a project: 图片, 视频, 音频, 其他. */
const KIND_FOLDER = { image: '图片', video: '视频', audio: '音频', file: '其他' };
/** Shared across projects: brand material (logos…) and the user's favourites. */
const LIBRARY_FOLDERS = { brand: '品牌资产库', fav: '收藏夹' };
const RESERVED = new Set([STUDIO_FOLDER, TEMP_FOLDER, ...Object.values(LIBRARY_FOLDERS), ...Object.values(KIND_FOLDER)]);

/** A free archive path for a new file: <project>/<kind folder>/<MMDD-HHMMSS>-<name>. */
async function archivePath(name, project) {
  const { day, time } = stamp();
  const folder = KIND_FOLDER[kindOf(name)];
  const dir = project ? `${project}/${folder}` : folder;
  await fsp.mkdir(path.join(ARCHIVE, dir), { recursive: true });
  return freeName(dir, `${day.slice(5).replace('-', '')}-${time}-${name}`);
}

/** `dir/name`, numbered if a file with that name exists. */
function freeName(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let i = 0; ; i++) {
    const rel = `${dir}/${base}${i ? `-${i}` : ''}${ext}`;
    if (!fs.existsSync(path.join(ARCHIVE, rel))) return rel;
  }
}

/** Replaces every string that is exactly an old archive id with its new id. */
function remap(value, map) {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remap(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, map)]));
  return value;
}

/**
 * Projects from before the kind folders kept files in date folders (2026-10-23/…). Moves them
 * into 图片 / 视频 / 音频 / 其他 (the date goes into the name) and rewrites every reference: in
 * all projects and in the shared library. The project file is backed up first. Returns how
 * many files moved.
 */
/** 品牌资产库 / 收藏夹: files at the top, plus one level of the user's own folders. */
async function listShelf(kind) {
  const rootRel = LIBRARY_FOLDERS[kind];
  await fsp.mkdir(path.join(ARCHIVE, rootRel), { recursive: true });
  const read = async (rel) => {
    const out = [];
    for (const e of await fsp.readdir(path.join(ARCHIVE, rel), { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('.')) continue;
      const id = `${rel}/${e.name}`;
      const st = await fsp.stat(path.join(ARCHIVE, id));
      out.push({ id, name: e.name, kind: kindOf(e.name), size: st.size, mtime: st.mtimeMs });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  };
  const folders = [{ name: '', files: await read(rootRel) }];
  for (const e of await fsp.readdir(path.join(ARCHIVE, rootRel), { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.')) folders.push({ name: e.name, files: await read(`${rootRel}/${e.name}`) });
  }
  return { dir: path.join(ARCHIVE, rootRel), folders };
}

/** A shelf folder's archive path ('' = the shelf itself), or null for a bad name. */
function shelfDir(kind, folder) {
  const root = LIBRARY_FOLDERS[kind];
  if (!root) return null;
  const f = safeName(String(folder ?? '').trim()).replace(/\.+$/, '');
  return folder ? (f ? `${root}/${f}` : null) : root;
}

async function organizeProject(id) {
  const root = path.join(ARCHIVE, id);
  const map = new Map();
  for (const day of await fsp.readdir(root, { withFileTypes: true })) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    for (const f of await fsp.readdir(path.join(root, day.name), { withFileTypes: true })) {
      if (!f.isFile() || f.name.startsWith('.')) continue;
      const old = `${id}/${day.name}/${f.name}`;
      const dir = `${id}/${KIND_FOLDER[kindOf(f.name)]}`;
      await fsp.mkdir(path.join(ARCHIVE, dir), { recursive: true });
      const rel = freeName(dir, `${day.name.slice(5).replace('-', '')}-${f.name}`);
      await fsp.rename(path.join(ARCHIVE, old), path.join(ARCHIVE, rel));
      map.set(old, rel);
    }
    // Remove the date folder if nothing but Finder's .DS_Store is left.
    const left = await fsp.readdir(path.join(root, day.name));
    if (left.every((n) => n === '.DS_Store')) await fsp.rm(path.join(root, day.name), { recursive: true });
  }
  if (!map.size) return 0;
  const own = path.join(root, PROJECT_FILE);
  await fsp.copyFile(own, `${own}.before-organize.bak`).catch(() => {});
  for (const p of await listProjects()) {
    const file = path.join(ARCHIVE, p.id, PROJECT_FILE);
    const data = await readJson(file, null);
    if (data) await writeJson(file, remap(data, map));
  }
  const lib = await readJson(LIBRARY_FILE, null);
  if (lib) await writeJson(LIBRARY_FILE, remap(lib, map));
  return map.size;
}

/** Resolve a client-supplied archive id, refusing anything outside the archive. */
function resolveArchived(rel) {
  const abs = path.resolve(ARCHIVE, rel);
  if (!abs.startsWith(ARCHIVE + path.sep) || rel.split('/').some((p) => p.startsWith('.'))) return null;
  return abs;
}

/** Media files under the whole archive, or under one project folder. */
async function listArchive(project) {
  const out = [];
  const walk = async (rel, depth) => {
    let entries = [];
    try {
      entries = await fsp.readdir(path.join(ARCHIVE, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // 制作/ holds the AI productions' working folders; their finished films are listed already.
      if (e.name.startsWith('.') || e.name === PROJECT_FILE || e.name === STUDIO_FOLDER || e.name === TEMP_FOLDER) continue;
      const id = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && depth < 3) await walk(id, depth + 1);
      else if (e.isFile() && kindOf(e.name) !== 'file') {
        const st = await fsp.stat(path.join(ARCHIVE, id));
        out.push({ id, name: e.name, kind: kindOf(e.name), size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  await walk(project ?? '', project ? 1 : 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------------------------------------------------------------------------
// Projects: each one is a folder in the archive holding its canvas and media
// ---------------------------------------------------------------------------

/** A project id is its folder name directly under the archive. */
function projectDir(id) {
  if (typeof id !== 'string' || !id || id.includes('/') || id.startsWith('.')) return null;
  const abs = resolveArchived(id);
  return abs && fs.existsSync(path.join(abs, PROJECT_FILE)) ? abs : null;
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, typeof data === 'string' ? data : JSON.stringify(data));
  await fsp.rename(tmp, file);
}

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
};

function uniqueFolder(name) {
  const base = safeName(String(name ?? '').trim() || '未命名项目').replace(/\.+$/, '') || '未命名项目';
  for (let i = 1; ; i++) {
    const n = i === 1 ? base : `${base} ${i}`;
    if (!fs.existsSync(path.join(ARCHIVE, n)) && !RESERVED.has(n)) return n;
  }
}

const emptyCanvas = (name) => ({ name, nodes: [], edges: [], assets: [], history: [] });

async function createProject(name, canvas) {
  const id = uniqueFolder(name);
  const now = Date.now();
  await fsp.mkdir(path.join(ARCHIVE, id), { recursive: true });
  await writeJson(path.join(ARCHIVE, id, PROJECT_FILE), { version: 1, createdAt: now, updatedAt: now, canvas: { ...(canvas ?? emptyCanvas(id)), name: id } });
  return id;
}

async function listProjects() {
  let entries = [];
  try {
    entries = await fsp.readdir(ARCHIVE, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || !projectDir(e.name)) continue;
    const data = await readJson(path.join(ARCHIVE, e.name, PROJECT_FILE), null);
    if (!data) continue;
    const nodes = data.canvas?.nodes ?? [];
    const cover = nodes.flatMap((n) => n.data?.outputs ?? []).map((o) => o.media).find((m) => m?.kind === 'image')?.id;
    out.push({ id: e.name, name: e.name, createdAt: data.createdAt ?? 0, updatedAt: data.updatedAt ?? 0, nodeCount: nodes.length, cover });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Rewrite every archive id that points inside a renamed project folder. */
function rebase(value, from, to) {
  if (typeof value === 'string') return value.startsWith(`${from}/`) ? `${to}${value.slice(from.length)}` : value;
  if (Array.isArray(value)) return value.map((v) => rebase(v, from, to));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rebase(v, from, to)]));
  return value;
}

async function renameProject(id, name) {
  const target = safeName(String(name ?? '').trim()).replace(/\.+$/, '');
  if (!target) throw new Error('项目名称不能为空');
  if (target === id) return id;
  if (fs.existsSync(path.join(ARCHIVE, target)) || RESERVED.has(target)) throw new Error(`已存在名为「${target}」的项目或文件夹`);
  await fsp.rename(path.join(ARCHIVE, id), path.join(ARCHIVE, target));
  const file = path.join(ARCHIVE, target, PROJECT_FILE);
  const data = rebase(await readJson(file, {}), id, target);
  data.canvas = { ...data.canvas, name: target };
  data.updatedAt = Date.now();
  await writeJson(file, data);
  const lib = await readJson(LIBRARY_FILE, null);
  if (lib) await writeJson(LIBRARY_FILE, rebase(lib, id, target));
  const app = await readJson(APP_FILE, {});
  if (app.lastProject === id) await writeJson(APP_FILE, { ...app, lastProject: target });
  return target;
}

/** Earlier versions kept one canvas in .libcanvas/state.json; turn it into the first project. */
async function migrateLegacyState() {
  if (!fs.existsSync(LEGACY_STATE_FILE)) return;
  const legacy = await readJson(LEGACY_STATE_FILE, null);
  if (legacy?.library && !fs.existsSync(LIBRARY_FILE)) await writeJson(LIBRARY_FILE, legacy.library);
  if ((await listProjects()).length === 0) {
    const id = await createProject(legacy?.canvas?.name || '我的项目', legacy?.canvas);
    await writeJson(APP_FILE, { lastProject: id });
  }
  await fsp.rename(LEGACY_STATE_FILE, `${LEGACY_STATE_FILE}.migrated`);
}

// ---------------------------------------------------------------------------
// Generation jobs
// ---------------------------------------------------------------------------

const jobs = new Map();

function newJob(engine, kind) {
  const job = { id: randomUUID(), engine, kind, status: 'running', log: [], startedAt: Date.now(), proc: null };
  jobs.set(job.id, job);
  // Forget finished jobs after an hour.
  setTimeout(() => jobs.delete(job.id), 3600_000).unref();
  return job;
}

const say = (job, msg) => {
  if (msg) job.log.push(String(msg).slice(0, 300));
};
const fail = (job, msg) => {
  job.status = 'error';
  job.error = msg;
};

function newestImage(dir, since) {
  let best = null;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (kindOf(e.name) === 'image') {
        const t = fs.statSync(p).mtimeMs;
        if (t >= since && (!best || t > best.t)) best = { p, t };
      }
    }
  };
  walk(dir);
  return best?.p ?? null;
}

/** Width and height from a PNG or JPEG header, so the canvas can show the real aspect ratio. */
async function imageSize(file) {
  try {
    const fh = await fsp.open(file, 'r');
    const { buffer } = await fh.read(Buffer.alloc(64 * 1024), 0, 64 * 1024, 0);
    await fh.close();
    if (buffer.readUInt32BE(0) === 0x89504e47) return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      for (let i = 2; i < buffer.length - 9; ) {
        if (buffer[i] !== 0xff) break;
        const marker = buffer[i + 1];
        const len = buffer.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buffer.readUInt16BE(i + 5), w: buffer.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
  } catch {
    // unknown size: the canvas measures it when the image loads
  }
  return {};
}

// ---------------------------------------------------------------------------
// Video tools (FFmpeg)
// ---------------------------------------------------------------------------

function runFfmpeg(args, timeout = 30 * 60_000) {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('没有找到 FFmpeg'));
    const proc = spawn(FFMPEG, ['-hide_banner', '-nostdin', ...args], { env: CHILD_ENV });
    let err = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeout);
    proc.stderr.on('data', (c) => (err = (err + c).slice(-400_000)));
    proc.on('error', reject);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, err });
    });
  });
}

async function probeVideo(abs) {
  const { err } = await runFfmpeg(['-i', abs]);
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
  const size = /Video: [^\n]*?(\d{2,5})x(\d{2,5})/.exec(err);
  const fps = /Video: [^\n]*?([\d.]+) fps/.exec(err);
  return {
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    w: size ? Number(size[1]) : 0,
    h: size ? Number(size[2]) : 0,
    fps: fps ? Number(fps[1]) : 0,
    hasAudio: /Stream #\S+.*: Audio:/.test(err),
    hasVideo: /Stream #\S+.*: Video:/.test(err),
  };
}

// ---- Playable copies --------------------------------------------------------------------------
// The app's player (Chromium) can't decode some camera files, e.g. H.264 4:2:2 / 10-bit from
// Sony cameras, ProRes, or PCM sound in MP4. Playback and the in-app frame tools get a cached
// H.264 copy (at most 1920 px) instead; downloads and the server tools keep the original.
const PLAY_CACHE = path.join(ARCHIVE, '.cache', 'play');
const PLAYABLE_VIDEO = { h264: ['yuv420p', 'yuvj420p'], hevc: ['yuv420p', 'yuv420p10le'], vp8: ['yuv420p'], vp9: ['yuv420p', 'yuva420p'], av1: ['yuv420p'] };
const PLAYABLE_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];
const playCopies = new Map();

/** The file to play for an archived video: itself if the player can decode it, else a cached copy. */
function playableFile(abs) {
  const st = fs.statSync(abs);
  const key = createHash('sha1').update(`${abs}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
  if (!playCopies.has(key)) {
    const job = (async () => {
      const copy = path.join(PLAY_CACHE, `${key}.mp4`);
      if (fs.existsSync(copy)) {
        await fsp.utimes(copy, new Date(), new Date()).catch(() => {});
        return copy;
      }
      const { err } = await runFfmpeg(['-i', abs]);
      const v = /Stream #\S+.*: Video: (\w+)[^,\n]*, (\w+)/.exec(err);
      const a = /Stream #\S+.*: Audio: (\w+)/.exec(err);
      const videoOk = !v || PLAYABLE_VIDEO[v[1]]?.includes(v[2]);
      const audioOk = !a || PLAYABLE_AUDIO.includes(a[1]);
      if (videoOk && audioOk) return abs;
      await fsp.mkdir(PLAY_CACHE, { recursive: true });
      // Copies nobody has played for two weeks are dropped (they're remade when needed).
      for (const f of await fsp.readdir(PLAY_CACHE)) {
        const st = await fsp.stat(path.join(PLAY_CACHE, f)).catch(() => null);
        if (st && Date.now() - st.mtimeMs > 14 * 86_400_000) await fsp.rm(path.join(PLAY_CACHE, f), { force: true });
      }
      const tmp = `${copy}.part.mp4`;
      const video = videoOk
        ? ['-c:v', 'copy']
        : ['-vf', "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
      const r = await runFfmpeg(['-y', '-i', abs, '-map', '0:v:0', '-map', '0:a:0?', ...video, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp]);
      if (r.code !== 0) throw new Error(`视频转成可播放格式失败：${r.err.split('\n').filter(Boolean).at(-1) ?? ''}`);
      await fsp.rename(tmp, copy);
      return copy;
    })();
    job.catch(() => playCopies.delete(key));
    playCopies.set(key, job);
  }
  return playCopies.get(key);
}

/** "120657-我的成片.webm" -> "我的成片": the archive's time prefix and extension dropped. */
const baseOf = (rel) => path.basename(rel, path.extname(rel)).replace(/^(\d{4}-)?\d{6}-/, '');
const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}m${String(Math.floor(t % 60)).padStart(2, '0')}s`;

function ffFail(res, what, err) {
  const line = err.split('\n').filter((l) => /error|invalid|no such|not/i.test(l)).at(-1) ?? err.split('\n').filter(Boolean).at(-1) ?? '';
  return json(res, 500, { error: `${what}失败：${line.trim().slice(0, 200)}` });
}

async function videoTool(res, kind, body) {
  const src = resolveArchived(String(body.id ?? ''));
  if (!src || !fs.existsSync(src)) return json(res, 404, { error: '找不到这个视频文件' });
  const project = projectDir(body.project) ? body.project : undefined;
  const info = await probeVideo(src);
  const base = baseOf(body.id);

  if (kind === 'info') return json(res, 200, info);

  if (kind === 'separate') {
    if (!info.hasAudio) return json(res, 400, { error: '这个视频没有音轨，无需分离' });
    const ext = path.extname(src).toLowerCase() || '.mp4';
    const videoRel = await archivePath(`${base}-无声${ext}`, project);
    let r = await runFfmpeg(['-y', '-i', src, '-map', '0:v:0', '-an', '-c:v', 'copy', path.join(ARCHIVE, videoRel)]);
    if (r.code !== 0) return ffFail(res, '导出无声视频', r.err);
    const audioRel = await archivePath(`${base}-音频.m4a`, project);
    r = await runFfmpeg(['-y', '-i', src, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', path.join(ARCHIVE, audioRel)]);
    if (r.code !== 0) return ffFail(res, '导出音频', r.err);
    return json(res, 200, {
      video: { id: videoRel, kind: 'video', name: path.basename(videoRel), w: info.w, h: info.h },
      audio: { id: audioRel, kind: 'audio', name: path.basename(audioRel) },
    });
  }

  if (kind === 'crop') {
    if (!info.w || !info.h) return json(res, 400, { error: '读取不到视频尺寸' });
    const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
    const even = (v) => Math.max(2, Math.floor(v / 2) * 2);
    const x = even(clamp(body.x) * info.w);
    const y = even(clamp(body.y) * info.h);
    const w = Math.min(even(clamp(body.w) * info.w), even(info.w - x));
    const h = Math.min(even(clamp(body.h) * info.h), even(info.h - y));
    if (w < 16 || h < 16) return json(res, 400, { error: '裁切区域太小' });
    const rel = await archivePath(`${base}-裁切.mp4`, project);
    const args = ['-y', '-i', src, '-vf', `crop=${w}:${h}:${x}:${y}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    args.push(...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']), path.join(ARCHIVE, rel));
    const r = await runFfmpeg(args);
    if (r.code !== 0) return ffFail(res, '画面裁切', r.err);
    return json(res, 200, { video: { id: rel, kind: 'video', name: path.basename(rel), w, h } });
  }

  if (kind === 'keyframes') {
    const max = Math.max(3, Math.min(24, Number(body.max) || 12));
    const threshold = Math.max(0.1, Math.min(0.6, Number(body.threshold) || 0.3));
    // Pass 1: find cuts on a small copy of the picture (fast), always keeping the first frame.
    const det = await runFfmpeg(['-i', src, '-an', '-vf', `scale=320:-2,select='eq(n,0)+gt(scene,${threshold})',showinfo`, '-f', 'null', '-']);
    let times = [...det.err.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
    const d = info.duration || times.at(-1) || 0;
    if (times.length < 3 && d > 0) {
      const n = Math.min(max, Math.max(4, Math.round(d / 3)));
      times = Array.from({ length: n }, (_, i) => (d * (i + 0.5)) / n);
    }
    if (times.length > max) times = Array.from({ length: max }, (_, i) => times[Math.round((i * (times.length - 1)) / (max - 1))]);
    // Pass 2: full-resolution stills (capped at 1280 wide) at those moments, a little after each cut.
    const frames = [];
    for (const t of times) {
      const at = Math.min(t + 0.15, Math.max(0, d - 0.05));
      const rel = await archivePath(`${base}-关键帧-${fmtTime(t)}.jpg`, project);
      const r = await runFfmpeg(['-y', '-ss', at.toFixed(3), '-i', src, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', path.join(ARCHIVE, rel)]);
      if (r.code !== 0 || !fs.existsSync(path.join(ARCHIVE, rel))) continue;
      frames.push({ id: rel, kind: 'image', name: path.basename(rel), time: t, ...(await imageSize(path.join(ARCHIVE, rel))) });
    }
    if (!frames.length) return json(res, 500, { error: '没能从视频中截取画面' });
    return json(res, 200, { duration: d, frames });
  }
  return json(res, 404, { error: 'not found' });
}

// ---------------------------------------------------------------------------
// Voice-over and music through the local engines (see engines.mjs)
// ---------------------------------------------------------------------------

let engineMgr;
const localEngines = () => (engineMgr ??= createEngines({ env: CHILD_ENV }));

let studioMgr;
const studio = () => (studioMgr ??= createStudio({ env: CHILD_ENV, ffmpeg: FFMPEG, claude: CLAUDE, codex: CODEX, port: PORT }));
const engineStatus = () => {
  const st = localEngines().status();
  return { ...st, engines: { ...st.engines, studio: studio().status() } };
};

const TTS_VOICES = ['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'];

async function runVoice(job, { text, voice, instruct, lang, engine, name, refAudio }) {
  try {
    const rel = await archivePath(`${safeName(name || '配音').replace(/\.[^.]*$/, '')}.wav`, job.project);
    const out = path.join(ARCHIVE, rel);
    let seconds = 0;
    if (engine === 'system') {
      say(job, '系统语音合成中…');
      const aiff = `${out}.aiff`;
      await new Promise((ok, bad) => execFile('say', ['-v', voice || 'Tingting', '-o', aiff, text], (e) => (e ? bad(e) : ok())));
      const r = await runFfmpeg(['-y', '-i', aiff, '-ar', '48000', out]);
      await fsp.rm(aiff, { force: true });
      if (r.code !== 0) throw new Error('系统语音转换失败');
      seconds = (await probeVideo(out)).duration;
    } else if (refAudio) {
      // Clone: the first 15 s of the recording, mono 24 kHz, is the voice reference.
      const src = resolveArchived(String(refAudio));
      if (!src || !fs.existsSync(src)) throw new Error('找不到要克隆的录音');
      const ref = path.join(JOBS_DIR, `ref-${job.id}.wav`);
      await fsp.mkdir(JOBS_DIR, { recursive: true });
      const r = await runFfmpeg(['-y', '-i', src, '-t', '15', '-vn', '-ac', '1', '-ar', '24000', ref]);
      if (r.code !== 0) throw new Error('读取参考录音失败');
      say(job, '正在识别参考录音并克隆声音（首次使用会先下载约 4 GB 模型）…');
      try {
        seconds = await localEngines().tts({ text, lang, out, refAudio: ref });
      } finally {
        await fsp.rm(ref, { force: true });
      }
    } else {
      say(job, '正在加载配音模型…');
      seconds = await localEngines().tts({ text, voice: TTS_VOICES.includes(voice) ? voice : 'Serena', instruct, lang, out });
    }
    job.file = { id: rel, kind: 'audio', name: path.basename(rel), seconds };
    job.status = 'done';
  } catch (err) {
    fail(job, err.message);
  }
}

async function runMusic(job, { prompt, lyrics, duration, language, name }) {
  try {
    const rel = await archivePath(`${safeName(name || '音乐').replace(/\.[^.]*$/, '')}.wav`, job.project);
    await localEngines().music({ prompt, lyrics, duration, language, out: path.join(ARCHIVE, rel), onLog: (m) => say(job, m) });
    job.file = { id: rel, kind: 'audio', name: path.basename(rel) };
    job.status = 'done';
  } catch (err) {
    fail(job, err.message);
  }
}

// ---------------------------------------------------------------------------
// AI production (玩法 nodes): an agent builds and renders a HyperFrames film in
// <project>/制作/<time>-<title>/, which stays editable in HyperFrames Studio.
// ---------------------------------------------------------------------------

/** Copies the production's render into the project as a new video and fills in the job. */
async function collectFilm(job, ws, title) {
  const rel = await archivePath(`${safeName(title).slice(0, 40)}.mp4`, job.project);
  await fsp.copyFile(path.join(ws, 'renders', 'final.mp4'), path.join(ARCHIVE, rel));
  const info = await probeVideo(path.join(ARCHIVE, rel)).catch(() => ({}));
  job.file = { id: rel, kind: 'video', name: path.basename(rel), w: info.w, h: info.h, seconds: info.duration };
  job.text = (await fsp.readFile(path.join(ws, 'SUMMARY.md'), 'utf8').catch(() => '')).trim();
  job.studio = { workspace: path.relative(ARCHIVE, ws).split(path.sep).join('/') };
  job.status = 'done';
}

async function runStudio(job, body) {
  try {
    const title = String(body.title || '视频').slice(0, 60);
    let ws;
    if (body.workspace) {
      ws = resolveArchived(String(body.workspace));
      if (!ws || !fs.existsSync(path.join(ws, 'index.html'))) throw new Error('找不到上一版的制作文件夹');
    } else {
      const { day, time } = stamp();
      const base = job.project ? path.join(ARCHIVE, job.project) : path.join(ARCHIVE, day);
      ws = path.join(base, STUDIO_FOLDER, `${day}-${time}-${safeName(title).slice(0, 40)}`);
    }
    if (body.renderOnly) await studio().render(job, ws);
    else {
      const refs = (Array.isArray(body.refs) ? body.refs : [])
        .slice(0, 12)
        .map((r) => ({ abs: resolveArchived(String(r.id ?? '')), kind: kindOf(String(r.id ?? '')), label: String(r.label ?? '').slice(0, 80) }))
        .filter((r) => r.abs && fs.existsSync(r.abs) && r.kind !== 'file');
      await studio().make(job, {
        engine: body.engine === 'claude' ? 'claude' : 'chatgpt',
        ws,
        revise: !!body.workspace,
        brief: String(body.prompt ?? '').slice(0, 20000),
        title,
        ratio: String(body.ratio || '16:9'),
        duration: Number(body.duration) > 0 ? Math.max(3, Math.min(300, Number(body.duration))) : undefined,
        method: /^[\w-]+$/.test(String(body.method ?? '')) ? body.method : undefined,
        methodName: String(body.methodName ?? '').slice(0, 40),
        refs,
      });
    }
    if (job.status === 'cancelled') return;
    if (!studio().finalOk(ws)) throw new Error('渲染没有生成视频文件');
    await collectFilm(job, ws, title);
  } catch (err) {
    if (job.status !== 'cancelled') fail(job, err.message);
  }
}

// ---------------------------------------------------------------------------
// Local media tools (server/tools): native programs and models downloaded on first use.
// Each run reads one archived file and writes its results into the same project.
// ---------------------------------------------------------------------------

let toolsMgr;
const mediaTools = () => (toolsMgr ??= createTools({ ffmpeg: FFMPEG, env: CHILD_ENV }));

/** name → which inputs it takes and how it runs; each returns the files it made. */
const TOOL_RUNS = {
  upscale: {
    kinds: ['image'],
    async run({ src, base, body, tmp, log, out }) {
      const scale = Number(body.scale) === 2 ? 2 : 4;
      const file = await out(`${base}-放大${scale}倍.png`);
      await mediaTools().upscale({ input: src, out: file.abs, scale, anime: !!body.anime, tmp, onLog: log });
      return [file];
    },
  },
  link: {
    kinds: [],
    async run({ body, tmp, log, progress, out }) {
      const got = await mediaTools().fetchLink({ url: String(body.url ?? '').trim(), tmp, onLog: log, onProgress: progress });
      const file = await out(path.basename(got));
      await fsp.rename(got, file.abs).catch(async () => {
        await fsp.copyFile(got, file.abs);
      });
      return [file];
    },
  },
  denoise: {
    kinds: ['audio', 'video'],
    async run({ src, kind, base, tmp, log, out }) {
      const file = await out(`${base}-降噪${kind === 'video' ? '.mp4' : '.wav'}`);
      await mediaTools().denoise({ input: src, out: file.abs, isVideo: kind === 'video', tmp, onLog: log });
      return [file];
    },
  },
  separate: {
    kinds: ['audio', 'video'],
    async run({ src, base, tmp, log, out, progress }) {
      const vocals = await out(`${base}-人声.wav`, '人声');
      const backing = await out(`${base}-伴奏.wav`, '伴奏');
      await mediaTools().separate({ input: src, vocalsOut: vocals.abs, backingOut: backing.abs, tmp, onLog: log, onProgress: progress });
      return [vocals, backing];
    },
  },
  interpolate: {
    kinds: ['video'],
    async run({ src, base, tmp, log, out, progress }) {
      const file = await out(`${base}-补帧.mp4`);
      const r = await mediaTools().interpolate({ input: src, out: file.abs, tmp, onLog: log, onProgress: progress });
      file.label = `${r.fps} 帧`;
      return [file];
    },
  },
  vupscale: {
    kinds: ['video'],
    async run({ src, base, tmp, log, out, progress }) {
      const file = await out(`${base}-高清.mp4`);
      await mediaTools().upscaleVideo({ input: src, out: file.abs, tmp, onLog: log, onProgress: progress });
      return [file];
    },
  },
  trim: {
    kinds: ['video'],
    async run({ src, base, body, log, out }) {
      const file = await out(`${base}-剪辑.mp4`);
      await mediaTools().trim({ input: src, out: file.abs, ranges: body.ranges, speed: body.speed, onLog: log });
      return [file];
    },
  },
  scenes: {
    kinds: ['video'],
    async run({ src, base, body, tmp, log, project }) {
      const pattern = path.join(tmp, 'clip-%03d.mp4');
      const parts = await mediaTools().splitScenes({ input: src, outPattern: pattern, threshold: Math.max(0.1, Math.min(0.8, Number(body.threshold) || 0.3)), onLog: log });
      const files = [];
      for (const [i, part] of parts.entries()) {
        const made = path.join(tmp, `clip-${String(i).padStart(3, '0')}.mp4`);
        if (!fs.existsSync(made)) continue;
        const rel = await archivePath(`${base}-镜头${i + 1}.mp4`, project);
        await fsp.rename(made, path.join(ARCHIVE, rel));
        files.push({ rel, abs: path.join(ARCHIVE, rel), label: `镜头 ${i + 1}（${part.start.toFixed(1)}–${part.end.toFixed(1)} 秒）` });
      }
      return files;
    },
  },
};

async function runTool(job, name, body) {
  const tmp = path.join(JOBS_DIR, `tool-${job.id}`);
  try {
    const spec = TOOL_RUNS[name];
    // Tools with no input kinds (链接下载) don't work on an archived file.
    const src = spec.kinds.length ? resolveArchived(String(body.id ?? '')) : null;
    if (spec.kinds.length && (!src || !fs.existsSync(src))) throw new Error('找不到要处理的文件');
    const kind = src ? kindOf(src) : null;
    if (src && !spec.kinds.includes(kind)) throw new Error('这个工具不能处理这种文件');
    await fsp.mkdir(tmp, { recursive: true });
    const out = async (fileName, label) => {
      const rel = await archivePath(safeName(fileName), job.project);
      return { rel, abs: path.join(ARCHIVE, rel), label };
    };
    const made = await spec.run({
      src,
      kind,
      base: src ? baseOf(src).slice(0, 40) : '',
      body,
      tmp,
      project: job.project,
      out,
      log: (m) => say(job, m),
      progress: (p) => (job.progress = p),
    });
    if (job.status === 'cancelled') return;
    job.files = [];
    for (const f of made) {
      if (!fs.existsSync(f.abs)) throw new Error('处理完成但没有生成文件');
      const k = kindOf(f.abs);
      const info = k === 'image' ? await imageSize(f.abs) : k === 'video' ? await probeVideo(f.abs).then((v) => ({ w: v.w, h: v.h, seconds: v.duration })) : {};
      job.files.push({ id: f.rel, kind: k, name: path.basename(f.rel), label: f.label, ...info });
    }
    job.status = 'done';
  } catch (err) {
    if (job.status !== 'cancelled') fail(job, err.message);
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Frames → video: the app renders frames (depth maps, director animation), uploads them one
// by one as JPEGs, then asks for an H.264 MP4 in the project folder.
// ---------------------------------------------------------------------------

const frameSessions = new Map();

async function framesStart(body) {
  const id = randomUUID();
  const dir = path.join(JOBS_DIR, `frames-${id}`);
  await fsp.mkdir(dir, { recursive: true });
  const fps = Math.max(1, Math.min(60, Number(body.fps) || 24));
  // alpha: PNG frames with transparency → VP9 .webm (small, plays in the app) or, with
  // prores, ProRes 4444 .mov for editing software; otherwise JPEG frames → H.264 .mp4.
  const alpha = body.alpha === 'prores' ? 'prores' : body.alpha ? 'webm' : '';
  // Only a real video extension is replaced: titles can contain dots ("7.0 秒").
  const name = safeName(String(body.name || 'video')).replace(/\.(mp4|mov|webm|m4v)$/i, '') + ({ prores: '.mov', webm: '.webm' }[alpha] ?? '.mp4');
  // audioFrom: an archived file whose sound goes on the new video (e.g. the source clip).
  const audio = body.audioFrom ? resolveArchived(String(body.audioFrom)) : null;
  frameSessions.set(id, { dir, fps, name, alpha, audio: audio && fs.existsSync(audio) ? audio : null, start: Number(body.audioStart) || 0, project: projectDir(body.project) ? body.project : undefined, at: Date.now() });
  return id;
}

async function framesFinish(res, s) {
  const ext = s.alpha ? '.png' : '.jpg';
  const files = (await fsp.readdir(s.dir)).filter((f) => f.endsWith(ext)).sort();
  if (!files.length) return json(res, 400, { error: '没有收到任何画面' });
  const first = await imageSize(path.join(s.dir, files[0]));
  const rel = await archivePath(s.name, s.project);
  const audioCodec = { prores: 'pcm_s16le', webm: 'libopus' }[s.alpha] ?? 'aac';
  const sound = s.audio ? ['-ss', String(s.start), '-i', s.audio, '-map', '0:v', '-map', '1:a?', '-c:a', audioCodec, '-shortest'] : [];
  const codec = {
    prores: ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0'],
    webm: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4'],
  }[s.alpha] ?? ['-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  const r = await runFfmpeg(['-y', '-framerate', String(s.fps), '-i', path.join(s.dir, `%06d${ext}`), ...sound, ...codec, path.join(ARCHIVE, rel)]);
  await fsp.rm(s.dir, { recursive: true, force: true });
  if (r.code !== 0) return ffFail(res, '合成视频', r.err);
  return json(res, 200, { video: { id: rel, kind: 'video', name: path.basename(rel), ...(first ?? {}) } });
}

async function keepImage(job, src, ratio) {
  const rel = await archivePath(`${job.engine}${path.extname(src) || '.png'}`, job.project);
  const abs = path.join(ARCHIVE, rel);
  await fsp.copyFile(src, abs);
  // The image tool only makes a few sizes (no 21:9, say): centre-crop to the ratio asked for.
  const [rw, rh] = String(ratio ?? '').split(':').map(Number);
  const { w, h } = await imageSize(abs);
  if (FFMPEG && rw > 0 && rh > 0 && w && h && Math.abs(w / h / (rw / rh) - 1) > 0.03) {
    const cw = Math.min(w, Math.round((h * rw) / rh)) & ~1;
    const ch = Math.min(h, Math.round((w * rh) / rw)) & ~1;
    const tmp = `${abs}.crop${path.extname(abs)}`;
    const r = await runFfmpeg(['-y', '-i', abs, '-vf', `crop=${cw}:${ch}`, '-frames:v', '1', tmp]);
    if (r.code === 0) await fsp.rename(tmp, abs);
    else await fsp.rm(tmp, { force: true });
  }
  job.file = { id: rel, kind: 'image', name: path.basename(rel), ...(await imageSize(abs)) };
}

function runChatGPT(job, { kind, prompt, images, ratio }) {
  const dir = path.join(JOBS_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const last = path.join(dir, 'last.txt');
  const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--json', '-C', dir, '-o', last];
  for (const img of images) args.push('-i', img);
  let input;
  if (kind === 'image') {
    args.push('-s', 'workspace-write', '-c', 'model_reasoning_effort="low"');
    input = [
      '请使用图片生成工具生成一张图片。',
      `画面描述：${prompt}`,
      `画幅比例：${ratio || '1:1'}。`,
      images.length ? '已附上参考图，请参考其中的主体、人物和风格。' : '',
      '生成后把最终图片保存为当前目录下的 output.png。不要做其他任何事情。',
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    args.push('-s', 'read-only', '-c', 'model_reasoning_effort="medium"');
    input = `${prompt}\n\n（直接输出结果正文，不要调用任何工具，不要解释你在做什么。）`;
  }
  args.push('-');
  say(job, kind === 'image' ? '正在调用 ChatGPT 生成图片…' : '正在调用 ChatGPT…');

  const proc = spawn(CODEX, args, { cwd: dir, env: CHILD_ENV });
  job.proc = proc;
  proc.stdin.end(input);
  let buf = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const e = JSON.parse(line);
        const it = e.item ?? {};
        if (e.type === 'item.completed' && it.type === 'agent_message') say(job, it.text);
        if (e.type === 'item.started' && it.type === 'command_execution') say(job, 'ChatGPT 正在处理…');
        if (e.type === 'error' || e.type === 'turn.failed') say(job, e.message ?? e.error?.message);
      } catch {
        // non-JSON noise
      }
    }
  });
  proc.stderr.on('data', (c) => (stderr = (stderr + c).slice(-4000)));
  proc.on('close', async (code) => {
    job.proc = null;
    if (job.status === 'cancelled') return;
    try {
      if (code !== 0) return fail(job, `ChatGPT 运行失败（退出码 ${code}）${job.log.at(-1) ? `：${job.log.at(-1)}` : ''}`);
      if (kind === 'image') {
        const out = fs.existsSync(path.join(dir, 'output.png')) ? path.join(dir, 'output.png') : newestImage(dir, job.startedAt) ?? newestImage(CODEX_IMAGES, job.startedAt);
        if (!out) return fail(job, `ChatGPT 没有返回图片${job.log.at(-1) ? `：${job.log.at(-1)}` : ''}`);
        await keepImage(job, out, ratio);
      } else {
        job.text = (await fsp.readFile(last, 'utf8').catch(() => '')).trim();
        if (!job.text) return fail(job, 'ChatGPT 没有返回内容');
      }
      job.status = 'done';
    } catch (err) {
      fail(job, String(err?.message ?? err));
    } finally {
      fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
  proc.on('error', (err) => fail(job, `无法启动 ChatGPT：${err.message}`));
}

function runClaude(job, { prompt, images }) {
  const dir = path.join(JOBS_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  let input = prompt;
  if (images.length) {
    // Claude Code reads reference images itself with its Read tool.
    args.push('--tools', 'Read', '--allowedTools', 'Read', '--add-dir', ARCHIVE);
    input += `\n\n参考图片（请用 Read 工具查看）：\n${images.join('\n')}`;
  } else args.push('--tools', '');
  input += '\n\n（直接输出结果正文，不要解释你在做什么。）';
  say(job, '正在调用 Claude Code…');

  const proc = spawn(CLAUDE, args, { cwd: dir, env: CHILD_ENV });
  job.proc = proc;
  proc.stdin.end(input);
  let buf = '';
  let result = null;
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const e = JSON.parse(line);
        if (e.type === 'assistant') say(job, 'Claude 正在写作…');
        if (e.type === 'result') result = e;
      } catch {
        // ignore
      }
    }
  });
  proc.on('close', (code) => {
    job.proc = null;
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    if (job.status === 'cancelled') return;
    if (result && !result.is_error && result.result) {
      job.text = String(result.result).trim();
      job.status = 'done';
      return;
    }
    const msg = result?.result ?? `退出码 ${code}`;
    fail(job, /not logged in|login/i.test(msg) ? 'Claude Code 未登录：请在终端运行 claude，按提示登录后再试' : `Claude Code 运行失败：${msg}`);
  });
  proc.on('error', (err) => fail(job, `无法启动 Claude Code：${err.message}`));
}

// ---------------------------------------------------------------------------
// On-device vision models: not shipped with the app. The first request for one downloads it
// (HuggingFace, or its mirror where huggingface.co is unreachable) into the engines folder.
// ---------------------------------------------------------------------------

const VISION_DIR = path.join(ENGINES_DIR, 'vision');
const HF = ['https://huggingface.co', 'https://hf-mirror.com'];
const hfFiles = (repo, files) => Object.fromEntries(files.map((f) => [`${repo}/${f}`, HF.map((h) => `${h}/${repo}/resolve/main/${f}`)]));
const TRANSFORMERS_JSON = ['config.json', 'preprocessor_config.json'];
/** Every model file the app may ask for, with where to download it from (first that works). */
const MODEL_SOURCES = {
  // Depth Anything V2 small (Apache-2.0): depth video, background blur.
  ...hfFiles('onnx-community/depth-anything-v2-small', [...TRANSFORMERS_JSON, 'onnx/model_fp16.onnx']),
  // Whisper large-v3-turbo (MIT), 4-bit: speech to text.
  ...hfFiles('onnx-community/whisper-large-v3-turbo', [
    ...TRANSFORMERS_JSON,
    'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'vocab.json', 'merges.txt', 'normalizer.json',
    'onnx/encoder_model_q4f16.onnx', 'onnx/decoder_model_merged_q4f16.onnx',
  ]),
  // IS-Net general use (DIS, Apache-2.0; ONNX from rembg, MIT): cutout, decomposition, video background removal.
  'isnet/isnet-general-use.onnx': ['https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'],
  // LaMa (Apache-2.0): magic eraser, watermark removal.
  ...hfFiles('Carve/LaMa-ONNX', ['lama_fp32.onnx']),
  // PP-OCRv4 via RapidOCR (Apache-2.0): text recognition, plus its character list.
  ...hfFiles('SWHL/RapidOCR', ['PP-OCRv4/ch_PP-OCRv4_det_infer.onnx', 'PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx']),
  // Chinese-CLIP ViT-B/16 (MIT, OFA-Sys; ONNX by Xenova), 4-bit: 智能素材搜索 (pictures by description).
  ...hfFiles('Xenova/chinese-clip-vit-base-patch16', [...TRANSFORMERS_JSON, 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt', 'onnx/model_q4f16.onnx']),
  'ocr/ppocr_keys_v1.txt': ['https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.7/ppocr/utils/ppocr_keys_v1.txt', 'https://gitee.com/paddlepaddle/PaddleOCR/raw/release/2.7/ppocr/utils/ppocr_keys_v1.txt'],
};
// ---- 本地引擎 → 本地工具与模型: everything downloaded on first use, with its size on disk ------

const TOOLS_DIR = path.join(ENGINES_DIR, 'tools');
/** Each downloadable part: where it lives, what uses it, and roughly how big it is. */
const COMPONENTS = [
  { id: 'esrgan', kind: 'tool', name: 'Real-ESRGAN', use: '高清放大、视频高清', dirs: [path.join(TOOLS_DIR, 'esrgan')] },
  { id: 'rife', kind: 'tool', name: 'RIFE', use: '补帧变流畅', dirs: [path.join(TOOLS_DIR, 'rife')] },
  { id: 'deepfilter', kind: 'tool', name: 'DeepFilterNet', use: '降噪', dirs: [path.join(TOOLS_DIR, 'deepfilter')] },
  { id: 'demucs', kind: 'tool', size: '约 340 MB', name: 'HTDemucs + ONNX Runtime', use: '人声伴奏分离', dirs: [path.join(TOOLS_DIR, 'demucs'), path.join(TOOLS_DIR, 'ort')] },
  { id: 'ytdlp', kind: 'tool', name: 'yt-dlp', use: '粘贴链接下载视频', dirs: [path.join(TOOLS_DIR, 'ytdlp')] },
  { id: 'isnet', kind: 'model', size: '约 170 MB', name: 'IS-Net', use: '抠图、图片拆解、视频去背景、元素编辑点选', dirs: [path.join(VISION_DIR, 'isnet')] },
  { id: 'lama', kind: 'model', size: '约 200 MB', name: 'LaMa', use: '橡皮擦、去水印、去字幕、本地扩图和删字', dirs: [path.join(VISION_DIR, 'Carve')] },
  { id: 'ocr', kind: 'model', size: '约 15 MB', name: 'PP-OCRv4', use: '识别文字、改文字、去字幕', dirs: [path.join(VISION_DIR, 'SWHL'), path.join(VISION_DIR, 'ocr')] },
  { id: 'whisper', kind: 'model', size: '约 550 MB', name: 'Whisper large-v3-turbo', use: '转文字、声音克隆时识别录音', dirs: [path.join(VISION_DIR, 'onnx-community', 'whisper-large-v3-turbo')] },
  { id: 'depth', kind: 'model', size: '约 47 MB', name: 'Depth Anything V2', use: '深度提取', dirs: [path.join(VISION_DIR, 'onnx-community', 'depth-anything-v2-small')] },
  { id: 'clip', kind: 'model', size: '约 130 MB', name: 'Chinese-CLIP', use: '智能搜索（按画面找素材）', dirs: [path.join(VISION_DIR, 'Xenova', 'chinese-clip-vit-base-patch16')] },
];
/** Tools that have been removed from the app; their downloads are deleted at start-up. */
const OBSOLETE = [path.join(TOOLS_DIR, 'vtracer')];

async function sizeOnDisk(p) {
  const st = await fsp.lstat(p).catch(() => null);
  if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of await fsp.readdir(p)) total += await sizeOnDisk(path.join(p, e));
  return total;
}
async function componentStatus() {
  return Promise.all(
    COMPONENTS.map(async (c) => {
      const bytes = (await Promise.all(c.dirs.map(sizeOnDisk))).reduce((a, b) => a + b, 0);
      return { id: c.id, kind: c.kind, name: c.name, use: c.use, bytes, installed: bytes > 0, expected: c.size ?? TOOL_INFO[c.id]?.size };
    }),
  );
}

const visionDownloads = new Map();
/** Bytes received / expected per file being downloaded, for progress in the app. */
const modelProgress = new Map();

/**
 * Local path of a /models/<file> request, downloading it first if needed. Resolves null for a
 * file the app doesn't know, or one the model doesn't have (transformers.js probes optional files).
 */
async function visionModel(rel) {
  const urls = MODEL_SOURCES[rel];
  if (!urls) return null;
  const abs = path.join(VISION_DIR, rel);
  if (fs.existsSync(abs)) return abs;
  if (!visionDownloads.has(abs))
    visionDownloads.set(
      abs,
      (async () => {
        let lastErr;
        let missing = 0;
        for (const url of urls) {
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) });
            if (r.status === 404) {
              missing++;
              continue;
            }
            if (!r.ok || !r.body) throw new Error(`${r.status}`);
            await fsp.mkdir(path.dirname(abs), { recursive: true });
            const tmp = `${abs}.part`;
            const total = Number(r.headers.get('content-length')) || 0;
            const prog = { done: 0, total };
            modelProgress.set(rel, prog);
            const out = fs.createWriteStream(tmp);
            for await (const chunk of r.body) {
              prog.done += chunk.length;
              if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
            }
            await new Promise((ok, bad) => out.end((e) => (e ? bad(e) : ok())));
            await fsp.rename(tmp, abs);
            return abs;
          } catch (err) {
            lastErr = err;
          } finally {
            modelProgress.delete(rel);
          }
        }
        if (missing === urls.length) return null;
        throw new Error(`下载模型失败（${path.basename(rel)}）：${lastErr?.message}`);
      })().finally(() => visionDownloads.delete(abs)),
    );
  return visionDownloads.get(abs);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/**
 * Only this app may talk to the server: reject other Host names (DNS rebinding)
 * and cross-site requests, so no website can make the browser drive local AI apps.
 */
function allowed(req) {
  const hosts = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  if (!hosts.includes(req.headers.host ?? '')) return false;
  const origin = req.headers.origin;
  if (origin && !hosts.map((h) => `http://${h}`).includes(origin)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return false;
  return true;
}

async function sendFile(req, res, abs, cache) {
  let st;
  try {
    st = await fsp.stat(abs);
  } catch {
    return json(res, 404, { error: '文件不存在' });
  }
  if (!st.isFile()) return json(res, 404, { error: '文件不存在' });
  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(abs, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  fs.createReadStream(abs).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  try {
    if (!allowed(req)) return json(res, 403, { error: 'forbidden' });

    if (p === '/api/engines' && req.method === 'GET') return json(res, 200, await engines());

    if (p === '/api/projects' && req.method === 'GET') return json(res, 200, { projects: await listProjects() });
    if (p === '/api/projects' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 10_000)).toString('utf8') || '{}');
      return json(res, 200, { id: await createProject(body.name) });
    }
    const projMatch = /^\/api\/projects\/([^/]+)(\/rename)?$/.exec(p);
    if (projMatch) {
      let dir = projectDir(projMatch[1]);
      // Saving a project whose folder was moved or deleted (e.g. in Finder) while it was open:
      // make the folder again rather than lose the canvas.
      let recreated = false;
      if (!dir && req.method === 'PUT' && !projMatch[2] && projMatch[1] === safeName(projMatch[1]) && !RESERVED.has(projMatch[1]) && !fs.existsSync(path.join(ARCHIVE, projMatch[1]))) {
        await createProject(projMatch[1]);
        dir = projectDir(projMatch[1]);
        recreated = true;
      }
      if (!dir) return json(res, 404, { error: '项目文件夹不存在（可能被移动或删除了）' });
      const file = path.join(dir, PROJECT_FILE);
      if (projMatch[2] && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 10_000)).toString('utf8') || '{}');
        try {
          return json(res, 200, { id: await renameProject(projMatch[1], body.name) });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      if (req.method === 'GET') {
        await writeJson(APP_FILE, { ...(await readJson(APP_FILE, {})), lastProject: projMatch[1] });
        // Sorted before the canvas loads, so no open canvas still holds the old paths.
        const organized = await organizeProject(projMatch[1]).catch((err) => (console.error('整理项目文件夹失败：', err), 0));
        return json(res, 200, { ...(await readJson(file, {})), organized });
      }
      if (req.method === 'PUT') {
        const data = JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString('utf8'));
        const prev = await readJson(file, {});
        await writeJson(file, { version: 1, createdAt: prev.createdAt ?? Date.now(), updatedAt: Date.now(), canvas: { ...data.canvas, name: projMatch[1] } });
        return json(res, 200, { ok: true, recreated });
      }
    }
    if (p === '/api/library' && req.method === 'GET') return json(res, 200, await readJson(LIBRARY_FILE, {}));
    if (p === '/api/library' && req.method === 'PUT') {
      const body = (await readBody(req, 20 * 1024 * 1024)).toString('utf8');
      JSON.parse(body);
      await writeJson(LIBRARY_FILE, body);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/app' && req.method === 'GET') {
      const app = await readJson(APP_FILE, {});
      return json(res, 200, { ...app, lastProject: projectDir(app.lastProject) ? app.lastProject : null });
    }

    if (p === '/api/upload' && req.method === 'POST') {
      const name = safeName(url.searchParams.get('name') ?? 'file');
      const project = projectDir(url.searchParams.get('project')) ? url.searchParams.get('project') : undefined;
      if (url.searchParams.has('temp')) await fsp.mkdir(TEMP_DIR, { recursive: true });
      const shelf = url.searchParams.get('shelf') ? shelfDir(url.searchParams.get('shelf'), url.searchParams.get('folder') ?? '') : null;
      if (shelf) await fsp.mkdir(path.join(ARCHIVE, shelf), { recursive: true });
      const rel = url.searchParams.has('temp') ? `${TEMP_FOLDER}/${Date.now()}-${name}` : shelf ? freeName(shelf, name) : await archivePath(name, project);
      const abs = path.join(ARCHIVE, rel);
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(abs);
        req.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
        req.on('error', reject);
      });
      const st = await fsp.stat(abs);
      return json(res, 200, { id: rel, name: path.basename(rel), kind: kindOf(rel), size: st.size });
    }

    if (p === '/api/tools' && req.method === 'GET') return json(res, 200, mediaTools().status());
    if (p === '/api/components' && req.method === 'GET') return json(res, 200, await componentStatus());
    const compMatch = /^\/api\/components\/(\w+)$/.exec(p);
    if (compMatch && req.method === 'DELETE') {
      const c = COMPONENTS.find((x) => x.id === compMatch[1]);
      if (!c) return json(res, 404, { error: '没有这个组件' });
      for (const d of c.dirs) await fsp.rm(d, { recursive: true, force: true });
      return json(res, 200, await componentStatus());
    }
    const runMatch = /^\/api\/tools\/(\w+)$/.exec(p);
    if (runMatch && req.method === 'POST' && TOOL_RUNS[runMatch[1]]) {
      if (!FFMPEG) return json(res, 500, { error: '没有找到 FFmpeg，媒体工具不可用' });
      const body = JSON.parse((await readBody(req, 100_000)).toString('utf8') || '{}');
      const job = newJob('local', runMatch[1]);
      if (projectDir(body.project)) job.project = body.project;
      runTool(job, runMatch[1], body);
      return json(res, 200, { id: job.id });
    }

    const toolMatch = /^\/api\/video\/(info|separate|crop|keyframes)$/.exec(p);
    if (toolMatch && req.method === 'POST') {
      if (!FFMPEG) return json(res, 500, { error: '没有找到 FFmpeg，视频工具不可用' });
      const body = JSON.parse((await readBody(req, 10_000)).toString('utf8') || '{}');
      return videoTool(res, toolMatch[1], body);
    }

    if (p === '/api/local-engines' && req.method === 'GET') return json(res, 200, engineStatus());
    const engMatch = /^\/api\/local-engines\/(tts|music|studio)(\/install)?$/.exec(p);
    if (engMatch && engMatch[2] && req.method === 'POST') {
      engMatch[1] === 'studio' ? studio().install() : localEngines().install(engMatch[1]);
      return json(res, 200, engineStatus());
    }
    if (engMatch && !engMatch[2] && req.method === 'DELETE') {
      await (engMatch[1] === 'studio' ? studio().uninstall() : localEngines().uninstall(engMatch[1]));
      return json(res, 200, engineStatus());
    }

    if (p === '/api/studio/make' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
      if (!body.renderOnly && !String(body.prompt ?? '').trim()) return json(res, 400, { error: '请先写下想做的视频内容' });
      if (!studio().installed()) return json(res, 400, { error: '还没有安装视频制作引擎：点右上角「本地引擎」安装 HyperFrames' });
      if (!body.renderOnly) {
        const st = await engines();
        const e = body.engine === 'claude' ? st.claude : st.chatgpt;
        const name = body.engine === 'claude' ? 'Claude Code' : 'ChatGPT';
        if (!e.available) return json(res, 400, { error: `没有找到 ${name}` });
        if (!e.loggedIn) {
          engineCache.at = 0;
          return json(res, 400, { error: `${name} 未登录，请先登录后再试` });
        }
      }
      const job = newJob(body.engine === 'claude' ? 'claude' : 'chatgpt', 'video');
      if (projectDir(body.project)) job.project = body.project;
      runStudio(job, body);
      return json(res, 200, { id: job.id });
    }
    if (p === '/api/studio/open' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 10_000)).toString('utf8') || '{}');
      const ws = resolveArchived(String(body.workspace ?? ''));
      if (!ws || !fs.existsSync(path.join(ws, 'index.html'))) return json(res, 404, { error: '找不到制作文件夹' });
      try {
        return json(res, 200, { url: await studio().preview(ws) });
      } catch (err) {
        return json(res, 500, { error: `无法打开 Studio：${err.message}` });
      }
    }
    if ((p === '/api/tts' || p === '/api/music') && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
      const text = String(body.text ?? body.prompt ?? '').slice(0, 20000);
      if (!text.trim()) return json(res, 400, { error: p === '/api/tts' ? '没有要配音的文字' : '没有音乐描述' });
      const job = newJob(p === '/api/tts' ? body.engine || 'qwen3' : 'ace-step', 'audio');
      if (projectDir(body.project)) job.project = body.project;
      if (p === '/api/tts') runVoice(job, { text, voice: body.voice, instruct: body.instruct, lang: body.lang, engine: body.engine, name: body.name, refAudio: body.refAudio });
      else runMusic(job, { prompt: text, lyrics: String(body.lyrics ?? '').slice(0, 8000), duration: body.duration, language: body.language, name: body.name });
      return json(res, 200, { id: job.id });
    }

    if (p === '/api/frames' && req.method === 'POST') {
      if (!FFMPEG) return json(res, 500, { error: '没有找到 FFmpeg，无法合成视频' });
      const body = JSON.parse((await readBody(req, 10_000)).toString('utf8') || '{}');
      return json(res, 200, { id: await framesStart(body) });
    }
    const frameMatch = /^\/api\/frames\/([\w-]+)(?:\/(\d{1,6})|\/(finish))?$/.exec(p);
    if (frameMatch) {
      const s = frameSessions.get(frameMatch[1]);
      if (!s) return json(res, 404, { error: '合成任务不存在' });
      if (frameMatch[2] && req.method === 'PUT') {
        const buf = await readBody(req, 30 * 1024 * 1024);
        await fsp.writeFile(path.join(s.dir, `${frameMatch[2].padStart(6, '0')}${s.alpha ? '.png' : '.jpg'}`), buf);
        return json(res, 200, { ok: true });
      }
      if (frameMatch[3] && req.method === 'POST') {
        frameSessions.delete(frameMatch[1]);
        return framesFinish(res, s);
      }
      if (!frameMatch[2] && !frameMatch[3] && req.method === 'DELETE') {
        frameSessions.delete(frameMatch[1]);
        await fsp.rm(s.dir, { recursive: true, force: true });
        return json(res, 200, { ok: true });
      }
    }

    const shelfMatch = /^\/api\/shelf\/(brand|fav)(?:\/(folder|add|move|remove))?$/.exec(p);
    if (shelfMatch) {
      const kind = shelfMatch[1];
      if (!shelfMatch[2] && req.method === 'GET') return json(res, 200, await listShelf(kind));
      const body = JSON.parse((await readBody(req, 10_000)).toString('utf8') || '{}');
      const dir = shelfDir(kind, body.folder);
      if (!dir) return json(res, 400, { error: '文件夹名称无效' });
      if (shelfMatch[2] === 'folder') {
        await fsp.mkdir(path.join(ARCHIVE, dir), { recursive: true });
        return json(res, 200, await listShelf(kind));
      }
      const src = resolveArchived(String(body.id ?? ''));
      if (!src || !fs.existsSync(src)) return json(res, 404, { error: '找不到这个文件' });
      if (shelfMatch[2] === 'remove') {
        // To the Trash, so a mistake can be undone in Finder.
        const trash = path.join(HOME, '.Trash');
        await fsp.rename(src, path.join(trash, `${Date.now()}-${path.basename(src)}`)).catch(() => fsp.rm(src));
        return json(res, 200, await listShelf(kind));
      }
      await fsp.mkdir(path.join(ARCHIVE, dir), { recursive: true });
      // Without the archive's date/time prefix: library files keep plain names.
      const rel = freeName(dir, path.basename(src).replace(/^(\d{4}-)?\d{6}-/, ''));
      if (shelfMatch[2] === 'move') await fsp.rename(src, path.join(ARCHIVE, rel));
      else await fsp.copyFile(src, path.join(ARCHIVE, rel));
      return json(res, 200, { ...(await listShelf(kind)), id: rel });
    }

    if (p === '/api/archive' && req.method === 'GET') {
      const project = url.searchParams.get('project');
      const dir = project ? projectDir(project) : ARCHIVE;
      if (!dir) return json(res, 404, { error: '项目文件夹不存在（可能被移动或删除了）' });
      return json(res, 200, { dir, files: await listArchive(project ?? undefined) });
    }

    if (p === '/api/reveal' && req.method === 'POST') {
      const { id } = JSON.parse((await readBody(req, 10_000)).toString('utf8') || '{}');
      const abs = id ? resolveArchived(id) : ARCHIVE;
      if (!abs) return json(res, 400, { error: '无效路径' });
      await fsp.mkdir(ARCHIVE, { recursive: true });
      execFile('open', id ? ['-R', abs] : [abs]);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/generate' && req.method === 'POST') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: '需要 JSON' });
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
      const engine = body.engine;
      const kind = body.kind === 'image' ? 'image' : 'text';
      const prompt = String(body.prompt ?? '').slice(0, 20000);
      if (!prompt.trim()) return json(res, 400, { error: '提示词为空' });
      const images = (Array.isArray(body.images) ? body.images : []).map((id) => resolveArchived(String(id))).filter(Boolean).slice(0, 8);
      const st = await engines();
      if (engine === 'chatgpt') {
        if (!st.chatgpt.available) return json(res, 400, { error: '没有找到 ChatGPT 应用（需要 ChatGPT 桌面版自带的 Codex 命令行）' });
        if (!st.chatgpt.loggedIn) return json(res, 400, { error: 'ChatGPT 未登录：请打开 ChatGPT 应用登录后再试' });
        const job = newJob(engine, kind);
        if (projectDir(body.project)) job.project = body.project;
        runChatGPT(job, { kind, prompt, images, ratio: body.ratio });
        return json(res, 200, { id: job.id });
      }
      if (engine === 'claude') {
        if (kind === 'image') return json(res, 400, { error: 'Claude 不能生成图片，请为图片节点选择 ChatGPT' });
        if (!st.claude.available) return json(res, 400, { error: '没有找到 Claude Code 命令行' });
        if (!st.claude.loggedIn) {
          engineCache.at = 0; // re-check next time; the user may have just logged in
          return json(res, 400, { error: 'Claude Code 未登录：请在终端运行 claude，按提示登录后再试' });
        }
        const job = newJob(engine, kind);
        runClaude(job, { prompt, images });
        return json(res, 200, { id: job.id });
      }
      return json(res, 400, { error: `未知的引擎：${engine}` });
    }

    const jobMatch = /^\/api\/jobs\/([\w-]+)$/.exec(p);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return json(res, 404, { error: '任务不存在' });
      if (req.method === 'DELETE') {
        job.status = 'cancelled';
        job.proc?.kill('SIGTERM');
        return json(res, 200, { ok: true });
      }
      const { proc: _proc, ...pub } = job;
      return json(res, 200, pub);
    }

    if (p.startsWith('/files/') && req.method === 'GET') {
      const abs = resolveArchived(p.slice('/files/'.length));
      if (!abs) return json(res, 400, { error: '无效路径' });
      if (url.searchParams.has('play') && kindOf(abs) === 'video' && fs.existsSync(abs)) return sendFile(req, res, await playableFile(abs), 'private, max-age=31536000, immutable');
      return sendFile(req, res, abs, 'private, max-age=31536000, immutable');
    }

    if (p === '/api/models/progress' && req.method === 'GET') return json(res, 200, Object.fromEntries(modelProgress));
    if (p.startsWith('/models/') && req.method === 'GET' && !fs.existsSync(path.join(DIST, p))) {
      try {
        const abs = await visionModel(p.slice('/models/'.length));
        return abs ? sendFile(req, res, abs, 'no-cache') : json(res, 404, { error: 'not found' });
      } catch (err) {
        return json(res, 502, { error: err.message });
      }
    }

    if (req.method === 'GET' && !p.startsWith('/api/')) {
      // The built front end; unknown paths fall back to index.html.
      const abs = path.resolve(DIST, `.${p}`);
      const inDist = abs.startsWith(DIST + path.sep);
      if (inDist && fs.existsSync(abs) && fs.statSync(abs).isFile()) return sendFile(req, res, abs, p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      if (fs.existsSync(path.join(DIST, 'index.html'))) return sendFile(req, res, path.join(DIST, 'index.html'), 'no-cache');
      return json(res, 503, { error: '前端尚未构建，请先运行 npm run build' });
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: String(err?.message ?? err) });
  }
});

/** Start listening; resolves once the server is up. Used by the Mac app and by `npm start`. */
export async function startServer() {
  fs.mkdirSync(META_DIR, { recursive: true });
  for (const d of OBSOLETE) fs.rmSync(d, { recursive: true, force: true });
  for (const f of fs.existsSync(TEMP_DIR) ? fs.readdirSync(TEMP_DIR) : []) {
    const abs = path.join(TEMP_DIR, f);
    if (Date.now() - fs.statSync(abs).mtimeMs > 86_400_000) fs.rmSync(abs, { force: true });
  }
  await migrateLegacyState().catch((err) => console.error('迁移旧存档失败：', err));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      console.log(`WCcanvastv 已启动：http://localhost:${PORT}`);
      console.log(`素材留档目录：${ARCHIVE}`);
      console.log(`ChatGPT：${CODEX ?? '未找到'}`);
      console.log(`Claude Code：${CLAUDE ?? '未找到'}`);
      console.log(`FFmpeg：${FFMPEG ?? '未找到'}`);
      resolve({ port: PORT, archive: ARCHIVE });
    });
  });
}

/** Stop the server and any AI runs still in progress. */
export function stopServer() {
  for (const job of jobs.values()) job.proc?.kill('SIGTERM');
  engineMgr?.stopAll();
  studioMgr?.stopPreviews();
  server.close();
}

export const SERVER_PORT = PORT;

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((err) => {
    console.error(err.code === 'EADDRINUSE' ? `端口 ${PORT} 已被占用，WCcanvastv 可能已经在运行` : err);
    process.exit(1);
  });
}
