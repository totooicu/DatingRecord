import { useEffect, useMemo, useState } from 'react';
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

/** 时间线单次最多先渲染多少条事件，剩下的靠「显示更多」逐批放出。
 *
 * 万级数据下一次性把全部事件渲染成 DOM 节点会卡好几秒。先画一屏，
 * 剩下的等用户要看了再逐批补，避免整页假死。 */
const PAGE = 300;

export function Timeline({
  filter,
  keyword,
  openId,
  onOpened,
  onClearDay,
  onBackToCalendar,
}: {
  filter: TimelineFilter;
  keyword: string;
  /** 外部要求打开的某条事件（文件库的引用列表点进来的） */
  openId?: string | null;
  onOpened?: () => void;
  /** 清掉日历带进来的「只看某一天」 */
  onClearDay?: () => void;
  /** 回到日历（日历会停在上次看的那一天，不会跳回今天） */
  onBackToCalendar?: () => void;
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
  // 用 seenOpenId 记住已经开过哪个，避免父层清空 openId 之前的重渲染把它反复打开。
  // 这段必须放在 effect 里：onOpened 是父组件（App）的 setState，
  // 在渲染期间调它会触发 React 的「渲染 A 时改 B」警告，而且父层状态可能在渲染中途被改坏。
  const [seenOpenId, setSeenOpenId] = useState<string | null>(null);
  useEffect(() => {
    // 父层把 openId 清掉了，记忆也跟着清掉——否则再跳同一条事件时会被当成「已经开过」而不响应
    if (!openId) {
      if (seenOpenId) setSeenOpenId(null);
      return;
    }
    if (openId === seenOpenId) return;
    setSeenOpenId(openId);
    const target = getEvent(openId);
    if (target) setEditing(target);
    onOpened?.();
  }, [openId, seenOpenId, onOpened]);
  const [creating, setCreating] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // 渐进渲染：先画前 PAGE 条，剩下靠「显示更多」放出，避免万级数据整页假死
  const [visible, setVisible] = useState(PAGE);
  useEffect(() => { setVisible(PAGE); }, [filter, keyword]);
  const groups = useMemo(() => groupByMonth(events), [events]);
  const visibleGroups = useMemo(() => {
    let remaining = visible;
    const out: [string, DREvent[]][] = [];
    for (const [month, list] of groups) {
      if (remaining <= 0) break;
      const take = list.slice(0, remaining);
      out.push([month, take]);
      remaining -= take.length;
    }
    return out;
  }, [groups, visible]);

  return (
    <div className="timeline">
      <div className="timeline-head">
        <h3>
          时间线 <span className="muted">{events.length} 条</span>
          {filter.dayLabel && <span className="tl-daychip">只看 {filter.dayLabel}</span>}
        </h3>
        <div>
          {filter.dayLabel && (
            <button
              className="btn btn-sm"
              onClick={() => onBackToCalendar?.()}
              title="回到日历里那一天"
            >
              回到日历
            </button>
          )}
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

      {visibleGroups.map(([month, list]) => (
        <MonthGroup key={month} month={month} events={list} nameOf={nameOf} onEdit={setEditing} />
      ))}

      {events.length > visible && (
        <div className="timeline-more">
          <button className="btn" onClick={() => setVisible((v) => v + PAGE)}>
            显示更多（还剩 {events.length - visible} 条）
          </button>
        </div>
      )}

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
