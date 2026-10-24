// 功能面板 · 背景音乐歌单。
//
// 音频文件走现有文件库（listFiles / uploadFile / getBlob），歌单就是「文件库里
// mime 以 audio/ 开头的文件」按加入顺序排。播放控制用一个 <audio> 元素：
//   - 播放 / 暂停
//   - 上一首 / 下一首（随机模式下随机挑一首）
//   - 循环模式：列表循环 → 单曲循环 → 不循环（播完停下）

import { useEffect, useMemo, useRef, useState } from 'react';
import { listFiles, type StoredFile } from '../../core/repo/files';
import { uploadFile } from '../../core/files/upload';
import { objectUrlFor, forgetUrl } from '../../core/db/blob';

type LoopMode = 'list' | 'one' | 'off';

const LOOP_LABEL: Record<LoopMode, string> = {
  list: '列表循环',
  one: '单曲循环',
  off: '不循环',
};

function isAudio(f: StoredFile): boolean {
  return f.mime.startsWith('audio/');
}

export function MusicPanel() {
  const [tracks, setTracks] = useState<StoredFile[]>(() => listFiles().filter(isAudio));
  const [current, setCurrent] = useState<StoredFile | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState<LoopMode>('list');
  const [url, setUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 切歌时拿 object URL，旧 URL 释放
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!current) {
        setUrl(null);
        return;
      }
      const u = await objectUrlFor(current.id);
      if (!alive) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      setUrl((old) => {
        if (old) forgetUrl(current.id);
        return u;
      });
    })();
    return () => {
      alive = false;
    };
  }, [current]);

  // URL 就绪后自动播放
  useEffect(() => {
    if (url && audioRef.current) {
      audioRef.current.play().catch(() => setPlaying(false));
    }
  }, [url]);

  const refresh = () => setTracks(listFiles().filter(isAudio));

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      await uploadFile(f, { smallLimit: 5 * 1024 * 1024 });
    }
    refresh();
  };

  const playAt = (i: number) => {
    const t = tracks[i];
    if (!t) return;
    setCurrent(t);
    setPlaying(true);
  };

  const next = (auto = false) => {
    if (tracks.length === 0) return;
    if (loop === 'off' && auto && current) {
      setPlaying(false);
      return;
    }
    if (loop === 'one' && auto) {
      if (audioRef.current) audioRef.current.currentTime = 0;
      audioRef.current?.play().catch(() => {});
      return;
    }
    let i = current ? tracks.findIndex((t) => t.id === current.id) : -1;
    if (loop === 'list') {
      i = (i + 1) % tracks.length;
    } else if (loop === 'off') {
      i = i + 1;
      if (i >= tracks.length) {
        setPlaying(false);
        return;
      }
    } else {
      // list 循环里也可以随机跳，这里保留顺序
      i = (i + 1) % tracks.length;
    }
    playAt(i);
  };

  const prev = () => {
    if (tracks.length === 0) return;
    const i = current ? tracks.findIndex((t) => t.id === current.id) : 0;
    playAt((i - 1 + tracks.length) % tracks.length);
  };

  const toggle = () => {
    if (!current) {
      if (tracks.length > 0) playAt(0);
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().catch(() => {});
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const cycleLoop = () => {
    setLoop((m) => (m === 'list' ? 'one' : m === 'one' ? 'off' : 'list'));
  };

  const curIdx = useMemo(
    () => (current ? tracks.findIndex((t) => t.id === current.id) : -1),
    [current, tracks],
  );

  return (
    <div className="music-panel">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => pickFiles(e.target.files)}
      />

      <div className="music-now">
        <div className="music-title">{current ? current.name : '未在播放'}</div>
        <div className="music-sub muted small">
          {tracks.length} 首{current ? ` · 第 ${curIdx + 1}/${tracks.length} 首` : ''}
        </div>

        <div className="music-controls">
          <button onClick={prev} title="上一首" disabled={tracks.length === 0}>⏮</button>
          <button onClick={toggle} title={playing ? '暂停' : '播放'} disabled={tracks.length === 0}>
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={() => next(false)} title="下一首" disabled={tracks.length === 0}>⏭</button>
          <button onClick={cycleLoop} title={LOOP_LABEL[loop]}>
            {loop === 'list' ? '🔁' : loop === 'one' ? '🔂' : '▶️'}
            <span className="music-loop-label small">{LOOP_LABEL[loop]}</span>
          </button>
        </div>

        <audio
          ref={audioRef}
          src={url ?? undefined}
          onEnded={() => next(true)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      </div>

      <div className="music-actions">
        <button className="primary" onClick={() => fileInputRef.current?.click()}>添加音频文件</button>
      </div>

      <ul className="music-list">
        {tracks.length === 0 && <li className="muted small">还没有音频文件，点上面「添加音频文件」从本地选。</li>}
        {tracks.map((t, i) => (
          <li
            key={t.id}
            className={`music-row${current?.id === t.id ? ' on' : ''}`}
            onClick={() => playAt(i)}
          >
            <span className="music-row-idx">{current?.id === t.id ? (playing ? '♪' : '‖') : i + 1}</span>
            <span className="music-row-name">{t.name}</span>
            <span className="music-row-size muted small">{(t.size / 1024 / 1024).toFixed(1)} MB</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
