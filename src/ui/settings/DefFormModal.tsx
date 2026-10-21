// 新建 / 编辑属性定义
import { useState } from 'react';
import {
  countAttrValues,
  getDef,
  listDefs,
  retuneAttrValues,
  upsertDef,
} from '../../core/repo/persons';
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

  // 新建时输入的 key 可能正好是某条「已归档」的属性：那是同一条定义，直接恢复它，
  // 不能当成新定义插入——否则要么插不进去（主键冲突），要么插进去也不显示。
  const typedKey = key.trim();
  const archivedMatch =
    !existing && typedKey
      ? listDefs(true).find((d) => d.key === typedKey && d.archived) ?? null
      : null;
  const activeMatch =
    !existing && typedKey
      ? listDefs(true).find((d) => d.key === typedKey && !d.archived) ?? null
      : null;
  // 复用归档定义时类型必须沿用原定义；编辑启用中的定义则可以改类型
  const effType = archivedMatch ? archivedMatch.type : type;
  const typeChanged = !!existing && existing.type !== effType;
  const valueCount = typeChanged && existing ? countAttrValues(existing.key) : 0;

  const save = () => {
    if (!existing && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      setErr('key 只能用英文字母、数字、下划线，且以字母开头（创建后不可修改）');
      return;
    }
    if (activeMatch) {
      setErr(`key「${typedKey}」已经被「${activeMatch.label}」占用，换个 key，或直接编辑那条属性。`);
      return;
    }
    if (!label.trim()) {
      setErr('字段名不能为空');
      return;
    }
    upsertDef({
      key: existing?.key ?? key,
      label: label.trim(),
      type: effType,
      // 命中的归档定义在这里被恢复（archived=false），否则编辑已有定义时保持原状态
      archived: existing ? undefined : false,
      group: group.trim() || '自定义',
      options: options
        .split('、')
        .map((s) => s.trim())
        .filter(Boolean),
      unit: unit || undefined,
      max: effType === 'rating' ? max : undefined,
      sensitive,
      timeVarying,
    });

    // 类型变了：把所有人的旧值按新类型重写一遍（转不了的清空，见 retuneAttrValues）
    if (typeChanged) {
      const nd = getDef(existing.key);
      if (nd) retuneAttrValues(existing.key, nd);
    }
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
          <select
            value={effType}
            disabled={!!archivedMatch}
            onChange={(e) => setType(e.target.value as AttributeType)}
          >
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
        {(effType === 'enum' || effType === 'enumMulti') && (
          <div className="span-2">
            <Field label="选项（用、分隔）">
              <input value={options} onChange={(e) => setOptions(e.target.value)} />
            </Field>
          </div>
        )}
        {effType === 'number' && (
          <Field label="单位">
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="cm / kg" />
          </Field>
        )}
        {effType === 'rating' && (
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
      {typeChanged && (
        <p className="warn-line">
          类型从「{ATTRIBUTE_TYPES.find((t) => t.value === existing.type)?.label ?? existing.type}」改为
          「{ATTRIBUTE_TYPES.find((t) => t.value === effType)?.label ?? effType}」。
          {valueCount > 0
            ? `已有 ${valueCount} 条值会按新类型转换，无法转换的会被清空（历史记录仍保留）。`
            : '目前还没有人填过这个属性，可以直接改。'}
        </p>
      )}
      {archivedMatch && (
        <p className="warn-line">
          这个 key 对应一条已归档的属性「{archivedMatch.label}」，保存会把它恢复为可见属性（类型沿用
          {archivedMatch.type}，历史值继续有效）。
        </p>
      )}
      {err && <div className="alert alert-err">{err}</div>}
    </Modal>
  );
}
