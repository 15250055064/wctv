import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from './Icon';
import { useUI } from './ui';

// Local voice (Qwen3-TTS) and music (ACE-Step) engines: status chip and install window; also
// where the SnapAny key for 链接下载 is entered.

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

interface SnapAnyInfo {
  keySet: boolean;
  hint?: string;
  ok?: boolean | null;
  credits?: number | null;
  error?: string;
}

/**
 * 链接下载 with SnapAny: 抖音 links (and pages yt-dlp can't open) go through the user's own
 * SnapAny API key, which is kept on this Mac and never shown again.
 */
function SnapAnyKey() {
  const [info, setInfo] = useState<SnapAnyInfo | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch('/api/snapany')
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ keySet: false }));
  }, []);
  const send = async (method: 'PUT' | 'DELETE') => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/snapany', { method, headers: { 'Content-Type': 'application/json' }, body: method === 'PUT' ? JSON.stringify({ key }) : undefined });
      const body = await r.json();
      if (!r.ok) return setErr(body.error ?? '保存失败');
      setInfo(body);
      setKey('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="le-card le-wide">
      <div className="le-head">
        <Icon name="link" size={20} />
        <div>
          <b>链接下载 · SnapAny</b>
          <small>抖音等需要登录的视频链接</small>
        </div>
        <div className="grow" />
        <span className={`le-state ${info?.keySet && info.ok ? 'on' : ''}`}>{!info ? '…' : !info.keySet ? '未设置' : info.ok ? `剩余 ${info.credits ?? '?'} 积分` : '需要检查'}</span>
      </div>
      <p>
        在画布上粘贴链接即可下载。B站、小红书、YouTube 等用免费的 yt-dlp；<b>抖音</b>（以及 yt-dlp 打不开的页面）通过 SnapAny 解析，每个链接消耗 1 积分。到{' '}
        <a href="https://platform.snapany.com/zh" target="_blank" rel="noreferrer">
          platform.snapany.com
        </a>{' '}
        注册并创建 API Key（新用户有 50 个免费积分），粘贴到下面。Key 只保存在这台 Mac 上。
      </p>
      {info?.keySet && (
        <p className="muted small">
          已保存：{info.hint}
          {info.error ? ` · ${info.error}` : ''}
        </p>
      )}
      <div className="le-actions">
        <input className="pp-input" type="password" placeholder={info?.keySet ? '粘贴新的 Key 替换' : 'sk_snapany_…'} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        <button className="primary-btn" disabled={busy || !key.trim()} onClick={() => send('PUT')}>
          {busy ? '检查中…' : '保存'}
        </button>
        {info?.keySet && (
          <button className="text-btn" disabled={busy} onClick={() => send('DELETE')}>
            删除
          </button>
        )}
      </div>
      {err && <p className="le-err small">{err}</p>}
    </article>
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
              <SnapAnyKey />
            </div>
          ) : (
            <p className="muted">正在读取引擎状态…</p>
          )}
        </div>
      </div>
    </div>
  );
}
