// 历史会话 tab：列出存下来的会话，能载入继续、改名、批量删除。
// 列表用全站同一颗分页控件与同一个「每页条数」偏好；勾选（批量删除）按全量算。

import type { AiSession } from '../../../core/ai/sessions';
import type { Paged } from '../../common/usePaged';
import { fmtSnapTime } from '../../../core/snapshots';
import { Paginator } from '../../common/Paginator';
import { Empty } from '../../common';
import { PencilIcon } from '../../files/rowIcons';

export function HistoryTab({
  sessions,
  paged,
  manage,
  onManage,
  picked,
  onTogglePick,
  onRemovePicked,
  onFinishManage,
  onNew,
  onLoad,
  renameId,
  renameText,
  onRenameText,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: {
  sessions: AiSession[];
  paged: Paged<AiSession>;
  /** 批量管理模式：左边出勾选框，点条目变选中而不是打开 */
  manage: boolean;
  onManage: (v: boolean) => void;
  picked: Set<string>;
  onTogglePick: (id: string) => void;
  onRemovePicked: () => void;
  onFinishManage: () => void;
  onNew: () => void;
  onLoad: (id: string) => void;
  renameId: string | null;
  renameText: string;
  onRenameText: (v: string) => void;
  onStartRename: (s: AiSession) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}) {
  return (
    <div className="aichat-history">
      <div className="aichat-subhead">
        <span className="muted small">点一个会话就打开继续；改名、批量删除在右边。</span>
        <span className="aichat-subhead-actions">
          {manage ? (
            <>
              <button
                className="aichat-chipbtn aichat-chipbtn-danger"
                onClick={onRemovePicked}
                disabled={picked.size === 0}
              >
                删除选中{picked.size > 0 ? `（${picked.size}）` : ''}
              </button>
              <button className="aichat-chipbtn aichat-chipbtn-primary" onClick={onFinishManage}>
                完成
              </button>
            </>
          ) : (
            <>
              <button className="aichat-chipbtn" onClick={() => onManage(true)}>
                批量删除
              </button>
              <button className="aichat-chipbtn aichat-chipbtn-primary" onClick={onNew}>
                ＋ 新会话
              </button>
            </>
          )}
        </span>
      </div>
      {sessions.length === 0 ? (
        <Empty compact text="还没有历史会话。在「聊天」里说点什么，会自动存下来。" />
      ) : (
        <ul className="aichat-session-list">
          {paged.pageItems.map((s) => (
            <li
              key={s.id}
              className={manage && picked.has(s.id) ? 'aichat-session aichat-session-picked' : 'aichat-session'}
            >
              {manage && (
                <button
                  type="button"
                  className={picked.has(s.id) ? 'aichat-pick aichat-pick-on' : 'aichat-pick'}
                  onClick={() => onTogglePick(s.id)}
                  aria-pressed={picked.has(s.id)}
                  aria-label={picked.has(s.id) ? '取消选择' : '选择这个会话'}
                >
                  {picked.has(s.id) ? '✓' : ''}
                </button>
              )}
              {renameId === s.id ? (
                <div className="aichat-session-rename">
                  <input
                    value={renameText}
                    autoFocus
                    onChange={(e) => onRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onCommitRename();
                      if (e.key === 'Escape') onCancelRename();
                    }}
                    aria-label="会话名"
                  />
                  <button className="aichat-linkbtn" onClick={onCommitRename}>
                    保存
                  </button>
                  <button className="aichat-linkbtn aichat-linkbtn-dim" onClick={onCancelRename}>
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="aichat-session-main"
                    onClick={() => (manage ? onTogglePick(s.id) : onLoad(s.id))}
                    title={manage ? '选中这个会话' : '打开这个会话'}
                  >
                    <span className="aichat-session-title">{s.title}</span>
                    <span className="aichat-session-sub">
                      <span className="aichat-session-time">{fmtSnapTime(s.updatedAt)}</span>
                      <span className="aichat-session-meta">{s.items.length} 条消息</span>
                    </span>
                  </button>
                  {!manage && (
                    <button
                      type="button"
                      className="aichat-session-edit"
                      title="修改会话名"
                      aria-label="修改会话名"
                      onClick={() => onStartRename(s)}
                    >
                      <PencilIcon />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Paginator paged={paged} />
    </div>
  );
}
