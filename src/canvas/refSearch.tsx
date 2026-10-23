import { useState } from 'react';
import { nanoid } from 'nanoid';
import { Icon } from './Icon';
import { listArchive, listShelf, useMediaUrl, type ArchivedFile } from './media';
import { currentProjectId } from './project';
import { useCanvas } from './store';
import { useUI } from './ui';
import type { MediaKind, MediaRef } from './types';

// 找素材 under a node's prompt: describe a picture, and the closest ones from this project,
// 品牌资产 and 收藏夹 show up; clicking one puts it on the canvas wired into the node as a
// reference. Uses the same Chinese-CLIP search as 资产管理.

const asMedia = (f: ArchivedFile): MediaRef & { mtime: number } => ({ id: f.id, kind: f.kind as MediaKind, name: f.name, mtime: f.mtime });

async function allFiles() {
  const project = currentProjectId();
  const [own, brand, fav] = await Promise.all([listArchive(project || undefined), listShelf('brand'), listShelf('fav')]);
  return [...(own?.files ?? []), ...[brand, fav].flatMap((s) => s?.folders.flatMap((f) => f.files) ?? [])].map(asMedia);
}

function Hit({ media, onPick }: { media: MediaRef; onPick: () => void }) {
  const url = useMediaUrl(media.kind === 'image' ? media.id : undefined);
  const name = (media.name ?? '').replace(/^(\d{4}-)?\d{6}-/, '');
  return (
    <button className="rs-hit" title={`${name}\n点击连到这个节点作参考`} onClick={onPick}>
      {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <Icon name={media.kind === 'video' ? 'video' : 'image'} size={18} />}
    </button>
  );
}

export function RefSearch({ id, onClose }: { id: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [hits, setHits] = useState<MediaRef[] | null>(null);
  const search = async () => {
    if (!q.trim()) return;
    setBusy('正在搜索…');
    try {
      const { searchMedia } = await import('./tools/search');
      setHits((await searchMedia(q.trim(), await allFiles(), setBusy, 10)).map((h) => h.media));
    } catch (err) {
      useUI.getState().notify(`搜索失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy('');
    }
  };
  const pick = (media: MediaRef) => {
    const s = useCanvas.getState();
    const node = s.nodes.find((n) => n.id === id);
    if (!node) return;
    // To the left of the node, stacked below earlier picks.
    const inputs = s.edges.filter((e) => e.target === id).length;
    s.addNode(media.kind, { x: node.position.x - 380, y: node.position.y + inputs * 60 }, {
      to: id,
      select: false,
      data: { title: (media.name ?? '素材').replace(/^(\d{4}-)?\d{6}-/, '').replace(/\.[^.]+$/, ''), outputs: [{ id: nanoid(6), createdAt: Date.now(), media }], current: 0, status: 'done' },
    });
    useUI.getState().notify('已连到这个节点作参考');
  };
  return (
    <div className="rs nodrag">
      <form
        className="rs-bar"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Icon name="search" size={13} />
        <input autoFocus value={q} placeholder="描述要找的参考图，在本项目、品牌资产和收藏夹里找" onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
          <Icon name="x" size={12} />
        </button>
      </form>
      {busy && <p className="muted small">{busy}</p>}
      {hits && !busy && (hits.length ? <div className="rs-hits">{hits.map((m) => <Hit key={m.id} media={m} onPick={() => pick(m)} />)}</div> : <p className="muted small">没有找到图片或视频</p>)}
    </div>
  );
}
