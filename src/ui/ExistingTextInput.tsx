import { useState } from 'react';
import { existingInputChoices } from '../core/repo/inputChoices';

export function ExistingTextInput({ value, onChange, source, attributeKey, disabledChoices = false, multiline = false, placeholder }: {
  value: string; onChange: (value: string) => void; source: 'attribute' | 'mood'; attributeKey?: string;
  disabledChoices?: boolean; multiline?: boolean; placeholder?: string;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const onFocus = () => {
    setOptions(disabledChoices ? [] : existingInputChoices(source, attributeKey));
    setFocused(true);
  };
  return <span className="existing-input" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
  }}>
    {multiline ? <textarea rows={3} value={value} onFocus={onFocus} onChange={e => onChange(e.target.value)} /> :
      <input value={value} placeholder={placeholder} onFocus={onFocus} onChange={e => onChange(e.target.value)} />}
    {focused && <span className="chip-group" aria-label="已有内容候选">
      {options.filter(t => t !== value && t.toLowerCase().includes(value.toLowerCase())).slice(0, 20).map(t =>
        <button type="button" className="chip" key={t} style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%' }}
          onPointerDown={e => e.preventDefault()} onClick={() => onChange(t)}>{t}</button>)}
    </span>}
  </span>;
}
