import { useEffect, useMemo, useState } from 'react';
import { getEvent, listEvents } from '../../core/repo/events';
import { EventForm } from '../event';
import { Empty } from '../common';
import { useVersion, bump } from '../../store';
import { personNameOf } from '../persons/personName';
import type { DREvent } from '../../core/types';
import type { TimelineFilter } from './filter';
import { MonthGroup, groupByMonth } from './EventGroup';
import { TrashModal } from './TrashModal';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';

/** 时间线分页：与人物 / 文件 / 事件集共用同一颗分页控件和同一个「每页条数」偏好。
 *
 * 万级数据下一次性把全部事件渲染成 DOM 节点会卡好几秒。以前是「先画 300 条 +
 * 显示更多」——那是渐进渲染，不是分页：点一次多一叠，越滚越长，回不去也跳不动。
 * 现在切成一页一页，DOM 数量恒定，还能直接跳到第 N 页。
 *
 * 分页切在「扁平事件列表」上、而不是切在月份分组上：分组要按整表算才不会乱序，
 * 而每一页各自 group 一次，月份标题跟着这一页的内容走。 */

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
  // 参与者名字（含隐私打码）与人物详情共用 personNameOf，别在这儿再写一份
  const nameOf = personNameOf;

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
  const [trashOpen, setTrashOpen] = useState(false);
  // 筛选/关键词一变，结果集整体换血，留在深页没意义——和人物列表、文件库同一套做法
  const paged = usePaged(events, usePageSize());
  useEffect(() => {
    paged.setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, keyword]);
  const groups = useMemo(() => groupByMonth(paged.pageItems), [paged.pageItems]);

  return (
    <div className="timeline pin-body">
      {/* 页面标题在 head 上，这里只留一条工具条：多少条 + 几个文字动作。
          不再重复一行「时间线」，也不再放「＋记一件事」——右下角 FAB 各处都在 */}
      <div className="timeline-head">
        <span className="tl-count">{events.length} 条</span>
        {filter.dayLabel && (
          <span className="tl-daychip">
            只看 {filter.dayLabel}
            <button className="tl-chip-x" onClick={() => onClearDay?.()} title="取消日期限制" aria-label="取消日期限制">
              ×
            </button>
          </span>
        )}
        <div className="tl-acts">
          {filter.dayLabel && (
            <button className="tl-act" onClick={() => onBackToCalendar?.()} title="回到日历里那一天">
              回到日历
            </button>
          )}
          <button className="tl-act" onClick={() => setTrashOpen(true)}>
            回收站
          </button>
        </div>
      </div>

      {events.length === 0 && <Empty text="没有符合条件的事件" />}

      {groups.map(([month, list]) => (
        <MonthGroup key={month} month={month} events={list} nameOf={nameOf} onEdit={setEditing} />
      ))}

      <Paginator paged={paged} />

      {editing && (
        <EventForm
          event={editing}
          onClose={() => {
            setEditing(null);
            bump();
          }}
        />
      )}
      {trashOpen && <TrashModal onClose={() => setTrashOpen(false)} />}
    </div>
  );
}
