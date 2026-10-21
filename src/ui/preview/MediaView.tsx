// 图片 / 视频 / 音频三种「浏览器能直接放」的预览。
//   图片、视频：可缩放拖动（见 ZoomPan）
//   视频、音频：自绘播放条，支持拖进度与倍速（见 MediaTransport）
import { useRef } from 'react';
import { useBlobUrl } from './useBlobUrl';
import { ZoomPan } from './ZoomPan';
import { MediaTransport } from './MediaTransport';

export function ImageView({ id, name }: { id: string; name: string }) {
  const url = useBlobUrl(id);
  if (!url) return <Loading />;
  return (
    <div className="pv-viewer">
      <ZoomPan>
        <img src={url} alt={name} draggable={false} />
      </ZoomPan>
    </div>
  );
}

export function VideoView({ id, name }: { id: string; name: string }) {
  const url = useBlobUrl(id);
  const ref = useRef<HTMLVideoElement>(null);
  if (!url) return <Loading />;
  return (
    <div className="pv-video">
      <ZoomPan>
        {/* 没有原生 controls：播放/进度/倍速统一走下面的自绘控制条 */}
        <video ref={ref} src={url} playsInline preload="metadata" aria-label={name} />
      </ZoomPan>
      <MediaTransport media={ref} />
    </div>
  );
}

export function AudioView({ id, name }: { id: string; name: string }) {
  const url = useBlobUrl(id);
  const ref = useRef<HTMLAudioElement>(null);
  if (!url) return <Loading />;
  return (
    <div className="pv-audio">
      <div className="pv-audio-art">
        <div className="pv-audio-icon" aria-hidden="true">
          ♪
        </div>
        <div className="pv-audio-name">{name}</div>
      </div>
      <audio ref={ref} src={url} preload="metadata" aria-label={name} />
      <MediaTransport media={ref} />
    </div>
  );
}

export function Loading() {
  return <div className="pv-loading muted">正在读取…</div>;
}
