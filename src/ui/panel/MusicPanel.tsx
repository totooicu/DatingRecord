// 功能面板 · 背景音乐歌单。
//
// 音频来源两个：
//   1. 从本地磁盘选文件（复用文件库 useUploader：判重、撞车弹窗全走它）
//   2. 从文件库里选已存在的文件加入歌单（复用 FilesPanel，点文件即加入）

import { useEffect, useMemo, useRef, useState } from 'react';
import { listFiles, type StoredFile } from '../../core/repo/files';
import { objectUrlFor, forgetUrl } from '../../core/db/blob';
import { getPlaylist, setPlaylist } from '../../core/music/playlist';
import { FilesPanel } from '../files';
import { CollisionModal } from '../files/CollisionModal';
import { useUploader } from '../files/useUploader';
import { showToast as toast } from '../toast';

type LoopMode = 'list' | 'one' | 'off';

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
  const [tracks, setTracks] = useState<StoredFile[]>(() => {
    const ids = getPlaylist();
    const all = listFiles();
    return ids.map((id) => all.find((f) => f.id === id)).filter(Boolean) as StoredFile[];
  });
  const [current, setCurrent] = useState<StoredFile | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState<LoopMode>('list');
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const { busy, ask, inputRef, upload, openPicker } = useUploader((msg) => toast(msg));

  useEffect(() => {
    setPlaylist(tracks.map((t) => t.id));
  }, [tracks]);

  const refresh = () => {
    const all = listFiles();
    setTracks((ts) => ts.map((t) => all.find((f) => f.id === t.id) ?? t));
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!current) { setUrl(null); return; }
      const u = await objectUrlFor(current.id);
      if (!alive) { if (u) URL.revokeObjectURL(u); return; }
      setUrl((old) => { if (old) forgetUrl(current.id); return u; });
    })();
    return () => { alive = false; };
  }, [current]);

  useEffect(() => {
    if (url && audioRef.current) audioRef.current.play().catch(() => setPlaying(false));
  }, [url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, url]);

  const playAt = (i: number) => {
    const t = tracks[i];
    if (!t) return;
    setProgress(0);
    setCurrent(t);
    setPlaying(true);
  };

  const move = (i: number, dir: -1 | 1) => {
    setTracks((ts) => {
      const j = i + dir;
      if (j < 0 || j >= ts.length) return ts;
      const next = [...ts];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const next = (auto = false) => {
    if (tracks.length === 0) return;
    if (loop === 'off' && auto) { setPlaying(false); return; }
    if (loop === 'one' && auto) {
      if (audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => {}); }
      return;
    }
    const i = current ? tracks.findIndex((t) => t.id === current.id) : -1;
    playAt((i + 1) % tracks.length);
  };

  const prev = () => {
    if (tracks.length === 0) return;
    const i = current ? tracks.findIndex((t) => t.id === current.id) : 0;
    playAt((i - 1 + tracks.length) % tracks.length);
  };

  const toggle = () => {
    if (!current) { if (tracks.length > 0) playAt(0); return; }
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().catch(() => {}); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  };

  const seek = (v: number) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    a.currentTime = v;
    setProgress(v);
  };

  const cycleLoop = () => setLoop((m) => (m === 'list' ? 'one' : m === 'one' ? 'off' : 'list'));

  const curIdx = useMemo(
    () => (current ? tracks.findIndex((t) => t.id === current.id) : -1),
    [current, tracks],
  );

  const onPickFile = (f: StoredFile) => {
    setTracks((ts) => {
      if (ts.some((t) => t.id === f.id)) {
        toast(`「${f.name}」已在歌单`);
        return ts;
      }
      toast(`已加入「${f.name}」`);
      return [...ts, f];
    });
  };

  if (picking) {
    return (
      <div className="music-panel">
        <div className="music-pick-back">
          <button className="music-add-btn" onClick={() => setPicking(false)}>← 返回歌单</button>
          <span className="muted small">点文件即可加入歌单</span>
        </div>
        <FilesPanel onPick={onPickFile} pickedIds={new Set(tracks.map((t) => t.id))} />
        {ask && <CollisionModal prompt={ask.prompt} uploading={ask.preview}
          onDecide={(p) => ask.step(p)} onCancel={ask.cancel} />}
      </div>
    );
  }

  return (
    <div className="music-panel">
      <input ref={inputRef} type="file" accept="audio/*" multiple hidden
        onChange={(e) => { upload(e.target.files).then(refresh); }} />

      <div className="music-now">
        <div className="music-disc">{current ? '♪' : '♫'}</div>
        <div className="music-meta">
          <div className="music-title">{current ? current.name : '未在播放'}</div>
          <div className="music-sub muted small">
            {tracks.length} 首{curIdx >= 0 ? ` · ${curIdx + 1}/${tracks.length}` : ''}
          </div>
        </div>
      </div>

      <div className="music-progress">
        <span className="music-time small">{fmtTime(progress)}</span>
        <input type="range" min={0} max={duration || 0} step={0.1} value={progress}
          onChange={(e) => seek(Number(e.target.value))} className="music-range" />
        <span className="music-time small">{fmtTime(duration)}</span>
      </div>

      <div className="music-controls">
        <button className="music-btn" onClick={cycleLoop} title={LOOP_LABEL[loop]}>
          {loop === 'list' ? '🔁' : loop === 'one' ? '🔂' : '↪'}
        </button>
        <button className="music-btn" onClick={prev} disabled={tracks.length === 0}>⏮</button>
        <button className="music-btn music-btn-play" onClick={toggle} disabled={tracks.length === 0}>
          {playing ? '⏸' : '▶'}
        </button>
        <button className="music-btn" onClick={() => next(false)} disabled={tracks.length === 0}>⏭</button>
        <button className="music-btn music-speed" onClick={() => {
          const i = SPEEDS.indexOf(speed);
          setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
        }} title="倍速">{speed}×</button>
      </div>

      <audio
        ref={audioRef} src={url ?? undefined}
        onTimeUpdate={() => { if (audioRef.current) setProgress(audioRef.current.currentTime); }}
        onLoadedMetadata={() => { if (audioRef.current) setDuration(audioRef.current.duration); }}
        onEnded={() => next(true)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      <div className="music-add">
        <button className="music-add-btn primary" onClick={openPicker} disabled={busy}>
          {busy ? '上传中…' : '从本地添加'}
        </button>
        <button className="music-add-btn" onClick={() => setPicking(true)}>从文件库选</button>
      </div>

      <ul className="music-list">
        {tracks.length === 0 && <li className="muted small">还没有音频，从本地或文件库添加。</li>}
        {tracks.map((t, i) => (
          <li key={t.id} className={`music-row${current?.id === t.id ? ' on' : ''}`}>
            <span className="music-row-order">
              <button className="music-move" onClick={() => move(i, -1)} disabled={i === 0} title="上移">↑</button>
              <button className="music-move" onClick={() => move(i, 1)} disabled={i === tracks.length - 1} title="下移">↓</button>
            </span>
            <span className="music-row-idx">{current?.id === t.id ? (playing ? '♪' : '‖') : i + 1}</span>
            <span className="music-row-name" onClick={() => playAt(i)}>{t.name}</span>
            <span className="music-row-size muted small">{(t.size / 1024 / 1024).toFixed(1)}M</span>
            <button className="music-remove" onClick={() => {
              if (!confirm(`把「${t.name}」移出歌单？`)) return;
              if (current?.id === t.id) { setCurrent(null); setPlaying(false); }
              setTracks((ts) => ts.filter((x) => x.id !== t.id));
            }} title="移出歌单">✕</button>
          </li>
        ))}
      </ul>

      {ask && <CollisionModal prompt={ask.prompt} uploading={ask.preview}
        onDecide={(p) => ask.step(p)} onCancel={ask.cancel} />}
    </div>
  );
}
