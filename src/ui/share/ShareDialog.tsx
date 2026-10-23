// 分享设置弹层：选「分享程度」，再决定要不要带附件，然后生成 .drshare.json。
//
// 等级是一把单向的尺子（原样 → 去私 → 只名 → 化名，自选另算），
// 每一条都直接写「会带走什么」，不写「严格 / 宽松」这种评价词——
// 用户得能一眼判断发出去的东西长什么样。
import { useMemo, useState } from 'react';
import {
  exportPersonShareFile,
  exportShareFile,
  type ShareOptions,
} from '../../core/io';
import { listDefs } from '../../core/repo/persons';
import { SHARE_LEVELS, type ShareLevel } from '../../core/types';
import { Modal } from '../common';
import { showToast } from '../toast';

export type ShareTarget =
  | { kind: 'collection'; id: string; name: string }
  | { kind: 'person'; id: string; name: string };

export function ShareDialog({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const [level, setLevel] = useState<ShareLevel>('full');
  const [attrKeys, setAttrKeys] = useState<string[]>([]);
  const [withAttachments, setWithAttachments] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 属性字典只在「自选」用得上；按分组顺序排，和人物详情里的顺序一致
  const defs = useMemo(() => (level === 'custom' ? listDefs() : []), [level]);

  const run = async () => {
    setBusy(true);
    setError(null);
    const opts: ShareOptions = {
      level,
      attrKeys: level === 'custom' ? attrKeys : [],
      includeAttachments: withAttachments,
    };
    try {
      const name =
        target.kind === 'collection'
          ? await exportShareFile(target.id, opts)
          : await exportPersonShareFile(target.id, opts);
      showToast(`已生成分享文件：${name}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={`分享 · ${target.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void run()}>
            {busy ? '生成中…' : '生成分享文件'}
          </button>
        </>
      }
    >
      <div className="share-levels">
        <p className="muted small">
          {target.kind === 'collection'
            ? '会带走这个事件集（含子事件集）里的事件、聊天和人物。'
            : '会带走这个人参与过的全部事件，以及事件里出现的其他人；不带事件集结构。'}
          事件涉及的人物一定会被带上，区别只在人物资料带多少。
        </p>
        {SHARE_LEVELS.map((lv) => (
          <label key={lv.key} className={level === lv.key ? 'share-level share-level-on' : 'share-level'}>
            <input
              type="radio"
              name="share-level"
              checked={level === lv.key}
              onChange={() => setLevel(lv.key)}
            />
            <span className="share-level-text">
              <strong>{lv.title}</strong>
              <span className="muted small">{lv.desc}</span>
            </span>
          </label>
        ))}

        {level === 'custom' && (
          <div className="share-attrs">
            <div className="share-attrs-title">带哪些属性</div>
            {defs.length === 0 && <p className="muted small">属性字典还是空的，只能带走姓名。</p>}
            <div className="share-attr-list">
              {defs.map((d) => (
                <label key={d.key} className="checkbox">
                  <input
                    type="checkbox"
                    checked={attrKeys.includes(d.key)}
                    onChange={(e) =>
                      setAttrKeys((old) =>
                        e.target.checked ? [...old, d.key] : old.filter((k) => k !== d.key),
                      )
                    }
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="checkbox share-attach-toggle">
          <input
            type="checkbox"
            checked={withAttachments}
            onChange={(e) => setWithAttachments(e.target.checked)}
          />
          带上正文引用的图片与附件
        </label>
      </div>

      {error && <div className="alert alert-err">{error}</div>}
    </Modal>
  );
}
