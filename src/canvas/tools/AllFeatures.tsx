import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { defaultParams } from '../config';
import { Icon } from '../Icon';
import { IMAGE_PRESETS, type ImagePreset } from '../presets';
import { absPos, currentOutput, sizeOf, useCanvas } from '../store';
import { useUI } from '../ui';
import type { CanvasNode, MediaKind } from '../types';
import { AUDIO_TOOLS, IMAGE_TOOLS, VIDEO_TOOLS, openTool, type Tool } from './ToolsUI';

// 全部功能 (in the bottom dock, like LibTV's 功能宝箱): every preset and local tool in one place.
// Tools work on the selected node; presets use it as their reference picture.

const RATIOS = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4, '21:9': 21 / 9 } as const;
/** The image node's ratio closest to a w×h picture. */
const nearestRatio = (w: number, h: number) => (Object.keys(RATIOS) as (keyof typeof RATIOS)[]).reduce((a, b) => (Math.abs(Math.log(RATIOS[b] / (w / h))) < Math.abs(Math.log(RATIOS[a] / (w / h))) ? b : a));

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

/** A new image node to the right of `src` (or mid-canvas), wired from it, using the preset. */
function applyPreset(preset: ImagePreset, src: CanvasNode | undefined, center: { x: number; y: number }) {
  const s = useCanvas.getState();
  const media = src ? currentOutput(src.data)?.media : undefined;
  const ratio = preset.ratio === 'source' ? (media?.w && media?.h ? nearestRatio(media.w, media.h) : '16:9') : preset.ratio;
  const at = src ? (() => {
    const p = absPos(src, s.nodes);
    return { x: p.x + sizeOf(src).w + 120, y: p.y };
  })() : center;
  const id = s.addNode('image', at, {
    from: src?.id,
    data: { title: preset.name, prompt: preset.prompt, params: { ...defaultParams('image'), ratio } },
  });
  if (src) s.run([id]);
  useUI.getState().notify(src ? `正在用 ChatGPT 生成「${preset.name}」（约 1 分钟）` : `已添加「${preset.name}」节点：连一张参考图，或补充描述后点 ↑ 生成`);
}

export function AllFeaturesPanel({ center }: { center: () => { x: number; y: number } }) {
  const { open, set, notify } = useUI(useShallow((s) => ({ open: s.allFeatures, set: s.set, notify: s.notify })));
  const sel = useSelection();
  if (!open) return null;
  const close = () => set({ allFeatures: false });
  const node = () => useCanvas.getState().nodes.find((n) => n.id === sel.id);

  const tool = (t: Tool, kinds: MediaKind[]) => {
    if (!sel.id || !sel.kind || !kinds.includes(sel.kind)) return notify(`请先在画布上选中一个${kinds.map((k) => ({ image: '图片', video: '视频', audio: '音频' })[k]).join(' / ')}节点`);
    close();
    openTool(t, sel.id);
  };
  const preset = (p: ImagePreset) => {
    if (sel.id && sel.kind !== 'image') return notify('预设需要选中一张图片作参考，或者什么都不选来新建');
    close();
    applyPreset(p, sel.id ? node() : undefined, center());
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
          <section className="af-section">
            <h4>
              图片预设
              <small>ChatGPT 生成，每次消耗一张生图额度；选中图片作参考，不选则新建空白节点</small>
            </h4>
            <div className="af-grid">
              {IMAGE_PRESETS.map((p) => (
                <button key={p.id} className={`af-item ${!sel.id || sel.kind === 'image' ? '' : 'dim'}`} onClick={() => preset(p)}>
                  <Icon name="sparkles" size={16} />
                  <span>
                    <b>{p.name}</b>
                    <small>{p.desc}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
          {section('图片工具', '本机运行，免费', IMAGE_TOOLS, ['image'])}
          {section('视频工具', '本机运行，免费', VIDEO_TOOLS.filter((t) => !AUDIO_TOOLS.includes(t)), ['video'])}
          {section('音频工具', '本机运行，免费；视频的声音也可以', AUDIO_TOOLS, ['audio', 'video'])}
        </div>
      </div>
    </div>,
    document.body,
  );
}
