import { LocalEnginesChip } from './localEngines';
import { AllFeaturesPanel } from './tools/AllFeatures';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useStore as useFlowStore } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { MENU_KINDS, NODE_META, isMac } from './config';
import { Icon } from './Icon';
import { downloadText, isServerId, listArchive, revealInFinder, useMediaUrl, type ArchivedFile } from './media';
import { fetchEngines, newProject, openProject, refreshProjects, renameCurrentProject, type EngineStatus } from './persistence';
import { useProject } from './project';
import { useImeField } from './useImeField';
import { DEFAULT_PREFERENCES, useLibrary } from './library';
import { MediaThumb } from './nodes';
import { GESTURES, SHORTCUTS, formatCombo } from './shortcuts';
import { absPos, exportJson, sizeOf, useCanvas, type SaveStatus, currentOutput } from './store';
import { requestUpload, useUI } from './ui';
import { isGenKind, type HistoryItem, type MediaKind, type MediaRef } from './types';

export function useViewportCenter() {
  const { screenToFlowPosition } = useReactFlow();
  return () => screenToFlowPosition({ x: window.innerWidth / 2 - 150, y: window.innerHeight / 2 - 120 });
}

function clampToViewport(x: number, y: number, w: number, h: number) {
  return { left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(y, window.innerHeight - h - 8)) };
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

/**
 * Autosave indicator. Edits save within a second, so flipping to "unsaved" on every keystroke
 * reads as flicker: it stays on "已自动保存" and only shows saving when a save is still pending
 * after a moment, then holds that briefly so it never blinks.
 */
function SaveStatusChip({ status }: { status: SaveStatus }) {
  const [shown, setShown] = useState<'saved' | 'saving' | 'failed'>('saved');
  const since = useRef(0);
  useEffect(() => {
    if (status === 'failed') return setShown('failed');
    if (status === 'saved') {
      const wait = Math.max(0, 600 - (Date.now() - since.current));
      const t = setTimeout(() => setShown('saved'), shown === 'saving' ? wait : 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      since.current = Date.now();
      setShown('saving');
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  const label = shown === 'failed' ? '保存失败，请检查磁盘空间' : shown === 'saving' ? '保存中' : '已自动保存';
  return (
    <span className={`save-status save-${shown}`} title="改动会自动保存到项目文件夹">
      <i />
      {label}
    </span>
  );
}

function Engines() {
  const [st, setSt] = useState<EngineStatus | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => fetchEngines().then((v) => alive && setSt(v));
    load();
    const t = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (st === undefined) return null;
  if (st === null)
    return (
      <span className="engine engine-off" title="生成和硬盘留档需要本地服务，请重新打开 WCcanvastv">
        <i />
        本地服务未启动
      </span>
    );
  const chip = (label: string, e: { available: boolean; loggedIn: boolean }, fix: string) => {
    const ok = e.available && e.loggedIn;
    return (
      <span className={`engine ${ok ? 'engine-on' : 'engine-warn'}`} title={ok ? `${label} 已就绪` : fix}>
        <i />
        {label}
        {ok ? '' : e.available ? ' 未登录' : ' 未安装'}
      </span>
    );
  };
  return (
    <>
      {chip('ChatGPT', st.chatgpt, '打开 ChatGPT 应用并登录')}
      {chip('Claude', st.claude, '在终端运行 claude，按提示登录')}
      <LocalEnginesChip />
      <PrefsButton />
      <span className="sep" />
    </>
  );
}

/** Project name (rename on Enter or blur) plus the project menu. */
function ProjectName({ name, setName }: { name: string; setName: (n: string) => void }) {
  const projectId = useProject((s) => s.id);
  const set = useUI((s) => s.set);
  const [open, setOpen] = useState(false);
  const nameField = useImeField(name, setName);
  const commit = (el: HTMLInputElement) => {
    if (projectId && el.value.trim() !== projectId) renameCurrentProject(el.value);
  };
  return (
    <div className="project-name">
      <input
        className="canvas-name"
        {...nameField}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setName(projectId ?? name);
            e.currentTarget.blur();
          }
        }}
        aria-label="项目名称"
        title="项目名称（回车确认，会同步重命名项目文件夹）"
      />
      {projectId && (
        <>
          <button className="icon-btn" title="项目" onClick={() => setOpen(!open)}>
            <Icon name="down" size={14} />
          </button>
          {open && (
            <div className="popover project-menu" onMouseLeave={() => setOpen(false)}>
              {(
                [
                  ['plus', '新建项目', '⌘N', () => newProject()],
                  ['folder', '打开项目…', '⌘O', () => set({ projects: true })],
                  ['search', '在访达中显示项目文件夹', '', () => revealInFinder(projectId)],
                ] as const
              ).map(([icon, label, key, fn]) => (
                <button
                  key={label}
                  onClick={() => {
                    setOpen(false);
                    fn();
                  }}
                >
                  <span className="pop-item">
                    <Icon name={icon} size={14} />
                    {label}
                  </span>
                  <kbd>{key}</kbd>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ProjectManager() {
  const { open, set } = useUI(useShallow((s) => ({ open: s.projects, set: s.set })));
  const { list, id } = useProject(useShallow((s) => ({ list: s.list, id: s.id })));
  const [q, setQ] = useState('');
  const [name, setNewName] = useState('');
  useEffect(() => {
    if (open) refreshProjects().catch(() => {});
  }, [open]);
  if (!open) return null;
  const close = () => set({ projects: false });
  const k = q.trim().toLowerCase();
  const shown = list.filter((p) => !k || p.name.toLowerCase().includes(k));
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">项目</h3>
          <div className="lib-search">
            <Icon name="search" size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索项目" />
          </div>
          <button className="text-btn" onClick={() => revealInFinder()} title="在访达中打开留档目录">
            <Icon name="folder" size={14} />
            留档目录
          </button>
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="lib-grid proj-grid">
          <form
            className="proj-card proj-new"
            onSubmit={async (e) => {
              e.preventDefault();
              close();
              await newProject(name.trim() || '未命名项目');
              setNewName('');
            }}
          >
            <div className="proj-cover">
              <Icon name="plus" size={28} />
            </div>
            <input value={name} onChange={(e) => setNewName(e.target.value)} placeholder="新项目名称" />
            <button className="primary-btn" type="submit">
              新建项目
            </button>
          </form>
          {shown.map((p) => (
            <div
              key={p.id}
              className={`proj-card ${p.id === id ? 'on' : ''}`}
              onClick={() => {
                close();
                if (p.id !== id) openProject(p.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                revealInFinder(p.id);
              }}
              title="点击打开，右键在访达中显示"
            >
              <div className="proj-cover">{p.cover ? <MediaThumb media={{ id: p.cover, kind: 'image' }} /> : <Icon name="workflow" size={28} />}</div>
              <div className="proj-meta">
                <b>{p.name}</b>
                {p.id === id && <span className="proj-current">当前</span>}
              </div>
              <div className="proj-sub">
                <span>
                  {p.nodeCount} 个节点 · {p.updatedAt ? fmtTime(p.updatedAt) : '—'}
                </span>
                <button
                  className="icon-btn"
                  title="在访达中显示"
                  onClick={(e) => {
                    e.stopPropagation();
                    revealInFinder(p.id);
                  }}
                >
                  <Icon name="folder" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PrefsButton() {
  const on = useLibrary((s) => !!s.preferences?.text.trim());
  const set = useUI((s) => s.set);
  return (
    <button className={`text-btn ${on ? 'on' : ''}`} title="每次生成都会带上的个人偏好与习惯" onClick={() => set({ prefs: true })}>
      <Icon name="user" size={14} />
      我的偏好
    </button>
  );
}

export function PreferencesPanel() {
  const { open, set, notify } = useUI(useShallow((s) => ({ open: s.prefs, set: s.set, notify: s.notify })));
  const { preferences, setPreferences } = useLibrary(useShallow((s) => ({ preferences: s.preferences ?? DEFAULT_PREFERENCES, setPreferences: s.setPreferences })));
  const [draft, setDraft] = useState(preferences);
  useEffect(() => {
    if (open) setDraft({ ...DEFAULT_PREFERENCES, ...preferences });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const close = () => set({ prefs: false });
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal prefs-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">我的偏好</h3>
          <span className="muted small">写一次，之后每次生成都会自动带上</span>
          <div className="grow" />
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="prefs-body">
          <div className="prefs-help">
            <b>从 ChatGPT 复制过来：</b>
            <ol>
              <li>
                打开 ChatGPT →<b>设置 → 个性化 → 自定义指令</b>，复制「你希望 ChatGPT 如何回应」和「关于你」两栏。
              </li>
              <li>
                在同一页点<b>「记忆 → 管理记忆」</b>，把你想保留的条目复制过来。
              </li>
              <li>粘贴到下面，可以删掉和创作无关的内容。</li>
            </ol>
          </div>
          <textarea
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            placeholder={'例如：\n- 我是短视频导演，偏好电影感、冷暖对比强烈的画面\n- 文案口语化、简洁，避免网络流行语\n- 回答用简体中文'}
          />
          <div className="prefs-row">
            <span className="muted small">{draft.text.trim().length} 字</span>
            <div className="grow" />
            <label className="lib-check">
              <input type="checkbox" checked={draft.chatgpt} onChange={(e) => setDraft({ ...draft, chatgpt: e.target.checked })} />
              用于 ChatGPT
            </label>
            <label className="lib-check">
              <input type="checkbox" checked={draft.claude} onChange={(e) => setDraft({ ...draft, claude: e.target.checked })} />
              用于 Claude
            </label>
            <button className="text-btn" onClick={close}>
              取消
            </button>
            <button
              className="primary-btn"
              onClick={() => {
                setPreferences(draft);
                close();
                notify(draft.text.trim() ? '偏好已保存，之后的生成都会带上' : '已清空偏好');
              }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SentViewer() {
  const { sentView, set } = useUI(useShallow((s) => ({ sentView: s.sentView, set: s.set })));
  if (!sentView) return null;
  const close = () => set({ sentView: null });
  const { sent } = sentView;
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal prefs-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">发送记录 · {sentView.title}</h3>
          <span className="muted small">这次生成实际发给 {sent.model === 'claude' ? 'Claude Code' : 'ChatGPT'} 的内容</span>
          <div className="grow" />
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="prefs-body">
          {sent.images.length > 0 && (
            <div className="sent-images">
              {sent.images.map((id) => (
                <MediaThumb key={id} media={{ id, kind: 'image' }} />
              ))}
            </div>
          )}
          <pre className="sent-full">{sent.prompt}</pre>
        </div>
      </div>
    </div>
  );
}

/** Right-click menu for asset tiles. */
export function TileMenu() {
  const { tileMenu, set } = useUI(useShallow((s) => ({ tileMenu: s.tileMenu, set: s.set })));
  const addMediaNode = useCanvas((s) => s.addMediaNode);
  const center = useViewportCenter();
  if (!tileMenu) return null;
  const close = () => set({ tileMenu: null });
  return (
    <div className="popover ctx-menu" style={clampToViewport(tileMenu.x, tileMenu.y, 200, 100)} onMouseDown={(e) => e.stopPropagation()} onMouseLeave={close}>
      <button
        onClick={() => {
          addMediaNode(tileMenu.media, center());
          close();
        }}
      >
        <span>添加到画布</span>
      </button>
      <button
        disabled={!isServerId(tileMenu.media.id)}
        onClick={() => {
          revealInFinder(tileMenu.media.id);
          close();
        }}
      >
        <span>在访达中显示</span>
      </button>
    </div>
  );
}

export function TopBar() {
  const { name, setName, saveStatus, undo, redo, canUndo, canRedo, importJson, clear } = useCanvas(
    useShallow((s) => ({
      name: s.name,
      setName: s.setName,
      saveStatus: s.saveStatus,
      undo: s.undo,
      redo: s.redo,
      canUndo: s.past.length > 0,
      canRedo: s.future.length > 0,
      importJson: s.importJson,
      clear: s.clear,
    })),
  );
  const notify = useUI((s) => s.notify);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="topbar topbar-left">
        <div className="logo">
          <Icon name="sparkles" size={16} />
          <b>WCcanvastv</b>
        </div>
        <ProjectName name={name} setName={setName} />
        <SaveStatusChip status={saveStatus} />
        <div className="sep" />
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title={`撤销 ${isMac ? '⌘' : 'Ctrl'} Z`}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} title={`重做 ${isMac ? '⌘⇧' : 'Ctrl Shift'} Z`}>
          <Icon name="redo" />
        </button>
      </div>
      <div className="topbar topbar-right">
        <Engines />
        <button className="text-btn" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} />
          导入
        </button>
        <button className="text-btn" onClick={() => downloadText(exportJson(), `${name}.libcanvas.json`, 'application/json')}>
          <Icon name="download" size={14} />
          导出
        </button>
        <button
          className="text-btn"
          onClick={() => {
            if (confirm('清空画布上的所有节点？（可撤销）')) clear();
          }}
        >
          <Icon name="trash" size={14} />
          清空
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              importJson(await f.text());
              notify('已导入画布');
            } catch (err) {
              notify(`导入失败：${err instanceof Error ? err.message : err}`);
            }
          }}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bottom toolbar & view controls
// ---------------------------------------------------------------------------

export function BottomToolbar() {
  const { tool, setSettings } = useCanvas(useShallow((s) => ({ tool: s.settings.tool, setSettings: s.setSettings })));
  const { panel, togglePanel, set, menu, studio } = useUI(useShallow((s) => ({ panel: s.panel, togglePanel: s.togglePanel, set: s.set, menu: s.menu, studio: s.studio })));
  const center = useViewportCenter();
  const addRef = useRef<HTMLButtonElement>(null);
  const [matOpen, setMatOpen] = useState(false);
  const allOpen = useUI((s) => s.allFeatures);
  return (
    <div className="dock">
      <AllFeaturesPanel />
      <div className="dock-group">
        <button
          ref={addRef}
          className={`dock-btn dock-add ${menu && !menu.from ? 'on' : ''}`}
          title="添加节点 (Tab)"
          onClick={() => {
            if (menu) return set({ menu: null });
            const r = addRef.current!.getBoundingClientRect();
            set({ menu: { x: r.left, y: r.top - 8, flow: center(), anchor: 'above' } });
          }}
        >
          <Icon name="plus" size={18} />
        </button>
        <button className={`dock-btn ${tool === 'move' ? 'on' : ''}`} title="移动 (V)" onClick={() => setSettings({ tool: 'move' })}>
          <Icon name="pointer" />
        </button>
        <button className={`dock-btn ${tool === 'hand' ? 'on' : ''}`} title="抓手 (H)" onClick={() => setSettings({ tool: 'hand' })}>
          <Icon name="hand" />
        </button>
        <span className="dock-sep" />
        <button className={`dock-btn ${allOpen ? 'on' : ''}`} title="全部功能：图片预设和所有本地工具" onClick={() => set({ allFeatures: !allOpen })}>
          <Icon name="grid" />
        </button>
        <div className="dock-pop-wrap">
          <button className={`dock-btn ${matOpen ? 'on' : ''}`} title="素材库" onClick={() => setMatOpen(!matOpen)}>
            <Icon name="shapes" />
          </button>
          {matOpen && (
            <div className="popover dock-pop" onMouseLeave={() => setMatOpen(false)}>
              <div className="menu-head">素材库</div>
              {(
                [
                  ['palette', '风格库', true, () => set({ library: { kind: 'style' } })],
                  ['aperture', '特效库', true, () => set({ library: { kind: 'lens' } })],
                  ['film', '视频玩法库', true, () => set({ methodFor: 'new' })],
                  ['workflow', '打开工具箱', false, () => set({ toolbox: true })],
                ] as const
              ).map(([icon, label, isNew, fn]) => (
                <button
                  key={label}
                  onClick={() => {
                    fn();
                    setMatOpen(false);
                  }}
                >
                  <span className="pop-item">
                    <Icon name={icon} />
                    {label}
                  </span>
                  {isNew && <span className="new-tag">NEW</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className={`dock-btn ${studio ? 'on' : ''}`} title="角色库" onClick={() => set({ studio: studio ? null : {} })}>
          <Icon name="smile" />
        </button>
        <button className={`dock-btn ${panel === 'history' ? 'on' : ''}`} title="生成历史" onClick={() => togglePanel('history')}>
          <Icon name="clock" />
        </button>
        <button className="dock-btn" title={`搜索节点 ${isMac ? '⌘' : 'Ctrl'} F`} onClick={() => set({ search: true })}>
          <Icon name="search" />
        </button>
        <button className={`dock-btn ${panel === 'shortcuts' ? 'on' : ''}`} title="快捷键" onClick={() => togglePanel('shortcuts')}>
          <Icon name="keyboard" />
        </button>
      </div>
    </div>
  );
}

export function ViewControls({ onTidy }: { onTidy: () => void }) {
  const { settings, setSettings } = useCanvas(useShallow((s) => ({ settings: s.settings, setSettings: s.setSettings })));
  const { panel, togglePanel } = useUI(useShallow((s) => ({ panel: s.panel, togglePanel: s.togglePanel })));
  const zoom = useFlowStore((s) => s.transform[2]);
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow();
  const [open, setOpen] = useState(false);
  // The minimap sits just above this bar: tell it where the bar's top edge is (the bar moves
  // up and can wrap on narrow windows).
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const update = () => document.documentElement.style.setProperty('--view-controls-top', `${window.innerHeight - el.getBoundingClientRect().top}px`);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    update();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return (
    <div className="view-controls" ref={bar}>
      <button className={`text-btn ${panel === 'assets' ? 'on' : ''}`} onClick={() => togglePanel('assets')}>
        <Icon name="sidebar" size={14} />
        资产管理
      </button>
      <button className="icon-btn" title={`整理画布 ${isMac ? '⌥⇧' : 'Alt Shift'} F`} onClick={onTidy}>
        <Icon name="tidy" />
      </button>
      <button className={`icon-btn ${settings.minimap ? 'on' : ''}`} title="切换小地图" onClick={() => setSettings({ minimap: !settings.minimap })}>
        <Icon name="map" />
      </button>
      <button className={`icon-btn ${settings.showEdges ? '' : 'on'}`} title={settings.showEdges ? '隐藏节点连线' : '显示节点连线'} onClick={() => setSettings({ showEdges: !settings.showEdges })}>
        <Icon name="link" />
      </button>
      <button className={`icon-btn ${settings.snap ? 'on' : ''}`} title="网格吸附" onClick={() => setSettings({ snap: !settings.snap })}>
        <Icon name="magnet" />
      </button>
      <div className="zoom-wrap">
        <button className="text-btn zoom-btn" onClick={() => setOpen(!open)} title="缩放选项">
          {Math.round(zoom * 100)}%
          <Icon name="down" size={12} />
        </button>
        {open && (
          <div className="popover zoom-menu" onMouseLeave={() => setOpen(false)}>
            {[
              ['放大', `${isMac ? '⌘' : 'Ctrl'} +`, () => zoomIn({ duration: 200 })],
              ['缩小', `${isMac ? '⌘' : 'Ctrl'} -`, () => zoomOut({ duration: 200 })],
              ['适合屏幕', `${isMac ? '⌘' : 'Ctrl'} 0`, () => fitView({ duration: 300, padding: 0.2 })],
              ['缩放至 50%', '', () => zoomTo(0.5, { duration: 200 })],
              ['缩放至 100%', `${isMac ? '⌘' : 'Ctrl'} 1`, () => zoomTo(1, { duration: 200 })],
              ['缩放至 200%', '', () => zoomTo(2, { duration: 200 })],
            ].map(([label, key, fn]) => (
              <button
                key={label as string}
                onClick={() => {
                  (fn as () => void)();
                  setOpen(false);
                }}
              >
                <span>{label as string}</span>
                <kbd>{key as string}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-node menu & context menu
// ---------------------------------------------------------------------------

export function NodeMenu() {
  const { menu, set, togglePanel } = useUI(useShallow((s) => ({ menu: s.menu, set: s.set, togglePanel: s.togglePanel })));
  const addNode = useCanvas((s) => s.addNode);
  if (!menu) return null;
  // Open toward whichever side has more room and cap the height there; the rest scrolls.
  const vh = window.innerHeight;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 268));
  const below = vh - menu.y - 8;
  const above = menu.y - 8;
  const up = menu.anchor === 'above' || (below < 420 && above > below);
  const pos = up ? { left, bottom: vh - menu.y, maxHeight: above } : { left, top: menu.y, maxHeight: below };
  return (
    <div className="popover node-menu nowheel" style={pos} onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="menu-head">{menu.from ? '拖拽连线或点击选择节点类型' : '添加节点'}</div>
      {MENU_KINDS.map((k) => {
        const meta = NODE_META[k];
        return (
          <button
            key={k}
            className="menu-item"
            onClick={() => {
              const id = addNode(k, menu.flow, { from: menu.from });
              set({ menu: null });
              if (k === 'style' || k === 'lens') set({ library: { kind: k, targetNodeId: id } });
              if (k === 'method') set({ methodFor: id });
              if (k === 'character') set({ studio: { pickFor: id } });
            }}
          >
            <span className="menu-icon">
              <Icon name={meta.icon} />
            </span>
            <span className="menu-text">
              <b>{meta.label}</b>
              <small>{meta.desc}</small>
            </span>
          </button>
        );
      })}
      {!menu.from && (
        <>
          <div className="menu-head">添加资源</div>
          <button className="menu-item" onClick={() => requestUpload(menu.flow)}>
            <span className="menu-icon">
              <Icon name="upload" />
            </span>
            <span className="menu-text">
              <b>上传</b>
              <small>可上传图片、视频、音频文件</small>
            </span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              set({ menu: null });
              togglePanel('history');
            }}
          >
            <span className="menu-icon">
              <Icon name="clock" />
            </span>
            <span className="menu-text">
              <b>从生成历史选择</b>
              <small>从历史生成中选择素材</small>
            </span>
          </button>
        </>
      )}
    </div>
  );
}

export function ContextMenu({ onTidy }: { onTidy: () => void }) {
  const { ctx, set } = useUI(useShallow((s) => ({ ctx: s.ctx, set: s.set })));
  const s = useCanvas();
  if (!ctx) return null;
  const selected = s.nodes.filter((n) => n.selected).map((n) => n.id);
  const target = ctx.nodeId ? s.nodes.find((n) => n.id === ctx.nodeId) : undefined;
  const ids = target ? (selected.includes(target.id) ? selected : [target.id]) : [];
  const genIds = s.nodes.filter((n) => ids.includes(n.id) && isGenKind(n.type)).map((n) => n.id);
  const targetMedia = target ? currentOutput(target.data)?.media : undefined;
  const projectId = useProject.getState().id;
  const close = () => set({ ctx: null });
  const item = (label: string, key: string, fn: () => void, disabled = false) => (
    <button
      key={label}
      disabled={disabled}
      onClick={() => {
        fn();
        close();
      }}
    >
      <span>{label}</span>
      {key && <kbd>{key}</kbd>}
    </button>
  );
  const m = isMac ? '⌘' : 'Ctrl ';
  return (
    <div className="popover ctx-menu" style={clampToViewport(ctx.x, ctx.y, 240, 300)} onMouseDown={(e) => e.stopPropagation()}>
      {target ? (
        <>
          {genIds.length > 0 && item(`生成${genIds.length > 1 ? ` ${genIds.length} 个节点` : ''}`, `${m}↵`, () => s.run(genIds))}
          {item('复制', `${m}C`, () => s.copy(ids))}
          {item('创建副本', `${m}D`, () => s.duplicate(ids))}
          {item('连接选中节点', `${m}L`, () => s.connectChain(ids), ids.length < 2)}
          {item('分组', `${m}G`, () => s.group(ids))}
          {item('取消分组', `${m}⇧G`, () => s.ungroup(ids), !s.nodes.some((n) => ids.includes(n.id) && (n.type === 'group' || n.parentId)))}
          {targetMedia && (
            <>
              <hr />
              {item('在访达中显示', '', () => revealInFinder(targetMedia.id), !isServerId(targetMedia.id))}
            </>
          )}
          <hr />
          {item('删除', 'Del', () => s.deleteNodes(ids))}
        </>
      ) : (
        <>
          {item('添加节点', 'Tab', () => set({ menu: { x: ctx.x, y: ctx.y, flow: ctx.flow } }))}
          {item('粘贴', `${m}V`, () => s.paste(ctx.flow))}
          {item('上传素材', '', () => requestUpload(ctx.flow))}
          <hr />
          {item('全选', `${m}A`, s.selectAll)}
          {item('整理画布', isMac ? '⌥⇧F' : 'Alt Shift F', onTidy)}
          {projectId && item('在访达中显示项目文件夹', '', () => revealInFinder(projectId))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panels
// ---------------------------------------------------------------------------

function MediaTile({ media, title, onAdd }: { media: MediaRef; title?: string; onAdd: () => void }) {
  return (
    <button
      className="tile"
      draggable
      title={`${title ?? media.name ?? ''}\n点击添加到画布，或拖到画布上`}
      onDragStart={(e) => e.dataTransfer.setData('application/x-libcanvas-media', JSON.stringify(media))}
      onClick={onAdd}
      onContextMenu={(e) => {
        e.preventDefault();
        useUI.getState().set({ tileMenu: { x: e.clientX, y: e.clientY, media } });
      }}
    >
      <MediaThumb media={media} />
      <span className="tile-kind">{media.kind === 'image' ? '图片' : media.kind === 'video' ? '视频' : '音频'}</span>
    </button>
  );
}

const FOLDERS: { kind: ArchivedFile['kind']; label: string; icon: string }[] = [
  { kind: 'image', label: '图片', icon: 'image' },
  { kind: 'video', label: '视频', icon: 'video' },
  { kind: 'audio', label: '音频', icon: 'audio' },
  { kind: 'file', label: '其他', icon: 'file' },
];
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * 资产管理: the current project's files, one folder per kind. Rows only (no thumbnails), so a
 * project with hundreds of files stays light; click or drag a file onto the canvas.
 */
export function AssetsPanel() {
  const { panel, set } = useUI(useShallow((s) => ({ panel: s.panel, set: s.set })));
  const { assets, history, addMediaNode } = useCanvas(useShallow((s) => ({ assets: s.assets, history: s.history, addMediaNode: s.addMediaNode })));
  const center = useViewportCenter();
  const projectId = useProject((s) => s.id);
  const [archive, setArchive] = useState<{ dir: string; files: ArchivedFile[] } | null | undefined>(undefined);
  const [open, setOpen] = useState<Partial<Record<ArchivedFile['kind'], boolean>>>({});
  useEffect(() => {
    if (panel === 'assets') listArchive(projectId || undefined).then(setArchive);
  }, [panel, projectId, assets.length, history.length]);
  if (panel !== 'assets') return null;
  const media = (f: ArchivedFile): MediaRef => ({ id: f.id, kind: f.kind as MediaKind, name: f.name });
  return (
    <aside className="drawer drawer-left">
      <header>
        <b>资产管理</b>
        <button className="icon-btn" onClick={() => set({ panel: null })}>
          <Icon name="x" />
        </button>
      </header>
      <button className="upload-btn" onClick={() => requestUpload(center())}>
        <Icon name="upload" size={14} /> 上传图片 / 视频 / 音频
      </button>
      {archive === undefined ? (
        <p className="empty">读取中…</p>
      ) : archive === null ? (
        <p className="empty">本地服务未启动，无法读取项目文件夹</p>
      ) : (
        <>
          <button className="text-btn archive-dir" title="在访达中显示" onClick={() => revealInFinder(projectId || undefined)}>
            <Icon name="folder" size={14} />
            <span>{archive.dir.replace(/^\/Users\/[^/]+/, '~')}</span>
          </button>
          <div className="asset-folders nowheel">
            {FOLDERS.map((f) => {
              const files = archive.files.filter((x) => x.kind === f.kind);
              if (!files.length && f.kind === 'file') return null;
              return (
                <div key={f.kind} className="asset-folder">
                  <button className={`asset-folder-head ${open[f.kind] ? 'on' : ''}`} onClick={() => setOpen({ ...open, [f.kind]: !open[f.kind] })}>
                    <Icon name={open[f.kind] ? 'down' : 'right'} size={12} />
                    <Icon name={f.icon} size={14} />
                    <span>{f.label}</span>
                    <small>{files.length}</small>
                  </button>
                  {open[f.kind] &&
                    (files.length ? (
                      files.map((x) => (
                        <button
                          key={x.id}
                          className="asset-row"
                          draggable={x.kind !== 'file'}
                          title={`${x.id}\n${x.kind === 'file' ? '' : '点击添加到画布，或拖到画布上'}`}
                          onDragStart={(e) => e.dataTransfer.setData('application/x-libcanvas-media', JSON.stringify(media(x)))}
                          onClick={() => (x.kind === 'file' ? revealInFinder(x.id) : addMediaNode(media(x), center()))}
                          onContextMenu={(e) => {
                            if (x.kind === 'file') return;
                            e.preventDefault();
                            useUI.getState().set({ tileMenu: { x: e.clientX, y: e.clientY, media: media(x) } });
                          }}
                        >
                          <span className="asset-name">{x.name.replace(/^\d{6}-/, '')}</span>
                          <small>{fmtSize(x.size)}</small>
                        </button>
                      ))
                    ) : (
                      <p className="empty small">还没有{f.label}</p>
                    ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}

const fmtTime = (t: number) => new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function Stars({ item }: { item: HistoryItem }) {
  const rate = useCanvas((s) => s.rateHistory);
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={(item.rating ?? 0) >= n ? 'on' : ''} onClick={() => rate(item.id, item.rating === n ? 0 : n)} aria-label={`评 ${n} 星`}>
          <Icon name="star" size={11} />
        </button>
      ))}
    </span>
  );
}

export function HistoryPanel() {
  const { panel, set } = useUI(useShallow((s) => ({ panel: s.panel, set: s.set })));
  const { history, addMediaNode, addNode } = useCanvas(useShallow((s) => ({ history: s.history, addMediaNode: s.addMediaNode, addNode: s.addNode })));
  const center = useViewportCenter();
  const [tab, setTab] = useState<HistoryItem['kind']>('image');
  const [minRating, setMinRating] = useState(0);
  if (panel !== 'history') return null;
  const list = history.filter((h) => h.kind === tab && (h.rating ?? 0) >= minRating);
  return (
    <aside className="drawer drawer-right">
      <header>
        <b>生成历史</b>
        <button className="icon-btn" onClick={() => set({ panel: null })}>
          <Icon name="x" />
        </button>
      </header>
      <div className="tabs">
        {(
          [
            ['image', '图片'],
            ['video', '视频'],
            ['audio', '音频'],
            ['text', '文本'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
        <select className="pp-select" value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
          <option value={0}>所有评级</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}星及以上
            </option>
          ))}
        </select>
      </div>
      {list.length === 0 ? (
        <p className="empty">暂无历史记录</p>
      ) : (
        <div className="history-list">
          {list.map((h) => (
            <div key={h.id} className="history-item">
              {h.media ? (
                <MediaTile media={h.media} onAdd={() => addMediaNode(h.media!, center())} />
              ) : (
                <div className="history-text">{h.text}</div>
              )}
              <div className="history-meta">
                <p title={h.prompt}>{h.prompt || '（无提示词）'}</p>
                <small>
                  {h.model} · {fmtTime(h.createdAt)}
                </small>
                <div className="history-actions">
                  <Stars item={h} />
                  <button
                    className="text-btn"
                    onClick={() => (h.media ? addMediaNode(h.media, center()) : addNode('text', center(), { data: { text: h.text } }))}
                  >
                    添加到画布
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

export function ShortcutsPanel() {
  const { panel, set } = useUI(useShallow((s) => ({ panel: s.panel, set: s.set })));
  if (panel !== 'shortcuts') return null;
  const groups = [
    ['creation', '创作'],
    ['zoom', '缩放'],
    ['move', '移动画布'],
    ['other', '其他'],
  ] as const;
  return (
    <div className="shortcuts">
      <button className="icon-btn close" onClick={() => set({ panel: null })} aria-label="关闭快捷键面板">
        <Icon name="x" />
      </button>
      {groups.map(([g, title]) => (
        <section key={g}>
          <h4>{title}</h4>
          {SHORTCUTS.filter((s) => s.group === g && !s.hidden).map((s) => (
            <div key={s.id} className="sc-row">
              <span>{s.label}</span>
              <kbd>{formatCombo(s.combo[0])}</kbd>
            </div>
          ))}
          {GESTURES.filter((s) => s.group === g).map((s) => (
            <div key={s.label + s.keys} className="sc-row">
              <span>{s.label}</span>
              <kbd>{s.keys}</kbd>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

export function SearchModal() {
  const { search, set } = useUI(useShallow((s) => ({ search: s.search, set: s.set })));
  const { nodes, select } = useCanvas(useShallow((s) => ({ nodes: s.nodes, select: s.select })));
  const { setCenter } = useReactFlow();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => {
    const k = q.trim().toLowerCase();
    return nodes.filter((n) => !k || n.data.title.toLowerCase().includes(k) || (n.data.prompt ?? '').toLowerCase().includes(k) || (n.data.text ?? '').toLowerCase().includes(k)).slice(0, 50);
  }, [nodes, q]);
  useEffect(() => {
    if (search) {
      setQ('');
      setActive(0);
    }
  }, [search]);
  if (!search) return null;
  const go = (i: number) => {
    const n = results[i];
    if (!n) return;
    const p = absPos(n, nodes);
    const { w, h } = sizeOf(n);
    select([n.id]);
    setCenter(p.x + w / 2, p.y + h / 2, { zoom: 1, duration: 400 });
    set({ search: false });
  };
  return (
    <div className="modal-backdrop" onMouseDown={() => set({ search: false })}>
      <div className="search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="搜索节点名称、提示词或文本…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive(Math.min(active + 1, results.length - 1));
              if (e.key === 'ArrowUp') setActive(Math.max(active - 1, 0));
              if (e.key === 'Enter') go(active);
              if (e.key === 'Escape') set({ search: false });
            }}
          />
        </div>
        <div className="search-results">
          {results.length === 0 && <p className="empty">没有匹配的节点</p>}
          {results.map((n, i) => (
            <button key={n.id} className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onClick={() => go(i)}>
              <Icon name={NODE_META[n.type ?? 'text'].icon} size={14} />
              <span>{n.data.title}</span>
              <small>{n.data.prompt || n.data.text?.slice(0, 40)}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TidyToast() {
  const { tidyPrev, set } = useUI(useShallow((s) => ({ tidyPrev: s.tidyPrev, set: s.set })));
  const restore = useCanvas((s) => s.restorePositions);
  const { fitView } = useReactFlow();
  if (!tidyPrev) return null;
  return (
    <div className="toast toast-action">
      <span>是否保留此次整理结果？</span>
      <button
        className="text-btn"
        onClick={() => {
          restore(tidyPrev);
          set({ tidyPrev: null });
          setTimeout(() => fitView({ duration: 300, padding: 0.2 }), 0);
        }}
      >
        还原
      </button>
      <button className="primary-btn" onClick={() => set({ tidyPrev: null })}>
        保留
      </button>
    </div>
  );
}

export function Toast() {
  const toast = useUI((s) => s.toast);
  return toast ? <div className="toast">{toast}</div> : null;
}

export function Lightbox() {
  const { preview, set } = useUI(useShallow((s) => ({ preview: s.preview, set: s.set })));
  const url = useMediaUrl(preview?.id);
  if (!preview) return null;
  return (
    <div className="modal-backdrop lightbox" onMouseDown={() => set({ preview: null })}>
      <div onMouseDown={(e) => e.stopPropagation()}>
        {preview.kind === 'image' && <img src={url} alt="" />}
        {preview.kind === 'video' && <video src={url} controls autoPlay />}
        {preview.kind === 'audio' && <audio src={url} controls autoPlay />}
      </div>
      <button className="icon-btn lightbox-close" onClick={() => set({ preview: null })}>
        <Icon name="x" size={20} />
      </button>
    </div>
  );
}

/** Builds a small storyboard workflow so the canvas has something to play with. */
function useLoadDemo() {
  const center = useViewportCenter();
  const { fitView } = useReactFlow();
  return () => {
    const s = useCanvas.getState();
    const c = center();
    const idea = s.addNode('text', { x: c.x - 600, y: c.y - 100 }, { data: { title: '故事创意', text: '一只橘猫在雨夜的霓虹街头寻找走失的主人，最后在一家面馆门口重逢。' } });
    const script = s.addNode('script', { x: c.x - 180, y: c.y - 140 }, { from: idea, data: { title: '分镜脚本', prompt: '雨夜霓虹街头的橘猫寻主短片' } });
    s.addNode('reference', { x: c.x - 600, y: c.y + 140 }, { data: { title: '备注', text: '风格参考：冷暖对比强烈的电影感。' } });
    s.addNode('image', { x: c.x + 260, y: c.y - 300 }, { from: idea, data: { title: '角色图', prompt: '橘猫，戴红围巾，湿漉漉的毛发，霓虹灯反光，电影感', params: { ratio: '16:9' } } });
    s.addNode('text', { x: c.x + 260, y: c.y + 80 }, { from: idea, data: { title: '宣传文案', model: 'claude', prompt: '根据故事创意写一段 60 字以内的短片宣传语' } });
    s.addNode('video', { x: c.x + 700, y: c.y - 300 }, { data: { title: '成片（上传留档）' } });
    s.select([script]);
    setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 50);
  };
}

export function EmptyHint() {
  const empty = useCanvas((s) => s.nodes.length === 0);
  const addNode = useCanvas((s) => s.addNode);
  const center = useViewportCenter();
  const loadDemo = useLoadDemo();
  if (!empty) return null;
  return (
    <div className="empty-hint">
      <h2>
        <b>双击画布</b> 自由生成节点
      </h2>
      <p>或者从下面开始，拖入图片 / 视频 / 音频文件也可以</p>
      <div className="quick">
        {(['text', 'image', 'video', 'script'] as const).map((k) => (
          <button key={k} onClick={() => addNode(k, center())}>
            <Icon name={NODE_META[k].icon} />
            {NODE_META[k].label}
          </button>
        ))}
        <button className="demo" onClick={loadDemo}>
          <Icon name="sparkles" />
          加载示例工作流
        </button>
      </div>
    </div>
  );
}
