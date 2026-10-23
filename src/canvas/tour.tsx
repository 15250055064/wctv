import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from './Icon';
import { useUI } from './ui';

// 新功能导览: after an update, a few steps that point at what's new (a ring around the button
// and a card beside it). It opens once per version by itself, and from the ? in the dock.

/** Raise this when the steps change, so the tour shows once more after the update. */
const TOUR_VERSION = '1.4';
const SEEN = 'wctv-tour-seen';

const STEPS: { target?: string; title: string; text: string }[] = [
  { title: '这次更新了什么', text: '用几步带你看看新功能，随时可以跳过；以后点底部的「?」还能再看一遍。' },
  { target: 'assets', title: '资产管理', text: '当前项目的文件按 图片 / 视频 / 音频 分好文件夹（电脑里的文件夹也一样整理好了）。新增「品牌资产」和「收藏夹」，所有项目共用，可以建自己的文件夹；顶部的搜索框能用文字描述找素材，比如「穿风衣的女生」。' },
  { title: '素材工具在节点上方', text: '选中图片、视频或音频，上方会多出一排工具：扩图、元素编辑、改文字、视频高清、智能去字幕、人声分离……鼠标停在按钮上就能看到说明。' },
  { target: 'all', title: '全部功能', text: '所有本地工具都在这里一览，选中素材后点对应工具即可。' },
  { target: 'library', title: '风格库', text: '风格库改成了简洁的列表；多机位九宫格、角色三视图、剧情推演等一键玩法在「图片玩法」分类里。' },
  { title: '粘贴就能用', text: '在画布上 ⌘V 粘贴链接，直接把图片、视频下载成节点（B 站、小红书、YouTube 等）；粘贴一段文字，会变成文本节点。' },
  { title: '更顺手的操作', text: '按住 Option 拖动节点，会拉出一个不带连线的副本；双击连线可以删除它。右键图片或视频节点可以「加入品牌资产库」或「收藏」。' },
];

export function FeatureTour() {
  const { open, set } = useUI(useShallow((s) => ({ open: s.tour, set: s.set })));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // First launch after an update: open by itself.
  useEffect(() => {
    let seen = '';
    try {
      seen = localStorage.getItem(SEEN) ?? '';
    } catch {
      // No storage: show it, harmlessly, each launch.
    }
    if (seen !== TOUR_VERSION) {
      const t = setTimeout(() => set({ tour: true }), 1500);
      return () => clearTimeout(t);
    }
  }, [set]);
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  const step = STEPS[i];
  useLayoutEffect(() => {
    if (!open) return;
    const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
    const measure = () => setRect(el ? el.getBoundingClientRect() : null);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, step]);

  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(SEEN, TOUR_VERSION);
    } catch {
      // ignore
    }
    set({ tour: false });
  };
  // The card sits above the highlighted button when it's low on the screen, below otherwise.
  const W = 320;
  const card = rect
    ? {
        left: Math.max(16, Math.min(window.innerWidth - W - 16, rect.left + rect.width / 2 - W / 2)),
        ...(rect.top > window.innerHeight / 2 ? { bottom: window.innerHeight - rect.top + 14 } : { top: rect.bottom + 14 }),
      }
    : { left: window.innerWidth / 2 - W / 2, top: window.innerHeight / 2 - 110 };

  return createPortal(
    <div className="tour-layer">
      {rect && <div className="tour-ring" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} />}
      <div className="tour-card" style={{ width: W, ...card }}>
        <div className="tour-head">
          <Icon name="sparkles" size={14} />
          <b>{step.title}</b>
          <div className="grow" />
          <small>
            {i + 1}/{STEPS.length}
          </small>
        </div>
        <p>{step.text}</p>
        <div className="row">
          <button className="text-btn" onClick={close}>
            跳过
          </button>
          <div className="grow" />
          {i > 0 && (
            <button className="text-btn" onClick={() => setI(i - 1)}>
              上一步
            </button>
          )}
          <button className="primary-btn" onClick={() => (i + 1 < STEPS.length ? setI(i + 1) : close())}>
            {i + 1 < STEPS.length ? '下一步' : '开始使用'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
