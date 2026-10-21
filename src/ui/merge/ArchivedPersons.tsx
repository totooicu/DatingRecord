/**
 * 归档人物管理。
 *
 * 起因就是「重复人物里没内容、概览却写着 4 +1 归档」：那 +1 是真实存在的记录，
 * 只是没有任何界面把它显示出来，用户只能看到一个对不上、又不知道怎么消掉的数字。
 * 所以这里把两类不在列表里的记录都摊开：手动归档的可恢复，合并留下的墓碑可清理。
 */
import { useMemo } from 'react';
import { hardDeletePerson, listArchivedPersons, unarchivePerson } from '../../core/repo/persons';
import { ConfirmButton, Empty } from '../common';
import { useVersion, bump } from '../../store';
import { fmtDate } from './format';

export function ArchivedPersons() {
  const v = useVersion();
  const list = useMemo(() => listArchivedPersons(), [v]);

  if (list.length === 0) return <Empty text="没有归档的人物" />;

  return (
    <ul className="merge-list">
      {list.map((p) => (
        <li key={p.id}>
          <span className="merge-rec">
            <span className="merge-rec-main">{p.displayName}</span>
            <span className="muted small">
              {p.reason === 'merged'
                ? `${fmtDate(p.updatedAt)} 被并入「${p.mergedIntoName ?? '另一条记录'}」· 事件已转到对方名下`
                : `${fmtDate(p.updatedAt)} 归档 · ${p.stats.eventCount} 次事件`}
            </span>
          </span>
          <span className="member-actions">
            {/* 合并留下的墓碑不给恢复：参与者已经转走，恢复出来只会是一个没有事件的空壳 */}
            {p.reason === 'archived' && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  unarchivePerson(p.id);
                  bump();
                }}
              >
                恢复
              </button>
            )}
            <ConfirmButton
              text="彻底删除"
              danger
              confirmText={`彻底删除「${p.displayName}」？此操作不可撤销，会一并移除其事件关联。`}
              onConfirm={() => {
                hardDeletePerson(p.id);
                bump();
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
