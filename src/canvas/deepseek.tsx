import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from './Icon';
import { useUI } from './ui';

// DeepSeek API key: typed here, saved by the local server on this Mac only (it never comes
// back to the page), and sent only to DeepSeek's official API (api.deepseek.com).

interface DeepSeekInfo {
  keySet: boolean;
  /** e.g. "sk-…a1b2" */
  hint: string;
  ready: boolean | null;
  model: string;
  models: string[];
}

const MODEL_LABEL: Record<string, string> = {
  'deepseek-flash': 'DeepSeek Flash（快、便宜）',
  'deepseek-v4-pro': 'DeepSeek V4 Pro（更强）',
};

async function call(method: 'GET' | 'PUT' | 'DELETE' | 'POST', body?: object, url = '/api/deepseek'): Promise<DeepSeekInfo> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
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
      setInfo(await call('POST', undefined, '/api/deepseek/test'));
      setMsg({ ok: true, text: '连接成功，可以在节点里选择 DeepSeek 了' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy('save');
    setMsg(null);
    try {
      setInfo(await call('PUT', { key }));
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
            WCcanvastv 直接调用 DeepSeek 官方接口，需要你自己的 API Key（在{' '}
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
              platform.deepseek.com
            </a>{' '}
            创建，按用量从你的 DeepSeek 账户扣费）。Key 只保存在这台 Mac 上，只发给 api.deepseek.com，不会发给 ChatGPT、Claude 或其他地方。
          </p>
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
            <button className="text-btn" disabled={!info?.keySet || !!busy} onClick={test}>
              {busy === 'test' ? '测试中…' : '测试连接'}
            </button>
          </div>
          {msg && <p className={msg.ok ? 'ds-ok' : 'ds-warn'}>{msg.text}</p>}
          {info && (
            <div className="ds-status">
              <span>使用的模型：</span>
              <select className="pp-select" value={info.model} onChange={async (e) => setInfo(await call('PUT', { model: e.target.value }))}>
                {info.models.map((m) => (
                  <option key={m} value={m}>
                    {MODEL_LABEL[m] ?? m}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="muted small">
            DeepSeek 可用于文本、脚本、视频提示词、音乐作词和视频玩法；它看不到参考图，也不能生成图片。视频玩法里 DeepSeek 一次写好整段动画，由应用检查并渲染，不会调用生图、配音等工具。
          </p>
        </div>
      </div>
    </div>
  );
}
