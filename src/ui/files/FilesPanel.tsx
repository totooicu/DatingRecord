// 文件页：库本身 + 两个数据维护入口（迁移、判重阈值）。
//
// 迁移放在文件页底部而不是单独一个设置项：它只跟文件有关，
// 而且是一次性动作，放在这里用户找得到、又不会占目录位置。
import { useState } from 'react';
import type { StoredFile } from '../../core/repo/files';
import { FilesSection } from './FilesSection';
import type { PreviewKind } from '../preview';
import { MigrateSection } from './MigrateSection';
import { SMALL_LIMIT_OPTIONS, getSmallLimit, setSmallLimit } from '../filePrefs';
import { fmtSize } from './fileFormat';

function SmallLimitRow() {
  const [limit, setLimit] = useState(getSmallLimit());
  return (
    <div className="file-pref">
      <label className="field-label" htmlFor="small-limit">
        判重阈值
        <em>不超过此大小的同名文件逐字节比对，超过则弹窗让你判断</em>
      </label>
      <select
        id="small-limit"
        value={limit}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLimit(v);
          setSmallLimit(v);
        }}
      >
        {SMALL_LIMIT_OPTIONS.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}（{fmtSize(o.v)}）
          </option>
        ))}
      </select>
    </div>
  );
}

export function FilesPanel({
  onPick,
  pickedIds,
  onlyKinds,
  pickLabel,
  compact,
}: {
  onPick?: (f: StoredFile) => void;
  pickedIds?: Set<string>;
  onlyKinds?: PreviewKind[];
  pickLabel?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="files-panel">
        <FilesSection
          onPick={onPick}
          pickedIds={pickedIds}
          onlyKinds={onlyKinds}
          pickLabel={pickLabel}
          compact
        />
      </div>
    );
  }
  return (
    <div className="files-panel">
      <FilesSection onPick={onPick} pickedIds={pickedIds} />
      <SmallLimitRow />
      <details className="files-advanced">
        <summary>数据迁移（内容寻址）</summary>
        <MigrateSection />
      </details>
    </div>
  );
}
