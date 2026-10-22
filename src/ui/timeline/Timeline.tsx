import { useMemo, useState } from 'react';
import { getEvent, listEvents } from '../../core/repo/events';
import { getPerson } from '../../core/repo/persons';
import { EventForm } from '../event';
import { Empty } from '../common';
import { useVersion, bump } from '../../store';
import { isPrivacyMode } from '../../privacy';
import type { DREvent } from '../../core/types';
import type { TimelineFilter } from './filter';
import { MonthGroup, groupByMonth } from './EventGroup';
import { TrashModal } from './TrashModal';

export function Timeline({
  filter,
  keyword,
  openId,
  onOpened,
  onClearDay,
}: {
  filter: TimelineFilter;
  keyword: string;
  /** 外部要求打开的某条事件（文件库的引用列表点进来的） */
  openId?: string | null;
  onOpened?: () => void;
  /** 清掉日历带进来的「只看某一天」 */
  onClearDay?: () => void;
}) {
  const v = useVersion();
  // 参与者名字：隐私模式下，标了隐私的人物显示成「（隐私）」而不是真名——
  // 否则一个公开事件里挂着个隐藏人物，名字照样漏出来。getPerson 不受隐私过滤影响，
  // 所以这里能拿到私有人物再就地打码。
  const nameOf = (id: string) => {
    const p = getPerson(id);
    if (!p) return '?';
    if (isPrivacyMode() && p.isPrivate) return '（隐私）';
    return p.displayName;
  };

  const events = useMemo<DREvent[]>(() => {
    // 日历给的精确区间优先；否则退回「最近 N 天」的粗筛
    const from = filter.fromTs ?? (filter.withinDays ? Date.now() - Number(filter.withinDays) * 86400000 : undefined);
    return listEvents({
      keyword: keyword || filter.keyword || undefined,
      personId: filter.personId || undefined,
      kind: filter.kind || undefined,
      tag: filter.tag || undefined,
      minRating: filter.minRating ? Number(filter.minRating) : undefined,
      fromTs: from,
      toTs: filter.toTs,
      collectionId: filter.collectionId || undefined,
    });
  }, [v, filter, keyword]);

  const [editing, setEditing] = useState<DREvent | null>(null);

  // 外部跳转：把目标事件找出来直接开编辑框。
  // 用 ref 比较避免重复打开——父层在 onOpened 里清空 openId 之前，
  // 任何一次重渲染都会让这个 effect 再跑一遍。
  const [seenOpenId, setSeenOpenId] = useState<string | null>(null);
  if (openId && openId !== seenOpenId) {
    setSeenOpenId(openId);
    const target = getEvent(openId);
    if (target) setEditing(target);
    onOpened?.();
  }
  const [creating, setCreating] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const groups = useMemo(() => groupByMonth(events), [events]);

  return (
    <div className="timeline">
      <div className="timeline-head">
        <h3>
          时间线 <span className="muted">{events.length} 条</span>
          {filter.dayLabel && <span className="tl-daychip">只看 {filter.dayLabel}</span>}
        </h3>
        <div>
          {filter.dayLabel && (
            <button className="btn btn-sm" onClick={() => onClearDay?.()}>
              取消日期
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setTrashOpen(true)}>
            回收站
          </button>
          <button className="btn btn-primary btn-new-inline" onClick={() => setCreating(true)}>
            ＋ 记一件事
          </button>
        </div>
      </div>

      {events.length === 0 && <Empty text="没有符合条件的事件" />}

      {groups.map(([month, list]) => (
        <MonthGroup key={month} month={month} events={list} nameOf={nameOf} onEdit={setEditing} />
      ))}

      {editing && (
        <EventForm
          event={editing}
          onClose={() => {
            setEditing(null);
            bump();
          }}
        />
      )}
      {creating && (
        <EventForm
          onClose={() => {
            setCreating(false);
            bump();
          }}
        />
      )}
      {trashOpen && <TrashModal onClose={() => setTrashOpen(false)} />}
    </div>
  );
}
