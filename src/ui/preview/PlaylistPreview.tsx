// 歌单文件预览：把 .drpl 解析成曲目清单，可直接载入播放。
//
// 预览只读；增删排序在「设置 → 功能面板 → 音乐」里做（那边会自动写回文件）。

import { useEffect, useState } from 'react';
import { listFiles, type StoredFile } from '../../core/repo/files';
import { openPlaylist } from '../../core/runtime/music';
import {
  resolvePlaylistTracks,
  type PlaylistDoc,
} from '../../core/music/format';
import { readPlaylist } from '../../core/music/playlistFile';
import { PlayIcon } from '../panel/MusicIcons';
import { showToast } from '../toast';

function fmtSize(n: number): string {
  if (!n) return '';
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function PlaylistPreview({ file }: { file: StoredFile }) {
  const [doc, setDoc] = useState<PlaylistDoc | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    readPlaylist(file)
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

  if (error) {
    return <p className="muted">{error}</p>;
  }
  if (!doc) {
    return <p className="muted small">读取歌单中…</p>;
  }

  const { tracks, missing } = resolvePlaylistTracks(doc, listFiles());

  const play = async () => {
    setBusy(true);
    try {
      await openPlaylist(file.id, { play: true });
      showToast(`正在播放「${doc.name}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="playlist-preview">
      <div className="playlist-preview-head">
        <div>
          <div className="playlist-preview-name">{doc.name}</div>
          <div className="muted small">
            {tracks.length} 首
            {missing.length ? ` · ${missing.length} 首找不到文件` : ''}
            {doc.description ? ` · ${doc.description}` : ''}
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => void play()} disabled={busy || tracks.length === 0}>
          {busy ? (
            '载入中…'
          ) : (
            <>
              <span className="playlist-play-icon"><PlayIcon /></span>
              播放
            </>
          )}
        </button>
      </div>

      {tracks.length === 0 && missing.length === 0 && (
        <p className="muted small">这个歌单还是空的。去「功能面板 → 音乐」里添加曲目。</p>
      )}

      <ul className="playlist-preview-list">
        {tracks.map((t, i) => (
          <li key={t.id}>
            <span className="playlist-preview-idx">{i + 1}</span>
            <span className="playlist-preview-title">{t.name}</span>
            <span className="muted small">{fmtSize(t.size)}</span>
          </li>
        ))}
        {missing.map((t, i) => (
          <li key={`missing-${i}`} className="playlist-preview-missing">
            <span className="playlist-preview-idx">–</span>
            <span className="playlist-preview-title">{t.name}</span>
            <span className="muted small">文件缺失</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
