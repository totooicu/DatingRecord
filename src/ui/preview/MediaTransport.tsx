// 音频 / 视频的播放控制条：进度拖动、前后 10 秒、播放暂停、倍速。
//
// 不用原生 controls：手机浏览器里没有倍速入口，进度条也被系统 UI 遮住。
// 原生控件只在桌面带上倍速菜单，行为不一致；自己画一条最省心。
import { useEffect, useRef, useState, type RefObject } from 'react';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function PlayIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M8 5.2l11 6.8-11 6.8z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M8.5 5.5v13M15.5 5.5v13" />
    </svg>
  );
}

function fmtTime(t: number): string {
  const total = Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function MediaTransport({ media }: { media: RefObject<HTMLMediaElement> }) {
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(true);
  const [rate, setRate] = useState(1);
  // 拖动进度条期间暂停 syncing，否则 timeupdate 会把滑块拽回去
  const scrubbing = useRef(false);

  useEffect(() => {
    const el = media.current;
    if (!el) return;

    const syncTime = () => {
      if (!scrubbing.current) setCur(el.currentTime || 0);
    };
    const syncDur = () => setDur(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onRate = () => setRate(el.playbackRate);

    el.addEventListener('timeupdate', syncTime);
    el.addEventListener('loadedmetadata', syncDur);
    el.addEventListener('durationchange', syncDur);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    el.addEventListener('ratechange', onRate);

    // 元素可能已经读到了元数据（缓存命中时 effect 晚于 loadedmetadata）
    syncDur();
    setPaused(el.paused);

    return () => {
      el.removeEventListener('timeupdate', syncTime);
      el.removeEventListener('loadedmetadata', syncDur);
      el.removeEventListener('durationchange', syncDur);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
      el.removeEventListener('ratechange', onRate);
    };
  }, [media]);

  const seek = (t: number) => {
    const el = media.current;
    if (!el) return;
    const max = Number.isFinite(el.duration) ? el.duration : 0;
    const v = Math.max(0, Math.min(max, t));
    el.currentTime = v;
    setCur(v);
  };

  const toggle = () => {
    const el = media.current;
    if (!el) return;
    if (el.paused) {
      // play() 可能被自动播放策略拒绝，静默失败即可（用户再点一次）
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const speed = (r: number) => {
    const el = media.current;
    if (!el) return;
    el.playbackRate = r;
    setRate(r);
  };

  return (
    <div className="pv-transport">
      <div className="pv-seek">
        <span className="pv-time">{fmtTime(cur)}</span>
        <input
          type="range"
          min={0}
          max={dur}
          step={0.1}
          value={Math.min(cur, dur)}
          aria-label="播放进度"
          onPointerDown={() => {
            scrubbing.current = true;
          }}
          onPointerUp={() => {
            scrubbing.current = false;
          }}
          onPointerCancel={() => {
            scrubbing.current = false;
          }}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="pv-time">{fmtTime(dur)}</span>
      </div>
      <div className="pv-controls">
        <button type="button" className="btn btn-sm" onClick={() => seek((media.current?.currentTime ?? 0) - 10)}>
          −10s
        </button>
        <button
          type="button"
          className="btn btn-sm pv-play"
          onClick={toggle}
          aria-label={paused ? '播放' : '暂停'}
          title={paused ? '播放' : '暂停'}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => seek((media.current?.currentTime ?? 0) + 10)}>
          +10s
        </button>
        <span className="pv-rate" aria-label="播放倍速">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              className={Math.abs(rate - r) < 0.01 ? 'on' : ''}
              onClick={() => speed(r)}
            >
              {r}×
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
