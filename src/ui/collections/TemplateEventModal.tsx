// 「事件集模板事件」选择弹窗（F-C09）。
//
// 模板是一条真事件：不复制、不另存快照，改模板事件即改默认值。
// 因此候选只排除已删除事件；可以选别的事件集里的事件，也可以选一条
// 专门用来当「配置」的事件（不挂进本集合，成员列表也就不会被占位）。
import { useMemo, useState } from 'react';
import { getCollection, setCollectionTemplate } from '../../core/repo/collections';
import { getEvent, listEvents } from '../../core/repo/events';
import { formatTime } from '../../core/time';
import { Field, Modal } from '../common';
import { useVersion, bump } from '../../store';
import { hides } from '../../privacy';

export function TemplateEventModal({
  collectionId,
  onClose,
}: {
  collectionId: string;
  onClose: () => void;
}) {
  const v = useVersion();
  const [kw, setKw] = useState('');
  const collection = useMemo(() => getCollection(collectionId), [collectionId, v]);
  const rawCurrent = useMemo(() => {
    const id = collection?.templateEventId;
    return id ? getEvent(id) : null;
  }, [collection, v]);
  const current = rawCurrent && !hides(rawCurrent) ? rawCurrent : null;
  const candidates = useMemo(() => {
    const all = listEvents();
    return (kw ? all.filter((e) => e.title.includes(kw)) : all).slice(0, 50);
  }, [v, kw]);

  const pick = (eventId: string | null) => {
    try {
      setCollectionTemplate(collectionId, eventId);
      bump();
      onClose();
    } catch {
      // 模板事件刚好被删：保持在弹窗里，下次选择会重新读一次列表
      bump();
    }
  };

  return (
    <Modal title="模板事件" onClose={onClose}>
      <p className="muted small">
        在本事件集下新建事件时，自动带入模板事件的类型、呈现形态、标签、人物、地点、正文与评分/花费。
        标题、时间和关联事件不会复制；改动模板事件本身，以后新建的事件就跟着变。
      </p>
      <p className="small">
        当前模板：
        <strong>{current ? current.title : '未设置'}</strong>
        {collection?.templateEventId && !current && (
          <span className="muted">{rawCurrent ? '（隐私模式下不显示）' : '（模板事件已删除）'}</span>
        )}
      </p>
      <Field label="搜索事件">
        <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="输入标题关键词" />
      </Field>
      <ul className="pick-list template-pick-list">
        <li>
          <button type="button" onClick={() => pick(null)}>
            <span>不使用模板</span>
            <span className="muted">新事件按表单默认值</span>
          </button>
        </li>
        {candidates.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => pick(e.id)}>
              <span>
                {e.title}
                {e.id === collection?.templateEventId && <span className="muted"> · 当前</span>}
              </span>
              <span className="muted">{formatTime(e.time)}</span>
            </button>
          </li>
        ))}
        {candidates.length === 0 && <li className="muted">没有匹配的事件</li>}
      </ul>
    </Modal>
  );
}
