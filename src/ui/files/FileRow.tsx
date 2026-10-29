// 单个文件行：
//   第一行 类型 + 预览/改名/引用/删除（缩略图也是预览入口）
//   第二行起 文件名：单独成行，长名字按需换行，绝不截断
//   最后一行 大小 · 时间 · 引用数
import { Fragment, useRef, useState } from 'react';
import { countRefs, collectionsUsingFile, isMappingFile, personsUsingFile, renameFile, setFilePrivate, takeFileName } from '../../core/repo/files';
import { FileNameConflict } from '../../core/files/displayNames';
import { isAppLink, schemeOf } from '../../core/files';
import { isInPlaylist as isInMusic } from '../../core/music/playlist';
import { deleteHint } from './deleteHint';
import { HashBadge } from './HashBadge';
import {
  CheckIcon,
  CloseIcon,
  EyeIcon,
  IconButton,
  LinkIcon,
  LockIcon,
  PencilIcon,
  TrashIcon,
  UnlockIcon,
} from './rowIcons';
import { bump } from '../../store';
import type { StoredFile } from '../../core/repo/files';
import { extOf, kindLabel, kindOf } from '../preview';
import { fmtDate, fmtSize } from './fileFormat';

/** 文件名折行：优先在 _ - . / 空格后断行，避免把单词从中间劈开 */
function FileNameText({ name }: { name: string }) {
  const segments = name.split(/(?<=[_\-./\s])/);
  return (
    <>
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg}
          {i < segments.length - 1 && <wbr />}
        </Fragment>
      ))}
    </>
  );
}

export function FileRow({
  file,
  thumb,
  batch,
  selected,
  onToggleSelect,
  onPreview,
  onCopy,
  onDelete,
  onShowRefs,
  onPick,
  pickDisabled,
  pickLabel = '插入',
}: {
  file: StoredFile;
  thumb?: string;
  batch: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onPreview: (f: StoredFile) => void;
  onCopy: (f: StoredFile) => void;
  onDelete: (f: StoredFile) => void;
  onShowRefs: (f: StoredFile) => void;
  /** 编辑器里的挑选模式：给了就在行内显示「插入」，点名字也直接插入 */
  onPick?: (f: StoredFile) => void;
  /** 挑选模式下此文件已被选：灰显，点名字/插入都不响应 */
  pickDisabled?: boolean;
  /** 挑选按钮文案（默认「插入」；音乐面板传「加入」） */
  pickLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [draft, setDraft] = useState(file.name);
  const [renameError, setRenameError] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const refs = countRefs(file);
  const avatars = personsUsingFile(file);
  const icons = collectionsUsingFile(file);
  const kind = kindOf(file.name, file.mime);
  /** 缩略图兜底：未知类型不写「其」（来自「其他」），直接把扩展名亮出来 */
  const thumbText =
    kind === 'unknown'
      ? (extOf(file.name) || '?').toUpperCase().slice(0, 4)
      : kindLabel(kind).slice(0, 1);

  /** 批量模式勾选、挑选模式插入，其余情况预览 */
  const openOrSelect = () => {
    if (batch) onToggleSelect(file.id);
    else if (onPick) {
      if (pickDisabled) return;
      onPick(file);
    }
    else onPreview(file);
  };

  /**
   * 「这轮改名已处理完」闸门：点按钮或回车让输入框卸载时，浏览器还会补一次 focusout，
   * 不挡住就会拿旧草稿再改一次名（冲突路径上尤其会把已经成功的编辑重新打开）。
   * 重新进入编辑时复位。
   */
  const settled = useRef(false);
  const finish = () => {
    settled.current = true;
    setRenameError('');
    setSuggestion('');
    setEditing(false);
  };

  /** 改名：冲突默认拒绝；occupy = 占用此名，原同名文件自动编号（只动名字，不动内容与引用） */
  const commit = (value = draft, occupy = false) => {
    const n = value.trim();
    try {
      if (n && n !== file.name) {
        if (occupy) takeFileName(file.id, n);
        else renameFile(file.id, n);
        bump();
      } else {
        setDraft(file.name);
      }
      finish();
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e));
      setSuggestion(e instanceof FileNameConflict ? e.suggestion : '');
    }
  };

  /** 放弃这次改名：回到原名，退出编辑 */
  const cancel = () => {
    setDraft(file.name);
    finish();
  };

  return (
    <li className={`${selected ? 'file-item file-item-selected' : 'file-item'}${pickDisabled ? ' file-item-picked' : ''}`}>
      {batch && (
        <button
          type="button"
          className={selected ? 'file-check file-check-on' : 'file-check'}
          onClick={() => onToggleSelect(file.id)}
          aria-pressed={selected}
          aria-label={selected ? `取消选择「${file.name}」` : `选择「${file.name}」`}
        >
          {selected && <CheckIcon />}
        </button>
      )}

      <button
        className="file-thumb-btn"
        onClick={() => (batch ? onToggleSelect(file.id) : onPreview(file))}
        title={batch ? '选择' : '预览'}
        aria-label={batch ? '选择' : '预览'}
      >
        {thumb ? (
          <img className="file-thumb" src={thumb} alt="" />
        ) : (
          <span className="file-thumb file-thumb-icon">{thumbText}</span>
        )}
      </button>

      <div className="file-main">
        <div className="file-row-top">
          <span className="file-type">{kindLabel(kind)}</span>
          {isMappingFile(file) && (
            <span className="mapping-badge" title={file.sourceUrl}>
              映射
            </span>
          )}
          {file.isPrivate && <span className="privacy-badge">隐私</span>}

          {!batch && (
            <span className="file-actions">
              {onPick && (
                <button type="button" className="btn btn-sm btn-primary" disabled={pickDisabled}
                  onClick={() => { if (!pickDisabled) onPick(file); }}>
                  {pickDisabled ? '已选' : pickLabel}
                </button>
              )}
              <IconButton label="预览" onClick={() => onPreview(file)}>
                <EyeIcon />
              </IconButton>
              <IconButton
                label="改名"
                onClick={() => {
                  setDraft(file.name);
                  settled.current = false;
                  setRenameError('');
                  setSuggestion('');
                  setEditing(true);
                }}
              >
                <PencilIcon />
              </IconButton>
              <IconButton label="复制引用" onClick={() => onCopy(file)}>
                <LinkIcon />
              </IconButton>
              {confirmDel ? (
                <>
                  {/* 确认删除占住隐私键的位置，取消删除占住删除键的位置：按钮数量不变，窄屏不会挤出卡片 */}
                  <button
                    type="button"
                    className="file-icon-btn file-icon-btn-danger"
                    title="确定删除"
                    aria-label="确定删除"
                    onClick={() => {
                      setConfirmDel(false);
                      onDelete(file);
                    }}
                  >
                    <CheckIcon />
                  </button>
                  <button
                    type="button"
                    className="file-icon-btn"
                    title="取消删除"
                    aria-label="取消删除"
                    onClick={() => setConfirmDel(false)}
                  >
                    <CloseIcon />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={file.isPrivate ? 'file-icon-btn file-icon-btn-on' : 'file-icon-btn'}
                    title={file.isPrivate ? '已设为隐私，点击取消' : '设为隐私'}
                    aria-label={file.isPrivate ? '取消隐私' : '设为隐私'}
                    aria-pressed={file.isPrivate}
                    onClick={() => {
                      setFilePrivate(file.id, !file.isPrivate);
                      bump();
                    }}
                  >
                    {file.isPrivate ? <LockIcon /> : <UnlockIcon />}
                  </button>
                  <button
                    type="button"
                    className="file-icon-btn file-icon-btn-danger"
                    title={deleteHint(
                      file.name,
                      refs,
                      avatars.map((a) => a.displayName),
                      icons.map((c) => c.name),
                    )}
                    aria-label="删除"
                    onClick={() => setConfirmDel(true)}
                  >
                    <TrashIcon />
                  </button>
                </>
              )}
            </span>
          )}
        </div>

        {editing && !batch ? (
          <div onBlur={(e) => { if (settled.current) return; if (!e.currentTarget.contains(e.relatedTarget)) commit(); }}>
          <input
            className="file-rename"
            aria-label="文件名"
            autoFocus
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setRenameError(''); setSuggestion(''); }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
          />
          {renameError && <p className="small" role="alert">{renameError}</p>}
          {suggestion && <>
            <p className="small muted">「占用此名」把这个名字给当前文件，原同名文件自动编号，内容与引用都不动。</p>
            <div className="row-actions">
              <button type="button" className="btn btn-sm" onClick={() => commit(suggestion)}>使用建议名称</button>
              <button type="button" className="btn btn-sm" onClick={() => commit(draft, true)}>占用此名</button>
              <button type="button" className="btn btn-sm" onClick={cancel}>放弃改名</button>
            </div>
          </>}
          {!suggestion && renameError && <button type="button" className="btn btn-sm" onClick={cancel}>放弃改名</button>}
          </div>
        ) : (
          <button
            className="file-name"
            onClick={openOrSelect}
            title={onPick && !batch ? '插入引用' : file.name}
          >
            <FileNameText name={file.name} />
          </button>
        )}

        <div className="file-row-meta muted small">
          <HashBadge storedId={file.storedId} />
          <span>·</span>
          {isMappingFile(file) ? (
            <span title={file.sourceUrl}>
              {isAppLink(file.sourceUrl) ? `应用深链 · ${schemeOf(file.sourceUrl)}` : '链接文件'}
              {file.size > 0 ? ` · 远端 ${fmtSize(file.size)}` : ''}
            </span>
          ) : (
            <span>{fmtSize(file.size)}</span>
          )}
          <span>·</span>
          <span>{fmtDate(file.createdAt)}</span>
          <span>·</span>
          {refs + avatars.length + icons.length + (isInMusic(file.id) ? 1 : 0) === 0 ? (
            <span>未被引用</span>
          ) : (
            <button
              type="button"
              className="file-refs-btn"
              onClick={() => onShowRefs(file)}
              title="查看谁在用它"
            >
              {[
                refs > 0 ? `${refs} 个事件` : '',
                avatars.length > 0 ? `${avatars.length} 个头像` : '',
                icons.length > 0 ? `${icons.length} 个图标` : '',
                isInMusic(file.id) ? '歌单' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
