import { useShallow } from 'zustand/react/shallow';
import { Icon } from './Icon';
import { revealInFinder } from './media';
import { useCanvas } from './store';
import { useUI } from './ui';

/**
 * HyperFrames Studio (the editor that ships with HyperFrames) on a 玩法 node's production
 * folder. Edits save into the folder; 「渲染为新版本」 turns them into a new film on the node.
 */
export function HFStudioWindow() {
  const { st, set } = useUI(useShallow((s) => ({ st: s.hfStudio, set: s.set })));
  const rerender = useCanvas((s) => s.rerenderFilm);
  if (!st) return null;
  const close = () => set({ hfStudio: null });
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal hfs-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">HyperFrames Studio</h3>
          <span className="muted hfs-hint">在这里改文字、画面和时间线，修改会自动保存到制作文件夹</span>
          <div className="grow" />
          <button className="text-btn" onClick={() => revealInFinder(`${st.workspace}/index.html`)}>
            <Icon name="folder" size={14} /> 打开文件夹
          </button>
          <button className="text-btn" onClick={() => window.open(st.url, '_blank')}>
            <Icon name="expand" size={14} /> 在浏览器中打开
          </button>
          <button
            className="primary-btn"
            onClick={() => {
              rerender(st.nodeId);
              close();
            }}
          >
            <Icon name="refresh" size={14} /> 渲染为新版本
          </button>
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <iframe className="hfs-frame" src={st.url} title="HyperFrames Studio" allow="autoplay; clipboard-read; clipboard-write" />
      </div>
    </div>
  );
}
