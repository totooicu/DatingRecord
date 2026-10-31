// 人物分组（QQ 那种：一人挂一个组，组名自己填、填过的复用）。
//
// 组名不建表，库里 DISTINCT 出来就是候选，所以：
//   · 「同学 / 家人 / 同事」这些名字是用户自己敲出来的，敲第二次就能选到；
//   · 最后一人离开某组，这个组名自己就消失了，不会攒出一堆空组。
import { useEffect, useId, useMemo, useState } from 'react';
import { listGroupNames } from '../../core/repo/persons';
import { useVersion } from '../../store';

/** 组名编辑框：自由填写 + datalist 复用填过的；✕ = 移出分组（回到未分组） */
export function GroupPicker({
  value,
  onCommit,
  label = '分组',
}: {
  value: string;
  onCommit: (next: string) => void;
  label?: string;
}) {
  const v = useVersion();
  const names = useMemo(() => listGroupNames(), [v]);
  const listId = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (raw: string) => {
    const next = raw.trim();
    if (next === value.trim()) return; // 没改就别写（否则撤销条里多一条什么都没改的「修改…」）
    onCommit(next);
  };

  return (
    <span className="group-picker">
      <span className="group-picker-label guide-only">{label}</span>
      <input
        className="group-picker-input"
        list={listId}
        value={draft}
        placeholder="未分组"
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          // 拼音没打完时 Enter 是「确认候选词」，不能当成提交（与人物改名同一套判断）
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            commit(draft);
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') setDraft(value);
        }}
      />
      <datalist id={listId}>
        {/* 常用在前：listGroupNames 已按人数排过 */}
        {names.map((n) => (
          <option key={n.name} value={n.name} />
        ))}
      </datalist>
      {value && (
        <button
          type="button"
          className="icon-btn group-picker-clear"
          aria-label="移出分组"
          title="移出分组"
          onClick={() => {
            setDraft('');
            onCommit('');
          }}
        >
          ✕
        </button>
      )}
    </span>
  );
}

/**
 * 分组筛选条：全部 / 各分组 / 未分组。
 * 只在真的有两个以上组时出现，否则白占一行。
 */
export function GroupChips({
  sections,
  active,
  onPick,
}: {
  sections: { name: string; count: number }[];
  /** undefined = 全部；空串 = 未分组 */
  active: string | undefined;
  onPick: (next: string | undefined) => void;
}) {
  if (sections.length < 2) return null;
  return (
    <div className="group-chips" role="tablist" aria-label="按分组筛选">
      <button
        type="button"
        className={active === undefined ? 'group-chip group-chip-on' : 'group-chip'}
        aria-selected={active === undefined}
        onClick={() => onPick(undefined)}
      >
        全部
      </button>
      {sections.map((s) => (
        <button
          key={s.name || '未分组'}
          type="button"
          className={active === s.name ? 'group-chip group-chip-on' : 'group-chip'}
          aria-selected={active === s.name}
          onClick={() => onPick(s.name)}
        >
          {s.name || '未分组'}
          <span className="group-chip-count">{s.count}</span>
        </button>
      ))}
    </div>
  );
}
