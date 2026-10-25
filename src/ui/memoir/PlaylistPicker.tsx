// 手动挑歌：从文件库的音频里勾几首，存成歌单挂到回忆录上。
//
// 和 AI 配乐是两条路：AI 负责给「氛围」，这里负责精确控制——
// 用户想放哪几首就放哪几首，也可以直接改手头已有的歌单。

import { useMemo, useState } from 'react';
import { trackRefOf } from '../../core/music/format';
import { libraryAudio } from '../../core/music/library';
import {
  createPlaylist,
  getPlaylistFile,
  playlistDisplayName,
  readPlaylist,
  writePlaylist,
} from '../../core/music/playlistFile';
import { updateMemoir } from '../../core/repo/memoirs';
import { bump, useVersion } from '../../store';
import { Modal } from '../common';
import { showToast as toast } from '../toast';
import type { Memoir } from '../../core/types';

export function PlaylistPicker({
  memoir,
  onApply,
}: {
  memoir: Memoir;
  onApply: (next: Memoir) => void;
}) {
  const v = useVersion();
  const audio = useMemo(() => libraryAudio(), [v]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const current = memoir.playlistId ? getPlaylistFile(memoir.playlistId) : null;

  const openPicker = async () => {
    setErr(null);
    setQuery('');
    setSelected(new Set());
    setName(current ? playlistDisplayName(current) : `${memoir.title}配乐`);
    setOpen(true);
    if (!memoir.playlistId) return;

    // 打开时把当前歌单的曲目勾上，改歌单就是「在原有基础上增删」
    setLoading(true);
    try {
      const doc = await readPlaylist(memoir.playlistId);
      const pool = libraryAudio();
      const ids = new Set<string>();
      for (const t of doc.tracks) {
        const hit = pool.find((f) => (t.id && f.id === t.id) || (t.storedId && f.storedId === t.storedId));
        if (hit) ids.add(hit.id);
      }
      setSelected(ids);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async (mode: 'new' | 'overwrite') => {
    const tracks = audio.filter((f) => selected.has(f.id));
    if (!tracks.length) {
      setErr('先勾几首歌再保存');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      let id: string;
      let savedName = name;
      if (mode === 'overwrite' && memoir.playlistId) {
        const doc = await readPlaylist(memoir.playlistId);
        doc.name = name;
        doc.tracks = tracks.map(trackRefOf);
        const f = await writePlaylist(memoir.playlistId, doc);
        id = f.id;
        savedName = playlistDisplayName(f);
      } else {
        const f = await createPlaylist({ name, tracks });
        id = f.id;
        savedName = playlistDisplayName(f);
      }
      updateMemoir(memoir.id, { playlistId: id });
      onApply({ ...memoir, playlistId: id });
      bump();
      toast(`已保存歌单「${savedName}」，共 ${tracks.length} 首`);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = q ? audio.filter((f) => f.name.toLowerCase().includes(q)) : audio;

  return (
    <>
      <button className="btn btn-sm" onClick={() => void openPicker()}>
        自己挑歌…
      </button>

      {open && (
        <Modal
          title="挑选背景歌单"
          onClose={() => {
            if (!saving) setOpen(false);
          }}
          footer={
            <div className="memoir-ai-row">
              <span className="muted small">
                曲库 {audio.length} 首 · 已选 {selected.size} 首
              </span>
              <span className="memoir-picker-foot-gap" />
              <button className="btn btn-sm" disabled={saving} onClick={() => setOpen(false)}>
                取消
              </button>
              {memoir.playlistId && (
                <button className="btn btn-sm" disabled={saving} onClick={() => void save('new')}>
                  另存为新歌单
                </button>
              )}
              <button
                className="btn btn-sm btn-primary"
                disabled={saving || loading}
                onClick={() => void save(memoir.playlistId ? 'overwrite' : 'new')}
              >
                {saving ? '保存中…' : memoir.playlistId ? '保存到当前歌单' : '新建歌单'}
              </button>
            </div>
          }
        >
          <div className="memoir-picker">
            <label className="field">
              <span className="field-label">歌单名</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：春天的背景音" />
            </label>

            {audio.length > 0 && (
              <input
                className="memoir-song-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜歌名…"
              />
            )}

            {!audio.length ? (
              <p className="small memoir-ai-warn">
                文件库里还没有音频。先去「设置 → 文件」导入几首歌，再回来挑。
              </p>
            ) : loading ? (
              <p className="muted small">正在读当前歌单…</p>
            ) : !shown.length ? (
              <p className="muted small">没有名字里带「{query.trim()}」的歌。</p>
            ) : (
              <div className="memoir-song-list">
                {shown.map((f) => (
                  <label className="memoir-song-row" key={f.id}>
                    <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                    <span className="memoir-song-name" title={f.name}>
                      {f.name}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {err && <p className="small memoir-ai-err">{err}</p>}
            {memoir.playlistId && (
              <p className="muted small">
                保存到当前歌单会覆盖原歌单的曲目；想保留原来的，选「另存为新歌单」。
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
