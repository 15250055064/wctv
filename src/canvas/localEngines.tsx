import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from './Icon';
import { useUI } from './ui';

// Local voice (Qwen3-TTS) and music (ACE-Step) engines: status chip and install window.

interface LocalEngine {
  name: string;
  size: string;
  license: string;
  installed: boolean;
  installing: boolean;
  running: boolean;
  error?: string;
  log: string[];
}
export interface LocalEngineStatus {
  dir: string;
  engines: { tts: LocalEngine; music: LocalEngine; studio?: LocalEngine };
}

async function call(url: string, method = 'GET'): Promise<LocalEngineStatus | null> {
  try {
    const r = await fetch(url, { method });
    return r.ok ? ((await r.json()) as LocalEngineStatus) : null;
  } catch {
    return null;
  }
}

export function useLocalEngines(fast: boolean) {
  const [st, setSt] = useState<LocalEngineStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => call('/api/local-engines').then((v) => alive && setSt(v));
    load();
    const busy = st && (st.engines.tts.installing || st.engines.music.installing || st.engines.studio?.installing);
    const t = setInterval(load, fast || busy ? 1500 : 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [fast, st?.engines.tts.installing, st?.engines.music.installing, st?.engines.studio?.installing]);
  return [st, setSt] as const;
}

/** Top-bar chip: how many of the local engines are ready. */
export function LocalEnginesChip() {
  const set = useUI((s) => s.set);
  const [st] = useLocalEngines(false);
  if (!st) return null;
  const all = Object.values(st.engines).filter((e): e is LocalEngine => !!e);
  const busy = all.some((e) => e.installing);
  const ready = all.filter((e) => e.installed).length;
  return (
    <button className={`engine engine-btn ${busy ? 'engine-warn' : ready === all.length ? 'engine-on' : 'engine-off'}`} title="本地配音、音乐与视频制作引擎" onClick={() => set({ localEngines: true })}>
      <i />
      {busy ? '引擎安装中…' : `本地引擎 ${ready}/${all.length}`}
    </button>
  );
}

type Name = 'tts' | 'music' | 'studio';

interface Component {
  id: string;
  kind: 'tool' | 'model';
  name: string;
  use: string;
  bytes: number;
  installed: boolean;
  expected?: string;
}
const fmtBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

/** The small tools and models the local tools download on first use: what each is for, its size, and removal. */
function Components() {
  const [list, setList] = useState<Component[] | null>(null);
  useEffect(() => {
    fetch('/api/components')
      .then((r) => r.json())
      .then(setList)
      .catch(() => setList([]));
  }, []);
  const remove = async (c: Component) => {
    if (!confirm(`删除「${c.name}」（${fmtBytes(c.bytes)}）？下次用到「${c.use}」时会重新下载。`)) return;
    const r = await fetch(`/api/components/${c.id}`, { method: 'DELETE' });
    if (r.ok) setList(await r.json());
  };
  if (!list) return <p className="muted small">正在读取…</p>;
  const total = list.reduce((a, c) => a + c.bytes, 0);
  return (
    <section className="le-components">
      <h4 className="bd-h">
        本地工具与模型 <small className="muted">用到时自动下载 · 已占用 {fmtBytes(total)}</small>
      </h4>
      {list.map((c) => (
        <div key={c.id} className="le-comp">
          <span className={`le-dot ${c.installed ? 'on' : ''}`} />
          <b>{c.name}</b>
          <span className="muted small grow">{c.use}</span>
          <span className="small">{c.installed ? fmtBytes(c.bytes) : `未下载（${c.expected ?? ''}）`}</span>
          {c.installed && (
            <button className="text-btn" onClick={() => remove(c)}>
              删除
            </button>
          )}
        </div>
      ))}
      <p className="muted small">视频处理用的 FFmpeg 随应用自带，不需要下载。</p>
    </section>
  );
}

export function LocalEnginesPanel() {
  const { open, set } = useUI(useShallow((s) => ({ open: s.localEngines, set: s.set })));
  const [st, setSt] = useLocalEngines(open);
  if (!open) return null;
  const close = () => set({ localEngines: false });
  const act = async (name: Name, how: 'install' | 'remove') => {
    if (how === 'remove' && !confirm('卸载会删除这个引擎和它的模型文件，之后可以重新安装。继续？')) return;
    const v = await call(how === 'install' ? `/api/local-engines/${name}/install` : `/api/local-engines/${name}`, how === 'install' ? 'POST' : 'DELETE');
    if (v) setSt(v);
  };
  const card = (name: Name, e: LocalEngine, desc: string, uses: string[]) => (
    <article key={name} className="le-card">
      <div className="le-head">
        <Icon name={name === 'tts' ? 'mic' : name === 'music' ? 'audio' : 'film'} size={20} />
        <div>
          <b>{e.name}</b>
          <small>
            {e.size} · {e.license}
          </small>
        </div>
        <div className="grow" />
        <span className={`le-state ${e.installed ? 'on' : e.installing ? 'busy' : ''}`}>{e.installing ? '安装中…' : e.installed ? (e.running ? '运行中' : '已安装') : e.error ? '安装失败' : '未安装'}</span>
      </div>
      <p>{desc}</p>
      <ul>
        {uses.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
      {(e.installing || e.error || (e.log.length > 0 && !e.installed)) && <pre className="le-log nowheel">{e.log.slice(-14).join('\n')}</pre>}
      <div className="le-actions">
        {e.installed ? (
          <button className="text-btn" onClick={() => act(name, 'remove')}>
            卸载
          </button>
        ) : (
          <button className="primary-btn" disabled={e.installing} onClick={() => act(name, 'install')}>
            {e.installing ? '正在安装…' : e.error ? '重试安装' : '一键安装'}
          </button>
        )}
      </div>
    </article>
  );
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal le-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">本地引擎</h3>
          <div className="grow" />
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="prefs-body">
          <p className="muted">
            这些开源引擎都在这台 Mac 上运行，不需要账号或 API Key。安装时会下载运行环境和模型文件，需要联网和一些时间；无法访问 HuggingFace、npm 时会自动改用国内镜像。文件放在：
            <code>{st?.dir ?? '…'}</code>
          </p>
          {st ? (
            <div className="le-grid">
              {card('tts', st.engines.tts, '阿里通义开源的 Qwen3-TTS（1.7B），通过 mlx-audio 在 Apple 芯片上运行，中文自然度高，支持 9 种音色和语气指令。', ['配音节点：把文字或 GPT/Claude 写的口播读出来', '温柔、激昂、悬疑、新闻播报等语气', '首次生成需要加载模型，之后会快很多'])}
              {st.engines.studio &&
                card('studio', st.engines.studio, 'HeyGen 开源的 HyperFrames：用 HTML + GSAP 写视频，由本地 Chrome 和 FFmpeg 渲染成 MP4，自带可视化编辑器 Studio。', ['视频玩法节点：Claude Code / ChatGPT 按玩法直接做出成片', '做完可在 Studio 里改文字、画面和时间线，再渲染新版本', '会自动调用本地配音、音乐和 ChatGPT 生图'])}
              {card('music', st.engines.music, 'ACE-Step 1.5 开源音乐模型，按风格描述和歌词生成带人声或纯音乐的完整歌曲，支持中文歌词。', ['音频节点选「ACE-Step 歌曲」时使用', 'GPT/Claude 负责写歌词和英文风格描述', '首次作曲需要启动引擎、加载模型（约 1–2 分钟）'])}
            </div>
          ) : (
            <p className="muted">正在读取引擎状态…</p>
          )}
          <Components />
        </div>
      </div>
    </div>
  );
}
