import { type ReactNode, useState } from 'react';

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal modal-wide' : 'modal'}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{text}</p>
      {action}
    </div>
  );
}

export function ConfirmButton({
  text,
  danger,
  confirmText,
  onConfirm,
}: {
  text: string;
  danger?: boolean;
  confirmText: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button className={danger ? 'btn btn-danger' : 'btn'} onClick={() => setArmed(true)}>
        {text}
      </button>
    );
  }
  return (
    <span className="confirm-row">
      <button className="btn btn-danger" onClick={() => { onConfirm(); setArmed(false); }}>
        {confirmText}
      </button>
      <button className="btn btn-ghost" onClick={() => setArmed(false)}>
        取消
      </button>
    </span>
  );
}

/** 标签输入：回车或逗号分隔添加 */
export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="chip">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label="移除">
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={placeholder ?? '输入后回车'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}
