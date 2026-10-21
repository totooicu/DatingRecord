// 合并确认弹窗：列出两边属性，冲突字段让用户二选一
import { useEffect, useMemo, useState } from 'react';
import { mergePersons, previewMerge } from '../../core/repo/persons';
import { Modal } from '../common';
import { bump } from '../../store';
import { fmtDate } from './format';
import { AttrChoiceRow } from './AttrChoiceRow';

export function MergeModal({
  keepId,
  dropId,
  onClose,
}: {
  keepId: string;
  dropId: string;
  onClose: () => void;
}) {
  const preview = useMemo(() => previewMerge(keepId, dropId), [keepId, dropId]);
  const [choices, setChoices] = useState<Record<string, 'keep' | 'drop'>>({});

  // 冲突字段默认取保留者的值，但要求用户至少过一遍
  useEffect(() => {
    if (!preview) return;
    const init: Record<string, 'keep' | 'drop'> = {};
    for (const a of preview.attrs) init[a.key] = 'keep';
    setChoices(init);
  }, [preview]);

  if (!preview) return null;
  const { keep, drop } = preview;

  const go = () => {
    mergePersons(keepId, dropId, choices);
    bump();
    onClose();
  };

  return (
    <Modal
      wide
      title="合并人物"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={go}>
            确认合并
          </button>
        </>
      }
    >
      <p className="muted">
        保留 <strong>{keep.displayName}</strong>
        <span className="small">
          （{fmtDate(keep.createdAt)} 创建 · {preview.keepEventCount} 次事件）
        </span>
        ，把 {fmtDate(drop.createdAt)} 创建的那条并入后归档。
      </p>
      <p className="muted small">
        事件关联：{preview.dropEventCount} 条将转到保留的记录名下
        {preview.bothEventCount > 0 && `（其中 ${preview.bothEventCount} 条两条都在，会去掉重复的那个）`}。
      </p>

      {preview.attrs.length === 0 ? (
        <p className="muted">两边都没有填写自定义属性。</p>
      ) : (
        <div className="merge-attrs">
          {preview.attrs.map((a) => (
            <AttrChoiceRow
              key={a.key}
              a={a}
              value={choices[a.key]}
              onChange={(c) => setChoices((p) => ({ ...p, [a.key]: c }))}
            />
          ))}
        </div>
      )}

      {(preview.dropOnlyTags.length > 0 || preview.dropOnlyAliases.length > 0) && (
        <p className="muted small">
          还会并入：
          {preview.dropOnlyTags.length > 0 && ` 标签 ${preview.dropOnlyTags.join('、')}`}
          {preview.dropOnlyAliases.length > 0 && ` 别名 ${preview.dropOnlyAliases.join('、')}`}
        </p>
      )}

      <p className="warn-line">建议先到「备份与恢复」导出一份 JSON 再操作。</p>
    </Modal>
  );
}
