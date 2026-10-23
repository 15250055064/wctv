import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from '../Icon';
import { currentOutput, useCanvas } from '../store';
import { useUI } from '../ui';
import type { MediaKind } from '../types';
import { AUDIO_TOOLS, IMAGE_TOOLS, VIDEO_TOOLS, openTool, type Tool } from './ToolsUI';

// 全部功能 (in the bottom dock, like LibTV's 功能宝箱): every local tool in one place, working on
// the selected node. (The image presets are in 风格库 → 图片玩法.)


/** The single selected node with media, and what kind it is. */
function useSelection() {
  return useCanvas(
    useShallow((s) => {
      const sel = s.nodes.filter((n) => n.selected && n.type !== 'group');
      const media = sel.length === 1 ? currentOutput(sel[0].data)?.media : undefined;
      return { id: sel.length === 1 ? sel[0].id : null, title: sel.length === 1 ? sel[0].data.title : '', kind: media?.kind ?? null, w: media?.w ?? 0, h: media?.h ?? 0 };
    }),
  );
}

export function AllFeaturesPanel() {
  const { open, set, notify } = useUI(useShallow((s) => ({ open: s.allFeatures, set: s.set, notify: s.notify })));
  const sel = useSelection();
  if (!open) return null;
  const close = () => set({ allFeatures: false });

  const tool = (t: Tool, kinds: MediaKind[]) => {
    if (!sel.id || !sel.kind || !kinds.includes(sel.kind)) return notify(`请先在画布上选中一个${kinds.map((k) => ({ image: '图片', video: '视频', audio: '音频' })[k]).join(' / ')}节点`);
    close();
    openTool(t, sel.id);
  };

  const section = (title: string, hint: string, tools: Tool[], kinds: MediaKind[]) => (
    <section className="af-section">
      <h4>
        {title}
        <small>{hint}</small>
      </h4>
      <div className="af-grid">
        {tools.map((t) => (
          <button key={t.name} className={`af-item ${sel.kind && kinds.includes(sel.kind) ? '' : 'dim'}`} onClick={() => tool(t, kinds)}>
            <Icon name={t.icon} size={16} />
            <span>
              <b>{t.label}</b>
              <small>{t.desc}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  // A portal: the dock it's opened from is transformed, which would trap a fixed overlay.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal af-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">全部功能</h3>
          <span className="muted small">{sel.id ? `当前选中：${sel.title}` : '先在画布上选中一个素材，再选功能'}</span>
          <div className="grow" />
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="prefs-body af-body nowheel">
          {section('图片工具', '本机运行，免费', IMAGE_TOOLS, ['image'])}
          {section('视频工具', '本机运行，免费', VIDEO_TOOLS.filter((t) => !AUDIO_TOOLS.includes(t)), ['video'])}
          {section('音频工具', '本机运行，免费；视频的声音也可以', AUDIO_TOOLS, ['audio', 'video'])}
        </div>
      </div>
    </div>,
    document.body,
  );
}
