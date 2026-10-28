// 功能面板 · 背景音乐歌单（薄视图）。
//
// 音频元素与播放状态已挪到 core/runtime/music 单例（用 document.createElement 的全局
// <audio>，不依赖任何组件）：离开本页歌继续放，且作为一条「服务」进 head。
// 这个组件只负责把单例状态画出来、把用户操作转给单例。
//
// 歌单本身是文件库里的 .drpl 文件：
//   · 选中后，增删/排序自动写回文件（防抖，状态在右上角）；
//   · 没选中时，当前队列叫「临时队列」，可以一键存成歌单；
//   · 支持新建 / 导入 / 改名 / 删除，后续其他面板也能直接读这些文件。

import { useEffect, useMemo, useRef, useState } from 'react';
import { type StoredFile } from '../../core/repo/files';
import { useUploader } from '../files/useUploader';
import {
  useMusic,
  syncTracks,
  addTracks,
  removeTrack,
  playAt,
  toggle,
  next,
  prev,
  seek,
  cycleLoop,
  setSpeed,
  reorder,
  openPlaylist,
  detachPlaylist,
  saveQueueAsPlaylist,
  renameActivePlaylist,
  deleteActivePlaylist,
  getActivePlaylistDoc,
  type LoopMode,
} from '../../core/runtime/music';
import {
  importPlaylistText,
  listPlaylists,
  playlistDisplayName,
} from '../../core/music/playlistFile';
import { uniquePlaylistName } from '../../core/music/format';
import { FilesPanel } from '../files';
import { LoopIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from './MusicIcons';
import { CollisionModal } from '../files/CollisionModal';
import { showToast as toast } from '../toast';
import { ConfirmButton, Field, FilePickInput, Modal } from '../common';
import { bump, useVersion } from '../../store';
import type { PreviewKind } from '../preview';

const LOOP_LABEL: Record<LoopMode, string> = {
  list: '列表循环',
  one: '单曲循环',
  off: '不循环',
};

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
/** 从文件库挑曲目时只列音频 */
const AUDIO_KINDS: PreviewKind[] = ['audio'];

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface PlaylistDraft {
  name: string;
  description: string;
  withTracks: boolean;
}

export function MusicPanel() {
  const m = useMusic();
  const v = useVersion();
  const { busy, ask, inputRef, upload, openPicker } = useUploader((msg) => toast(msg));
  const [picking, setPicking] = useState(false);
  const [create, setCreate] = useState<PlaylistDraft | null>(null);
  const [edit, setEdit] = useState<PlaylistDraft | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const playlists = useMemo(() => listPlaylists(), [v]);
  const activeDoc = getActivePlaylistDoc();

  // 进来先让单例从文件库/歌单同步出当前列表；文件库变化（上传/删除/改名）也重同步
  useEffect(() => {
    syncTracks();
  }, [v]);

  const refresh = () => syncTracks();

  const curIdx = m.tracks.findIndex((t) => t.id === m.current?.id);

  const onPickFile = (f: StoredFile) => {
    addTracks([f]);
    toast(`已加入「${f.name}」`);
  };

  const openCreate = () => {
    setCreate({
      name: uniquePlaylistName('我的歌单', playlists),
      description: '',
      // 临时队列默认一起存；已在某个歌单里时，「新建」默认是空歌单
      withTracks: m.tracks.length > 0 && !m.playlistId,
    });
  };

  const openEdit = () => {
    if (!m.playlistId) return;
    setEdit({
      name: m.playlistName ?? '',
      description: activeDoc?.description ?? '',
      withTracks: false,
    });
  };

  const submitCreate = async () => {
    if (!create || dialogBusy) return;
    setDialogBusy(true);
    try {
      const file = await saveQueueAsPlaylist(
        create.name,
        create.description,
        create.withTracks && m.tracks.length > 0,
      );
      bump();
      setCreate(null);
      toast(`已创建「${playlistDisplayName(file)}」`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setDialogBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!edit || dialogBusy) return;
    setDialogBusy(true);
    try {
      await renameActivePlaylist(edit.name, edit.description);
      bump();
      setEdit(null);
      toast('歌单信息已更新');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setDialogBusy(false);
    }
  };

  const onSelect = (id: string) => {
    if (id === (m.playlistId ?? '')) return;
    if (!id) {
      void detachPlaylist().then(() => toast('已卸下歌单，当前队列未保存'));
      return;
    }
    void openPlaylist(id).catch((e: unknown) => {
      toast(e instanceof Error ? e.message : String(e));
    });
  };

  const onImportFiles = async (files: File[]) => {
    const f = files[0];
    if (!f || importing) return;
    setImporting(true);
    try {
      const text = await f.text();
      const saved = await importPlaylistText(text, f.name);
      await openPlaylist(saved.id);
      bump();
      toast(`已导入「${playlistDisplayName(saved)}」`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const removeActive = async () => {
    try {
      await deleteActivePlaylist();
      bump();
      toast('已删除歌单文件，当前队列保留为临时队列');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const saveText = !m.playlistId
    ? (m.tracks.length ? '队列未保存' : '')
    : m.saving === 'saving'
      ? '保存中…'
      : m.saving === 'error'
        ? '保存失败'
        : m.saving === 'saved'
          ? '已保存'
          : '自动保存';

  if (picking) {
    return (
      <div className="music-panel">
        <div className="music-pick-back">
          <button className="music-add-btn" onClick={() => setPicking(false)}>← 返回歌单</button>
          <span className="muted small">点文件即可加入当前歌单</span>
        </div>
        <FilesPanel
          onPick={onPickFile}
          pickedIds={new Set(m.tracks.map((t) => t.id))}
          onlyKinds={AUDIO_KINDS}
          pickLabel="加入"
          compact
        />
      </div>
    );
  }

  return (
    <div className="music-panel">
      <FilePickInput
        inputRef={inputRef}
        accept="audio/*"
        multiple
        onFiles={(files) => {
          void upload(files).then((saved) => {
            // 上传成功的文件直接加进歌单：歌单可能被用户清空过（播种逻辑
            // 不会兜这种场景），这里显式加，传完立刻看得到。
            if (saved.length) addTracks(saved);
            refresh();
          });
        }}
      />
      <FilePickInput
        inputRef={importRef}
        accept={`.drpl,application/x-dr-playlist,application/json`}
        onFiles={(files) => void onImportFiles(files)}
      />

      <section className="music-playlists">
        <div className="music-pl-head">
          <span className="music-pl-label">歌单</span>
          <span className={`music-save-state${m.saving === 'error' ? ' is-error' : ''}`}>{saveText}</span>
        </div>
        <div className="music-pl-bar">
          <select
            className="music-pl-select"
            value={m.playlistId ?? ''}
            onChange={(e) => onSelect(e.target.value)}
            aria-label="选择歌单"
          >
            <option value="">临时队列（未保存）</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>{playlistDisplayName(p)}</option>
            ))}
          </select>
          <button className="music-add-btn primary" onClick={openCreate} disabled={dialogBusy}>新建</button>
          <button className="music-add-btn" onClick={() => importRef.current?.click()} disabled={importing}>
            {importing ? '导入中…' : '导入'}
          </button>
        </div>

        {m.playlistId && (
          <div className="music-pl-meta">
            {activeDoc?.description && <span className="muted small">{activeDoc.description}</span>}
            <button className="music-pl-action" onClick={openEdit}>改名 / 描述</button>
            <ConfirmButton
              compact
              text="删除"
              confirmText={`删除歌单「${m.playlistName ?? ''}」？曲目文件不会被删除。`}
              onConfirm={() => void removeActive()}
              className="music-pl-action danger"
            />
          </div>
        )}

        {!m.playlistId && m.tracks.length > 0 && (
          <button className="music-save-queue" onClick={openCreate}>
            把当前 {m.tracks.length} 首存为歌单
          </button>
        )}

        {m.playlistMissing > 0 && (
          <p className="music-missing">
            有 {m.playlistMissing} 首曲目在当前文件库里找不到（文件被删或还没导入），播放时会跳过。
          </p>
        )}
      </section>

      <div className="music-now">
        <div className="music-disc">{m.current ? '♪' : '♫'}</div>
        <div className="music-meta">
          <div className="music-title">{m.current ? m.current.name : (m.pendingPlay ? '待播放（点一下恢复）' : '未在播放')}</div>
          <div className="music-sub muted small">
            {m.tracks.length} 首{curIdx >= 0 ? ` · ${curIdx + 1}/${m.tracks.length}` : ''}
            {m.playlistName ? ` · ${m.playlistName}` : ''}
          </div>
          {m.error && <div className="music-error small">{m.error}</div>}
        </div>
      </div>

      <div className="music-progress">
        <span className="music-time small">{fmtTime(m.progress)}</span>
        <input type="range" min={0} max={m.duration || 0} step={0.1} value={m.progress}
          onChange={(e) => seek(Number(e.target.value))} className="music-range" />
        <span className="music-time small">{fmtTime(m.duration)}</span>
      </div>

      <div className="music-controls">
        <button className="music-btn" onClick={cycleLoop} title={LOOP_LABEL[m.loop]} aria-label={LOOP_LABEL[m.loop]}>
          <LoopIcon mode={m.loop} />
        </button>
        <button className="music-btn" onClick={prev} disabled={m.tracks.length === 0} title="上一首" aria-label="上一首">
          <PrevIcon />
        </button>
        <button
          className="music-btn music-btn-play"
          onClick={toggle}
          disabled={m.tracks.length === 0}
          title={m.playing ? '暂停' : '播放'}
          aria-label={m.playing ? '暂停' : '播放'}
        >
          {m.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="music-btn" onClick={() => next(false)} disabled={m.tracks.length === 0} title="下一首" aria-label="下一首">
          <NextIcon />
        </button>
        <button className="music-btn music-speed" onClick={() => {
          const i = SPEEDS.indexOf(m.speed);
          setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
        }} title="倍速">{m.speed}×</button>
      </div>

      <div className="music-add">
        <button className="music-add-btn primary" onClick={openPicker} disabled={busy}>
          {busy ? '上传中…' : '从本地添加'}
        </button>
        <button className="music-add-btn" onClick={() => setPicking(true)}>从文件库选</button>
      </div>

      <ul className="music-list">
        {m.tracks.length === 0 && <li className="muted small">还没有音频，从本地或文件库添加。</li>}
        {m.tracks.map((t, i) => (
          <li key={t.id} className={`music-row${m.current?.id === t.id ? ' on' : ''}`}>
            <span className="music-row-order">
              <button className="music-move" onClick={() => reorder(i, -1)} disabled={i === 0} title="上移">↑</button>
              <button className="music-move" onClick={() => reorder(i, 1)} disabled={i === m.tracks.length - 1} title="下移">↓</button>
            </span>
            <span className="music-row-idx">{m.current?.id === t.id ? (m.playing ? '♪' : '‖') : i + 1}</span>
            <span className="music-row-name" onClick={() => playAt(i)}>{t.name}</span>
            <span className="music-row-size muted small">{(t.size / 1024 / 1024).toFixed(1)}M</span>
            <button className="music-remove" onClick={() => removeTrack(t.id)} title="移出歌单">✕</button>
          </li>
        ))}
      </ul>

      {create && (
        <Modal
          title="新建歌单"
          onClose={() => !dialogBusy && setCreate(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setCreate(null)} disabled={dialogBusy}>取消</button>
              <button className="btn btn-primary" onClick={() => void submitCreate()} disabled={dialogBusy || !create.name.trim()}>
                {dialogBusy ? '创建中…' : '创建'}
              </button>
            </>
          }
        >
          <Field label="名称">
            <input
              autoFocus
              value={create.name}
              maxLength={60}
              onChange={(e) => setCreate({ ...create, name: e.target.value })}
              placeholder="例如：通勤路上"
            />
          </Field>
          <Field label="描述" hint="可选">
            <textarea
              rows={2}
              value={create.description}
              onChange={(e) => setCreate({ ...create, description: e.target.value })}
              placeholder="这个歌单适合什么时候听"
            />
          </Field>
          {m.tracks.length > 0 && (
            <label className="music-check">
              <input
                type="checkbox"
                checked={create.withTracks}
                onChange={(e) => setCreate({ ...create, withTracks: e.target.checked })}
              />
              把当前队列的 {m.tracks.length} 首一起存进去
            </label>
          )}
          <p className="muted small">歌单会保存到文件库（.drpl），可在「文件」页筛选、预览、备份。</p>
        </Modal>
      )}

      {edit && (
        <Modal
          title="编辑歌单信息"
          onClose={() => !dialogBusy && setEdit(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEdit(null)} disabled={dialogBusy}>取消</button>
              <button className="btn btn-primary" onClick={() => void submitEdit()} disabled={dialogBusy || !edit.name.trim()}>
                {dialogBusy ? '保存中…' : '保存'}
              </button>
            </>
          }
        >
          <Field label="名称">
            <input
              autoFocus
              value={edit.name}
              maxLength={60}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </Field>
          <Field label="描述" hint="可选">
            <textarea
              rows={2}
              value={edit.description}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            />
          </Field>
          <p className="muted small">文件名会同步改成「{edit.name.trim() || '…'}.drpl」。</p>
        </Modal>
      )}

      {ask && <CollisionModal prompt={ask.prompt} uploading={ask.preview}
        onDecide={(c) => ask.step(c)} onCancel={ask.cancel} />}
    </div>
  );
}
