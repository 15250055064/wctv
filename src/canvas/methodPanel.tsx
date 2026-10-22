import { useShallow } from 'zustand/react/shallow';
import { Icon } from './Icon';
import { METHODS } from './methods';
import { MethodPreview } from './nodes';
import { useViewportCenter } from './panels';
import { useCanvas } from './store';
import { useUI } from './ui';

/**
 * The video-method library (素材库 → 视频玩法库, or a method node's 选择玩法): what each method
 * looks like, what it does, where it comes from. Opened from 素材库 it adds a new method node.
 */
export function MethodLibrary() {
  const { methodFor, set } = useUI(useShallow((s) => ({ methodFor: s.methodFor, set: s.set })));
  const node = useCanvas((s) => (methodFor ? s.nodes.find((n) => n.id === methodFor) : undefined));
  const center = useViewportCenter();
  if (!methodFor || (!node && methodFor !== 'new')) return null;
  const close = () => set({ methodFor: null });
  const choose = (id: string, name: string) => {
    const s = useCanvas.getState();
    if (node) {
      s.commit();
      s.updateData(node.id, { methodId: id, title: name });
    } else s.addNode('method', center(), { data: { methodId: id, title: name }, select: true });
    close();
  };
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal method-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">视频玩法库</h3>
          <span className="muted small">选好后写下想做的视频，Claude Code 或 ChatGPT 会用 HyperFrames 按这个玩法直接做出成片；连到文本、脚本、图片节点时，它们也会按玩法来写</span>
          <div className="grow" />
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="method-grid">
          {METHODS.map((m) => (
            <article key={m.id} className={`method-card ${node?.data.methodId === m.id ? 'on' : ''}`}>
              <MethodPreview m={m} className="method-card-media" />
              <div className="method-card-body">
                <div className="method-card-title">
                  <b>{m.name}</b>
                  <span>{m.tagline}</span>
                </div>
                <h5>效果</h5>
                <p>{m.effect}</p>
                <h5>功能</h5>
                <ul>
                  {m.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <p className="method-card-fit">适合：{m.bestFor}</p>
                <div className="method-card-foot">
                  <a href={`https://github.com/${m.repo}`} target="_blank" rel="noreferrer" title="在浏览器打开原仓库">
                    {m.repo} · {m.author} · MIT
                  </a>
                  <button className="primary-btn" onClick={() => choose(m.id, m.name)}>
                    {node?.data.methodId === m.id ? '正在使用' : node ? '使用这个玩法' : '添加到画布'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
