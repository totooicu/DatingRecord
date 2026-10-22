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

  const [addOpen, setAddOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  // 新建出来的智能集合规则是空的，进详情页就弹规则编辑，省得先被「全部事件」唬住
  const [ruleDismissed, setRuleDismissed] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // 所有 hook 必须集中在「collection 不存在」的早退之前，否则组件复用时会乱序
  const smart = !!collection && isSmart(collection);

  useEffect(() => {
    setRuleDismissed(false);
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

      <CollectionStats
        collectionId={id}
        members={smart ? [] : members}
        children={children}
        smartCount={smart ? smartEvents.length : undefined}
      />
      <ChildList children={children} />
      {smart ? (
        <SmartList
          events={smartEvents}
          rule={collection.rule}
          onEditEvent={setEditingEventId}
          onEditRule={() => setRuleOpen(true)}
        />
      ) : (
        <MemberList
          collectionId={id}
          members={members}
          onEditEvent={setEditingEventId}
          onAdd={() => setAddOpen(true)}
        />
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
