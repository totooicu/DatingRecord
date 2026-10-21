// 详情头：头像 + 改名 + 标签 + 归档按钮
import { updatePerson, listPersons, deletePerson } from '../../core/repo/persons';
import { ConfirmButton, TagInput } from '../common';
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
  return (
    <div className="detail-head">
      <span className="avatar avatar-lg">{person.displayName.slice(0, 1)}</span>
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
        <button className="btn btn-primary" onClick={onNewEvent}>
          记一件事
        </button>
        <ConfirmButton
          text="归档"
          confirmText="确认归档？"
          onConfirm={() => {
            deletePerson(person.id);
            // 归档后别停在本人详情页——那看起来像没生效。
            // 手机端退回列表，宽屏右侧顺延到下一位。
            const next = listPersons()[0];
            onArchived?.(next?.id ?? null);
            bump();
          }}
        />
      </div>
    </div>
  );
}
