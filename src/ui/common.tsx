import { type ReactNode, useEffect, useState } from 'react';

/** 当前打开的弹窗数量：用来在弹窗打开时隐藏 FAB / TabBar，避免浮层压在内容上 */
let openModals = 0;
const modalListeners = new Set<(n: number) => void>();
function setModalOpen(delta: number) {
  openModals = Math.max(0, openModals + delta);
  modalListeners.forEach((fn) => fn(openModals));
}
export function useModalOpenCount() {
  const [n, setN] = useState(openModals);
  useEffect(() => {
    modalListeners.add(setN);
    return () => {
      modalListeners.delete(setN);
    };
  }, []);
  return n;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  media,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** 媒体预览用：高度随内容走、不限死，图片/视频才不会被挤成一条缝 */
  media?: boolean;
}) {
  useEffect(() => {
    setModalOpen(1);
    return () => setModalOpen(-1);
  }, []);

  const cls = ['modal', wide ? 'modal-wide' : '', media ? 'modal-media' : ''].filter(Boolean).join(' ');

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cls}>
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

export function Empty({
  text,
  action,
  compact,
}: {
  text: string;
  action?: ReactNode;
  /** 卡片里连续出现多个空状态时用更小的留白 */
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'empty empty-compact' : 'empty'}>
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
  compact,
  icon,
  className,
}: {
  text: string;
  danger?: boolean;
  confirmText: string;
  onConfirm: () => void;
  /** 紧凑模式：确认时只显示「确认 / 取消」，用于文件行这类挤在一行的场景 */
  compact?: boolean;
  /** 用图标代替文字（图标按钮仍需传 text 作为无障碍名称） */
  icon?: ReactNode;
  /** 追加到未确认按钮上的类名（如图标按钮样式） */
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button
        className={['btn', danger ? 'btn-danger' : '', className ?? ''].filter(Boolean).join(' ')}
        onClick={() => setArmed(true)}
        title={confirmText}
        aria-label={text}
      >
        {icon ?? text}
      </button>
    );
  }
  return (
    <span className={compact ? 'confirm-row' : 'confirm-row confirm-box'}>
      {!compact && <span className="confirm-msg">{confirmText}</span>}
      <span className="confirm-acts">
        <button
          className={compact ? 'btn btn-danger btn-sm' : 'btn btn-danger'}
          onClick={() => { onConfirm(); setArmed(false); }}
          title={confirmText}
        >
          确认
        </button>
        <button
          className={compact ? 'btn btn-ghost btn-sm' : 'btn btn-ghost'}
          onClick={() => setArmed(false)}
        >
          取消
        </button>
      </span>
    </span>
  );
}

/**
 * 隐私开关按钮：人物 / 事件集 / 事件 / 文件复用。
 * 只管「当前这条是否标了隐私」，不关心隐私模式开没开——模式是另一回事。
 * 点它切换 isPrivate 标记；开启隐私模式后，标了的条目会从所有列表消失。
 */
export function PrivacyButton({
  active,
  onToggle,
  label = '隐私',
}: {
  active: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={active ? 'btn btn-privacy' : 'btn'}
      title={active ? '已设为隐私（隐私模式下隐藏）' : '设为隐私（隐私模式下隐藏）'}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {label}
      {active ? '·开' : ''}
    </button>
  );
}

/**
 * 详情页顶部条：手机端显示返回按钮（页面栈），宽屏由 CSS 隐藏返回键。
 * 宽屏下标题可隐藏，因为左侧列表已经表明了当前项。
 */
export function PageHead({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="page-head">
      {onBack && (
        <button className="back-btn" onClick={onBack} aria-label="返回">
          ‹
        </button>
      )}
      <h2 className="page-head-title">{title}</h2>
      <div className="page-head-right">
        {right}
      </div>
    </div>
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
