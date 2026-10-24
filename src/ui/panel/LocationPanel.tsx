// 功能面板 · 定位记录。
//
// 点一下拿当前位置（经纬度 + 精度 + 时间），追加到 CSV 文本里；
// 点保存把 CSV 存进文件库。文件名用户自定义，默认「定位记录.csv」。
// CSV 格式：时间戳,纬度,经度,精度(米),备注

import { useState } from 'react';
import { uploadFile } from '../../core/files';
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

export function LocationPanel() {
  const [name, setName] = useState('定位记录.csv');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const record = () => {
    if (!navigator.geolocation) {
      toast('浏览器不支持定位');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        setRows((rs) => [
          ...rs,
          {
            ts: new Date().toISOString(),
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            note: note.trim(),
          },
        ]);
        setNote('');
        toast('已记录当前位置');
      },
      (err) => {
        setBusy(false);
        toast(`定位失败：${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const save = async () => {
    if (rows.length === 0) {
      toast('还没有记录');
      return;
    }
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const file = new File([blob], name.trim() || '定位记录.csv', { type: 'text/csv' });
    await uploadFile(file, { smallLimit: 5 * 1024 * 1024 });
    toast(`已存到文件库：${file.name}（${rows.length} 条）`);
  };

  return (
    <div className="music-panel">
      <div className="music-now">
        <div className="music-disc">📍</div>
        <div className="music-meta">
          <div className="music-title">定位记录</div>
          <div className="music-sub muted small">{rows.length} 条待保存</div>
        </div>
      </div>

      <div className="music-add">
        <input
          className="music-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="文件名.csv"
        />
      </div>

      <input
        className="music-name-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="备注（可选）：这次在哪、干嘛"
      />

      <div className="music-add">
        <button className="music-add-btn primary" onClick={record} disabled={busy}>
          {busy ? '定位中…' : '记录当前位置'}
        </button>
        <button className="music-add-btn" onClick={save}>保存到文件库</button>
      </div>

      <ul className="music-list">
        {rows.length === 0 && <li className="muted small">点「记录当前位置」开始。</li>}
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
    </div>
  );
}
