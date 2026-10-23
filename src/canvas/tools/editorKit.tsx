import type { PointerEvent as ReactPointerEvent } from 'react';

// Small pieces shared by the tools' option windows and editors.

export type OptProps = { go: (o?: Record<string, unknown>) => void; close: () => void };


export function Seg<T extends string | number>({ value, options, onChange, format }: { value: T; options: readonly T[]; onChange: (v: T) => void; format?: (v: T) => string }) {
  return (
    <div className="seg tool-seg">
      {options.map((o) => (
        <button key={String(o)} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export function Actions({ close, onGo, label = '开始', disabled }: { close: () => void; onGo: () => void; label?: string; disabled?: boolean }) {
  return (
    <div className="row">
      <button className="text-btn" onClick={close}>
        取消
      </button>
      <button className="primary-btn" disabled={disabled} onClick={onGo}>
        {label}
      </button>
    </div>
  );
}

/** Keeps pointer events coming while dragging, even outside the element. */
export const capture = (e: ReactPointerEvent<Element>) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // e.g. a pointer that's already gone
  }
};

/** Fits a w×h picture into the window's editing area. */
export const fit = (w: number, h: number, maxW = 860, maxH = 520) => {
  const k = Math.min(maxW / w, maxH / h, 1);
  return { w: Math.round(w * k), h: Math.round(h * k) };
};
