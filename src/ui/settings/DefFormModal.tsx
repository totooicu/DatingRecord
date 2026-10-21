// 新建 / 编辑属性定义
import { useState } from 'react';
import { listDefs, upsertDef } from '../../core/repo/persons';
import { ATTRIBUTE_TYPES, type AttributeType } from '../../core/types';
import { Field, Modal } from '../common';

export function DefFormModal({ defKey, onClose }: { defKey: string | null; onClose: () => void }) {
  const existing = defKey ? listDefs(true).find((d) => d.key === defKey) ?? null : null;
  const [key, setKey] = useState(existing?.key ?? '');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [type, setType] = useState<AttributeType>(existing?.type ?? 'text');
  const [group, setGroup] = useState(existing?.group ?? '自定义');
  const [options, setOptions] = useState((existing?.options ?? []).join('、'));
  const [unit, setUnit] = useState(existing?.unit ?? '');
  const [max, setMax] = useState(existing?.max ?? 5);
  const [sensitive, setSensitive] = useState(existing?.sensitive ?? false);
  const [timeVarying, setTimeVarying] = useState(existing?.timeVarying ?? false);
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    if (!existing && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      setErr('key 只能用英文字母、数字、下划线，且以字母开头（创建后不可修改）');
      return;
    }
    if (!label.trim()) {
      setErr('字段名不能为空');
      return;
    }
    upsertDef({
      key: existing?.key ?? key,
      label: label.trim(),
      type: existing?.type ?? type,
      group: group.trim() || '自定义',
      options: options
        .split('、')
        .map((s) => s.trim())
        .filter(Boolean),
      unit: unit || undefined,
      max: type === 'rating' ? max : undefined,
      sensitive,
      timeVarying,
    });
    onClose();
  };

  return (
    <Modal
      title={existing ? `编辑属性 · ${existing.label}` : '新建属性'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="字段名（可随时改）">
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="key（创建后不可改）">
          <input
            value={key}
            disabled={!!existing}
            onChange={(e) => setKey(e.target.value)}
            placeholder="如 favorite_food"
          />
        </Field>
        <Field label="类型（创建后不可改）">
          <select value={type} disabled={!!existing} onChange={(e) => setType(e.target.value as AttributeType)}>
            {ATTRIBUTE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="分组">
          <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="基本信息 / 喜好 / 关系…" />
        </Field>
        {(type === 'enum' || type === 'enumMulti') && (
          <div className="span-2">
            <Field label="选项（用、分隔）">
              <input value={options} onChange={(e) => setOptions(e.target.value)} />
            </Field>
          </div>
        )}
        {type === 'number' && (
          <Field label="单位">
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="cm / kg" />
          </Field>
        )}
        {type === 'rating' && (
          <Field label="满分">
            <input type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} />
          </Field>
        )}
        <Field label="敏感字段">
          <label className="checkbox">
            <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
            展示需谨慎
          </label>
        </Field>
        <Field label="随时间变化">
          <label className="checkbox">
            <input type="checkbox" checked={timeVarying} onChange={(e) => setTimeVarying(e.target.checked)} />
            记录历史快照
          </label>
        </Field>
      </div>
      {err && <div className="alert alert-err">{err}</div>}
    </Modal>
  );
}
