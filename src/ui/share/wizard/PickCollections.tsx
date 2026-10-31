// 第 1 步：挑要分享的事件集。
//
// 选中的事件集会连同子事件集一起带走（子集的行标「随上级」且不可反选）；
// 只有「选择根」能展开挑具体事件——子集的事件已经包含在父集里了。
// 单个事件的取消勾选是全局的：同一个事件在别的事件集下也不会分享。

import { formatTime } from '../../../core/time';
import type { DREvent } from '../../../core/types';
import { Empty } from '../../common';
import type { ColRow } from './model';

export function PickCollections({
  rows,
  colIds,
  impliedIds,
  selectionRoots,
  groups,
  excluded,
  expanded,
  onSetCols,
  onToggleCol,
  onToggleExpand,
  onToggleEvent,
  onSetGroupEvents,
  onOpenCol,
  onPeekEvent,
}: {
  rows: ColRow[];
  colIds: string[];
  /** 随上级一起带走、不能单独反选的事件集 */
  impliedIds: Set<string>;
  /** 选中的根：只有它们能展开挑事件 */
  selectionRoots: string[];
  groups: { id: string; name: string; events: DREvent[] }[];
  /** 被单独取消勾选的事件 */
  excluded: Set<string>;
  /** 展开了「挑事件」的选择根 */
  expanded: Set<string>;
  onSetCols: (ids: string[]) => void;
  onToggleCol: (row: ColRow) => void;
  onToggleExpand: (id: string) => void;
  onToggleEvent: (id: string) => void;
  onSetGroupEvents: (events: DREvent[], on: boolean) => void;
  onOpenCol: (id: string) => void;
  onPeekEvent: (e: DREvent) => void;
}) {
  return (
    <>
      <div className="share-wizard-tools">
        <span className="muted small">
          选中的事件集会连同子事件集一起带走；需要时展开「挑事件」，取消勾选的那些就不分享。
        </span>
        <span className="share-wizard-btns">
          <button
            className="btn btn-sm"
            onClick={() => onSetCols(rows.filter((r) => r.depth === 0).map((r) => r.id))}
          >
            全选
          </button>
          <button className="btn btn-sm" onClick={() => onSetCols([])}>
            清空
          </button>
        </span>
      </div>
      {rows.length === 0 ? (
        <Empty compact text="还没有事件集。" />
      ) : (
        <div className="share-pick-list">
          {rows.map((row) => {
            const implied = impliedIds.has(row.id);
            const checked = implied || colIds.includes(row.id);
            const root = selectionRoots.includes(row.id);
            const group = groups.find((g) => g.id === row.id);
            const expandedHere = root && expanded.has(row.id);
            return (
              <div key={row.id}>
                <div
                  className={checked ? 'share-pick-row share-pick-on' : 'share-pick-row'}
                  style={{ paddingLeft: 12 + row.depth * 18 }}
                >
                  <label className="share-pick-main">
                    <input type="checkbox" checked={checked} disabled={implied} onChange={() => onToggleCol(row)} />
                    <span className="share-pick-name">
                      {row.name}
                      {row.smart && <em title="智能集合：成员由规则实时算出">⚡</em>}
                    </span>
                  </label>
                  <span className="muted small">{row.eventCount} 个事件</span>
                  {implied && <span className="share-pick-tag">随上级</span>}
                  <button
                    className="btn btn-sm share-expand"
                    onClick={() => onOpenCol(row.id)}
                    title="看看这个事件集里都有什么"
                  >
                    详情
                  </button>
                  {root && (group?.events.length ?? 0) > 0 && (
                    <button
                      className="btn btn-sm share-expand"
                      onClick={() => onToggleExpand(row.id)}
                      aria-expanded={expandedHere}
                    >
                      {expandedHere ? '收起' : '挑事件'}
                    </button>
                  )}
                </div>

                {expandedHere && group && (
                  <div className="share-event-picks">
                    <div className="share-event-picks-head">
                      <span className="muted small">
                        {group.events.length} 个事件 · 取消勾选的不分享（跨事件集生效）
                      </span>
                      <span className="share-wizard-btns">
                        <button className="btn btn-sm" onClick={() => onSetGroupEvents(group.events, true)}>
                          全选
                        </button>
                        <button className="btn btn-sm" onClick={() => onSetGroupEvents(group.events, false)}>
                          清空
                        </button>
                      </span>
                    </div>
                    {group.events.map((e) => {
                      const on = !excluded.has(e.id);
                      return (
                        <div
                          key={e.id}
                          className={on ? 'share-event-pick' : 'share-event-pick share-event-off'}
                        >
                          <label className="share-event-pick-main">
                            <input type="checkbox" checked={on} onChange={() => onToggleEvent(e.id)} />
                            <span className="share-event-pick-text">
                              <span className="share-pick-name">{e.title || '未命名事件'}</span>
                              <span className="muted small">{formatTime(e.time)}</span>
                            </span>
                          </label>
                          <button
                            className="btn btn-sm share-expand"
                            onClick={() => onPeekEvent(e)}
                            title="看这个事件的正文"
                          >
                            查看
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
