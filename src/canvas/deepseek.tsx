import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from './Icon';
import { generateText } from './provider';
import { useUI } from './ui';

// DeepSeek API key: typed here, saved by the local server on this Mac only (it never comes
// back to the page), and handed to DeepSeek Harness's command line on each DeepSeek run.

interface DeepSeekInfo {
  installed: boolean;
  keySet: boolean;
  /** e.g. "sk-…a1b2" */
  hint: string;
  ready: boolean | null;
}

async function call(method: 'GET' | 'PUT' | 'DELETE', key?: string): Promise<DeepSeekInfo> {
  const r = await fetch('/api/deepseek', { method, headers: { 'Content-Type': 'application/json' }, body: key === undefined ? undefined : JSON.stringify({ key }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `请求失败（${r.status}）`);
  return j as DeepSeekInfo;
}

export function DeepSeekPanel() {
  const { open, set } = useUI(useShallow((s) => ({ open: s.deepseek, set: s.set })));
  const [info, setInfo] = useState<DeepSeekInfo | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    setKey('');
    setMsg(null);
    call('GET').then(setInfo, () => setInfo(null));
  }, [open]);
  if (!open) return null;
  const close = () => set({ deepseek: false });

  const test = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const text = await generateText('deepseek', '只回复两个字：你好');
      setMsg({ ok: true, text: `连接成功，DeepSeek 回复：${text.slice(0, 40)}` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
      call('GET').then(setInfo, () => {});
    }
  };
  const save = async () => {
    setBusy('save');
    setMsg(null);
    try {
      setInfo(await call('PUT', key));
      setKey('');
      setBusy(null);
      await test();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!confirm('删除保存在这台 Mac 上的 DeepSeek API Key？')) return;
    setInfo(await call('DELETE'));
    setMsg(null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal ds-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">DeepSeek</h3>
          <div className="grow" />
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="prefs-body">
          <p className="muted">
            WCcanvastv 通过 DeepSeek Harness 调用 DeepSeek，需要你自己的 DeepSeek API Key（在 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">platform.deepseek.com</a> 创建，按用量计费）。Key 只保存在这台 Mac 上，只在调用 DeepSeek 时使用，不会发给 ChatGPT、Claude 或其他地方。
          </p>
          {info && !info.installed && <p className="ds-warn">没有找到 DeepSeek Harness 应用：请先安装它，WCcanvastv 通过它的命令行调用 DeepSeek。</p>}
          <div className="ds-status">
            <span>当前 Key：</span>
            <b>{info?.keySet ? info.hint : '未填写'}</b>
            {info?.keySet && (
              <button className="text-btn" onClick={remove}>
                删除
              </button>
            )}
          </div>
          <div className="ds-row">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && key.trim()) save();
              }}
              placeholder={info?.keySet ? '粘贴新的 Key 以替换' : '粘贴你的 DeepSeek API Key（sk-…）'}
            />
            <button className="primary-btn" disabled={!key.trim() || !!busy} onClick={save}>
              {busy === 'save' ? '保存中…' : '保存并测试'}
            </button>
            <button className="text-btn" disabled={!info?.installed || !!busy} onClick={test}>
              {busy === 'test' ? '测试中…' : '测试连接'}
            </button>
          </div>
          {msg && <p className={msg.ok ? 'ds-ok' : 'ds-warn'}>{msg.text}</p>}
          <p className="muted small">DeepSeek 可用于文本、脚本、视频提示词、音乐作词和视频玩法；它看不到参考图，也不能生成图片。</p>
        </div>
      </div>
    </div>
  );
}
