// 第 2 步：挑要带走资料的人物。
//
// 事件里出现的人必须带上（否则事件会指向一个不存在的人），下面那组是
// 没出现在事件里、但用户想连资料一起带走的人。

import type { Person } from '../../../core/types';
import { Avatar } from '../../persons/Avatar';
import { Empty } from '../../common';

export function PickPersons({
  involved,
  extras,
  extraPicked,
  onSetExtras,
  onToggleExtra,
}: {
  /** 事件里的人物 + 出现次数 */
  involved: { person: Person; eventCount: number }[];
  /** 没出现在当前事件里的人物 */
  extras: Person[];
  extraPicked: Set<string>;
  onSetExtras: (ids: Set<string>) => void;
  onToggleExtra: (id: string) => void;
}) {
  return (
    <>
      <div className="share-wizard-tools">
        <span className="muted small">
          事件里出现的人必须带上资料，否则事件会指向一个不存在的人；下面还可以多选没涉及到的人。
        </span>
        <span className="share-wizard-btns">
          <button
            className="btn btn-sm"
            onClick={() => onSetExtras(new Set(extras.map((p) => p.id)))}
            disabled={extras.length === 0}
          >
            全选其他
          </button>
          <button
            className="btn btn-sm"
            onClick={() => onSetExtras(new Set())}
            disabled={extraPicked.size === 0}
          >
            清空其他
          </button>
        </span>
      </div>

      <div className="share-person-section">事件里的人物（必带）</div>
      {involved.length === 0 ? (
        <p className="muted small">当前挑出的事件里没有人物。</p>
      ) : (
        <div className="share-pick-list">
          {involved.map(({ person, eventCount }) => (
            <div key={person.id} className="share-pick-row share-pick-on">
              <label className="share-pick-main">
                <input type="checkbox" checked disabled />
                <Avatar name={person.displayName} avatar={person.avatar} icon={person.icon} size="sm" />
                <span className="share-pick-name">{person.displayName}</span>
              </label>
              <span className="muted small">出现 {eventCount} 次</span>
              <span className="share-pick-tag">必带</span>
            </div>
          ))}
        </div>
      )}

      {extras.length > 0 && (
        <>
          <div className="share-person-section">其他人物（可选）</div>
          <p className="muted small">
            这些人没有出现在当前事件里，勾上会连他们的资料一起带走，导入后是一个没有事件指向的人。
          </p>
          <div className="share-pick-list">
            {extras.map((person) => {
              const on = extraPicked.has(person.id);
              return (
                <label key={person.id} className={on ? 'share-pick-row share-pick-on' : 'share-pick-row'}>
                  <input type="checkbox" checked={on} onChange={() => onToggleExtra(person.id)} />
                  <Avatar name={person.displayName} avatar={person.avatar} icon={person.icon} size="sm" />
                  <span className="share-pick-name">{person.displayName}</span>
                </label>
              );
            })}
          </div>
        </>
      )}

      {involved.length === 0 && extras.length === 0 && <Empty compact text="库里还没有人物。" />}
    </>
  );
}
