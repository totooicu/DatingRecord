// 列表 + 详情两栏。
//
// 手机端按 view 切「列表 / 详情」，宽屏（≥1024px）由 CSS 忽略 data-view 同屏显示；
// 所以这里不需要任何 JS 判断屏幕宽度，只管把两栏都渲染出来。

import type { RefObject } from 'react';
import { PersonDetail, PersonList } from './persons';
import { CollectionDetail, CollectionTree } from './collections';
import { PageHead } from './common';
import { getPerson } from '../core/repo/persons';
import { getCollection } from '../core/repo/collections';
import { hides } from '../privacy';

interface PaneProps {
  /** 手机端是否处于详情页 */
  detailMode: boolean;
  /** detail 模式下打开的那条 id */
  detailId: string | null;
  /** 列表里选中的 id（宽屏右侧显示它） */
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
  listRef?: RefObject<HTMLDivElement>;
}

export function PersonsPane({
  detailMode,
  detailId,
  selectedId,
  onSelect,
  onBack,
  onArchived,
  listRef,
  keyword,
  onKeyword,
}: PaneProps & {
  onArchived: (nextId: string | null) => void;
  keyword: string;
  onKeyword: (k: string) => void;
}) {
  const showId = detailMode ? detailId : selectedId;
  const person = showId ? getPerson(showId) : null;
  // 隐私模式下，标了隐私的选中项当作「没选中」——否则详情页会把它亮出来
  const personHidden = !!person && hides(person);
  const title = personHidden ? '人物' : (person?.displayName ?? '人物');
  return (
    <>
      <div className="pane pane-list" ref={listRef}>
        <PersonList selectedId={selectedId} onSelect={onSelect} keyword={keyword} onKeyword={onKeyword} />
      </div>
      <div className="pane pane-detail">
        {showId && person && !personHidden ? (
          <>
            {/* 顶部条与事件集详情、其它主页保持一致：吸顶、标题居中、返回键常驻 */}
            <PageHead title={title} onBack={detailMode ? onBack : undefined} />
            {/* key：换人物时整块详情重置，否则归档确认态、弹窗等会带到下一个人身上 */}
            <PersonDetail key={showId} id={showId} onArchived={onArchived} />
          </>
        ) : (
          <>
            <PageHead title="人物" />
            <div className="pad muted">请选择或创建一位人物</div>
          </>
        )}
      </div>
    </>
  );
}

export function CollectionsPane({ detailMode, detailId, selectedId, onSelect, onBack, listRef }: PaneProps) {
  const showId = detailMode ? detailId : selectedId;
  const coll = showId ? getCollection(showId) : null;
  // 隐私模式下，标了隐私的选中项当作「没选中」
  const collHidden = !!coll && hides(coll);
  const title = collHidden ? '事件集' : (coll?.name ?? '事件集');
  return (
    <>
      <div className="pane pane-list" ref={listRef}>
        <CollectionTree selectedId={selectedId} onSelect={onSelect} />
      </div>
      <div className="pane pane-detail">
        {showId && coll && !collHidden ? (
          <>
            <PageHead title={title} onBack={detailMode ? onBack : undefined} />
            <CollectionDetail id={showId} />
          </>
        ) : (
          <>
            <PageHead title="事件集" />
            <div className="pad muted">请选择事件集</div>
          </>
        )}
      </div>
    </>
  );
}
