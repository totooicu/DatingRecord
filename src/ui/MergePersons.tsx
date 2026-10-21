import { useEffect, useMemo, useState } from 'react';
import {
  findDuplicatePersons,
  mergePersons,
  previewMerge,
  type MergeAttrChoice,
  type PersonWithStats,
} from '../core/repo/persons';
import { Empty, Modal } from './common';
import { useVersion, bump } from '../store';

/** 合并预览里的值只需要「看得懂」，不必走 AttributeField 的完整类型渲染 */
function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * 重复人物清理。
 *
 * 起因：createPerson 早期没有重名校验，用户以为没建成又建了一次，
 * 于是同一个人在库里出现两行 —— 事件参与者会同时列出两个同名 chip，
 * 设置页的「人物」计数（行数）也和眼睛数出来的人数对不上。
 */
/** 精确到秒：同一分钟里连点两次创建也能分辨是哪条 */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知时间';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 同名时用「创建时间 + 事件数」区分两条记录，否则用户根本看不出点的是哪条 */
function recordLabel(p: PersonWithStats): string {
  return `${fmtDate(p.createdAt)} 创建 · ${p.stats.eventCount} 次事件`;
}

export function DuplicatePersons() {
  const v = useVersion();
  const dupes = useMemo(() => findDuplicatePersons(), [v]);
  const [pair, setPair] = useState<[string, string] | null>(null);
  /** 一组超过两条时，先让用户挑「把哪条并进来」 */
  const [choose, setChoose] = useState<[PersonWithStats, PersonWithStats[]] | null>(null);

  if (dupes.length === 0) return <Empty text="没有发现同名人物" />;

  return (
    <>
      <p className="muted">
        下面每组是同一个名字建了多次。合并会把事件关联归到保留的那条，另一条归档（可恢复）。
      </p>
      {dupes.map((group) => {
        const name = group[0].displayName;
        return (
          <div key={name} className="merge-group">
            <div className="merge-group-head">
              <strong>{name}</strong>
              <span className="muted">{group.length} 条重复</span>
            </div>
            <ul className="merge-list">
              {group.map((p, i) => (
                <li key={p.id}>
                  <span className="merge-idx">#{i + 1}</span>
                  <span className="merge-rec">
                    <span className="merge-rec-main">{p.displayName}</span>
                    <span className="muted small">{recordLabel(p)}</span>
                  </span>
                  {/* 每条只给一个按钮，点击时再选「合并哪几条进来」——
                      之前每条都列出 N-1 个按钮，3 条就有 6 个，根本分不清 */}
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const others = group.filter((o) => o.id !== p.id);
                      if (others.length === 1) setPair([p.id, others[0].id]);
                      else setChoose([p, others]);
                    }}
                  >
                    保留这条
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {choose && <ChooseDropModal keep={choose[0]} others={choose[1]} onPick={(id) => { setChoose(null); setPair([choose[0].id, id]); }} onClose={() => setChoose(null)} />}
      {pair && <MergeModal keepId={pair[0]} dropId={pair[1]} onClose={() => setPair(null)} />}
    </>
  );
}

/** 组内超过两条时，先选要把哪一条并进来 */
function ChooseDropModal({
  keep,
  others,
  onPick,
  onClose,
}: {
  keep: PersonWithStats;
  others: PersonWithStats[];
  onPick: (dropId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="把哪一条并进来？" onClose={onClose}>
      <p className="muted small">
        保留的是 <strong>{keep.displayName}</strong>（{recordLabel(keep)}）。选择要并入并归档的那条：
      </p>
      <ul className="merge-list">
        {others.map((o) => (
          <li key={o.id}>
            <span className="merge-rec">
              <span className="merge-rec-main">{o.displayName}</span>
              <span className="muted small">{recordLabel(o)}</span>
            </span>
            <button className="btn btn-sm" onClick={() => onPick(o.id)}>
              并入
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function MergeModal({ keepId, dropId, onClose }: { keepId: string; dropId: string; onClose: () => void }) {
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
        <span className="small">（{fmtDate(keep.createdAt)} 创建 · {preview.keepEventCount} 次事件）</span>
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
            <AttrChoiceRow key={a.key} a={a} value={choices[a.key]} onChange={(c) => setChoices((p) => ({ ...p, [a.key]: c }))} />
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

function AttrChoiceRow({
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
