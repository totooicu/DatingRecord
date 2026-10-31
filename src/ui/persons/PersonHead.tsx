// 详情头：头像 + 改名 + 标签 + 归档按钮
import { useEffect, useState } from 'react';
import {
  updatePerson,
  listPersons,
  deletePerson,
  setPersonPrivate,
  setPersonIcon,
} from '../../core/repo/persons';
import { TagInput, PrivacyButton } from '../common';
import { GroupPicker } from './GroupPicker';
import { Avatar } from './Avatar';
import { IconPicker } from '../collections/IconPicker';
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
  const [iconOpen, setIconOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(person.displayName);
  useEffect(() => setNameDraft(person.displayName), [person.id, person.displayName]);
  const saveName = () => {
    const name = nameDraft.trim();
    if (!name) { setNameDraft(person.displayName); return; }
    setNameDraft(name);
    if (name === person.displayName) return;
    updatePerson(person.id, { displayName: name });
    bump();
  };

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
      <div className="detail-head detail-head-person">
        <Avatar
          name={person.displayName}
          avatar={person.avatar}
          icon={person.icon}
          size="lg"
          onClick={() => setIconOpen(true)}
          className="avatar-head"
        />
        <div className="detail-head-main">
          <input
            className="title-input"
            aria-label="人物姓名"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
          <TagInput
            value={person.tags}
            onChange={(t) => {
              updatePerson(person.id, { tags: t });
              bump();
            }}
            placeholder="添加标签"
          />
          {/* QQ 式分组：一个人挂一个组，组名自己填、填过的从下拉里复用 */}
          <GroupPicker
            value={person.groupName ?? ''}
            onCommit={(g) => {
              updatePerson(person.id, { groupName: g });
              bump();
            }}
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
              <PrivacyButton
                active={person.isPrivate}
                onToggle={() => {
                  setPersonPrivate(person.id, !person.isPrivate);
                  bump();
                }}
              />
              <button className="btn" onClick={() => setConfirming(true)}>
                归档
              </button>
            </>
          )}
        </div>
      </div>

      {iconOpen && (
        <IconPicker
          icon={person.icon ?? null}
          title="人物图标"
          fallback={person.displayName}
          fileHint="文件会出现在「设置 → 文件」里，可作为人物图标被引用"
          legacyClear={
            person.avatar
              ? {
                  label: '移除旧头像',
                  onClear: () => {
                    updatePerson(person.id, { avatar: null });
                    bump();
                  },
                }
              : undefined
          }
          onSave={(icon) => {
            setPersonIcon(person.id, icon);
            bump();
          }}
          onClose={() => setIconOpen(false)}
        />
      )}
    </>
  );
}
