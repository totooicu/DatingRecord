// 单个属性的取舍行：不冲突直接显示，冲突则二选一
import type { MergeAttrChoice } from '../../core/repo/persons';
import { fmt } from './format';

export function AttrChoiceRow({
  a,
  value,
  onChange,
}: {
  a: MergeAttrChoice;
  value: 'keep' | 'drop' | undefined;
  onChange: (c: 'keep' | 'drop') => void;
}) {
  const kv = fmt(a.keepValue);
  const dv = fmt(a.dropValue);
  if (!a.conflict) {
    return (
      <div className="merge-attr">
        <span className="merge-attr-label">{a.label}</span>
        <span className="merge-attr-val">{kv || dv || '—'}</span>
      </div>
    );
  }
  return (
    <div className="merge-attr">
      <span className="merge-attr-label">
        {a.label}
        <em className="chip-conflict">冲突</em>
      </span>
      <div className="merge-attr-choices">
        <label className={value === 'keep' ? 'merge-pick merge-pick-on' : 'merge-pick'}>
          <input type="radio" name={`m-${a.key}`} checked={value === 'keep'} onChange={() => onChange('keep')} />
          <span>{kv || '（空）'}</span>
        </label>
        <label className={value === 'drop' ? 'merge-pick merge-pick-on' : 'merge-pick'}>
          <input type="radio" name={`m-${a.key}`} checked={value === 'drop'} onChange={() => onChange('drop')} />
          <span>{dv || '（空）'}</span>
        </label>
      </div>
    </div>
  );
}
