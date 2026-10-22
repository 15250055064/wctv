// AI production studio: a 玩法 (video method) node hands its brief to Claude Code or ChatGPT
// (Codex), which builds the film as a HyperFrames composition (HTML + GSAP, MIT) in its own
// folder inside the project, renders it with headless Chrome + FFmpeg, and reports back.
// The folder stays editable: HyperFrames Studio opens it, and re-rendering picks up the edits.
//
// The toolchain lives in ~/Library/Application Support/WCcanvastv/engines next to the voice
// and music engines: node/ (Node 22, which HyperFrames needs) and studio/ (hyperframes, gsap,
// a static ffprobe and the blank project template). Installing it is a user action.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES_DIR } from './engines.mjs';

const NODE_VERSION = 'v22.23.4';
const NODE_DIR = path.join(ENGINES_DIR, 'node');
const NODE_BIN = path.join(NODE_DIR, 'bin');
const STUDIO_DIR = path.join(ENGINES_DIR, 'studio');
const STUDIO_BIN = path.join(STUDIO_DIR, 'bin');
const TEMPLATE = path.join(STUDIO_DIR, 'template');
const MODULES = path.join(STUDIO_DIR, 'node_modules');
const HF = path.join(MODULES, '.bin', 'hyperframes');
const READY = path.join(STUDIO_DIR, '.wccanvastv-ready');
const METHODS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'studio', 'methods');
const PACKAGES = { hyperframes: '0.8.185', gsap: '3.14.2', '@ffprobe-installer/darwin-arm64': '5.0.1' };
const NODE_MIRRORS = ['https://nodejs.org/dist', 'https://npmmirror.com/mirrors/node'];
const NPM_REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com'];
/** Agent runs give up after this long. */
const AGENT_TIMEOUT = 45 * 60_000;

export const STUDIO_INFO = { name: 'HyperFrames 视频制作', size: '约 500 MB', license: 'Apache-2.0（HyperFrames）· GSAP 免费许可' };

const SIZES = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:3': [1440, 1080],
  '3:4': [1080, 1440],
  '21:9': [2520, 1080],
};

export function createStudio({ env, ffmpeg, claude, codex, port }) {
  const state = { phase: 'idle', log: [], error: undefined };
  const previews = new Map(); // workspace → { url }

  const toolEnv = () => ({
    ...env,
    PATH: [STUDIO_BIN, NODE_BIN, ffmpeg ? path.dirname(ffmpeg) : null, env.PATH].filter(Boolean).join(':'),
    HYPERFRAMES_SKIP_SKILLS: '1',
    HYPERFRAMES_NO_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    NO_COLOR: '1',
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  });

  const log = (line) => {
    for (const l of String(line).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/[\r\n]+/)) {
      const t = l.trim();
      if (t) state.log.push(t.slice(0, 240));
    }
    if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
  };

  function run(cmd, args, { cwd = STUDIO_DIR, onLine = log, timeout = 30 * 60_000 } = {}) {
    return new Promise((resolve, reject) => {
      onLine(`$ ${path.basename(cmd)} ${args.join(' ')}`);
      const p = spawn(cmd, args, { cwd, env: toolEnv() });
      let out = '';
      const timer = setTimeout(() => p.kill('SIGTERM'), timeout);
      const take = (d) => {
        out = (out + d).slice(-20000);
        onLine(d);
      };
      p.stdout.on('data', take);
      p.stderr.on('data', take);
      p.on('error', (e) => (clearTimeout(timer), reject(e)));
      p.on('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} 退出码 ${code}：${out.trim().split('\n').slice(-3).join(' ').slice(0, 300)}`));
      });
    });
  }

  const installed = () => fs.existsSync(READY) && fs.existsSync(HF) && fs.existsSync(path.join(NODE_BIN, 'node'));

  async function reachable(url) {
    try {
      const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
      return r.status < 500;
    } catch {
      return false;
    }
  }

  async function ensureNode() {
    if (fs.existsSync(path.join(NODE_BIN, 'node'))) return;
    const name = `node-${NODE_VERSION}-darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
    let base = NODE_MIRRORS[0];
    if (!(await reachable(`${base}/${NODE_VERSION}/${name}.tar.gz`))) {
      base = NODE_MIRRORS[1];
      log('无法连接 nodejs.org，改用国内镜像 npmmirror.com');
    }
    const tgz = path.join(ENGINES_DIR, 'node.tar.gz');
    await run('curl', ['-fsSL', '-o', tgz, `${base}/${NODE_VERSION}/${name}.tar.gz`], { cwd: ENGINES_DIR });
    await fsp.rm(NODE_DIR, { recursive: true, force: true });
    await fsp.mkdir(NODE_DIR, { recursive: true });
    await run('tar', ['-xzf', tgz, '-C', NODE_DIR, '--strip-components', '1'], { cwd: ENGINES_DIR });
    await fsp.rm(tgz, { force: true });
  }

  async function install() {
    if (state.phase === 'installing') return;
    state.phase = 'installing';
    state.error = undefined;
    state.log = [];
    try {
      await fsp.mkdir(STUDIO_DIR, { recursive: true });
      await ensureNode();
      const pkg = { name: 'wccanvastv-studio', private: true, dependencies: PACKAGES };
      await fsp.writeFile(path.join(STUDIO_DIR, 'package.json'), JSON.stringify(pkg, null, 2));
      const registry = (await reachable(`${NPM_REGISTRIES[0]}/hyperframes`)) ? NPM_REGISTRIES[0] : NPM_REGISTRIES[1];
      if (registry !== NPM_REGISTRIES[0]) log('无法连接 npm 官方源，改用国内镜像 npmmirror.com');
      await run(path.join(NODE_BIN, 'npm'), ['install', '--no-audit', '--no-fund', '--registry', registry]);
      await linkTools();
      log('下载渲染用的 Chrome（约 200 MB）…');
      await run(HF, ['browser', 'ensure']);
      await run(HF, ['telemetry', 'disable']).catch(() => {});
      if (!fs.existsSync(path.join(TEMPLATE, 'index.html'))) {
        await fsp.rm(TEMPLATE, { recursive: true, force: true });
        await run(HF, ['init', 'template', '--non-interactive', '--example', 'blank']);
      }
      await fsp.writeFile(READY, new Date().toISOString());
      state.phase = 'idle';
      log('安装完成');
    } catch (err) {
      state.phase = 'error';
      state.error = err.message;
      log(`安装失败：${err.message}`);
    }
  }

  /** ffmpeg (the app's own) and ffprobe (from npm) where HyperFrames looks for them: on PATH. */
  async function linkTools() {
    await fsp.mkdir(STUDIO_BIN, { recursive: true });
    const links = { ffprobe: path.join(MODULES, '@ffprobe-installer', 'darwin-arm64', 'ffprobe'), ...(ffmpeg ? { ffmpeg } : {}) };
    for (const [name, target] of Object.entries(links)) {
      const at = path.join(STUDIO_BIN, name);
      await fsp.rm(at, { force: true });
      await fsp.symlink(target, at);
    }
  }

  async function uninstall() {
    await stopPreviews();
    await fsp.rm(STUDIO_DIR, { recursive: true, force: true });
    state.phase = 'idle';
    state.log = [];
    state.error = undefined;
  }

  function status() {
    return { ...STUDIO_INFO, installed: installed(), installing: state.phase === 'installing', error: state.error, running: previews.size > 0, log: state.log.slice(-60) };
  }

  // ---- Workspaces ---------------------------------------------------------------------

  /**
   * Creates a production folder: the HyperFrames template, local GSAP, the HyperFrames skills,
   * the chosen method's documents, the reference media and the task contract for the agent.
   */
  async function createWorkspace(ws, { method, refs }) {
    await fsp.mkdir(ws, { recursive: true });
    await fsp.cp(TEMPLATE, ws, { recursive: true, filter: (src) => !/[/\\](node_modules|\.git|renders)$/.test(src) });
    await fsp.symlink(MODULES, path.join(ws, 'node_modules'));
    await fsp.mkdir(path.join(ws, 'vendor'), { recursive: true });
    await fsp.copyFile(path.join(MODULES, 'gsap', 'dist', 'gsap.min.js'), path.join(ws, 'vendor', 'gsap.min.js'));
    const html = path.join(ws, 'index.html');
    await fsp.writeFile(html, (await fsp.readFile(html, 'utf8')).replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"']+\/dist\/gsap\.min\.js/, 'vendor/gsap.min.js'));
    // HyperFrames' own skills, where Claude Code (.claude) and Codex (.agents) look for them.
    for (const skill of ['hyperframes', 'hyperframes-cli']) {
      const src = path.join(MODULES, 'hyperframes', 'dist', 'skills', skill);
      for (const root of ['.claude', '.agents']) await fsp.cp(src, path.join(ws, root, 'skills', skill), { recursive: true });
    }
    if (method && fs.existsSync(path.join(METHODS_DIR, method))) await fsp.cp(path.join(METHODS_DIR, method), path.join(ws, 'method'), { recursive: true });
    await fsp.mkdir(path.join(ws, 'assets'), { recursive: true });
    const assets = [];
    for (const [i, ref] of refs.entries()) {
      const name = `ref${i + 1}${path.extname(ref.abs).toLowerCase()}`;
      await fsp.copyFile(ref.abs, path.join(ws, 'assets', name));
      assets.push({ name: `assets/${name}`, kind: ref.kind, label: ref.label });
    }
    await writeWct(ws);
    return assets;
  }

  /** bin/wct: the agent's door to the app's local image, voice and music generators. */
  async function writeWct(ws) {
    const bin = path.join(ws, 'bin');
    await fsp.mkdir(bin, { recursive: true });
    const hf = `#!/bin/sh\n# HyperFrames CLI (local install, no downloads).\nexec "${HF}" "$@"\n`;
    await fsp.writeFile(path.join(bin, 'hf'), hf, { mode: 0o755 });
    const wct = `#!/usr/bin/env node
// WCcanvastv local media tools for this production. Usage:
//   bin/wct image "<画面描述>" assets/<name>.png [--ratio 16:9]     ChatGPT 生图（需要已登录 ChatGPT）
//   bin/wct tts "<口播文字>" assets/<name>.wav [--voice Serena] [--tone 温柔]   Qwen3-TTS 本地配音
//   bin/wct music "<英文风格描述>" assets/<name>.wav [--duration 30] [--lyrics "<歌词>"]   ACE-Step 本地音乐（纯音乐不写 lyrics）
//   bin/wct status                                                 哪些本地引擎可用
const fs = require('node:fs');
const path = require('node:path');
const API = 'http://127.0.0.1:${port}';
const [cmd, text, out, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : d; };
const call = async (p, body) => {
  const r = await fetch(API + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};
(async () => {
  if (cmd === 'status') {
    const [e, l] = await Promise.all([call('/api/engines'), call('/api/local-engines')]);
    console.log(JSON.stringify({ image: !!(e.chatgpt && e.chatgpt.loggedIn), tts: l.engines.tts.installed, music: l.engines.music.installed }));
    return;
  }
  if (!['image', 'tts', 'music'].includes(cmd) || !text || !out) {
    console.error('用法见 bin/wct 文件开头');
    process.exit(2);
  }
  const project = process.env.WCT_PROJECT || undefined;
  const body =
    cmd === 'image' ? { engine: 'chatgpt', kind: 'image', prompt: text, ratio: opt('ratio', '16:9'), project }
    : cmd === 'tts' ? { text, voice: opt('voice', 'Serena'), instruct: opt('tone'), lang: opt('lang', 'chinese'), engine: 'qwen3', name: path.basename(out), project }
    : { prompt: text, lyrics: opt('lyrics', ''), duration: Number(opt('duration', 30)), language: opt('lang', 'zh'), name: path.basename(out), project };
  const { id } = await call(cmd === 'image' ? '/api/generate' : cmd === 'tts' ? '/api/tts' : '/api/music', body);
  process.stderr.write(cmd + ' 生成中');
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const job = await call('/api/jobs/' + id);
    if (job.status === 'error') throw new Error(job.error);
    if (job.status === 'done' && job.file) {
      const r = await fetch(API + '/files/' + job.file.id.split('/').map(encodeURIComponent).join('/'));
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
      console.log('\\n已保存 ' + out + (job.file.seconds ? '（' + job.file.seconds.toFixed(1) + ' 秒）' : ''));
      return;
    }
    process.stderr.write('.');
  }
})().catch((e) => { console.error('\\n失败：' + e.message); process.exit(1); });
`;
    await fsp.writeFile(path.join(bin, 'wct'), wct, { mode: 0o755 });
  }

  function contract({ title, brief, ratio, duration, method, methodName, assets, revise, engine }) {
    // Codex runs in a macOS sandbox where Chrome can't start: the app renders for it afterwards.
    const appRenders = engine !== 'claude';
    const [w, h] = SIZES[ratio] ?? SIZES['16:9'];
    const lines = [
      `# 任务：${revise ? '修改这部视频' : '制作一部视频'} —— ${title}`,
      '',
      '你是 WCcanvastv 的视频制作 agent。用这个文件夹里的 HyperFrames（HTML + GSAP 动画，由本地 Chrome 渲染成 MP4）完成下面的作品，做完要真的渲染出成片。',
      '',
      revise ? '## 修改意见' : '## 用户的需求',
      brief.trim(),
      '',
      '## 规格',
      `- 画幅：${ratio}，${w}×${h} 像素（index.html 根元素的 data-width / data-height 和 body 尺寸都改成这个，viewport meta 也一样）`,
      duration ? `- 时长：约 ${duration} 秒` : '- 时长：按需求里写的时长；没写就按内容需要自己定（一般 15–60 秒），并在 SUMMARY.md 里说明',
      '- 语言：画面文字和配音用中文，除非需求另有说明',
      '',
    ];
    if (method)
      lines.push(
        '## 玩法（风格方法）',
        `本片采用「${methodName}」玩法。先读 method/SKILL.md 和它引用的 method/references/*.md，按其中的视觉风格、分镜方法、动效语法和质量标准来做。`,
        '注意：玩法文档里提到的付费云服务（火山引擎、Atlas Cloud、HeyGen、ElevenLabs 等）和需要账号的发布步骤一律不用，改用下面的本地工具；最终交付物是用 HyperFrames 渲染的 MP4。',
        '',
      );
    if (revise)
      lines.push(
        '## 修改方式',
        '- 这个文件夹里已经有上一版（index.html、assets/、SUMMARY.md），先读懂它，再按修改意见改，没提到的部分保持原样。',
        '',
      );
    if (assets.length)
      lines.push('## 参考素材（已放在 assets/ 里，按需使用）', ...assets.map((a) => `- ${a.name}（${a.kind}${a.label ? `，${a.label}` : ''}）`), '');
    lines.push(
      '## 怎么做',
      '1. 先读 .claude/skills/hyperframes/SKILL.md（Codex 读 .agents/skills/hyperframes/SKILL.md）和其中的 references，严格遵守它的合成规则（window.__timelines 注册、data-* 属性、可 seek 的动画）。CLI 用法在 hyperframes-cli 技能里。',
      '2. 写分镜，再把成片写进 index.html（可以拆分子合成放到 compositions/）。所有动画都由 GSAP 时间线驱动。',
      ...(appRenders
        ? [
            '3. 运行 `bin/hf lint`，修掉所有错误。需要看画面时可以试 `bin/hf snapshot` 截帧；如果因为沙箱无法启动浏览器就跳过，靠仔细检查代码保证正确。',
            '4. 不要自己渲染，也不要另写截帧或编码脚本：你完成后，应用会用 `bin/hf render` 渲染出 renders/final.mp4。',
          ]
        : [
            '3. 运行 `bin/hf lint` 和 `bin/hf check`，修掉所有错误。',
            '4. 渲染：`bin/hf render -o renders/final.mp4`。确认文件存在且时长正确（`ffprobe renders/final.mp4`）。需要看画面时可以用 `bin/hf snapshot` 截帧检查。',
          ]),
      '5. 写 SUMMARY.md（中文，给用户看）：创意思路、分镜表（时间段 / 画面 / 文字 / 动效）、用到的素材和工具、想改哪里该改哪个文件。',
      '',
      '## 规则',
      '- 只用本地资源：GSAP 用 vendor/gsap.min.js，不要引用任何 CDN、Google Fonts 或网络图片；字体用系统字体（PingFang SC、Hiragino Sans GB、Songti SC、Helvetica Neue 等），并为用到的每个字体写 @font-face 声明，例如 `@font-face { font-family: \'PingFang SC\'; src: local(\'PingFang SC\'); }`，否则检查会报错、渲染会回退成默认字体。',
      '- 不要运行 npx、npm install 或下载任何东西；HyperFrames 命令一律用 `bin/hf`。',
      '- 需要素材时用 `bin/wct`（先 `bin/wct status` 看哪些可用）：`bin/wct image` 用 ChatGPT 生成插画或背景，`bin/wct tts` 用本地 Qwen3-TTS 配口播，`bin/wct music` 用本地 ACE-Step 生成配乐；不可用的就用 HTML/SVG/CSS 自己画，别卡住。生成图片较慢（每张约 1 分钟），只在确实需要时用，最多 6 张。',
      '- 有配音或音乐时，按 HyperFrames 的规则用 <audio> 元素放进合成里，让渲染带上声音；画面节奏要跟配音对齐。',
      '- 只在当前文件夹里读写，不要改动外面的任何文件。',
      '- 整个过程不要停下来问问题：信息不够时按最合理的理解自己决定，并写进 SUMMARY.md。',
      appRenders ? '- 最终要让 index.html 能直接被 `bin/hf render` 渲染成片。' : '- 最终必须得到 renders/final.mp4。',
    );
    return lines.join('\n');
  }

  // ---- The agent ------------------------------------------------------------------------

  const CLAUDE_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Skill', 'TodoWrite', ...['bin/hf', './bin/hf', 'bin/wct', './bin/wct', 'ls', 'cat', 'head', 'mkdir', 'cp', 'mv', 'rm', 'ffprobe', 'ffmpeg', 'node', 'sed', 'wc'].map((c) => `Bash(${c}:*)`)];

  /** Short, readable progress lines from the agents' JSON event streams. */
  function describe(engine, e) {
    const short = (s, n = 90) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
    const rel = (f) => short(String(f ?? '').split(/[/\\]/).slice(-2).join('/'), 60);
    if (engine === 'claude') {
      if (e.type !== 'assistant') return [];
      return (e.message?.content ?? []).map((c) => {
        if (c.type === 'text') return short(c.text, 140);
        if (c.type !== 'tool_use') return '';
        const i = c.input ?? {};
        if (c.name === 'Write') return `写入 ${rel(i.file_path)}`;
        if (c.name === 'Edit' || c.name === 'MultiEdit') return `修改 ${rel(i.file_path)}`;
        if (c.name === 'Read') return `阅读 ${rel(i.file_path)}`;
        if (c.name === 'Skill') return `加载技能 ${short(i.skill ?? i.name, 40)}`;
        if (c.name === 'Bash') return `运行 ${short(i.command, 100)}`;
        if (c.name === 'TodoWrite') return `规划：${(i.todos ?? []).map((t) => t.content).slice(0, 4).join(' / ')}`.slice(0, 160);
        return c.name;
      });
    }
    const it = e.item ?? {};
    // Codex wraps each command as /bin/zsh -lc "…".
    if (e.type === 'item.started' && it.type === 'command_execution') return [`运行 ${short(String(it.command ?? '').replace(/^\/bin\/\w*sh -lc\s+(["'])([\s\S]*)\1$/, '$2'), 100)}`];
    if (e.type === 'item.completed' && it.type === 'agent_message') return [short(it.text, 140)];
    if (e.type === 'item.completed' && it.type === 'file_change') return (it.changes ?? []).map((c) => `${c.kind === 'add' ? '写入' : '修改'} ${rel(c.path)}`);
    if (e.type === 'error' || e.type === 'turn.failed') return [short(e.message ?? e.error?.message, 200)];
    return [];
  }

  function runAgent(job, { engine, ws, task }) {
    return new Promise((resolve, reject) => {
      const env = { ...toolEnv(), WCT_PROJECT: job.project ?? '' };
      let cmd;
      let args;
      if (engine === 'claude') {
        if (!claude) return reject(new Error('没有找到 Claude Code 命令行'));
        cmd = claude;
        args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', CLAUDE_TOOLS.join(','), '--disallowedTools', 'WebFetch,WebSearch'];
      } else {
        if (!codex) return reject(new Error('没有找到 ChatGPT 应用（需要 ChatGPT 桌面版自带的 Codex 命令行）'));
        cmd = codex;
        args = ['exec', '--skip-git-repo-check', '--json', '-C', ws, '-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '-c', 'model_reasoning_effort="medium"', '-'];
      }
      const p = spawn(cmd, args, { cwd: ws, env });
      job.proc = p;
      p.stdin.end(task);
      let buf = '';
      let result = null;
      let stderr = '';
      const timer = setTimeout(() => p.kill('SIGTERM'), AGENT_TIMEOUT);
      p.stdout.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          try {
            const e = JSON.parse(line);
            if (e.type === 'result') result = e;
            for (const m of describe(engine, e)) if (m) job.log.push(m.slice(0, 300));
          } catch {
            // non-JSON noise
          }
        }
      });
      p.stderr.on('data', (c) => (stderr = (stderr + c).slice(-4000)));
      p.on('error', (err) => (clearTimeout(timer), reject(new Error(`无法启动 ${engine === 'claude' ? 'Claude Code' : 'ChatGPT'}：${err.message}`))));
      p.on('close', (code) => {
        clearTimeout(timer);
        job.proc = null;
        if (job.status === 'cancelled') return reject(new Error('已取消'));
        if (engine === 'claude' && result?.is_error) {
          const msg = String(result.result ?? '');
          return reject(new Error(/not logged in|login/i.test(msg) ? 'Claude Code 未登录：请在终端运行 claude，按提示登录后再试' : `Claude Code 运行失败：${msg.slice(0, 300)}`));
        }
        // A non-zero exit still leaves whatever the agent built; the caller renders it if needed.
        if (code !== 0) job.log.push(`AI 退出码 ${code}${stderr ? `：${stderr.trim().split('\n').at(-1)?.slice(0, 200)}` : ''}`);
        resolve();
      });
    });
  }

  async function render(job, ws) {
    job.log.push('正在渲染成片（本地 Chrome + FFmpeg）…');
    await fsp.mkdir(path.join(ws, 'renders'), { recursive: true });
    await run(HF, ['render', '-o', 'renders/final.mp4', '--quiet'], {
      cwd: ws,
      timeout: 30 * 60_000,
      onLine: (d) => {
        const m = /(\d{1,3})%/.exec(String(d));
        if (m) job.progress = Number(m[1]) / 100;
      },
    });
  }

  const finalOk = (ws) => {
    try {
      return fs.statSync(path.join(ws, 'renders', 'final.mp4')).size > 1000;
    } catch {
      return false;
    }
  };

  /**
   * Makes (or revises) a film. `ws` is the production folder; `done(ws)` collects the
   * result into the project. Throws with a readable message on failure.
   */
  async function make(job, { engine, ws, revise, brief, title, ratio, duration, method, methodName, refs }) {
    if (!installed()) throw new Error('还没有安装视频制作引擎：点右上角「本地引擎」安装 HyperFrames');
    let assets = [];
    if (!revise) {
      job.log.push('正在准备制作文件夹…');
      assets = await createWorkspace(ws, { method, refs });
    } else {
      // New reference media for a revision goes next to the old ones.
      const have = (await fsp.readdir(path.join(ws, 'assets')).catch(() => [])).filter((n) => /^ref\d+\./.test(n)).length;
      for (const [i, ref] of refs.entries()) {
        const name = `ref${have + i + 1}${path.extname(ref.abs).toLowerCase()}`;
        await fsp.copyFile(ref.abs, path.join(ws, 'assets', name));
        assets.push({ name: `assets/${name}`, kind: ref.kind, label: ref.label });
      }
      await writeWct(ws);
    }
    const task = contract({ title, brief, ratio, duration, method, methodName, assets, revise, engine });
    await fsp.writeFile(path.join(ws, revise ? `TASK-修改-${Date.now()}.md` : 'TASK.md'), task);
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const file = path.join(ws, name);
      const base = (await fsp.readFile(file, 'utf8').catch(() => '')).replace(/^<!-- wccanvastv -->[\s\S]*?<!-- \/wccanvastv -->\n*/, '');
      await fsp.writeFile(file, `<!-- wccanvastv -->\n${task}\n<!-- /wccanvastv -->\n\n${base}`);
    }
    if (revise) await fsp.rm(path.join(ws, 'renders', 'final.mp4'), { force: true });
    job.log.push(`${engine === 'claude' ? 'Claude Code' : 'ChatGPT'} 开始制作（通常需要 5–20 分钟）…`);
    await runAgent(job, {
      engine,
      ws,
      task: `${task}\n\n现在开始：按「怎么做」一步步完成，${engine === 'claude' ? '最后确认 renders/final.mp4 已生成并' : '最后'}写好 SUMMARY.md。`,
    });
    // Agents sometimes start a Studio preview of their own; don't leave it running.
    if (!previews.has(ws)) await run(HF, ['preview', ws, '--stop'], { cwd: ws, onLine: () => {}, timeout: 20_000 }).catch(() => {});
    if (job.status === 'cancelled') throw new Error('已取消');
    if (engine !== 'claude' || !finalOk(ws)) {
      if (!fs.existsSync(path.join(ws, 'index.html'))) throw new Error('AI 没有完成合成文件');
      await render(job, ws);
    }
    if (!finalOk(ws)) throw new Error('渲染没有生成视频文件');
  }

  // ---- Studio preview (the editor) ----------------------------------------------------------

  async function preview(ws) {
    const have = previews.get(ws);
    if (have && (await reachable(have.url.replace(/#.*$/, '')))) return have.url;
    const out = await run(HF, ['preview', ws, '--background', '--no-open', '--json', '--port', String(5300 + previews.size)], { cwd: ws, onLine: () => {}, timeout: 120_000 });
    const line = out.split('\n').reverse().find((l) => l.trim().startsWith('{'));
    const r = JSON.parse(line ?? '{}');
    const url = r.result?.studioUrl || r.result?.serverUrl;
    if (!url) throw new Error('Studio 没有启动');
    previews.set(ws, { url });
    return url;
  }

  async function stopPreviews() {
    if (!previews.size || !fs.existsSync(HF)) return;
    previews.clear();
    await run(HF, ['preview', '--kill-all'], { onLine: () => {}, timeout: 20_000 }).catch(() => {});
  }

  return { status, install, uninstall, installed, make, render, finalOk, preview, stopPreviews, SIZES };
}
