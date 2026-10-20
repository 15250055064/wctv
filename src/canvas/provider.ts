import { nanoid } from 'nanoid';
import { isServerMedia, putMedia } from './media';
import { parseComposition, renderComposition } from './synth';
import { currentProjectId } from './project';
import type { GenKind, GenOutput, MediaRef, ParamValue } from './types';

/** A fully composed request: `prompt` is exactly the text the AI app receives (see composeRequest). */
export interface GenRequest {
  kind: GenKind;
  prompt: string;
  model: string;
  params: Record<string, ParamValue>;
  /** Reference images, sent as files. */
  images: MediaRef[];
}

export type GenResult = Omit<GenOutput, 'id' | 'createdAt' | 'sent'>;

export interface GenerationProvider {
  generate(req: GenRequest, onProgress: (p: number, message?: string) => void): Promise<GenResult[]>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Job {
  status: 'running' | 'done' | 'error' | 'cancelled';
  log: string[];
  text?: string;
  file?: { id: string; kind: 'image'; name: string; w?: number; h?: number };
  error?: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
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

/** Start a job on the local server and poll it, reporting time-based progress plus the app's latest message. */
async function runJob(body: object, expectedMs: number, onProgress: (p: number, message?: string) => void): Promise<Job> {
  const { id } = await api<{ id: string }>('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, project: currentProjectId() }),
  });
  const start = Date.now();
  for (;;) {
    await sleep(1000);
    const job = await api<Job>(`/api/jobs/${id}`);
    // Ease toward 95% so long runs still look alive.
    const t = (Date.now() - start) / expectedMs;
    onProgress(0.95 * (1 - Math.exp(-2 * t)), job.log.at(-1));
    if (job.status === 'done') return job;
    if (job.status !== 'running') throw new Error(job.error ?? '生成失败');
  }
}

export const localProvider: GenerationProvider = {
  async generate(req, onProgress) {
    const images = req.images.filter(isServerMedia).map((m) => m.id);
    if (req.kind === 'image') {
      const job = await runJob({ engine: req.model, kind: 'image', prompt: req.prompt, images, ratio: req.params.ratio }, 60_000, onProgress);
      const f = job.file!;
      return [{ media: { id: f.id, kind: 'image', name: f.name, ...(f.w && f.h ? { w: f.w, h: f.h } : {}) } }];
    }
    if (req.kind === 'audio') {
      const job = await runJob({ engine: req.model, kind: 'text', prompt: req.prompt, images }, 60_000, (p) => onProgress(p * 0.85, '正在作曲…'));
      const score = parseComposition(job.text ?? '');
      onProgress(0.9, '正在合成音频…');
      const { blob, seconds } = await renderComposition(score, Math.max(20, Number(req.params.duration ?? 30) * 1.5));
      const name = `${(score.title || 'music').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}.wav`;
      const media = await putMedia(blob, 'audio', name);
      const summary = [
        score.title && `《${score.title}》`,
        `${score.bpm} BPM · ${Math.round(seconds)} 秒`,
        score.tracks.map((t) => t.instrument).join(' / '),
        score.description,
      ]
        .filter(Boolean)
        .join('\n');
      return [{ media, text: summary }];
    }
    const job = await runJob({ engine: req.model, kind: 'text', prompt: req.prompt, images }, 20_000, onProgress);
    if (req.kind === 'script') {
      const lines = (job.text ?? '')
        .split('\n')
        .map((l) => l.replace(/^[\s\-*\d.、]+(?=镜头)/, '').trim())
        .filter(Boolean);
      return [{ shots: lines.map((text) => ({ id: nanoid(6), text })) }];
    }
    return [{ text: job.text }];
  },
};

let provider: GenerationProvider = localProvider;
export const getProvider = () => provider;
export const setProvider = (p: GenerationProvider) => {
  provider = p;
};
