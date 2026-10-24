// 功能面板 · 定位记录。
//
// 逻辑：选/建一个 CSV 文件作为「当前记录文件」，之后每次打点追加进去，
// 自动写回文件库。不用每次手动保存。

import { useState } from 'react';
import { getFile, overwriteFileContent, type StoredFile } from '../../core/repo/files';
import { getBlob } from '../../core/db/blob';
import { uploadFile } from '../../core/files';
import { FilesPanel } from '../files';
import { showToast as toast } from '../toast';

interface Row {
  ts: string;
  lat: number;
  lng: number;
  accuracy: number;
  note: string;
}

function toCsv(rows: Row[]): string {
  const head = '时间,纬度,经度,精度(米),备注\n';
  const body = rows
    .map((r) => {
      const d = new Date(r.ts);
      const t = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
      return `"${t}",${r.lat.toFixed(6)},${r.lng.toFixed(6)},${Math.round(r.accuracy)},"${r.note.replace(/"/g, '""')}"`;
    })
    .join('\n');
  return head + body + '\n';
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((p) => p.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()) ?? [];
    if (parts.length < 3) continue;
    const lat = Number(parts[1]);
    const lng = Number(parts[2]);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    out.push({ ts: parts[0], lat, lng, accuracy: Number(parts[3]) || 0, note: parts[4] || '' });
  }
  return out;
}

export function LocationPanel() {
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);

  const current = fileId ? getFile(fileId) : null;

  const selectExisting = async (f: StoredFile) => {
    const blob = await getBlob(f.id);
    if (!blob) { toast('读不到文件'); return; }
    const text = await blob.text();
    const parsed = parseCsv(text);
    setRows(parsed);
    setFileId(f.id);
    setFileName(f.name);
    setPicking(false);
    toast(`已打开「${f.name}」，${parsed.length} 条记录`);
  };

  const createNew = async () => {
    const name = fileName.trim() || '定位记录.csv';
    const csv = toCsv([]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const file = new File([blob], name, { type: 'text/csv' });
    const out = await uploadFile(file, { smallLimit: 5 * 1024 * 1024 });
    const f = out.kind === 'created' ? out.file : out.kind === 'reused' ? out.file : null;
    if (f) {
      setFileId(f.id);
      setFileName(f.name);
      setRows([]);
      toast(`已创建「${f.name}」`);
    }
  };

  const record = () => {
    if (!fileId) { toast('先选或新建一个 CSV 文件'); return; }
    if (!navigator.geolocation) { toast('浏览器不支持定位'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setBusy(false);
        const r: Row = {
          ts: new Date().toISOString(),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          note: note.trim(),
        };
        const next = [...rows, r];
        setRows(next);
        setNote('');
        const blob = new Blob([toCsv(next)], { type: 'text/csv;charset=utf-8' });
        await overwriteFileContent(fileId, blob);
        toast('已记录并保存');
      },
      (err) => { setBusy(false); toast(`定位失败：${err.message}`); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="music-panel">
      <div className="music-now">
        <div className="music-disc">📍</div>
        <div className="music-meta">
          <div className="music-title">{current ? current.name : '未选择文件'}</div>
          <div className="music-sub muted small">{rows.length} 条记录</div>
        </div>
      </div>

      {!fileId && (
        <>
          <input className="music-name-input" value={fileName} onChange={(e) => setFileName(e.target.value)}
            placeholder="新文件名（默认 定位记录.csv）" />
          <div className="music-add">
            <button className="music-add-btn primary" onClick={createNew}>新建文件</button>
            <button className="music-add-btn" onClick={() => setPicking(true)}>选已有 CSV</button>
          </div>
        </>
      )}

      {fileId && (
        <>
          <input className="music-name-input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选）：这次在哪、干嘛" />
          <div className="music-add">
            <button className="music-add-btn primary" onClick={record} disabled={busy}>
              {busy ? '定位中…' : '记录当前位置'}
            </button>
            <button className="music-add-btn" onClick={() => { setFileId(null); setRows([]); }}>切换文件</button>
          </div>
        </>
      )}

      <ul className="music-list">
        {rows.length === 0 && <li className="muted small">{fileId ? '点「记录当前位置」开始打点。' : '先新建或选一个 CSV 文件。'}</li>}
        {rows.slice().reverse().map((r, i) => (
          <li key={i} className="music-row">
            <span className="music-row-idx">{rows.length - i}</span>
            <span className="music-row-name">
              {new Date(r.ts).toLocaleString()} · {r.lat.toFixed(4)},{r.lng.toFixed(4)}
              {r.note ? ` · ${r.note}` : ''}
            </span>
            <span className="music-row-size muted small">±{Math.round(r.accuracy)}m</span>
          </li>
        ))}
      </ul>

      {picking && (
        <div className="music-picker-mask" onClick={() => setPicking(false)}>
          <div className="music-picker" onClick={(e) => e.stopPropagation()}>
            <div className="music-picker-head">
              <strong>选定位 CSV</strong>
              <button onClick={() => setPicking(false)}>✕</button>
            </div>
            <div className="music-picker-body">
              <FilesPanel onPick={(f) => selectExisting(f)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
