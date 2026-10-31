// 人物侧的模板操作：套用模板（只补缺的字段）/ 把当前字段存成模板
import { useMemo, useState } from 'react';
import {
  applyTemplate,
  listDefs,
  listTemplates,
  saveAsTemplate,
  type AttrTemplate,
} from '../../core/repo/persons';
import { Modal, Empty } from '../common';
import { bump } from '../../store';

/** 套模板弹窗：列出所有模板，点「套用」即合并 */
export function ApplyTemplateModal({ personId, onClose }: { personId: string; onClose: () => void }) {
  const templates = useMemo(() => listTemplates(), []);
  const defs = useMemo(() => listDefs(), []);
  const [done, setDone] = useState<string | null>(null);
  const labelOf = (k: string) => defs.find((d) => d.key === k)?.label ?? k;

  return (
    <Modal
      wide
      title="套用属性模板"
      onClose={onClose}
      footer={
        <button className="btn btn-ghost" onClick={onClose}>
          完成
        </button>
      }
    >
      <p className="muted small">合并语义：只补缺失的字段，已经填了值的一个不动。</p>
      {done && <div className="alert alert-ok">已套用「{done}」</div>}
      {templates.length === 0 && <Empty compact text="还没有模板，去「设置 → 属性模板」新建一个。" />}
      <ul className="member-list">
        {templates.map((t) => (
          <li key={t.id}>
            <span className="member-title">
              {t.name}
              <em className="muted small"> {t.keys.length} 个字段</em>
            </span>
            <span className="member-actions">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  applyTemplate(t.id, personId);
                  bump();
                  setDone(t.name);
                }}
              >
                套用
              </button>
            </span>
            {t.keys.length > 0 && (
              <div className="chip-group template-keys">
                {t.keys.map((k) => (
                  <span key={k} className="chip">
                    {labelOf(k)}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** 存模板弹窗：当前人物已填的字段，按字典顺序 */
export function SaveTemplateModal({
  personId,
  filledKeys,
  onClose,
}: {
  personId: string;
  /** 当前人物已填字段的 key，调用方从 person.attrs 取 */
  filledKeys: string[];
  onClose: () => void;
}) {
  const defs = useMemo(() => listDefs(), []);
  const [name, setName] = useState('');
  const order = defs.map((d) => d.key);
  const preview = [...filledKeys].sort((a, b) => order.indexOf(a) - order.indexOf(b));

  return (
    <Modal
      title="存为属性模板"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              saveAsTemplate(personId, name);
              bump();
              onClose();
            }}
          >
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">模板名</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：亲密好友档案" />
      </label>
      <p className="muted small">保存这个人物当前已填的 {preview.length} 个字段（按属性字典顺序）：</p>
      {preview.length > 0 ? (
        <div className="chip-group template-keys">
          {preview.map((k) => (
            <span key={k} className="chip">
              {defs.find((d) => d.key === k)?.label ?? k}
            </span>
          ))}
        </div>
      ) : (
        <Empty compact text="这个人物还没有填任何字段，存出来会是个空模板。" />
      )}
    </Modal>
  );
}

export type { AttrTemplate };
