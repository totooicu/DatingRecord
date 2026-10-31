// 事件卡片头里的「列表 / 表格」切换。
//
// 放进卡片头而不是单独占一行：它控制的就是下面这张卡片的内容，
// 离得越近越不需要猜「这个开关是切什么的」。
import type { CollectionView } from '../prefs';

export function EventViewToggle({
  view,
  onChange,
}: {
  view: CollectionView;
  onChange: (v: CollectionView) => void;
}) {
  return (
    <div className="seg" role="group" aria-label="事件视图">
      <button type="button" aria-pressed={view === 'list'} onClick={() => onChange('list')}>
        列表
      </button>
      <button type="button" aria-pressed={view === 'table'} onClick={() => onChange('table')}>
        表格
      </button>
    </div>
  );
}
