import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useMediaUrl } from '../media';
import { useUI } from '../ui';
import type { MediaRef } from '../types';
import { Actions, Seg, capture, fit, type OptProps } from './editorKit';
import { MARK_COLORS, MAX_MARKS, maskBox, type Engine, type Mark, type MarkAction, type Pads } from './edit';

// The 扩图 and 元素编辑 windows (see edit.ts for what they do with the picture).

const notify = (m: string) => useUI.getState().notify(m);
const ENGINE_NAMES: Record<Engine, string> = { chatgpt: 'ChatGPT', local: '本地（免费）' };

/** The picture's size once loaded. */
function useImageSize(media: MediaRef) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(media.w && media.h ? { w: media.w, h: media.h } : null);
  const url = useMediaUrl(media.id);
  useEffect(() => {
    if (!url || size) return;
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [url, size]);
  return { url, size };
}

// ---- 扩图 ------------------------------------------------------------------------------------

const OUT_RATIOS = [
  ['自由', 0],
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
] as const;
type Side = keyof Pads;

export function OutpaintEditor({ media, go, close }: OptProps & { media: MediaRef }) {
  const { url, size } = useImageSize(media);
  const [pads, setPads] = useState<Pads>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [ratio, setRatio] = useState<string>('自由');
  const [engine, setEngine] = useState<Engine>('chatgpt');
  const [note, setNote] = useState('');
  if (!size) return <p className="muted">正在读取图片…</p>;
  // The picture takes about half the stage, leaving room to drag the frame outward.
  const stage = { w: Math.min(860, window.innerWidth - 100), h: Math.min(500, Math.round(window.innerHeight * 0.45)) };
  const k = Math.min((stage.w * 0.5) / size.w, (stage.h * 0.55) / size.h);
  const maxPad = { x: (stage.w / k - size.w) / 2, y: (stage.h / k - size.h) / 2 };
  const total = { w: Math.round(size.w + pads.left + pads.right), h: Math.round(size.h + pads.top + pads.bottom) };
  // The frame is centred on the stage; the picture sits inside it at (left, top).
  const frame = { x: (stage.w - total.w * k) / 2, y: (stage.h - total.h * k) / 2 };

  const pickRatio = (name: string, r: number) => {
    setRatio(name);
    if (!r) return;
    // The smallest frame of that shape around the picture, centred.
    const w = Math.max(size.w, size.h * r);
    const h = w / r;
    const px = Math.min(maxPad.x, (w - size.w) / 2);
    const py = Math.min(maxPad.y, (h - size.h) / 2);
    setPads({ top: py, bottom: py, left: px, right: px });
  };
  const dragSide = (side: Side) => (e: ReactPointerEvent) => {
    e.preventDefault();
    capture(e);
    setRatio('自由');
    const start = { x: e.clientX, y: e.clientY, pads };
    const el = e.currentTarget;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / k;
      const dy = (ev.clientY - start.y) / k;
      // The frame stays centred, so each side moves half as fast as the pointer… doubled back here.
      const d = { top: -dy, bottom: dy, left: -dx, right: dx }[side] * 2;
      const lim = side === 'left' || side === 'right' ? maxPad.x * 2 - start.pads[side === 'left' ? 'right' : 'left'] : maxPad.y * 2 - start.pads[side === 'top' ? 'bottom' : 'top'];
      setPads({ ...start.pads, [side]: Math.max(0, Math.min(lim, start.pads[side] + d)) });
    };
    const up = () => {
      el.removeEventListener('pointermove', move as never);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move as never);
    el.addEventListener('pointerup', up);
  };
  const handle = (side: Side) => <div key={side} className={`op-handle op-${side}`} onPointerDown={dragSide(side)} />;
  const grown = total.w > size.w || total.h > size.h;

  return (
    <>
      <p className="muted">拖动虚线框的上、下、左、右边，选出要往外扩展的区域；也可以直接选一个比例。原图内容保持不变，只补出新的部分。</p>
      <div className="op-stage" style={{ width: stage.w, height: stage.h }}>
        <div className="op-frame" style={{ left: frame.x, top: frame.y, width: total.w * k, height: total.h * k }}>
          {url && <img src={url} alt="" draggable={false} style={{ left: pads.left * k, top: pads.top * k, width: size.w * k, height: size.h * k }} />}
          {(['top', 'right', 'bottom', 'left'] as Side[]).map(handle)}
        </div>
      </div>
      <div className="tool-bar">
        <span className="small">
          {size.w}×{size.h} → <b>{total.w}×{total.h}</b>
        </span>
        <div className="grow" />
        <button
          className="text-btn"
          disabled={!grown}
          onClick={() => {
            setRatio('自由');
            setPads({ top: 0, right: 0, bottom: 0, left: 0 });
          }}
        >
          重置
        </button>
      </div>
      <h4 className="bd-h">比例</h4>
      <Seg value={ratio} options={OUT_RATIOS.map((r) => r[0])} onChange={(v) => pickRatio(v, OUT_RATIOS.find((r) => r[0] === v)![1])} />
      <h4 className="bd-h">生成方式</h4>
      <Seg value={engine} options={['chatgpt', 'local'] as const} onChange={setEngine} format={(v) => ENGINE_NAMES[v]} />
      <p className="muted small">{engine === 'chatgpt' ? '效果好，适合大范围扩展；消耗一次 ChatGPT 生图额度，约 1 分钟。' : '用本地 LaMa 补全，不花钱，适合扩一小圈；范围大时细节会变糊。'}</p>
      {engine === 'chatgpt' && <input className="pp-input" placeholder="补充描述（可选），比如：左边延伸出一片海" value={note} onChange={(e) => setNote(e.target.value)} />}
      <Actions close={close} onGo={() => go({ pads, engine, note })} label="开始扩图" disabled={!grown} />
    </>
  );
}

// ---- 元素编辑 ---------------------------------------------------------------------------------

type Tool = 'point' | 'box' | 'brush';
const TOOL_NAMES: Record<Tool, string> = { point: '点选', box: '框选', brush: '画笔' };
const ACTION_NAMES: Record<MarkAction, string> = { modify: '修改', remove: '删除', move: '移动' };

export function ElementEditor({ media, go, close }: OptProps & { media: MediaRef }) {
  const { url, size } = useImageSize(media);
  const [tool, setTool] = useState<Tool>('box');
  const [brush, setBrush] = useState(28);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [active, setActive] = useState(0);
  const [engine, setEngine] = useState<Engine>('chatgpt');
  const [busy, setBusy] = useState('');
  /** Waiting for a click that sets where mark `active` moves to. */
  const [placing, setPlacing] = useState(false);
  const overlay = useRef<HTMLCanvasElement>(null);
  const draft = useRef<{ mask: HTMLCanvasElement; from: { x: number; y: number } } | null>(null);
  const source = useRef<HTMLCanvasElement | null>(null);
  const view = size ? fit(size.w, size.h, Math.min(860, window.innerWidth - 100), Math.min(460, Math.round(window.innerHeight * 0.45))) : { w: 0, h: 0 };
  // Masks are kept at twice the view size: sharp enough, small enough.
  const mw = view.w * 2;
  const mh = view.h * 2;

  // Draw the marks (and the one being drawn) over the picture.
  const redraw = () => {
    const c = overlay.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const all = [...marks.map((m, i) => ({ m, i })), ...(draft.current ? [{ m: { mask: draft.current.mask } as Mark, i: marks.length }] : [])];
    for (const { m, i } of all) {
      const color = MARK_COLORS[i % MARK_COLORS.length];
      const tint = document.createElement('canvas');
      tint.width = c.width;
      tint.height = c.height;
      const t = tint.getContext('2d')!;
      t.drawImage(m.mask, 0, 0);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = color;
      t.fillRect(0, 0, c.width, c.height);
      g.globalAlpha = i === active ? 0.55 : 0.35;
      g.drawImage(tint, 0, 0);
      g.globalAlpha = 1;
      const b = m.action ? maskBox(m.mask) : null;
      if (!b) continue;
      g.fillStyle = color;
      g.beginPath();
      g.arc(b.x * c.width, b.y * c.height, 18, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), b.x * c.width, b.y * c.height);
      if (m.action === 'move' && m.to) {
        g.strokeStyle = color;
        g.lineWidth = 4;
        g.setLineDash([12, 8]);
        g.strokeRect((m.to.x - b.w / 2) * c.width, (m.to.y - b.h / 2) * c.height, b.w * c.width, b.h * c.height);
        g.setLineDash([]);
        g.beginPath();
        g.moveTo((b.x + b.w / 2) * c.width, (b.y + b.h / 2) * c.height);
        g.lineTo(m.to.x * c.width, m.to.y * c.height);
        g.stroke();
      }
    }
  };
  useEffect(redraw);

  const at = (e: ReactPointerEvent) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const newMask = () => {
    const m = document.createElement('canvas');
    m.width = mw;
    m.height = mh;
    return m;
  };
  const addMark = (mask: HTMLCanvasElement) => {
    const b = maskBox(mask);
    if (!b || b.w * view.w < 6 || b.h * view.h < 6) return notify('选区太小，请扩大标记范围');
    setMarks([...marks, { mask, action: 'modify', desc: '' }]);
    setActive(marks.length);
  };
  const update = (i: number, patch: Partial<Mark>) => setMarks(marks.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const down = async (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = at(e);
    if (placing) {
      update(active, { to: p });
      setPlacing(false);
      return;
    }
    if (marks.length >= MAX_MARKS) return notify(`最多添加 ${MAX_MARKS} 处编辑`);
    if (tool === 'point') {
      if (busy) return;
      setBusy('识别中...');
      try {
        const t = await import('./image');
        const e2 = await import('./edit');
        source.current ??= await t.loadImage(media);
        const found = await e2.subjectAt(source.current, p.x, p.y, setBusy);
        if (!found) notify('未识别到主体，请改用框选或画笔');
        else {
          const m = newMask();
          m.getContext('2d')!.drawImage(found, 0, 0, mw, mh);
          addMark(m);
        }
      } catch (err) {
        notify(`识别失败：${err instanceof Error ? err.message : err}`);
      } finally {
        setBusy('');
      }
      return;
    }
    capture(e);
    draft.current = { mask: newMask(), from: p };
    paint(p);
  };
  const paint = (p: { x: number; y: number }) => {
    const d = draft.current!;
    const g = d.mask.getContext('2d')!;
    g.fillStyle = '#fff';
    if (tool === 'box') {
      g.clearRect(0, 0, mw, mh);
      g.fillRect(Math.min(d.from.x, p.x) * mw, Math.min(d.from.y, p.y) * mh, Math.abs(p.x - d.from.x) * mw, Math.abs(p.y - d.from.y) * mh);
    } else {
      g.beginPath();
      g.arc(p.x * mw, p.y * mh, (brush / view.w) * mw, 0, Math.PI * 2);
      g.fill();
    }
    redraw();
  };
  const up = () => {
    const d = draft.current;
    draft.current = null;
    if (d) addMark(d.mask);
    else redraw();
  };

  const allRemove = marks.length > 0 && marks.every((m) => m.action === 'remove');
  const missing = marks.findIndex((m) => (m.action === 'modify' && !m.desc.trim()) || (m.action === 'move' && !m.to));
  const start = () => {
    if (missing >= 0) {
      setActive(missing);
      return notify(marks[missing].action === 'move' ? '请在图上点一下，选择移动目标位置' : '请输入修改描述');
    }
    go({ marks, engine: allRemove ? engine : 'chatgpt' });
  };

  if (!size) return <p className="muted">正在读取图片…</p>;
  return (
    <>
      <p className="muted">
        {placing ? '在图上点一下，选择这个对象要移动到的位置。' : { point: '点一下要修改的对象，自动识别出它的轮廓。', box: '框选你想要修改的对象。', brush: '画出你想要修改的对象。' }[tool]}
        最多 {MAX_MARKS} 处，每处可以修改、删除或移动。
      </p>
      <div className="tool-stage" style={{ width: view.w, height: view.h }}>
        {url && <img src={url} alt="" draggable={false} style={{ width: view.w, height: view.h }} />}
        <canvas
          ref={overlay}
          width={mw}
          height={mh}
          style={{ width: view.w, height: view.h, cursor: placing ? 'copy' : 'crosshair' }}
          onPointerDown={down}
          onPointerMove={(e) => draft.current && paint(at(e))}
          onPointerUp={up}
        />
      </div>
      <div className="tool-bar">
        <Seg value={tool} options={['point', 'box', 'brush'] as const} onChange={setTool} format={(v) => TOOL_NAMES[v]} />
        {tool === 'brush' && <input className="tool-range" type="range" min={8} max={80} value={brush} onChange={(e) => setBrush(Number(e.target.value))} title="画笔大小" />}
        <div className="grow" />
        {busy && <span className="muted small">{busy}</span>}
      </div>
      {marks.map((m, i) => (
        <div key={i} className={`ee-mark ${i === active ? 'on' : ''}`} onClick={() => setActive(i)}>
          <span className="ee-num" style={{ background: MARK_COLORS[i] }}>
            {i + 1}
          </span>
          <Seg value={m.action} options={['modify', 'remove', 'move'] as const} onChange={(a) => update(i, { action: a })} format={(v) => ACTION_NAMES[v]} />
          {m.action === 'modify' && <input className="pp-input" placeholder="描述你想如何修改" value={m.desc} onChange={(e) => update(i, { desc: e.target.value })} />}
          {m.action === 'move' && (
            <>
              <button
                className="text-btn"
                onClick={() => {
                  setActive(i);
                  setPlacing(true);
                }}
              >
                {m.to ? '重选位置' : '选择位置'}
              </button>
              <input className="pp-input" placeholder="补充移动说明（可选）" value={m.desc} onChange={(e) => update(i, { desc: e.target.value })} />
            </>
          )}
          {m.action === 'remove' && <span className="muted small grow">移除后背景自然融合</span>}
          <button className="icon-btn" aria-label="删除标记" onClick={() => setMarks(marks.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      {allRemove && (
        <>
          <h4 className="bd-h">生成方式</h4>
          <Seg value={engine} options={['chatgpt', 'local'] as const} onChange={setEngine} format={(v) => ENGINE_NAMES[v]} />
        </>
      )}
      <p className="muted small">{allRemove && engine === 'local' ? '只删除时可以用本地 LaMa，不花钱。' : '由 ChatGPT 修改，消耗一次生图额度，约 1 分钟；没标记的地方保持原样。'}</p>
      <Actions close={close} onGo={start} label="开始编辑" disabled={!marks.length || !!busy} />
    </>
  );
}
