import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { listShelf, revealInFinder, shelfAction, uploadToShelf, useMediaUrl, type ArchivedFile, type Shelf, type ShelfKind } from './media';
import { useCanvas } from './store';
import { useUI } from './ui';
import type { MediaKind, MediaRef } from './types';

// 品牌资产库 and 收藏夹 in 资产管理: folders shared by every project (beside the project folders
// on disk). Brand material (logos, standard colours, product shots) to use as references, and
// favourite results the user wants to keep, each sorted into folders of their own.

export const SHELF_NAMES: Record<ShelfKind, string> = { brand: '品牌资产库', fav: '收藏夹' };
const notify = (m: string) => useUI.getState().notify(m);

/** Copies a canvas or project file into a shelf (the top level; it can be moved to a folder there). */
export async function addToShelf(kind: ShelfKind, media: MediaRef) {
  try {
    await shelfAction(kind, 'add', { id: media.id });
    notify(`已加入${SHELF_NAMES[kind]}（资产管理 → ${kind === 'brand' ? '品牌资产' : '收藏夹'}）`);
  } catch (err) {
    notify(err instanceof Error ? err.message : String(err));
  }
}

const asMedia = (f: ArchivedFile): MediaRef => ({ id: f.id, kind: f.kind as MediaKind, name: f.name });

/** A small square preview for pictures (brand files are few and visual: logos, colours). */
function Thumb({ file }: { file: ArchivedFile }) {
  const url = useMediaUrl(file.kind === 'image' ? file.id : undefined);
  if (file.kind !== 'image') return <Icon name={file.kind === 'video' ? 'video' : file.kind === 'audio' ? 'audio' : 'file'} size={14} />;
  return <img className="shelf-thumb" src={url} alt="" loading="lazy" draggable={false} />;
}

export function ShelfView({ kind, at }: { kind: ShelfKind; at: () => { x: number; y: number } }) {
  const [shelf, setShelf] = useState<Shelf | null | undefined>(undefined);
  const [open, setOpen] = useState<Record<string, boolean>>({ '': true });
  const [naming, setNaming] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const addMediaNode = useCanvas((s) => s.addMediaNode);
  useEffect(() => {
    setShelf(undefined);
    listShelf(kind).then(setShelf);
  }, [kind]);
  const act = async (action: 'folder' | 'move' | 'remove', body: { id?: string; folder?: string }) => {
    try {
      setShelf(await shelfAction(kind, action, body));
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };
  if (shelf === undefined) return <p className="empty">读取中…</p>;
  if (shelf === null) return <p className="empty">本地服务未启动，无法读取{SHELF_NAMES[kind]}</p>;
  const folders = shelf.folders.map((f) => f.name).filter(Boolean);

  return (
    <>
      <p className="muted small shelf-hint">
        {kind === 'brand' ? '放 Logo、品牌色、产品图等常用素材，所有项目共用；拖到画布上连给图片或视频节点作参考。' : '收藏做得好的图片和视频，可以建文件夹分类，所有项目共用。'}
        在画布或「当前项目」里右键文件也能加入。
      </p>
      <div className="shelf-bar">
        <button className="text-btn" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" size={13} /> 上传
        </button>
        <button className="text-btn" onClick={() => setNaming('')}>
          <Icon name="folder" size={13} /> 新建文件夹
        </button>
        <div className="grow" />
        <button className="icon-btn" title="在访达中显示" onClick={() => revealInFinder(SHELF_NAMES[kind])}>
          <Icon name="search" size={13} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept="image/*,video/*,audio/*"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            for (const f of files) await uploadToShelf(kind, target, f).catch(() => notify(`上传失败：${f.name}`));
            setShelf(await listShelf(kind));
          }}
        />
      </div>
      {naming !== null && (
        <form
          className="shelf-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming.trim()) act('folder', { folder: naming.trim() }).then(() => setOpen({ ...open, [naming.trim()]: true }));
            setNaming(null);
          }}
        >
          <input className="pp-input" autoFocus placeholder="文件夹名称" value={naming} onChange={(e) => setNaming(e.target.value)} onBlur={() => !naming.trim() && setNaming(null)} />
          <button className="primary-btn">建立</button>
        </form>
      )}
      <div className="asset-folders nowheel">
        {shelf.folders.map((f) => {
          const key = f.name;
          const label = f.name || (kind === 'brand' ? '常用' : '未分类');
          return (
            <div key={key} className="asset-folder">
              <button
                className={`asset-folder-head ${open[key] ? 'on' : ''} ${target === key ? 'target' : ''}`}
                title="上传的文件会放进当前选中的文件夹"
                onClick={() => {
                  setOpen({ ...open, [key]: !open[key] });
                  setTarget(key);
                }}
              >
                <Icon name={open[key] ? 'down' : 'right'} size={12} />
                <Icon name="folder" size={14} />
                <span>{label}</span>
                <small>{f.files.length}</small>
              </button>
              {open[key] &&
                (f.files.length ? (
                  f.files.map((x) => (
                    <div
                      key={x.id}
                      className="asset-row shelf-row"
                      draggable
                      title={`${x.name}\n点击添加到画布，或拖到画布上`}
                      onDragStart={(e) => e.dataTransfer.setData('application/x-libcanvas-media', JSON.stringify(asMedia(x)))}
                      onClick={() => addMediaNode(asMedia(x), at())}
                    >
                      <Thumb file={x} />
                      <span className="asset-name">{x.name}</span>
                      <select
                        className="shelf-move"
                        title="移到文件夹"
                        value=""
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => act('move', { id: x.id, folder: e.target.value === '·' ? '' : e.target.value })}
                      >
                        <option value="">移到…</option>
                        {f.name && <option value="·">{kind === 'brand' ? '常用' : '未分类'}</option>}
                        {folders
                          .filter((n) => n !== f.name)
                          .map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                      </select>
                      <button
                        className="icon-btn"
                        title="移除（放进废纸篓）"
                        onClick={(e) => {
                          e.stopPropagation();
                          act('remove', { id: x.id });
                        }}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="empty small">还没有文件</p>
                ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
