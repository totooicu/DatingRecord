// 预览里点事件：用正式的 EventView 渲染包内那一份（人物与事件集名都取自分享包，
// 包里没有的就显示「未包含在分享里」）。聊天型事件额外挂一段聊天预览。

import type { DREvent, ShareFile } from '../../../core/types';
import { Modal } from '../../common';
import { EventView } from '../../event/EventView';
import { ChatPreview } from '../SharePeeks';

export function EventViewModal({
  event,
  preview,
  messages,
  onClose,
}: {
  event: DREvent;
  preview: ShareFile;
  /** 这条事件在包里的聊天消息 */
  messages: ShareFile['messages'];
  onClose: () => void;
}) {
  return (
    <Modal
      wide
      title={`事件预览 · ${event.title || '未命名事件'}`}
      onClose={onClose}
    >
      <EventView
        event={event}
        persons={preview.persons.map((p) => ({ id: p.id, displayName: p.displayName }))}
        flat={preview.collections.map((c) => ({ c, depth: 0 }))}
        collectionIds={preview.members
          .filter((m) => m.memberType === 'event' && m.memberId === event.id)
          .map((m) => m.collectionId)}
        candidates={preview.events.map((e) => ({ id: e.id, title: e.title }))}
        missingTitle="（未包含在分享里）"
        body={
          event.viewMode === 'chat' && messages.length > 0 ? (
            <ChatPreview
              messages={messages}
              nameOf={(id) => preview.persons.find((p) => p.id === id)?.displayName ?? '旁白'}
            />
          ) : undefined
        }
      />
    </Modal>
  );
}
