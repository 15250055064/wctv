import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { currentProjectId } from './project';
import type { MediaKind, MediaRef } from './types';

// Media lives as real files in the archive folder (~/Movies/WCcanvastv) through the
// local server; its id is the archive path, e.g. "2026-10-20/115930-clip.mp4".
// Without the server, blobs fall back to IndexedDB under a random id.
const DB_NAME = 'libcanvas';
const STORE = 'media';
const urlCache = new Map<string, string>();
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function mediaKindOf(type: string): MediaKind | null {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return null;
}

async function measure(blob: Blob, kind: MediaKind): Promise<{ w?: number; h?: number }> {
  try {
    if (kind === 'image') {
      const bmp = await createImageBitmap(blob);
      const size = { w: bmp.width, h: bmp.height };
      bmp.close();
      return size;
    }
    if (kind === 'video') {
      const url = URL.createObjectURL(blob);
      const size = await new Promise<{ w?: number; h?: number }>((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => resolve({ w: v.videoWidth, h: v.videoHeight });
        v.onerror = () => resolve({});
        v.src = url;
      });
      URL.revokeObjectURL(url);
      return size;
    }
  } catch {
    // Unknown dimensions just fall back to the node's default aspect ratio.
  }
  return {};
}

const EXT_OF: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'audio/wav': '.wav', 'audio/mpeg': '.mp3' };

export const isServerId = (id: string) => id.includes('/');
export const isServerMedia = (m: MediaRef) => isServerId(m.id);
const rawFileUrl = (id: string) => `/files/${id.split('/').map(encodeURIComponent).join('/')}`;
/** Videos ask for a copy the player can decode (camera files like 4:2:2 10-bit get converted once). */
export const fileUrl = (id: string) => rawFileUrl(id) + (/\.(mp4|mov|m4v|webm)$/i.test(id) ? '?play' : '');

async function upload(blob: Blob, name: string, temp = false): Promise<{ id: string; name: string } | null> {
  try {
    const project = currentProjectId();
    const res = await fetch(`/api/upload?name=${encodeURIComponent(name)}${project ? `&project=${encodeURIComponent(project)}` : ''}${temp ? '&temp' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Saves any file (e.g. a PSD) into the current project folder; returns its archive id. */
export async function saveFile(blob: Blob, name: string): Promise<{ id: string; name: string }> {
  const saved = await upload(blob, name);
  if (!saved) throw new Error('保存文件失败：本地服务未启动');
  return saved;
}

/** A working picture for a tool (e.g. a guide image for ChatGPT): kept out of the assets, deleted after a day. */
export async function saveTemp(blob: Blob, name: string): Promise<MediaRef> {
  const saved = await upload(blob, name, true);
  if (!saved) throw new Error('保存临时文件失败：本地服务未启动');
  return { id: saved.id, kind: 'image', name: saved.name };
}

/** Save media: to the archive folder on disk when the local server is up, else to IndexedDB. */
export async function putMedia(blob: Blob, kind: MediaKind, name?: string, size?: { w: number; h: number }): Promise<MediaRef> {
  const dims = size ?? (await measure(blob, kind));
  const saved = await upload(blob, name ?? `${kind}${EXT_OF[blob.type] ?? ''}`);
  if (saved) return { id: saved.id, kind, name: name ?? saved.name, ...dims };
  const id = nanoid(12);
  await tx('readwrite', (s) => s.put(blob, id));
  urlCache.set(id, URL.createObjectURL(blob));
  return { id, kind, name, ...dims };
}

export async function getMediaUrl(id: string): Promise<string | undefined> {
  if (isServerId(id)) return fileUrl(id);
  const cached = urlCache.get(id);
  if (cached) return cached;
  const blob = await tx<Blob | undefined>('readonly', (s) => s.get(id));
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function useMediaUrl(id?: string): string | undefined {
  const [url, setUrl] = useState(() => (id ? (isServerId(id) ? fileUrl(id) : urlCache.get(id)) : undefined));
  useEffect(() => {
    if (!id) return setUrl(undefined);
    let alive = true;
    getMediaUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

export function useMediaUrls(ids: string[]): (string | undefined)[] {
  const key = ids.join(',');
  const [urls, setUrls] = useState<(string | undefined)[]>([]);
  useEffect(() => {
    let alive = true;
    Promise.all(key ? key.split(',').map(getMediaUrl) : []).then((u) => alive && setUrls(u));
    return () => {
      alive = false;
    };
  }, [key]);
  return urls;
}

const EXT: Record<MediaKind, string> = { image: 'png', video: 'webm', audio: 'wav' };

export async function downloadMedia(media: MediaRef, title: string) {
  // Archived files download as they are, not as the playable copy.
  const url = isServerId(media.id) ? rawFileUrl(media.id) : await getMediaUrl(media.id);
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = media.name ?? `${title}.${EXT[media.kind]}`;
  a.click();
}

export function downloadText(text: string, filename: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ArchivedFile {
  id: string;
  name: string;
  kind: MediaKind | 'file';
  size: number;
  mtime: number;
}

/** Files of one project folder, or of the whole archive when project is omitted. */
/** Null when the local server can't be reached; `missing` when the project's folder is gone. */
export async function listArchive(project?: string): Promise<{ dir: string; files: ArchivedFile[]; missing?: boolean } | null> {
  try {
    const res = await fetch(`/api/archive${project ? `?project=${encodeURIComponent(project)}` : ''}`);
    if (res.status === 404) return { dir: '', files: [], missing: true };
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export type ShelfKind = 'brand' | 'fav';
export interface Shelf {
  dir: string;
  /** The first entry (name '') is the files at the top of the shelf. */
  folders: { name: string; files: ArchivedFile[] }[];
}

/** 品牌资产库 / 收藏夹, shared by all projects. */
export async function listShelf(kind: ShelfKind): Promise<Shelf | null> {
  try {
    const r = await fetch(`/api/shelf/${kind}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** folder: new folder; add: copy an archived file in; move: to another folder; remove: to the Trash. */
export async function shelfAction(kind: ShelfKind, action: 'folder' | 'add' | 'move' | 'remove', body: { id?: string; folder?: string }): Promise<Shelf & { id?: string }> {
  const r = await fetch(`/api/shelf/${kind}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json();
  if (!r.ok) throw new Error(out.error ?? '操作失败');
  return out;
}

/** Uploads a file from the computer straight into a shelf folder. */
export async function uploadToShelf(kind: ShelfKind, folder: string, file: File) {
  const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}&shelf=${kind}&folder=${encodeURIComponent(folder)}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!r.ok) throw new Error('上传失败');
}

/** Show a file or folder of the archive (or the archive itself) in Finder. */
export function revealInFinder(id?: string) {
  fetch('/api/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
}

/**
 * A still frame of a video, archived as an image so the video can feed generations
 * (the AI apps read images, not video). Taken at 1s, or mid-way for shorter clips.
 */
export async function videoPoster(media: MediaRef): Promise<MediaRef | null> {
  if (media.poster) return media.poster;
  const url = await getMediaUrl(media.id);
  if (!url) return null;
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  const once = (ev: string) => new Promise<void>((resolve, reject) => {
    video.addEventListener(ev, () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('视频无法读取')), { once: true });
  });
  try {
    await once('loadeddata');
    const d = Number.isFinite(video.duration) ? video.duration : 2;
    video.currentTime = Math.min(1, d / 2);
    await once('seeked');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) return null;
    const base = (media.name ?? 'video').replace(/\.[^.]+$/, '');
    return await putMedia(blob, 'image', `${base}-画面.jpg`, { w: canvas.width, h: canvas.height });
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
