// 成果里点开一条记录：新增 / 修改 / 删除各自说了什么，新增还能先改名。
// 改名只改这份暂存的成果，点「执行」后才写进库。

import type { SnapDiffItem } from '../../../core/snapshots';
import { Modal } from '../../common';
import { DIFF_KIND } from './model';

export function RecordDetailModal({
  item,
  action,
  name,
  onName,
  onSave,
  onClose,
  canRename,
}: {
  item: SnapDiffItem;
  action: 'created' | 'updated' | 'deleted';
  name: string;
  onName: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  canRename: boolean;
}) {
  const label = action === 'deleted' ? '已删除' : action === 'updated' ? '已修改' : '新增';
  const detail = item.detail ?? [];
  const before = item.before;
  return (
    <Modal title={`${label} · ${DIFF_KIND[item.kind]}`} onClose={onClose}>
      <div className="aichat-record">
        <div className="aichat-record-head">
          <span className="aichat-target-mark" aria-hidden>
            {item.kind === 'person' ? '人' : item.kind === 'event' ? '事' : '集'}
          </span>
          <div className="aichat-record-title">
            <b>{item.name}</b>
            <span className="muted small">
              {action === 'deleted'
                ? '这份成果执行后，它会从库里删掉'
                : action === 'created'
                  ? '暂存中，执行后才进库'
                  : '执行后这些修改才会生效'}
            </span>
          </div>
        </div>
        {detail.length ? (
          <ul className="aichat-record-detail">
            {detail.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="muted small">这条记录没有更多可看的字段。</p>
        )}
        {before?.content && !detail.some((x) => x.startsWith('正文：')) && (
          <p className="aichat-note">改前正文：{before.content.slice(0, 200)}</p>
        )}
        {action === 'created' && canRename && (
          <div className="aichat-record-edit">
            <label className="aichat-record-label" htmlFor="aichat-record-name">
              名称
            </label>
            <input
              id="aichat-record-name"
              value={name}
              onChange={(e) => onName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSave();
              }}
              placeholder="给它起个名字"
            />
            <button
              type="button"
              className="aichat-record-save"
              disabled={!name.trim() || name.trim() === item.name}
              onClick={onSave}
            >
              保存名称
            </button>
            <p className="muted small aichat-record-hint">改名只改这份暂存的成果；点「执行」后才会写进库。</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
