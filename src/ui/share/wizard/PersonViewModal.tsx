// 预览里点人物：看这份分享里实际带走的资料——导入方看到的就是这些。

import type { AttributeDef, Person, ShareLevel } from '../../../core/types';
import { SHARE_LEVELS } from '../../../core/types';
import { Modal } from '../../common';
import { Avatar } from '../../persons/Avatar';
import { attrsOf } from './model';

export function PersonViewModal({
  person,
  defs,
  level,
  eventCount,
  onClose,
}: {
  person: Person;
  defs: AttributeDef[];
  level: ShareLevel;
  /** 在预览事件里出现的次数（0 = 没出现） */
  eventCount: number;
  onClose: () => void;
}) {
  const attrs = attrsOf(person, defs);
  return (
    <Modal title={`人物资料 · ${person.displayName}`} onClose={onClose}>
      <div className="share-person-view">
        <div className="share-person-view-head">
          <Avatar name={person.displayName} avatar={person.avatar} icon={person.icon} size="lg" />
          <div>
            <strong>{person.displayName}</strong>
            <span className="muted small">
              {eventCount ? `在这些事件里出现 ${eventCount} 次` : '没有出现在这些事件里'}
            </span>
          </div>
        </div>

        {person.aliases.length > 0 && (
          <div className="share-view-row">
            <span className="share-view-label">别名</span>
            <span>{person.aliases.join('、')}</span>
          </div>
        )}
        {person.tags.length > 0 && (
          <div className="share-view-row">
            <span className="share-view-label">标签</span>
            <span>{person.tags.join('、')}</span>
          </div>
        )}

        {attrs.length > 0 && (
          <div className="share-view-attrs">
            <div className="share-view-label">属性</div>
            <div className="share-attr-list">
              {attrs.map((a) => (
                <span key={a.key} className="share-attr-pill">
                  <em>{a.label}</em>
                  {a.text}
                </span>
              ))}
            </div>
          </div>
        )}

        {person.notes.trim() && (
          <div className="share-view-row">
            <span className="share-view-label">备注</span>
            <p className="share-person-note">{person.notes}</p>
          </div>
        )}

        {person.aliases.length === 0 &&
          person.tags.length === 0 &&
          Object.keys(person.attrs).length === 0 &&
          !person.notes.trim() && (
            <p className="muted small">
              这份分享按「{SHARE_LEVELS.find((l) => l.key === level)?.title ?? '原样'}」程度只带了姓名。
            </p>
          )}

        <p className="muted small">以上是这份分享里实际带走的资料，导入方看到的就是这些。</p>
      </div>
    </Modal>
  );
}
