import { useEffect, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Icon } from './Icon';
import { linkSite, shareLink } from './links';

// After copying a link somewhere else (抖音, B站, a browser…), coming back to WCcanvastv offers to
// download it onto the canvas. The clipboard text is only checked for a link, and each copied
// link is offered once.

const offered = new Set<string>();

/** Marks a link as handled (e.g. it was pasted), so it isn't offered again. */
export const linkHandled = (url: string) => offered.add(url);

export function LinkPrompt() {
  const [link, setLink] = useState<string | null>(null);
  const rf = useReactFlow();
  useEffect(() => {
    const check = async () => {
      const r = await fetch('/api/clipboard').catch(() => null);
      const text: string = (await r?.json().catch(() => null))?.text ?? '';
      const url = shareLink(text);
      if (url && !offered.has(url)) {
        offered.add(url);
        setLink(url);
      }
    };
    // The link copied before the app was opened counts as already seen.
    fetch('/api/clipboard')
      .then((r) => r.json())
      .then((b) => {
        const url = shareLink(b.text ?? '');
        if (url) offered.add(url);
      })
      .catch(() => {});
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);
  if (!link) return null;
  const download = () => {
    const at = rf.screenToFlowPosition({ x: window.innerWidth / 2 - 180, y: window.innerHeight / 2 - 120 });
    import('./tools/ToolsUI').then((t) => t.downloadLink(link, at));
    setLink(null);
  };
  return (
    <div className="link-prompt">
      <Icon name="link" size={16} />
      <span className="link-prompt-text">
        <b>检测到复制的{linkSite(link)}链接</b>
        <small>{link}</small>
      </span>
      <button className="text-btn" onClick={() => setLink(null)}>
        忽略
      </button>
      <button className="primary-btn" onClick={download}>
        下载到画布
      </button>
    </div>
  );
}
