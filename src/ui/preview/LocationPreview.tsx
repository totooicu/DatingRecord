// 定位文件预览：把 .drloc 解析成点位清单。
//
// 只读；打点 / 改偏移在「设置 → 功能面板 → 定位」里做。
// 展示的是「原始坐标 + 文件偏移 + 分段修正」后的落图坐标，和地图上看到的一致。

import { useEffect, useState } from 'react';
import type { StoredFile } from '../../core/repo/files';
import { readLocation } from '../../core/location/locationFile';
import { applyOffset, type LocationDoc } from '../../core/location/format';

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function LocationPreview({ file }: { file: StoredFile }) {
  const [doc, setDoc] = useState<LocationDoc | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    readLocation(file)
      .then((d) => {
        if (alive) setDoc(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [file]);

  if (error) return <p className="muted">{error}</p>;
  if (!doc) return <p className="muted small">读取定位数据中…</p>;

  const points = applyOffset(doc.points, doc.offset, doc.offsets);
  const segCount = doc.offsets.length;

  return (
    <div className="playlist-preview">
      <div className="playlist-preview-head">
        <div>
          <div className="playlist-preview-name">{doc.name}</div>
          <div className="muted small">
            {points.length} 个点
            {doc.offset.lat !== 0 || doc.offset.lng !== 0
              ? ` · 偏移 Δ${doc.offset.lat.toFixed(6)}, Δ${doc.offset.lng.toFixed(6)}`
              : ''}
            {segCount > 0 ? ` · 分段修正 ${segCount} 段` : ''}
          </div>
        </div>
      </div>

      {points.length === 0 && <p className="muted small">这个定位文件还没有点。</p>}

      <ul className="playlist-preview-list">
        {points.map((p, i) => (
          <li key={`${p.ts}-${i}`}>
            <span className="playlist-preview-idx">{i + 1}</span>
            <span className="playlist-preview-title">
              {fmtTime(p.ts)} · {p.lat.toFixed(6)}, {p.lng.toFixed(6)}
              {p.note ? ` · ${p.note}` : ''}
            </span>
            <span className="muted small">{p.accuracy ? `±${Math.round(p.accuracy)}m` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
