// 「图片 · 画路径 / 地图 · 复现与保存」两个视图的切换。
//
// 切到地图时要顺手 invalidateSize()——地图容器在隐藏时初始化会算错尺寸，
// 这件事交给父组件的 onTab，因为 mapRef 在父组件手里。

export function TrackTabs({
  tab,
  onTab,
}: {
  tab: 'img' | 'map';
  onTab: (t: 'img' | 'map') => void;
}) {
  return (
    <div className="lab-track-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        className={tab === 'img' ? 'on' : undefined}
        aria-selected={tab === 'img'}
        onClick={() => onTab('img')}
      >
        图片 · 画路径
      </button>
      <button
        type="button"
        role="tab"
        className={tab === 'map' ? 'on' : undefined}
        aria-selected={tab === 'map'}
        onClick={() => onTab('map')}
      >
        地图 · 复现与保存
      </button>
    </div>
  );
}
