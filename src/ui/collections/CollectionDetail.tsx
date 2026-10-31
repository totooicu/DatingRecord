import { useEffect, useMemo, useState } from 'react';
import {
  getBreadcrumb,
  getCollection,
  isSmart,
  isEmptyRule,
  listChildren,
  listMembers,
  listSmartEvents,
  updateCollection,
  removeMember,
  collectionTotalCost,
} from '../../core/repo/collections';
import { getEvent } from '../../core/repo/events';
import { EventForm } from '../event';
import { Empty } from '../common';
import { useVersion, bump } from '../../store';
import { hides } from '../../privacy';
import { CollectionHead } from './CollectionHead';
import { CollectionStats } from './CollectionStats';
import { MemberList, ChildList } from './MemberList';
import { SmartList } from './SmartList';
import { RuleModal } from './RuleModal';
import { AddEventModal } from './AddEventModal';
import { MoveModal } from './MoveModal';
import { EventTable } from './EventTable';
import { getCollectionView, setCollectionView } from '../prefs';
import { MemoirList } from '../memoir';

export function CollectionDetail({ id }: { id: string }) {
  const v = useVersion();
  const collection = useMemo(() => getCollection(id), [id, v]);
  const members = useMemo(() => listMembers(id), [id, v]);
  const children = useMemo(() => listChildren(id), [id, v]);
  const breadcrumb = useMemo(() => getBreadcrumb(id), [id, v]);
  // 智能集合的成员是现算的，跟着 version 一起重算
  const smartEvents = useMemo(
    () => (collection && isSmart(collection) ? listSmartEvents(collection) : []),
    [collection, v],
  );
  // 金额合计跟着版本重算：增删事件、改金额、移动成员都会 bump()
  const totalCost = useMemo(
    () => (collection ? collectionTotalCost(collection) : 0),
    [collection, v],
  );
  // 表格与事件列表看同一批事件：直接成员里的 event，按成员顺序
  const memberEvents = useMemo(
    () =>
      members.flatMap((m) => {
        if (m.memberType !== 'event') return [];
        const e = getEvent(m.memberId);
        return e ? [e] : [];
      }),
    [members, v],
  );
  // 以成员关系挂进来的集合（不是 parent_id 子集）：并进「子事件集」卡片，别让它们消失
  const memberCollections = useMemo(
    () =>
      members.flatMap((m) => {
        if (m.memberType !== 'collection') return [];
        const c = getCollection(m.memberId);
        return c ? [{ id: c.id, name: c.name }] : [];
      }),
    [members, v],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  /** 直接在本集合下新建事件（不是从已有事件里挑） */
  const [newOpen, setNewOpen] = useState(false);
  /** 列表 / 表格：跟着设备走的偏好，只写 localStorage */
  const [view, setView] = useState(() => getCollectionView());
  const changeView = (next: 'list' | 'table') => {
    setView(next);
    setCollectionView(next);
  };
  const [ruleOpen, setRuleOpen] = useState(false);
  // 新建出来的智能集合规则是空的，进详情页就弹规则编辑，省得先被「全部事件」唬住
  const [ruleDismissed, setRuleDismissed] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** 事件 = 流水；回忆 = 从这些事件里挑出来排好的册子 */
  const [tab, setTab] = useState<'events' | 'memories'>('events');

  // 所有 hook 必须集中在「collection 不存在」的早退之前，否则组件复用时会乱序
  const smart = !!collection && isSmart(collection);

  useEffect(() => {
    setRuleDismissed(false);
    setTab('events');
  }, [id]);

  useEffect(() => {
    if (!smart) {
      setRuleOpen(false);
    } else if (!ruleDismissed && isEmptyRule(collection?.rule)) {
      setRuleOpen(true);
    }
  }, [smart, ruleDismissed, collection]);

  const closeRule = () => {
    setRuleOpen(false);
    setRuleDismissed(true);
  };

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 2500);
      return () => clearTimeout(t);
    }
  }, [msg]);

  if (!collection) return <Empty text="事件集不存在或已删除" />;
  // 隐私模式 + 标了隐私：详情也藏起来，不能从详情页漏出
  if (hides(collection)) return <Empty text="该事件集已设为隐私，隐私模式下不显示" />;

  return (
    <div className="detail">
      <CollectionHead
        collection={collection}
        breadcrumb={breadcrumb}
        onMove={() => setMoveOpen(true)}
        onError={setMsg}
      />

      {msg && <div className="alert">{msg}</div>}

      <div className="aichat-tabs collect-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'events'}
          className={tab === 'events' ? 'aichat-tab aichat-tab-on' : 'aichat-tab'}
          onClick={() => setTab('events')}
        >
          事件
          <span className="aichat-tab-n">{smart ? smartEvents.length : memberEvents.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'memories'}
          className={tab === 'memories' ? 'aichat-tab aichat-tab-on' : 'aichat-tab'}
          onClick={() => setTab('memories')}
        >
          回忆
        </button>
      </div>

      {tab === 'memories' ? (
        <MemoirList collectionId={id} collectionName={collection.name} />
      ) : (
        <>
      <CollectionStats
        collectionId={id}
        members={smart ? [] : members}
        children={children}
        smartCount={smart ? smartEvents.length : undefined}
        totalCost={totalCost}
      />
      <ChildList
        children={children}
        memberCollections={smart ? [] : memberCollections}
        onRemoveMember={(cid) => {
          removeMember(id, 'collection', cid);
          bump();
        }}
      />
      {smart ? (
        view === 'table' ? (
          <EventTable
            events={smartEvents}
            view={view}
            onView={changeView}
            onOpen={setEditingEventId}
          />
        ) : (
          <SmartList
            events={smartEvents}
            rule={collection.rule}
            view={view}
            onView={changeView}
            onEditEvent={setEditingEventId}
            onEditRule={() => setRuleOpen(true)}
          />
        )
      ) : view === 'table' ? (
        <EventTable
          events={memberEvents}
          view={view}
          onView={changeView}
          onOpen={setEditingEventId}
        />
      ) : (
        <MemberList
          collectionId={id}
          members={members}
          view={view}
          onView={changeView}
          onEditEvent={setEditingEventId}
          onAdd={() => setAddOpen(true)}
          onNew={() => setNewOpen(true)}
          templateEventId={collection.templateEventId}
        />
      )}
        </>
      )}

      {ruleOpen && (
        <RuleModal
          rule={collection.rule}
          onClose={closeRule}
          onSave={(r) => {
            updateCollection(id, { rule: r });
            bump();
            closeRule();
          }}
        />
      )}
      {addOpen && <AddEventModal collectionId={id} onClose={() => setAddOpen(false)} />}
      {newOpen && (
        <EventForm
          defaultCollectionId={id}
          onClose={() => {
            setNewOpen(false);
            bump();
          }}
        />
      )}
      {moveOpen && (
        <MoveModal collectionId={id} onClose={() => setMoveOpen(false)} onError={setMsg} />
      )}
      {editingEventId && (
        <EventForm
          event={getEvent(editingEventId) ?? undefined}
          onClose={() => {
            setEditingEventId(null);
            bump();
          }}
        />
      )}
    </div>
  );
}
