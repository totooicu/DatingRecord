// 分享向导里的「看一眼」弹窗：事件正文、事件集详情。
//
// 挑选阶段看的是本库的真实数据，预览阶段看的是已经按分享程度裁剪过的包内数据。
// 两边长的样子必须一致，所以这里只收「已经算好的展示数据」，不碰写库 API——
// 分享向导里任何弹窗都不该有编辑入口。
import { useMemo } from 'react';
import { listMessages } from '../../core/repo/chat';
import {
  collectionsOfEvent,
  describeRule,
  getTree,
  type TreeNode,
} from '../../core/repo/collections';
import { listEvents } from '../../core/repo/events';
import { listPersons } from '../../core/repo/persons';
import { formatTime } from '../../core/time';
import type { ChatMessage, Collection, DREvent } from '../../core/types';
import { Modal, Empty } from '../common';
import { EventView } from '../event/EventView';

/** 事件集详情里的一行事件：off = 被取消勾选，不会分享 */
export interface ColPeekEvent {
  event: DREvent;
  off?: boolean;
}

export interface ColPeekData {
  name: string;
  smart: boolean;
  /** 上级路径，根集合不显示 */
  path: string;
  description: string;
  ruleText?: string;
  statusLabel: string;
  isPrivate: boolean;
  children: string[];
  events: ColPeekEvent[];
}

/** 只读对话流：分享预览和本库预览共用一套排版 */
export function ChatPreview({
  messages,
  nameOf,
}: {
  messages: ChatMessage[];
  nameOf: (personId: string) => string;
}) {
  return (
    <div className="share-chat-preview">
      {messages.map((m) =>
        m.type === 'divider' ? (
          <div key={m.id} className="share-chat-div">
            {m.body}
          </div>
        ) : (
          <div key={m.id} className="share-chat-msg">
            <strong>{m.personId ? nameOf(m.personId) : '旁白'}</strong>
            <span>{m.body}</span>
          </div>
        ),
      )}
    </div>
  );
}

/** 本库事件预览：地点/评分/正文都按原样读，聊天形式走只读对话流 */
export function RepoEventPeek({ event, onClose }: { event: DREvent; onClose: () => void }) {
  const data = useMemo(() => {
    const flat = flatten(getTree());
    return {
      persons: listPersons({ includeArchived: true }).map((p) => ({
        id: p.id,
        displayName: p.displayName,
      })),
      flat,
      collectionIds: collectionsOfEvent(event.id).map((c) => c.id),
      candidates: listEvents().map((e) => ({ id: e.id, title: e.title })),
      messages: event.viewMode === 'chat' ? listMessages(event.id) : [],
    };
  }, [event.id, event.viewMode]);

  const nameOf = useMemo(() => {
    const map = new Map(data.persons.map((p) => [p.id, p.displayName]));
    return (id: string) => map.get(id) ?? '（已删除）';
  }, [data.persons]);

  return (
    <Modal
      wide
      title="事件预览"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          关闭
        </button>
      }
    >
      <EventView
        event={event}
        persons={data.persons}
        flat={data.flat}
        collectionIds={data.collectionIds}
        candidates={data.candidates}
        body={
          event.viewMode === 'chat' && data.messages.length > 0 ? (
            <ChatPreview messages={data.messages} nameOf={nameOf} />
          ) : undefined
        }
      />
      <p className="muted small share-peek-note">这是本库里的原始内容，导入方看到的由分享程度决定。</p>
    </Modal>
  );
}

/** 事件集详情：只读，事件行点开还能看正文 */
export function ColPeekModal({
  data,
  onClose,
  onEvent,
}: {
  data: ColPeekData;
  onClose: () => void;
  onEvent: (e: DREvent) => void;
}) {
  return (
    <Modal
      title="事件集详情"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="share-colpeek">
        <h4 className="share-colpeek-name">
          {data.name}
          {data.smart && <em title="智能集合：成员由规则实时算出">⚡</em>}
        </h4>

        {data.path && (
          <div className="share-view-row">
            <span className="share-view-label">上级</span>
            <span>{data.path}</span>
          </div>
        )}
        <div className="share-view-row">
          <span className="share-view-label">类型</span>
          <span className="share-colpeek-tags">
            <span className="share-pick-tag">{data.smart ? '智能集合' : '普通集合'}</span>
            <span className="share-pick-tag share-pick-muted">{data.statusLabel}</span>
            {data.isPrivate && <span className="share-pick-tag">隐私</span>}
          </span>
        </div>
        <div className="share-view-row">
          <span className="share-view-label">事件</span>
          <span>{data.events.length} 个（含子事件集）</span>
        </div>

        {data.description.trim() && (
          <div className="share-view-row">
            <span className="share-view-label">说明</span>
            <p className="share-person-note">{data.description}</p>
          </div>
        )}

        {data.smart && (
          <div className="share-view-row">
            <span className="share-view-label">规则</span>
            <span>{data.ruleText || '全部事件（未设条件）'}</span>
          </div>
        )}

        {data.children.length > 0 && (
          <div className="share-view-row">
            <span className="share-view-label">子事件集</span>
            <span className="share-colpeek-children">
              {data.children.map((n) => (
                <span key={n} className="share-attr-pill">
                  {n}
                </span>
              ))}
            </span>
          </div>
        )}

        <div className="share-colpeek-events-title">事件（点开预览）</div>
        {data.events.length === 0 ? (
          <Empty compact text="这个事件集下面还没有事件。" />
        ) : (
          <div className="share-events">
            {data.events.map(({ event, off }) => (
              <button
                key={event.id}
                type="button"
                className="share-event-row share-row-btn"
                onClick={() => onEvent(event)}
              >
                <span className="share-event-row-text">
                  <strong>{event.title || '未命名事件'}</strong>
                  <span className="muted small">{formatTime(event.time)}</span>
                </span>
                {off && <span className="share-pick-tag share-pick-muted">不分享</span>}
                <span className="share-row-caret">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function flatten(node: TreeNode | null): { c: Collection; depth: number }[] {
  const out: { c: Collection; depth: number }[] = [];
  const walk = (n: TreeNode, d: number) => {
    out.push({ c: n, depth: d });
    for (const c of n.children) walk(c, d + 1);
  };
  if (node) walk(node, 0);
  return out;
}

/** 给智能集合规则里的「人物」换个名字显示，别直接吐 id */
export function ruleTextOf(c: Collection): string {
  if (c.kind !== 'smart') return '';
  const names = new Map(listPersons({ includeArchived: true }).map((p) => [p.id, p.displayName]));
  return describeRule(c.rule, (id) => names.get(id) ?? id);
}
