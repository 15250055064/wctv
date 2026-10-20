import { useEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react';

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Props for a text field bound to a store value that stay safe with Chinese/Japanese input
 * methods. Writing every keystroke of a pinyin composition into the store re-renders the canvas
 * mid-composition and breaks it (the half-typed letters get committed). The field keeps its own
 * text, commits to the store only outside a composition, and follows outside changes (undo, a
 * generated result) whenever the user isn't composing.
 */
export function useImeField(value: string, commit: (v: string) => void, onLocalChange?: (v: string, el: Field) => void) {
  const [local, setLocal] = useState(value);
  const composing = useRef(false);
  const last = useRef(value);

  useEffect(() => {
    if (!composing.current && value !== last.current) {
      last.current = value;
      setLocal(value);
    }
  }, [value]);

  const push = (v: string) => {
    last.current = v;
    commit(v);
  };

  return {
    value: local,
    onChange: (e: ChangeEvent<Field>) => {
      const v = e.target.value;
      setLocal(v);
      onLocalChange?.(v, e.target);
      if (!composing.current && !(e.nativeEvent as InputEvent).isComposing) push(v);
    },
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (e: CompositionEvent<Field>) => {
      composing.current = false;
      const v = e.currentTarget.value;
      setLocal(v);
      onLocalChange?.(v, e.currentTarget);
      push(v);
    },
  };
}
