// 智能集合规则编辑弹窗（F-C04）：六个条件 + 实时命中数预览
import { useMemo, useState } from 'react';
import { Modal, Field } from '../common';
import { EVENT_KINDS, listEvents } from '../../core/repo/events';
import { listPersons } from '../../core/repo/persons';
import { ruleToFilter, describeRule, isEmptyRule } from '../../core/repo/collections';
import type { SmartRule } from '../../core/types';

export function RuleModal({
  rule,
  onClose,
  onSave,
}: {
  rule: SmartRule | null;
  onClose: () => void;
  onSave: (rule: SmartRule) => void;
}) {
  const [draft, setDraft] = useState<SmartRule>(rule ?? {});
  const persons = useMemo(() => listPersons(), []);
  const count = useMemo(() => listEvents(ruleToFilter(draft)).length, [draft]);
  const empty = isEmptyRule(draft);

  return (
    <Modal
      title="集合规则"
      onClose={onClose}
      footer={
        <>
          <span className="muted small">当前命中 {count} 个事件</span>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={empty}
            onClick={() => onSave({ ...draft, minRating: draft.minRating || undefined })}
          >
            保存
          </button>
        </>
      }
    >
      <Field label="关键词">
        <input
          value={draft.keyword ?? ''}
          placeholder="标题或正文包含…"
          onChange={(e) => setDraft({ ...draft, keyword: e.target.value })}
        />
      </Field>
      <Field label="标签">
        <input
          value={draft.tag ?? ''}
          placeholder="如 旅行"
          onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
        />
      </Field>
      <Field label="事件类型">
        <select
          value={draft.kind ?? ''}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value || undefined })}
        >
          <option value="">不限</option>
          {EVENT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="涉及人物">
        <select
          value={draft.personId ?? ''}
          onChange={(e) => setDraft({ ...draft, personId: e.target.value || undefined })}
        >
          <option value="">不限</option>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="最低评分（0 为不限）">
        <input
          type="number"
          min={0}
          max={5}
          value={draft.minRating ?? ''}
          onChange={(e) => setDraft({ ...draft, minRating: Number(e.target.value) || undefined })}
        />
      </Field>
      <Field label="最近 N 天（0 为不限）">
        <input
          type="number"
          min={0}
          value={draft.withinDays ?? ''}
          onChange={(e) => setDraft({ ...draft, withinDays: Number(e.target.value) || undefined })}
        />
      </Field>
      <p className="muted small">
        规则：{describeRule(draft)}
        {empty && '（至少设置一个条件，否则等于把全部事件堆进来）'}
      </p>
    </Modal>
  );
}
