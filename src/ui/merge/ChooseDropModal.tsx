// 组内超过两条时，先选要把哪一条并进来
import { Modal } from '../common';
import type { PersonWithStats } from '../../core/repo/persons';
import { recordLabel } from './format';

export function ChooseDropModal({
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
