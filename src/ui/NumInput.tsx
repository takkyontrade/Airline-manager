import { useEffect, useState } from 'react';

/**
 * Number field that lets you type freely and only applies the value when you
 * leave the field or press Enter. (Applying every keystroke meant an emptied
 * field snapped straight back to the minimum, so digits could not be replaced.)
 */
export function NumInput({ value, onCommit, min, max, style, className }: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(String(value)); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const n = Number(text.replace(/[,，\s]/g, '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)));
    if (text.trim() === '' || !Number.isFinite(n)) { setText(String(value)); return; }
    const v = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      style={style}
      value={text}
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onChange={(e) => { setEditing(true); setText(e.target.value); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}
