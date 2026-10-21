// 详情头：头像 + 改名 + 标签 + 归档按钮
import { useState } from 'react';
import { updatePerson, listPersons, deletePerson } from '../../core/repo/persons';
import { TagInput } from '../common';
import { Avatar } from './Avatar';
import { AvatarPicker } from './AvatarPicker';
import { bump } from '../../store';
import type { Person } from '../../core/types';

export function PersonHead({
  person,
  onNewEvent,
  onArchived,
}: {
  person: Person;
  onNewEvent: () => void;
  onArchived?: (nextId: string | null) => void;
}) {
  // 归档二次确认就地替换按钮：记一件事 → 确认，归档 → 取消。
  // 不额外展开一块文案，头部布局在确认前后保持不变。
  const [confirming, setConfirming] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);

  const archive = () => {
    deletePerson(person.id);
    // 归档后别停在本人详情页——那看起来像没生效。
    // 手机端退回列表，宽屏右侧顺延到下一位。
    const next = listPersons()[0];
    onArchived?.(next?.id ?? null);
    bump();
  };

  return (
    <>
      <div className="detail-head">
        <Avatar
          name={person.displayName}
          avatar={person.avatar}
          size="lg"
          onClick={() => setAvatarOpen(true)}
          className="avatar-head"
        />
        <div className="detail-head-main">
          <input
            className="title-input"
            value={person.displayName}
            onChange={(e) => updatePerson(person.id, { displayName: e.target.value })}
            onBlur={() => bump()}
          />
          <TagInput
            value={person.tags}
            onChange={(t) => {
              updatePerson(person.id, { tags: t });
              bump();
            }}
            placeholder="添加标签"
          />
        </div>
        <div className="detail-head-actions">
          {confirming ? (
            <>
              <button className="btn btn-danger" onClick={archive} title="确认归档？" aria-label="确认归档">
                确认
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                取消
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" onClick={onNewEvent}>
                记一件事
              </button>
              <button className="btn" onClick={() => setConfirming(true)}>
                归档
              </button>
            </>
          )}
        </div>
      </div>

      {avatarOpen && (
        <AvatarPicker
          personId={person.id}
          currentAvatar={person.avatar}
          onClose={() => setAvatarOpen(false)}
        />
      )}
    </>
  );
}
