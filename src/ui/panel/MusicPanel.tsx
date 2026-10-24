// 功能面板 · 背景音乐歌单（薄视图）。
//
// 音频元素与播放状态已挪到 core/runtime/music 单例（用 document.createElement 的全局
// <audio>，不依赖任何组件）：离开本页歌继续放，且作为一条「服务」进 head。
// 这个组件只负责把单例状态画出来、把用户操作转给单例。

import { useEffect, useState } from 'react';
import { type StoredFile } from '../../core/repo/files';
import { useUploader } from '../files/useUploader';
import { useMusic, syncTracks, addTracks, removeTrack, playAt, toggle, next, prev, seek, cycleLoop, setSpeed, reorder, type LoopMode } from '../../core/runtime/music';
import { FilesPanel } from '../files';
import { CollisionModal } from '../files/CollisionModal';
import { showToast as toast } from '../toast';
import { FilePickInput } from '../common';

const LOOP_LABEL: Record<LoopMode, string> = {
  list: '列表循环',
  one: '单曲循环',
  off: '不循环',
};

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function MusicPanel() {
  const m = useMusic();
  const { busy, ask, inputRef, upload, openPicker } = useUploader((msg) => toast(msg));
  const [picking, setPicking] = useState(false);

  // 进来先让单例从文件库/歌单同步出当前列表
  useEffect(() => {
    syncTracks();
  }, []);

  const refresh = () => syncTracks();

  const curIdx = m.tracks.findIndex((t) => t.id === m.current?.id);

  const onPickFile = (f: StoredFile) => {
    addTracks([f]);
    toast(`已加入「${f.name}」`);
  };

  if (picking) {
    return (
      <div className="music-panel">
        <div className="music-pick-back">
          <button className="music-add-btn" onClick={() => setPicking(false)}>← 返回歌单</button>
          <span className="muted small">点文件即可加入歌单</span>
        </div>
        <FilesPanel onPick={onPickFile} pickedIds={new Set(m.tracks.map((t) => t.id))} />
        {ask && <CollisionModal prompt={ask.prompt} uploading={ask.preview}
          onDecide={(p) => ask.step(p)} onCancel={ask.cancel} />}
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

      <div className="music-now">
        <div className="music-disc">{m.current ? '♪' : '♫'}</div>
        <div className="music-meta">
          <div className="music-title">{m.current ? m.current.name : (m.pendingPlay ? '待播放（点一下恢复）' : '未在播放')}</div>
          <div className="music-sub muted small">
            {m.tracks.length} 首{curIdx >= 0 ? ` · ${curIdx + 1}/${m.tracks.length}` : ''}
          </div>
        </div>
      </div>

      <div className="music-progress">
        <span className="music-time small">{fmtTime(m.progress)}</span>
        <input type="range" min={0} max={m.duration || 0} step={0.1} value={m.progress}
          onChange={(e) => seek(Number(e.target.value))} className="music-range" />
        <span className="music-time small">{fmtTime(m.duration)}</span>
      </div>

      <div className="music-controls">
        <button className="music-btn" onClick={cycleLoop} title={LOOP_LABEL[m.loop]}>
          {m.loop === 'list' ? '🔁' : m.loop === 'one' ? '🔂' : '↪'}
        </button>
        <button className="music-btn" onClick={prev} disabled={m.tracks.length === 0}>⏮</button>
        <button className="music-btn music-btn-play" onClick={toggle} disabled={m.tracks.length === 0}>
          {m.playing ? '⏸' : '▶'}
        </button>
        <button className="music-btn" onClick={() => next(false)} disabled={m.tracks.length === 0}>⏭</button>
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

      {ask && <CollisionModal prompt={ask.prompt} uploading={ask.preview}
        onDecide={(p) => ask.step(p)} onCancel={ask.cancel} />}
    </div>
  );
}
