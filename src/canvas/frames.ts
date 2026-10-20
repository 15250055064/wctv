import { currentProjectId } from './project';
import type { MediaRef } from './types';

async function call<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('本地服务未启动：请重新打开 WCcanvastv');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `请求失败（${res.status}）`);
  return body as T;
}

export const canvasJpeg = (c: HTMLCanvasElement, q = 0.92) => new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('画面编码失败'))), 'image/jpeg', q));

/**
 * Encodes `count` frames into an MP4 in the current project folder. `frame(i)` renders frame i;
 * the next frame renders while the previous one uploads.
 */
export async function encodeFrames(name: string, fps: number, count: number, frame: (i: number) => Promise<Blob>, onProgress: (p: number) => void): Promise<MediaRef> {
  const { id } = await call<{ id: string }>('/api/frames', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, fps, project: currentProjectId() }),
  });
  try {
    let upload: Promise<unknown> = Promise.resolve();
    for (let i = 0; i < count; i++) {
      const blob = await frame(i);
      await upload;
      upload = call(`/api/frames/${id}/${i + 1}`, { method: 'PUT', body: blob });
      onProgress((i + 1) / count);
    }
    await upload;
    const { video } = await call<{ video: MediaRef }>(`/api/frames/${id}/finish`, { method: 'POST' });
    return video;
  } catch (err) {
    fetch(`/api/frames/${id}`, { method: 'DELETE' }).catch(() => {});
    throw err;
  }
}
