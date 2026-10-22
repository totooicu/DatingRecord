// 事件集图标选择器（F-C08）。
//
// 四个 tab 对应四种图标：单文字 / 双字母 / SVG / 图片。
// 后两种要绑定一个文件，来源有两条路：
//   · 上传新文件 —— 走 uploadFileQuiet（与正文插图同一套判重，不会重复占空间）
//   · 从图库选择 —— 直接复用 attachments 里已有的文件，引用计数自动生效
//
// 关键约束：**图标落库是「文件 id」，不是 objectURL、也不是 base64**。
// 这样文件管理里能看到它、孤儿回收能保护它、导出备份时二进制跟着走。
import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadFileQuiet } from '../../core/files';
import { listFiles, urlForFile, type StoredFile } from '../../core/repo/files';
import { ConfirmButton, Modal } from '../common';
import { useVersion, bump } from '../../store';
import { getSmallLimit } from '../filePrefs';
import type { CollectionIcon, CollectionIconType } from '../../core/types';
import { CollectionIconView, iconChars } from './CollectionIcon';

/** 前景色板：字色以深浅为主，能压在任意底色上 */
const FG_COLORS = ['#2b2b2b', '#ffffff', '#c2255c', '#e8590c', '#2f9e44', '#1971c2', '#7048e8', '#868e96'];
/** 背景色板：浅色为主，深色只留一枚，避免列表里一片重色块 */
const BG_COLORS = [
  '#f7f3f0',
  '#fde8ef',
  '#fff4e6',
  '#ebfbee',
  '#e7f5ff',
  '#f3f0ff',
  '#f1f3f5',
  '#ffffff',
  '#d6336c',
  '#343a40',
  'transparent',
];

const TABS: { type: CollectionIconType; label: string }[] = [
  { type: 'text', label: '单文字' },
  { type: 'alpha', label: '双字母' },
  { type: 'svg', label: 'SVG' },
  { type: 'image', label: '图片' },
];

/**
 * 通用图标选择器。
 *
 * 事件集与人物共用同一套图标（F-C08 / F-P07）：调用方只负责把当前图标
 * 传进来、在 onSave 里落库。新增实体（例如以后的分组）也能直接复用。
 */
export function IconPicker({
  icon,
  title = '事件集图标',
  fallback = '',
  fileHint = '文件会出现在「设置 → 文件」里，可作为事件集图标被引用',
  /** 老字段（如人物头像）的清除入口：没设图标、但老数据还有显示内容时才会出现 */
  legacyClear,
  onSave,
  onClose,
}: {
  icon: CollectionIcon | null;
  title?: string;
  /** 无文字图标时的预览回退文字（一般是实体名字） */
  fallback?: string;
  fileHint?: string;
  legacyClear?: { label: string; onClear: () => void };
  onSave: (icon: CollectionIcon | null) => void;
  onClose: () => void;
}) {
  const v = useVersion();
  const cur = icon;
  const [type, setType] = useState<CollectionIconType>(cur?.type ?? 'text');
  const [text, setText] = useState(cur?.text ?? '');
  const [fileId, setFileId] = useState<string | undefined>(cur?.fileId);
  const [fg, setFg] = useState(cur?.fg ?? FG_COLORS[0]);
  const [bg, setBg] = useState(cur?.bg ?? BG_COLORS[1]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // 图库里只挑与当前 tab 匹配的文件。
  // 两个 tab 的分界只看 MIME：上传 svg 时 mime 就是 image/svg+xml，会被归到 SVG；
  // 万一 mime 缺失，再退回扩展名判断。这样同一张图不会两个 tab 都出现。
  const files = useMemo(() => listFiles(), [v]);
  /** 文件是否真的还在库里（上传后可能被孤儿回收扫掉） */
  const fileExists = (id: string) => files.some((f) => f.id === id);
  const library = useMemo(() => {
    const isSvg = (f: StoredFile) => (f.mime ? f.mime === 'image/svg+xml' : /\.svg$/i.test(f.name));
    if (type === 'svg') return files.filter(isSvg);
    if (type === 'image') return files.filter((f) => f.mime.startsWith('image/') && !isSvg(f));
    return [];
    // v 触发重算：刚上传的文件要立刻出现在图库里
  }, [type, files]);

  const draft: CollectionIcon | null =
    type === 'text' || type === 'alpha'
      ? { type, text: text || (type === 'alpha' ? 'AB' : '★'), fg, bg }
      : fileId
        ? { type, fileId, fg, bg }
        : { type, fg, bg };

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setErr('');
    try {
      const saved = await uploadFileQuiet(list[0], getSmallLimit());
      setFileId(saved.id);
      bump();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const save = () => {
    // 文字类必须至少有一个字；文件类必须绑定到文件，否则会把图标存成空方块
    if ((type === 'text' || type === 'alpha') && !text.trim()) return setErr('请先输入文字');
    if ((type === 'svg' || type === 'image') && !fileId) return setErr('请先上传或从图库选择一张图');
    // 新上传的文件可能已经被「孤儿回收」扫走了（上传 → 保存之间有 500ms 的持久化窗口），
    // 这种情况明确报错，不要让用户以为设上了
    if ((type === 'svg' || type === 'image') && fileId && !fileExists(fileId)) {
      return setErr('这张图已经不在文件库里了，请重新上传');
    }
    onSave(draft);
    bump();
    onClose();
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {cur && (
            <ConfirmButton
              text="移除图标"
              danger
              confirmText="恢复默认外观？"
              onConfirm={() => {
                onSave(null);
                bump();
                onClose();
              }}
            />
          )}
          {!cur && legacyClear && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                legacyClear.onClear();
                onClose();
              }}
            >
              {legacyClear.label}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="icon-picker">
        {/* 预览：三种尺寸，顺便让人看清在树里/日历里/头部是什么样 */}
        <div className="icon-preview">
          <CollectionIconView icon={draft} size="lg" fallback={fallback} />
          <CollectionIconView icon={draft} size="md" fallback={fallback} />
          <CollectionIconView icon={draft} size="sm" fallback={fallback} />
          <span className="muted small">
            {draft && (draft.type === 'svg' || draft.type === 'image') ? fileHint : '大小三档自动适配列表、日历与详情页'}
          </span>
        </div>

        <div className="icon-tabs">
          {TABS.map((t) => (
            <button
              key={t.type}
              className={t.type === type ? 'icon-tab icon-tab-on' : 'icon-tab'}
              onClick={() => {
                setType(t.type);
                setErr('');
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {(type === 'text' || type === 'alpha') && (
          <div className="icon-body">
            <input
              className="icon-text-input"
              value={text}
              maxLength={type === 'alpha' ? 8 : 4}
              placeholder={type === 'alpha' ? '两个字符，如 AB' : '一个字符 / emoji，如 ★ ♡ 🍰'}
              onChange={(e) => {
                setText(e.target.value);
                setErr('');
              }}
            />
            <p className="muted small">
              实际显示：
              <strong>「{text.trim() ? iconChars({ type, text }) : '—'}」</strong>
              {type === 'alpha' && ' （只取前两个字符）'}
            </p>
          </div>
        )}

        {(type === 'svg' || type === 'image') && (
          <div className="icon-body">
            <div className="row-actions">
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                上传{type === 'svg' ? ' SVG' : '图片'}
              </button>
              <span className="muted small">
                {type === 'svg' ? '仅 .svg，按矢量渲染不裁边' : 'png / jpg / webp / gif，按缩略图铺满'}
              </span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={type === 'svg' ? '.svg,image/svg+xml' : 'image/*'}
              hidden
              onChange={(e) => void upload(e.target.files)}
            />

            <p className="muted small icon-lib-title">或从图库选择（已有的文件不重复占空间）</p>
            {library.length === 0 ? (
              <p className="muted small">
                {files.length === 0
                  ? `图库里还没有任何文件，直接上传一张${type === 'svg' ? ' SVG' : '图片'}也行。`
                  : `图库里 ${files.length} 个文件都不是${type === 'svg' ? ' SVG' : '图片'}，直接上传一张也行。`}
              </p>
            ) : (
              <div className="icon-lib">
                {library.map((f) => (
                  <LibraryTile
                    key={f.id}
                    file={f}
                    selected={f.id === fileId}
                    onPick={() => {
                      setFileId(f.id);
                      setErr('');
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 配色：图片类只给背景（前景色对位图没意义） */}
        <div className="icon-colors">
          <div className="icon-color-row">
            <span className="muted small">背景</span>
            <Swatches colors={BG_COLORS} value={bg} onChange={setBg} />
          </div>
          {type !== 'image' && (
            <div className="icon-color-row">
              <span className="muted small">前景</span>
              <Swatches colors={FG_COLORS} value={fg} onChange={setFg} />
            </div>
          )}
        </div>

        {err && <p className="lock-err">{err}</p>}
      </div>
    </Modal>
  );
}

function Swatches({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="icon-swatches">
      {colors.map((c) => (
        <button
          key={c}
          className={c === value ? 'icon-swatch icon-swatch-on' : 'icon-swatch'}
          style={{ background: c === 'transparent' ? 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/8px 8px' : c }}
          aria-label={c === 'transparent' ? '透明' : c}
          data-color={c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function LibraryTile({
  file,
  selected,
  onPick,
}: {
  file: StoredFile;
  selected: boolean;
  onPick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void urlForFile(file.id).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [file.id]);

  return (
    <button
      className={selected ? 'icon-lib-tile icon-lib-tile-on' : 'icon-lib-tile'}
      onClick={onPick}
      title={file.name}
    >
      {url ? <img src={url} alt={file.name} loading="lazy" /> : <span className="muted small">…</span>}
    </button>
  );
}
