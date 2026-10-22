import { nanoid } from 'nanoid';
import { isServerMedia, putMedia } from './media';
import { parseComposition, renderComposition } from './synth';
import { currentProjectId } from './project';
import { secondsOf, TONES } from './config';
import { findMethod } from './methods';
import type { GenKind, GenOutput, MediaRef, ParamValue } from './types';

/** A fully composed request: `prompt` is exactly the text the AI app receives (see composeRequest). */
export interface GenRequest {
  kind: GenKind;
  prompt: string;
  model: string;
  params: Record<string, ParamValue>;
  /** Reference images, sent as files. */
  images: MediaRef[];
  /** Voice-overs: a recording to clone, and reading directions for the voice. */
  refAudio?: MediaRef;
  instruct?: string;
  /** 玩法 productions: media for the agent, the folder to revise, the method and a title. */
  refs?: { id: string; label: string }[];
  workspace?: string;
  methodId?: string;
  title?: string;
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
  file?: { id: string; kind: 'image' | 'audio' | 'video'; name: string; w?: number; h?: number; seconds?: number };
  studio?: { workspace: string };
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
function runJob(body: object, expectedMs: number, onProgress: (p: number, message?: string) => void): Promise<Job> {
  return runTask('/api/generate', body, expectedMs, onProgress);
}

async function runTask(url: string, body: object, expectedMs: number, onProgress: (p: number, message?: string) => void): Promise<Job> {
  const { id } = await api<{ id: string }>(url, {
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

/** Runs (or re-renders) a 玩法 production on the local server; the result is the rendered film. */
export async function produceFilm(body: object, onProgress: (p: number, message?: string) => void, expectedMs = 10 * 60_000): Promise<GenResult> {
  const job = await runTask('/api/studio/make', body, expectedMs, onProgress);
  const f = job.file!;
  return { media: { id: f.id, kind: 'video', name: f.name, ...(f.w && f.h ? { w: f.w, h: f.h } : {}) }, text: job.text || undefined, studio: job.studio };
}

export const localProvider: GenerationProvider = {
  async generate(req, onProgress) {
    if (req.kind === 'method') {
      const m = findMethod(req.methodId);
      const body = {
        engine: req.model,
        prompt: req.prompt,
        title: req.title || m?.name || '视频',
        ratio: req.params.ratio,
        duration: secondsOf(req.params),
        method: m?.id,
        methodName: m?.name,
        refs: (req.refs ?? []).filter((r) => isServerMedia({ id: r.id, kind: 'image' })),
        workspace: req.workspace,
      };
      return [await produceFilm(body, onProgress)];
    }
    const images = req.images.filter(isServerMedia).map((m) => m.id);
    if (req.kind === 'image') {
      const job = await runJob({ engine: req.model, kind: 'image', prompt: req.prompt, images, ratio: req.params.ratio }, 60_000, onProgress);
      const f = job.file!;
      return [{ media: { id: f.id, kind: 'image', name: f.name, ...(f.w && f.h ? { w: f.w, h: f.h } : {}) } }];
    }
    if (req.kind === 'voice') {
      // Optionally have ChatGPT / Claude write the narration first, then synthesize it locally.
      const writer = String(req.params.writer ?? '原文');
      let narration = req.prompt;
      let reasoning: string | undefined;
      if (writer !== '原文') {
        // Old voice nodes name the AI in the option; audio nodes use the node's model.
        const ai = writer.startsWith('Claude') ? 'claude' : writer.startsWith('ChatGPT') ? 'chatgpt' : req.model === 'claude' ? 'claude' : 'chatgpt';
        const job = await runJob({ engine: ai, kind: 'text', prompt: req.prompt, images: [] }, 20_000, (p, m) => onProgress(p * 0.4, m));
        ({ reasoning, body: narration } = splitReasoning(job.text ?? ''));
      }
      const voice = String(req.params.voice ?? 'Serena');
      const engine = req.model === 'system' || req.params.tts === '系统语音' ? 'system' : 'qwen3';
      const clone = req.params.mode === '克隆' || voice === 'Clone';
      if (clone && !req.refAudio) throw new Error('克隆声音需要一段录音：把要克隆的声音（音频节点，3–15 秒清晰人声）连到这里');
      const task = await runTask(
        '/api/tts',
        {
          text: narration,
          voice,
          instruct: [TONES[String(req.params.tone ?? '自然')], req.instruct].filter(Boolean).join('；'),
          lang: 'auto',
          engine,
          refAudio: clone ? req.refAudio?.id : undefined,
          project: currentProjectId(),
          name: clone ? '配音-克隆' : `配音-${voice}`,
        },
        25_000,
        (p, m) => onProgress((writer !== '原文' ? 0.4 : 0) + p * (writer !== '原文' ? 0.6 : 1), m),
      );
      const f = task.file!;
      return [{ media: { id: f.id, kind: 'audio', name: f.name }, text: narration, ...(reasoning ? { reasoning } : {}) }];
    }
    if (req.kind === 'audio' && String(req.params.engine ?? '').startsWith('ACE')) {
      // ChatGPT / Claude write the caption and lyrics; ACE-Step sings it locally.
      const job = await runJob({ engine: req.model, kind: 'text', prompt: req.prompt, images }, 30_000, (p) => onProgress(p * 0.15, '正在写歌词与风格…'));
      const spec = parseSongSpec(job.text ?? '');
      const task = await runTask(
        '/api/music',
        { prompt: spec.caption, lyrics: spec.lyrics, duration: secondsOf(req.params) ?? spec.duration ?? 30, language: spec.language, project: currentProjectId(), name: spec.title || '音乐' },
        150_000,
        (p, m) => onProgress(0.15 + p * 0.85, m ?? '音乐引擎作曲中…'),
      );
      const f = task.file!;
      const summary = [spec.title && `《${spec.title}》`, spec.description, `风格：${spec.caption}`, spec.lyrics && `\n${spec.lyrics}`].filter(Boolean).join('\n');
      return [{ media: { id: f.id, kind: 'audio', name: f.name }, text: summary }];
    }
    if (req.kind === 'audio') {
      const job = await runJob({ engine: req.model, kind: 'text', prompt: req.prompt, images }, 60_000, (p) => onProgress(p * 0.85, '正在作曲…'));
      const score = parseComposition(job.text ?? '');
      onProgress(0.9, '正在合成音频…');
      const { blob, seconds } = await renderComposition(score, Math.max(20, (secondsOf(req.params) ?? 120) * 1.5));
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
    const job = await runJob({ engine: req.model, kind: 'text', prompt: req.prompt, images }, req.kind === 'vprompt' ? 40_000 : 20_000, onProgress);
    const { reasoning, body } = splitReasoning(job.text ?? '');
    if (req.kind === 'vprompt') {
      const shots = parsePrompts(body);
      // As text too, so a text node in video-prompt mode shows and edits them like any text.
      const text = shots.map((p) => `【${p.meta ?? '提示词'}】\n${p.text}`).join('\n\n');
      return [{ shots, text, ...(reasoning ? { reasoning } : {}) }];
    }
    if (req.kind === 'script') {
      const lines = body
        .split('\n')
        .map((l) => l.replace(/^[\s\-*\d.、]+(?=镜头)/, '').trim())
        .filter(Boolean);
      return [{ shots: lines.map((text) => ({ id: nanoid(6), text })), ...(reasoning ? { reasoning } : {}) }];
    }
    return [{ text: body, ...(reasoning ? { reasoning } : {}) }];
  },
};

interface SongSpec {
  title?: string;
  /** Seconds, when the AI picked the length (时长「按文案」). */
  duration?: number;
  caption: string;
  lyrics: string;
  language: string;
  description?: string;
}

/** The JSON song description the AI writes for ACE-Step. */
export function parseSongSpec(text: string): SongSpec {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 没有返回作曲说明，请重试');
  const raw = JSON.parse(text.slice(start, end + 1)) as Partial<SongSpec>;
  if (!raw.caption?.trim()) throw new Error('作曲说明缺少风格描述，请重试');
  return {
    title: raw.title?.trim(),
    duration: Number(raw.duration) > 0 ? Number(raw.duration) : undefined,
    caption: raw.caption.trim(),
    lyrics: (raw.lyrics ?? '').trim() || '[Instrumental]',
    language: (raw.language ?? 'zh').trim() || 'zh',
    description: raw.description?.trim(),
  };
}

/** Splits a 「【生成思路】…【结果】…」 reply. Replies without the markers are all result. */
export function splitReasoning(text: string): { reasoning?: string; body: string } {
  const r = text.indexOf('【生成思路】');
  const b = text.indexOf('【结果】');
  if (b < 0) return { body: r >= 0 ? text.slice(r + 6).trim() : text.trim() };
  const reasoning = r >= 0 && r < b ? text.slice(r + 6, b).trim() : undefined;
  return { reasoning: reasoning || undefined, body: text.slice(b + 4).trim() };
}

/** 「【提示词N｜镜头｜时长｜模式｜参考】正文」 blocks; a reply without headings is one prompt. */
export function parsePrompts(body: string): { id: string; text: string; meta?: string }[] {
  const re = /【提示词\s*(\d+)\s*[｜|]?([^】]*)】/g;
  const heads = [...body.matchAll(re)];
  if (!heads.length) return body.trim() ? [{ id: nanoid(6), text: body.trim() }] : [];
  return heads
    .map((h, i) => {
      const start = h.index! + h[0].length;
      const end = heads[i + 1]?.index ?? body.length;
      const meta = h[2].split(/[｜|]/).map((x) => x.trim()).filter(Boolean).join(' · ');
      return { id: nanoid(6), text: body.slice(start, end).trim(), meta: meta || `提示词${h[1]}` };
    })
    .filter((p) => p.text);
}

/** One-off text generation through a local AI app (used by the director's scene builder). */
export async function generateText(engine: string, prompt: string, images: MediaRef[] = [], onProgress: (p: number, m?: string) => void = () => {}) {
  const job = await runJob({ engine, kind: 'text', prompt, images: images.filter(isServerMedia).map((m) => m.id) }, 30_000, onProgress);
  return job.text ?? '';
}

export const getProvider = (): GenerationProvider => localProvider;
