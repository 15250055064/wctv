// Local AI engines installed and run by WCcanvastv itself, outside the app bundle:
//   tts   – Qwen3-TTS (Apache-2.0) through mlx-audio (MIT) on Apple silicon
//   music – ACE-Step 1.5 (MIT), served by its own local API
// Everything lives in ~/Library/Application Support/WCcanvastv/engines: uv, Python, the
// environments and the model weights. Installing is an explicit user action in the app.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENGINES_DIR = path.resolve(process.env.WCCANVASTV_ENGINES || path.join(os.homedir(), 'Library', 'Application Support', 'WCcanvastv', 'engines'));
const BIN = path.join(ENGINES_DIR, 'bin');
const UV = path.join(BIN, 'uv');
const HF_HOME = path.join(ENGINES_DIR, 'hf');
const TTS_DIR = path.join(ENGINES_DIR, 'tts');
const TTS_PY = path.join(TTS_DIR, '.venv', 'bin', 'python');
const MUSIC_DIR = path.join(ENGINES_DIR, 'music');
const MUSIC_READY = path.join(MUSIC_DIR, '.wccanvastv-ready');
const TTS_WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'engines', 'tts_worker.py');
export const TTS_MODEL = 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit';
const MUSIC_PORT = 8001;
const UV_URL = 'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz';
const MUSIC_ZIP = 'https://github.com/ace-step/ACE-Step-1.5/archive/refs/heads/main.zip';

export const ENGINE_INFO = {
  tts: { name: 'Qwen3-TTS 配音', size: '约 4 GB', license: 'Apache-2.0（模型）· MIT（mlx-audio）' },
  music: { name: 'ACE-Step 1.5 音乐', size: '约 15 GB', license: 'MIT' },
};

export function createEngines({ env }) {
  const state = { tts: { phase: 'idle', log: [] }, music: { phase: 'idle', log: [] } };
  let hfEndpoint = null;

  const baseEnv = () => ({
    ...env,
    PATH: [BIN, env.PATH].filter(Boolean).join(':'),
    UV_CACHE_DIR: path.join(ENGINES_DIR, 'cache'),
    UV_PYTHON_INSTALL_DIR: path.join(ENGINES_DIR, 'python'),
    HF_HOME,
    HF_HUB_DISABLE_TELEMETRY: '1',
    TOKENIZERS_PARALLELISM: 'false',
    ...(hfEndpoint ? { HF_ENDPOINT: hfEndpoint } : {}),
  });

  const log = (name, line) => {
    const s = state[name];
    for (const l of String(line).split(/[\r\n]+/)) {
      const t = l.trim();
      if (t) s.log.push(t.slice(0, 240));
    }
    if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
  };

  /** Runs a command, streaming its output into the engine's log. */
  function run(name, cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      log(name, `$ ${path.basename(cmd)} ${args.join(' ')}`);
      const p = spawn(cmd, args, { cwd: opts.cwd ?? ENGINES_DIR, env: { ...baseEnv(), ...(opts.env ?? {}) } });
      state[name].proc = p;
      p.stdout.on('data', (d) => log(name, d));
      p.stderr.on('data', (d) => log(name, d));
      p.on('error', reject);
      p.on('close', (code) => {
        state[name].proc = null;
        code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} 退出码 ${code}`));
      });
    });
  }

  async function reachable(url) {
    try {
      const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
      return r.status < 500;
    } catch {
      return false;
    }
  }

  /** Mainland networks often can't reach huggingface.co; fall back to its public mirror. */
  async function pickHfEndpoint(name) {
    if (await reachable('https://huggingface.co/api/models/' + TTS_MODEL)) return;
    hfEndpoint = 'https://hf-mirror.com';
    log(name, '无法连接 huggingface.co，改用镜像 hf-mirror.com 下载模型');
  }

  async function ensureUv(name) {
    if (fs.existsSync(UV)) return;
    await fsp.mkdir(BIN, { recursive: true });
    const tgz = path.join(ENGINES_DIR, 'uv.tar.gz');
    await run(name, 'curl', ['-fsSL', '-o', tgz, UV_URL]);
    await run(name, 'tar', ['-xzf', tgz, '-C', BIN, '--strip-components', '1']);
    await fsp.rm(tgz, { force: true });
  }

  const ttsModelReady = () => {
    const dir = path.join(HF_HOME, 'hub', `models--${TTS_MODEL.replace('/', '--')}`, 'snapshots');
    try {
      return fs.readdirSync(dir).some((s) => fs.existsSync(path.join(dir, s, 'config.json')));
    } catch {
      return false;
    }
  };
  const installed = {
    tts: () => fs.existsSync(TTS_PY) && ttsModelReady(),
    music: () => fs.existsSync(MUSIC_READY),
  };

  const steps = {
    async tts() {
      await ensureUv('tts');
      await pickHfEndpoint('tts');
      if (!fs.existsSync(TTS_PY)) await run('tts', UV, ['venv', '--python', '3.12', path.join(TTS_DIR, '.venv')]);
      await run('tts', UV, ['pip', 'install', '--python', TTS_PY, 'mlx-audio']);
      log('tts', `下载语音模型 ${TTS_MODEL}（约 3 GB）…`);
      await run('tts', TTS_PY, ['-c', `from huggingface_hub import snapshot_download; snapshot_download(${JSON.stringify(TTS_MODEL)})`]);
    },
    async music() {
      await ensureUv('music');
      if (!fs.existsSync(path.join(MUSIC_DIR, 'pyproject.toml'))) {
        const zip = path.join(ENGINES_DIR, 'ace-step.zip');
        await run('music', 'curl', ['-fsSL', '-o', zip, MUSIC_ZIP]);
        await run('music', 'unzip', ['-q', '-o', zip, '-d', ENGINES_DIR]);
        await fsp.rm(MUSIC_DIR, { recursive: true, force: true });
        await fsp.rename(path.join(ENGINES_DIR, 'ACE-Step-1.5-main'), MUSIC_DIR);
        await fsp.rm(zip, { force: true });
      }
      await run('music', UV, ['sync'], { cwd: MUSIC_DIR });
      log('music', '下载音乐模型（约 10 GB，自动选择 HuggingFace 或 ModelScope）…');
      await run('music', UV, ['run', 'acestep-download'], { cwd: MUSIC_DIR });
      await fsp.writeFile(MUSIC_READY, new Date().toISOString());
    },
  };

  async function install(name) {
    const s = state[name];
    if (!s || s.phase === 'installing') return;
    s.phase = 'installing';
    s.error = undefined;
    s.log = [];
    try {
      await fsp.mkdir(ENGINES_DIR, { recursive: true });
      await steps[name]();
      s.phase = 'idle';
      log(name, '安装完成');
    } catch (err) {
      s.phase = 'error';
      s.error = err.message;
      log(name, `安装失败：${err.message}`);
    }
  }

  async function uninstall(name) {
    stop(name);
    if (name === 'tts') {
      await fsp.rm(TTS_DIR, { recursive: true, force: true });
      await fsp.rm(path.join(HF_HOME, 'hub', `models--${TTS_MODEL.replace('/', '--')}`), { recursive: true, force: true });
    } else await fsp.rm(MUSIC_DIR, { recursive: true, force: true });
    state[name] = { phase: 'idle', log: [] };
  }

  function status() {
    const out = {};
    for (const name of ['tts', 'music']) {
      const s = state[name];
      out[name] = {
        ...ENGINE_INFO[name],
        installed: installed[name](),
        installing: s.phase === 'installing',
        error: s.error,
        running: name === 'tts' ? !!ttsWorker : !!musicServer,
        log: s.log.slice(-60),
      };
    }
    return { dir: ENGINES_DIR, engines: out };
  }

  // ---- Qwen3-TTS: one persistent worker that keeps the model loaded -------------------
  let ttsWorker = null;
  let ttsSeq = 0;
  const ttsPending = new Map();

  function startTts() {
    if (ttsWorker) return ttsWorker;
    const p = spawn(TTS_PY, [TTS_WORKER, TTS_MODEL], { env: baseEnv() });
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const job = ttsPending.get(msg.id);
        if (!job) continue;
        ttsPending.delete(msg.id);
        msg.ok ? job.resolve(msg.seconds) : job.reject(new Error(msg.error || '配音失败'));
      }
    });
    p.stderr.on('data', (d) => log('tts', d));
    p.on('close', () => {
      ttsWorker = null;
      for (const j of ttsPending.values()) j.reject(new Error('配音引擎意外退出'));
      ttsPending.clear();
    });
    ttsWorker = p;
    return p;
  }

  /** Synthesizes `text` into a WAV file at `out`; resolves with its length in seconds. */
  function tts({ text, voice, instruct, lang, out }) {
    if (!installed.tts()) return Promise.reject(new Error('还没有安装 Qwen3-TTS 配音引擎'));
    const p = startTts();
    const id = `t${++ttsSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ttsPending.delete(id);
        reject(new Error('配音超时'));
      }, 10 * 60_000);
      ttsPending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      p.stdin.write(JSON.stringify({ id, text, voice, instruct, lang, out }) + '\n');
    });
  }

  // ---- ACE-Step: its API server, started on first use ---------------------------------
  let musicServer = null;
  let musicStarting = null;
  const MUSIC_URL = `http://127.0.0.1:${MUSIC_PORT}`;

  async function musicHealthy() {
    try {
      const r = await fetch(`${MUSIC_URL}/health`, { signal: AbortSignal.timeout(3000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  function startMusic(onLog) {
    if (musicStarting) return musicStarting;
    musicStarting = (async () => {
      if (await musicHealthy()) return;
      const p = spawn(UV, ['run', 'acestep-api', '--host', '127.0.0.1', '--port', String(MUSIC_PORT)], {
        cwd: MUSIC_DIR,
        // Pin the 1.7B lyrics model that ships with the main download; 'auto' would fetch the
        // 4B one (8 GB more) on Macs with lots of memory.
        env: { ...baseEnv(), ACESTEP_LM_BACKEND: 'mlx', ACESTEP_INIT_LLM: 'auto', ACESTEP_LM_MODEL_PATH: 'acestep-5Hz-lm-1.7B' },
      });
      musicServer = p;
      p.stdout.on('data', (d) => log('music', d));
      p.stderr.on('data', (d) => log('music', d));
      p.on('close', () => {
        musicServer = null;
        musicStarting = null;
      });
      const until = Date.now() + 10 * 60_000;
      while (Date.now() < until) {
        if (!musicServer) throw new Error(`音乐引擎启动失败：${state.music.log.slice(-3).join(' ')}`);
        if (await musicHealthy()) return;
        onLog?.('正在启动音乐引擎（首次需要加载模型）…');
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error('音乐引擎启动超时');
    })();
    musicStarting.catch(() => (musicStarting = null));
    return musicStarting;
  }

  async function musicApi(p, body) {
    const r = await fetch(`${MUSIC_URL}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j.code && j.code !== 200)) throw new Error(j.error || j.detail || `音乐引擎返回 ${r.status}`);
    return j.data;
  }

  /** Generates a song; resolves with the downloaded file path. */
  async function music({ prompt, lyrics, duration, language, out, onLog }) {
    if (!installed.music()) throw new Error('还没有安装 ACE-Step 音乐引擎');
    await startMusic(onLog);
    onLog?.('音乐引擎正在作曲…');
    const task = await musicApi('/release_task', {
      prompt,
      lyrics: lyrics || '',
      audio_duration: Math.max(10, Math.min(600, Number(duration) || 30)),
      vocal_language: language || 'zh',
      thinking: true,
      batch_size: 1,
      audio_format: 'wav',
    });
    const id = task.task_id;
    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await musicApi('/query_result', { task_id_list: [id] });
      const item = (Array.isArray(res) ? res : [res]).find((x) => x && (x.task_id === id || !x.task_id));
      if (!item) continue;
      if (item.status === 2) throw new Error(`作曲失败：${String(item.result ?? item.error ?? '').slice(0, 200)}`);
      if (item.status !== 1) continue;
      const parsed = typeof item.result === 'string' ? JSON.parse(item.result) : item.result;
      const first = (Array.isArray(parsed) ? parsed : [parsed]).find((x) => x?.file);
      if (!first) throw new Error('音乐引擎没有返回文件');
      const r = await fetch(`${MUSIC_URL}${first.file}`);
      if (!r.ok) throw new Error(`下载音乐失败（${r.status}）`);
      await fsp.writeFile(out, Buffer.from(await r.arrayBuffer()));
      return out;
    }
    throw new Error('作曲超时');
  }

  function stop(name) {
    if (name !== 'music' && ttsWorker) ttsWorker.kill('SIGTERM');
    if (name !== 'tts' && musicServer) musicServer.kill('SIGTERM');
    state[name ?? 'tts']?.proc?.kill?.('SIGTERM');
  }

  return { status, install, uninstall, tts, music, stopAll: () => (stop(), state.tts.proc?.kill('SIGTERM'), state.music.proc?.kill('SIGTERM')) };
}
