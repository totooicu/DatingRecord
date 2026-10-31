// 聊天 tab：气泡列表 + 待发附件 + 输入区。
//
// 状态全在父组件（aiChat 单例 + 本页 useState），这里只吃 props 画界面——
// 切 tab 时组件不卸载，agent 循环不中断，所以本文件刻意不持有任何状态。

import type { MutableRefObject } from 'react';
import type { Attachment } from '../../../core/ai/attach';
import type { AiModel } from '../../../core/ai';
import type { AiItem } from '../../../core/runtime/aiChat';
import { MAX_ATTACHMENTS } from '../../../core/ai/attach';
import { draftTimeLabel } from '../../../core/drafts';
import { MarkdownView } from '../../markdown';
import { AttachmentChips, AttachIcon, LibIcon } from './Attachments';
import { QUICK } from './model';

export function ChatTab({
  items,
  busy,
  activity,
  roundNo,
  itemMenu,
  onItemMenu,
  onCopy,
  onRemove,
  atts,
  onRemoveAtt,
  input,
  onInput,
  inputRestoredAt,
  onClearInput,
  models,
  alias,
  onAlias,
  onStop,
  rollbackId,
  onRollback,
  canSend,
  onSend,
  onPickFile,
  onOpenLib,
  onGoSnap,
  logRef,
  hasModel,
}: {
  items: AiItem[];
  busy: boolean;
  activity: string[];
  roundNo: number;
  /** 点开操作菜单的那条气泡下标 */
  itemMenu: number | null;
  onItemMenu: (i: number | null) => void;
  onCopy: (it: AiItem) => void;
  onRemove: (i: number) => void;
  atts: Attachment[];
  onRemoveAtt: (key: string) => void;
  input: string;
  onInput: (v: string) => void;
  /** 输入框内容是从草稿恢复来的？非空就在输入区上方挂一行提示 + 清空键 */
  inputRestoredAt: number | null;
  onClearInput: () => void;
  models: AiModel[];
  alias: string;
  onAlias: (v: string) => void;
  onStop: () => void;
  rollbackId: string | null;
  onRollback: (id: string) => void;
  canSend: boolean;
  onSend: (text: string) => void;
  onPickFile: () => void;
  onOpenLib: () => void;
  /** 待审核的成果：点一下带用户去「成果」tab */
  onGoSnap: () => void;
  /** 气泡容器：新消息要靠它滚到底，所以 ref 由父组件持有 */
  logRef: MutableRefObject<HTMLDivElement | null>;
  /** 没配模型时连引导语也发不出去 */
  hasModel: boolean;
}) {
  return (
    <div className="aichat-chat">
      <div className="aichat-log" ref={logRef}>
        {items.length === 0 && (
          <div className="aichat-empty">
            <p>比如可以问我：</p>
            <ul>
              {QUICK.map((q) => (
                <li key={q}>
                  <button className="aichat-quick" onClick={() => onSend(q)} disabled={busy || !hasModel}>
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {items.map((it, i) => (
          <div
            key={i}
            className={
              itemMenu === i ? `aichat-item aichat-${it.kind} aichat-item-open` : `aichat-item aichat-${it.kind}`
            }
            onClick={(e) => {
              // 气泡里的链接 / 按钮自己有事要做，别顺手把操作菜单也切出来
              if ((e.target as HTMLElement).closest('a,button')) return;
              onItemMenu(itemMenu === i ? null : i);
            }}
          >
            {it.attachments && it.attachments.length > 0 && <AttachmentChips atts={it.attachments} />}
            {/* 气泡内容按 Markdown 渲染：模型的回复天生带标题/列表/代码块，
                当纯文本显示就是把 ** 和 # 原样甩给用户。安全性由 core/markdown
                （marked 解析 + DOMPurify 白名单）保证，这里只管展示。 */}
            <div className="aichat-bubble">
              <MarkdownView source={it.text} />
            </div>
            {it.tools && it.tools.length > 0 && <div className="aichat-tools">调用了 {it.tools.join('、')}</div>}
            {it.pendingId && !busy && (
              <button className="aichat-rollback aichat-review-btn" onClick={onGoSnap}>
                待审核：去「成果」执行或放弃
              </button>
            )}
            {it.snapshotId && !it.pendingId && !busy && (
              <button className="aichat-rollback" onClick={() => onRollback(it.snapshotId!)}>
                回退本轮改动
              </button>
            )}
            {itemMenu === i && !busy && (
              <div className="aichat-item-actions">
                <button
                  className="aichat-linkbtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopy(it);
                  }}
                >
                  复制到对话框
                </button>
                <button
                  className="aichat-linkbtn aichat-linkbtn-dim"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(i);
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        ))}

        {busy && activity.length > 0 && (
          <div className="aichat-item aichat-assistant">
            <div className="aichat-activity">
              {activity.map((a, i) => (
                <div key={i} className="aichat-activity-line">
                  {a}
                </div>
              ))}
            </div>
          </div>
        )}

        {busy && activity.length === 0 && <div className="aichat-item aichat-assistant">思考中…</div>}
      </div>

      {/* 待发送的附件：贴在输入框上方，发出去就清空 */}
      {atts.length > 0 && (
        <div className="aichat-pending">
          <AttachmentChips atts={atts} onRemove={onRemoveAtt} />
        </div>
      )}

      <div className="aichat-input">
        {inputRestoredAt !== null && (
          <div className="draft-restored">
            <span className="muted small">
              已恢复上次没发出去的内容 · {draftTimeLabel(inputRestoredAt)}
            </span>
            <button className="btn btn-sm" onClick={onClearInput}>
              清空
            </button>
          </div>
        )}
        <div className="aichat-input-tools">
          <button
            className="aichat-toolbtn"
            onClick={onPickFile}
            disabled={busy || atts.length >= MAX_ATTACHMENTS}
            title="从本地选文件（手机上就是系统文件选择器）"
          >
            <AttachIcon /> 选文件
          </button>
          <button
            className="aichat-toolbtn"
            onClick={onOpenLib}
            disabled={busy || atts.length >= MAX_ATTACHMENTS}
            title="从本库的文件里挑一个"
          >
            <LibIcon /> 文件库
          </button>
          <label className="aichat-model aichat-model-inline" title="选择模型">
            <select value={alias} onChange={(e) => onAlias(e.target.value)} disabled={busy}>
              {models.length === 0 && <option value="">（未配置模型）</option>}
              {models.map((m) => (
                <option key={m.id} value={m.alias}>
                  {m.alias} · {m.model}
                </option>
              ))}
            </select>
          </label>
          {busy && (
            <span className="aichat-busy-chip" role="status">
              <span className="aichat-status-dot" aria-hidden />
              AI 干活中{roundNo > 1 ? ` · 第 ${roundNo} 轮` : ''}
              <button className="aichat-busy-stop" onClick={onStop}>
                停止
              </button>
            </span>
          )}
          {rollbackId && (
            <button className="aichat-toolbtn aichat-toolbtn-warn" onClick={() => onRollback(rollbackId)}>
              回退本轮
            </button>
          )}
        </div>
        <div className="aichat-input-row">
          <textarea
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter 只换行；Cmd/Ctrl+Enter 才发送（用户要求「换行不要触发发送」）
              if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                onSend(input);
              }
            }}
            placeholder={busy ? 'AI 正在干活，说不了话…' : '说点什么，Enter 换行，Cmd/Ctrl+Enter 发送'}
            rows={2}
            disabled={busy}
          />
          <button className="btn-primary aichat-send" onClick={() => onSend(input)} disabled={!canSend}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
