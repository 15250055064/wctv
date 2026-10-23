import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { getMediaUrl } from '../media';
import type { MediaRef } from '../types';
import { hasWebGPU, setupAI, withDownloads } from './ai';

// Speech to text with Whisper large-v3-turbo (MIT), 4-bit, on the GPU via WebGPU.

const WHISPER = 'onnx-community/whisper-large-v3-turbo';
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

export interface Segment {
  start: number;
  end: number;
  text: string;
}

/** The sound of an audio or video file as 16 kHz mono samples (what Whisper takes). */
async function decode(media: MediaRef): Promise<Float32Array> {
  const url = await getMediaUrl(media.id);
  if (!url) throw new Error('找不到文件');
  const data = await (await fetch(url)).arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(data).catch(() => {
      throw new Error(media.kind === 'video' ? '这个视频没有可识别的声音' : '音频无法读取');
    });
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
    }
    return out;
  } finally {
    ctx.close().catch(() => {});
  }
}

/** Transcribes an audio or video file into timed segments. `language`: 'zh', 'en', 'ja'… (required: without it Whisper here assumes English). */
export async function transcribe(media: MediaRef, language: string, onProgress: (msg: string) => void): Promise<Segment[]> {
  setupAI();
  onProgress('正在读取声音…');
  const audio = await decode(media);
  onProgress('正在加载语音识别模型…');
  asr ??= withDownloads(
    async () =>
      (await pipeline('automatic-speech-recognition', WHISPER, {
        device: (await hasWebGPU()) ? 'webgpu' : 'wasm',
        dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' },
      })) as AutomaticSpeechRecognitionPipeline,
    onProgress,
  );
  asr.catch(() => (asr = null));
  const model = await asr;
  onProgress(`正在识别（${Math.round(audio.length / 16000)} 秒）…`);
  const out = (await model(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    language: language || 'zh',
    task: 'transcribe',
  })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
  const chunks = out.chunks ?? [{ timestamp: [0, audio.length / 16000], text: out.text }];
  return chunks
    .map((c) => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? audio.length / 16000, text: c.text.trim() }))
    .filter((s) => s.text);
}

const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** "[00:01.2 – 00:04.8] text", one segment per line. */
export const timedText = (segs: Segment[]) => segs.map((s) => `[${clock(s.start)} – ${clock(s.end)}] ${s.text}`).join('\n');

/** The same segments as an SRT subtitle file. */
export function srt(segs: Segment[]) {
  const t = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const sec = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return segs.map((s, i) => `${i + 1}\n${t(s.start)} --> ${t(s.end)}\n${s.text}\n`).join('\n');
}
