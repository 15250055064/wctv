// Turns an AI-written composition (notes per instrument) into a stereo WAV, entirely in the
// browser with Web Audio. It sounds like a synthesizer / MIDI mock-up, not a recorded band.

export type Instrument = 'piano' | 'pad' | 'strings' | 'bass' | 'lead' | 'pluck' | 'bell' | 'drums';

export interface Composition {
  title?: string;
  bpm: number;
  beatsPerBar?: number;
  bars?: number;
  description?: string;
  tracks: { instrument: Instrument; volume?: number; pan?: number; notes: [number, number, string | number, number?][] }[];
}

export const INSTRUMENTS: Instrument[] = ['piano', 'pad', 'strings', 'bass', 'lead', 'pluck', 'bell', 'drums'];
export const DRUMS = ['kick', 'snare', 'clap', 'hat', 'openhat', 'tom', 'crash'] as const;

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4", "F#3", "Bb2" or a MIDI number -> frequency in Hz. */
export function freqOf(n: string | number): number | null {
  if (typeof n === 'number') return 440 * 2 ** ((n - 69) / 12);
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(n.trim());
  if (!m) return null;
  const midi = NOTE[m[1].toUpperCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Pull the composition JSON out of an AI reply, tolerating code fences and stray text. */
export function parseComposition(text: string): Composition {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回乐谱数据');
  const c = JSON.parse(text.slice(start, end + 1)) as Composition;
  if (!Array.isArray(c.tracks) || !c.tracks.length) throw new Error('乐谱里没有任何声部');
  c.bpm = Math.max(40, Math.min(220, Number(c.bpm) || 100));
  c.tracks = c.tracks
    .filter((t) => INSTRUMENTS.includes(t.instrument) && Array.isArray(t.notes))
    .map((t) => ({ ...t, notes: t.notes.filter((n) => Array.isArray(n) && n.length >= 3 && Number.isFinite(Number(n[0])) && Number(n[1]) > 0) }));
  if (!c.tracks.some((t) => t.notes.length)) throw new Error('乐谱里没有可演奏的音符');
  return c;
}

type Ctx = OfflineAudioContext;

function env(g: GainNode, t: number, peak: number, a: number, d: number, s: number, dur: number, r: number) {
  const p = g.gain;
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t + a + d);
  const off = Math.max(t + a + d, t + dur);
  p.setValueAtTime(Math.max(0.0001, peak * s), off);
  p.exponentialRampToValueAtTime(0.0001, off + r);
  return off + r;
}

function osc(ctx: Ctx, type: OscillatorType, f: number, t: number, end: number, out: AudioNode, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  o.connect(out);
  o.start(t);
  o.stop(end + 0.05);
  return o;
}

function lowpass(ctx: Ctx, freq: number, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: Ctx, t: number, len: number, out: AudioNode) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.connect(out);
  s.start(t);
  s.stop(t + len);
}

function playNote(ctx: Ctx, inst: Instrument, f: number, t: number, dur: number, vel: number, out: AudioNode) {
  const g = ctx.createGain();
  switch (inst) {
    case 'piano': {
      const f2 = lowpass(ctx, 3500);
      g.connect(f2).connect(out);
      const end = env(g, t, 0.5 * vel, 0.005, Math.min(1.2, dur + 0.4), 0.15, dur, 0.35);
      osc(ctx, 'triangle', f, t, end, g);
      osc(ctx, 'sine', f * 2, t, end, g).detune.value = 3;
      break;
    }
    case 'pluck': {
      const lp = lowpass(ctx, 4000, 2);
      lp.frequency.setValueAtTime(5000, t);
      lp.frequency.exponentialRampToValueAtTime(400, t + 0.4);
      g.connect(lp).connect(out);
      const end = env(g, t, 0.4 * vel, 0.003, 0.3, 0.05, Math.min(dur, 0.4), 0.15);
      osc(ctx, 'sawtooth', f, t, end, g);
      break;
    }
    case 'pad': {
      g.connect(lowpass(ctx, 1400)).connect(out);
      const end = env(g, t, 0.18 * vel, 0.5, 0.4, 0.8, dur, 0.9);
      osc(ctx, 'sawtooth', f, t, end, g, -8);
      osc(ctx, 'sawtooth', f, t, end, g, 8);
      osc(ctx, 'triangle', f / 2, t, end, g);
      break;
    }
    case 'strings': {
      g.connect(lowpass(ctx, 2600)).connect(out);
      const end = env(g, t, 0.2 * vel, 0.18, 0.3, 0.85, dur, 0.4);
      osc(ctx, 'sawtooth', f, t, end, g, -6);
      osc(ctx, 'sawtooth', f, t, end, g, 6);
      break;
    }
    case 'bass': {
      g.connect(lowpass(ctx, 700, 1.2)).connect(out);
      const end = env(g, t, 0.55 * vel, 0.01, 0.2, 0.7, dur, 0.08);
      osc(ctx, 'sawtooth', f, t, end, g);
      osc(ctx, 'sine', f / 2, t, end, g);
      break;
    }
    case 'lead': {
      g.connect(lowpass(ctx, 3200)).connect(out);
      const end = env(g, t, 0.22 * vel, 0.02, 0.2, 0.7, dur, 0.15);
      const o = osc(ctx, 'square', f, t, end, g);
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.value = 6;
      lfo.connect(depth).connect(o.detune);
      lfo.start(t + 0.15);
      lfo.stop(end);
      break;
    }
    case 'bell': {
      g.connect(out);
      const end = env(g, t, 0.3 * vel, 0.002, 1.8, 0.01, dur, 1.2);
      osc(ctx, 'sine', f, t, end, g);
      osc(ctx, 'sine', f * 2.76, t, end, g);
      osc(ctx, 'sine', f * 5.4, t, Math.min(end, t + 0.4), g);
      break;
    }
    default:
      break;
  }
}

function playDrum(ctx: Ctx, name: string, t: number, vel: number, out: AudioNode) {
  const g = ctx.createGain();
  g.connect(out);
  const n = String(name).toLowerCase();
  if (n === 'kick' || n === 'tom') {
    const o = ctx.createOscillator();
    const base = n === 'kick' ? 50 : 110;
    o.frequency.setValueAtTime(base * 3, t);
    o.frequency.exponentialRampToValueAtTime(base, t + 0.12);
    o.connect(g);
    env(g, t, 0.9 * vel, 0.002, 0.25, 0.01, 0.05, 0.1);
    o.start(t);
    o.stop(t + 0.5);
  } else if (n === 'snare' || n === 'clap') {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = n === 'snare' ? 1200 : 900;
    hp.connect(g);
    env(g, t, 0.45 * vel, 0.001, 0.15, 0.01, 0.02, 0.08);
    noise(ctx, t, 0.3, hp);
    if (n === 'snare') {
      const tg = ctx.createGain();
      tg.connect(out);
      env(tg, t, 0.3 * vel, 0.001, 0.08, 0.01, 0.01, 0.05);
      osc(ctx, 'triangle', 190, t, t + 0.15, tg);
    }
  } else {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = n === 'crash' ? 5000 : 7000;
    hp.connect(g);
    const len = n === 'openhat' ? 0.35 : n === 'crash' ? 1.4 : 0.06;
    env(g, t, (n === 'crash' ? 0.25 : 0.18) * vel, 0.001, len, 0.01, 0.01, len / 2);
    noise(ctx, t, len + 0.3, hp);
  }
}

function impulse(ctx: Ctx, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  return buf;
}

function toWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const frames = buf.length;
  const view = new DataView(new ArrayBuffer(44 + frames * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + frames * ch * 2, true);
  str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, frames * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < ch; c++) {
      view.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true);
      o += 2;
    }
  return new Blob([view], { type: 'audio/wav' });
}

/** Render a composition to a stereo WAV. Returns the file and its length in seconds. */
export async function renderComposition(c: Composition, maxSeconds = 120): Promise<{ blob: Blob; seconds: number }> {
  const spb = 60 / c.bpm;
  const lastBeat = Math.max(...c.tracks.flatMap((t) => t.notes.map((n) => Number(n[0]) + Number(n[1]))));
  const seconds = Math.min(maxSeconds, lastBeat * spb + 2.5);
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);

  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 3;
  const out = ctx.createGain();
  out.gain.value = 0.9;
  master.connect(out).connect(ctx.destination);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 2.4);
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  reverb.connect(wet).connect(master);

  for (const track of c.tracks) {
    const bus = ctx.createGain();
    bus.gain.value = Math.max(0, Math.min(1.5, track.volume ?? 0.8));
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, track.pan ?? 0));
    bus.connect(pan);
    pan.connect(master);
    if (track.instrument !== 'drums' && track.instrument !== 'bass') pan.connect(reverb);
    for (const [beat, len, pitch, vel] of track.notes) {
      const t = Number(beat) * spb;
      if (t >= seconds - 0.1) continue;
      const v = Math.max(0.1, Math.min(1, Number(vel ?? 0.8)));
      if (track.instrument === 'drums') playDrum(ctx, String(pitch), t, v, bus);
      else {
        const f = freqOf(pitch);
        if (f) playNote(ctx, track.instrument, f, t, Math.max(0.05, Number(len) * spb), v, bus);
      }
    }
  }
  const rendered = await ctx.startRendering();
  return { blob: toWav(rendered), seconds };
}
