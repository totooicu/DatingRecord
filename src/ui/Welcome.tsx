// 空库首屏：还没有任何人物时显示，三个入口对应三条上手路径

import { loadSampleData } from '../core/seed';
import { bump } from '../store';

export function Welcome({
  onImport,
  onCreate,
}: {
  onImport: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="app at-welcome" data-section="persons">
      <div className="pane pane-solo">
        <div className="welcome">
          <h2>开始记录你们的故事</h2>
          <p className="muted">
            数据全部保存在你自己的浏览器里（SQLite + IndexedDB），随时可以导出成 JSON 备份文件。
          </p>
          <div className="row-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                loadSampleData();
                bump();
              }}
            >
              载入示例数据看看效果
            </button>
            <button className="btn" onClick={onImport}>
              导入已有备份
            </button>
            <button className="btn" onClick={onCreate}>
              直接开始创建
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
