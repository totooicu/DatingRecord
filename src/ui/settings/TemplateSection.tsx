// 属性模板管理（F-P04）：新建 / 改名 / 删除。
// 「应用」在人物详情页做，这里只管模板本身的增删改。
import { useMemo, useState } from 'react';
import {
  createTemplate,
  deleteTemplate,
  listDefs,
  listTemplates,
  renameTemplate,
} from '../../core/repo/persons';
import { ConfirmButton, Modal } from '../common';
import { bump, useVersion } from '../../store';
import { Section } from './Section';

export function TemplateSection() {
  const v = useVersion();
  const templates = useMemo(() => listTemplates(), [v]);
  const defs = useMemo(() => listDefs(), [v]);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  const labelOf = (key: string) => defs.find((d) => d.key === key)?.label ?? key;

  return (
    <Section
      title="属性模板"
      desc="模板是一组属性字段的有序集合。新建人物时可以选一个模板套上，人物详情里也能随时「应用模板」（只补缺的字段，已有值不动）或「存为模板」。"
    >
      <div className="row-actions">
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          ＋ 新建模板
        </button>
      </div>

      {templates.length === 0 && <p className="muted">还没有模板。新建一个，或在人物详情点「存为模板」。</p>}

      <ul className="member-list">
        {templates.map((t) => (
          <li key={t.id}>
            <span className="member-title">
              {t.name}
              <em className="muted small"> {t.keys.length} 个字段</em>
            </span>
            <span className="member-actions">
              <button
                className="btn btn-sm"
                onClick={() => {
                  setRenaming(t.id);
                }}
              >
                改名
              </button>
              <ConfirmButton
                compact
                text="删除"
                danger
                confirmText={`删除模板「${t.name}」？已经套用过的人物不受影响。`}
                onConfirm={() => {
                  deleteTemplate(t.id);
                  bump();
                }}
              />
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

      {creating && (
        <TemplateEditModal
          defs={defs.map((d) => ({ key: d.key, label: d.label, group: d.group }))}
          onClose={() => setCreating(false)}
        />
      )}
      {renaming && (
        <RenameModal
          initial={templates.find((t) => t.id === renaming)?.name ?? ''}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            renameTemplate(renaming, name);
            bump();
            setRenaming(null);
          }}
        />
      )}
    </Section>
  );
}

/** 新建模板：起名 + 勾选字段（按字典分组陈列） */
function TemplateEditModal({
  defs,
  onClose,
}: {
  defs: { key: string; label: string; group: string }[];
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [keys, setKeys] = useState<string[]>([]);
  const groups = Array.from(new Set(defs.map((d) => d.group)));

  const toggle = (k: string) => setKeys((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  return (
    <Modal
      wide
      title="新建属性模板"
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
              createTemplate(name, keys);
              bump();
              onClose();
            }}
          >
            创建
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">模板名</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：恋人档案" />
      </label>
      {groups.map((g) => (
        <div key={g} className="template-group">
          <span className="muted small">{g || '未分组'}</span>
          <div className="chip-group">
            {defs
              .filter((d) => d.group === g)
              .map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={keys.includes(d.key) ? 'chip chip-on' : 'chip'}
                  onClick={() => toggle(d.key)}
                >
                  {d.label}
                </button>
              ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}

function RenameModal({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Modal
      title="模板改名"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave(name)}>
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">新名字</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>
    </Modal>
  );
}
