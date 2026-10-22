import { useMemo, useState } from 'react';
import { createEvent, deleteEvent, getEvent, listEvents, setEventPrivate, updateEvent } from '../../core/repo/events';
import { listPersons } from '../../core/repo/persons';
import {
  addMember,
  collectionsOfEvent,
  getTree,
  removeMember,
  type TreeNode,
} from '../../core/repo/collections';
import type { Collection, DREvent } from '../../core/types';
import { ConfirmButton, Modal, PrivacyButton } from '../common';
import { bump } from '../../store';
import { hides } from '../../privacy';
import { showToast } from '../toast';
import { EventFields } from './EventFields';
import { EventView } from './EventView';
import { ChatView } from './ChatView';
import { draftToPayload, initialDraft, type EventDraft } from './draft';

export function EventForm({
  event,
  defaultPersonId,
  defaultCollectionId,
  onClose,
}: {
  event?: DREvent;
  defaultPersonId?: string;
  defaultCollectionId?: string;
  onClose: () => void;
}) {
  const persons = useMemo(() => listPersons({ includeArchived: true }), []);
  const flat = useMemo(() => flatten(getTree()), []);
  const candidates = useMemo(
    () => listEvents().map((e) => ({ id: e.id, title: e.title, startTs: e.startTs, relatedEvents: e.relatedEvents })),
    [],
  );
  // 保存后不再关闭弹窗（保存即跳转会打断正在写的东西），
  // 所以新建完要把刚建的那条读回来当「已有事件」用——否则消息没处可挂。
  const [savedEvent, setSavedEvent] = useState<DREvent | null>(null);
  const ev = savedEvent ?? event ?? null;

  const existingCols = useMemo(
    () => (ev ? collectionsOfEvent(ev.id).map((c) => c.id) : []),
    [ev?.id],
  );

  const [d, setD] = useState<EventDraft>(() =>
    initialDraft(event, defaultPersonId, defaultCollectionId, existingCols),
  );
  // 打开已有事件先给浏览态：读的人不需要一屏输入框；点「编辑」才进表单。
  // 新建没有可读的旧数据，直接进编辑态。
  const [mode, setMode] = useState<'view' | 'edit'>(event ? 'view' : 'edit');
  const [priv, setPriv] = useState<boolean>(!!event?.isPrivate);
  const patch = (p: Partial<EventDraft>) => setD((s) => ({ ...s, ...p }));

  const save = () => {
    const payload = draftToPayload(d);
    let savedId: string;
    if (ev) {
      updateEvent(ev.id, payload);
      savedId = ev.id;
      const before = new Set(existingCols);
      const after = new Set(d.cols);
      for (const id of after) if (!before.has(id)) addMember(id, 'event', ev.id);
      for (const id of before) if (!after.has(id)) removeMember(id, 'event', ev.id);
    } else {
      const created = createEvent(payload);
      savedId = created.id;
      for (const id of d.cols) addMember(id, 'event', created.id);
    }
    // 隐私标记与正文/集合是两条独立的写，单独落库，不混进 updateEvent
    setEventPrivate(savedId, priv);
    bump();
    // 留在原地：刚改完往往还要接着写（尤其聊天形式下一条条往下记），
    // 关掉弹窗等于把人赶出去。只飘一句「已保存」，想要关自己点关闭。
    setSavedEvent(getEvent(savedId));
    showToast('已保存');
  };

  // 隐私模式 + 标了隐私：直接打开的编辑框也藏起来（文件库跳转等入口会先被拦截，
  // 这里再兜一层，免得任何直达路径把隐藏事件亮出来）
  if (ev && hides(ev)) {
    return (
      <Modal title="事件" onClose={onClose}>
        <p className="muted">该事件已设为隐私，隐私模式下不显示。</p>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      wide
      title={!ev ? '新建事件' : mode === 'view' ? '事件' : '编辑事件'}
      onClose={onClose}
      footer={
        <>
          {ev && (
            <ConfirmButton
              text="删除"
              danger
              confirmText="删除这个事件？它会先进「设置 → 归档与回收」，之后可以恢复或彻底删除。"
              onConfirm={() => {
                deleteEvent(ev.id);
                bump();
                onClose();
              }}
            />
          )}
          {ev && mode === 'view' ? (
            <>
              <button className="btn btn-ghost" onClick={onClose}>
                关闭
              </button>
              <button className="btn btn-primary" onClick={() => setMode('edit')}>
                编辑
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={onClose}>
                取消
              </button>
              <button className="btn btn-primary" onClick={save}>
                保存
              </button>
            </>
          )}
        </>
      }
    >
      {ev && mode === 'view' ? (
        <EventView
          event={ev}
          persons={persons}
          flat={flat}
          collectionIds={existingCols}
          candidates={candidates}
          body={ev.viewMode === 'chat' ? <ChatView event={ev} /> : undefined}
        />
      ) : (
        <>
          <div className="privacy-form-row">
            <span className="field-label">隐私</span>
            <PrivacyButton active={priv} onToggle={() => setPriv((v) => !v)} />
            <span className="muted small">开启隐私模式后，此事件将隐藏</span>
          </div>
          <EventFields
            d={d}
            patch={patch}
            persons={persons}
            flat={flat}
            eventId={event?.id}
            candidates={candidates}
          />
          {/* 聊天形式在编辑态也直接可编：点气泡改内容，不用先切回浏览态。
              新建事件还没有 id，消息无处可挂，保存后再记。 */}
          {d.viewMode === 'chat' &&
            (ev ? (
              <ChatView event={ev} />
            ) : (
              <p className="muted small chat-new-hint">
                先点「保存」，保存后就能在这里开始记聊天内容了。
              </p>
            ))}
        </>
      )}
    </Modal>
  );
}

function flatten(node: TreeNode | null): { c: Collection; depth: number }[] {
  const out: { c: Collection; depth: number }[] = [];
  const walk = (n: TreeNode, d: number) => {
    out.push({ c: n, depth: d });
    for (const k of n.children) walk(k, d + 1);
  };
  if (node) walk(node, 0);
  return out;
}
