import { useState } from 'react';
import { fileNameDuplicates, resolveFileNameDuplicates } from '../../core/repo/files';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';
import { bump, useVersion } from '../../store';

export function DupNameSection({ onMerge }: { onMerge: (ids: string[]) => void }) {
  useVersion();
  const [scanned, setScanned] = useState(false);
  const [note, setNote] = useState('');
  const groups = scanned ? fileNameDuplicates() : [];
  // 同名组可能有几百组
  const paged = usePaged(groups, usePageSize());
  return <section className="files-advanced">
    <h4>同名文件整理</h4>
    <p className="muted small">名称去除首尾空白后区分大小写。编号只改显示名，不改内容或引用；保留每组最早文件的名称。隐私模式只显示可见文件。</p>
    <button className="btn btn-sm" onClick={() => { setScanned(true); setNote(''); }}>扫描同名文件</button>
    {scanned && groups.length === 0 && <p className="small">没有可见的同名文件组</p>}
    {paged.pageItems.map((g) => <div key={g.name}>
      <h5 style={{ overflowWrap: 'anywhere' }}>{g.name} · {g.files.length} 个</h5>
      <ul>{g.files.map((f) => <li key={f.id} style={{ overflowWrap: 'anywhere' }}>{f.name} · {f.size} 字节 · {f.id}</li>)}</ul>
      <div className="row-actions">
        <button className="btn btn-sm" onClick={() => {
          if (!window.confirm(`为「${g.name}」的 ${g.files.length - 1} 个同名文件编号？不会合并或覆盖内容。`)) return;
          try {
            const changed = resolveFileNameDuplicates(g.name, g.files.map((f) => f.id));
            setNote(`已编号 ${changed.length} 个文件`);
            bump();
          } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
        }}>编号整理</button>
        <button className="btn btn-sm" onClick={() => onMerge(g.files.map((f) => f.id))}>选择合并</button>
      </div>
    </div>)}
    <Paginator paged={paged} />
    {note && <p role="status" className="small">{note}</p>}
  </section>;
}
