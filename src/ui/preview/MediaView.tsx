// 图片 / 视频 / 音频三种「浏览器能直接放」的预览。
//   图片、视频：可缩放拖动（见 ZoomPan）
//   视频、音频：自绘播放条，支持拖进度与倍速（见 MediaTransport）
// 浏览器解不开内容（编码不支持、文件损坏、远端链接失效）时，退回显示扩展名。
import { useEffect, useRef, useState } from 'react';
import { useBlobUrl } from './useBlobUrl';
import { ZoomPan } from './ZoomPan';
import { MediaTransport } from './MediaTransport';
import { ExtFallback } from './UnknownView';

export function ImageView({ id, name, mime }: { id: string; name: string; mime: string }) {
  const url = useBlobUrl(id);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url) return <Loading />;
  if (failed) return <ExtFallback id={id} name={name} mime={mime} reason="这张图片浏览器打不开（格式或文件已损坏）" />;
  return (
    <div className="pv-viewer">
      <ZoomPan>
        <img src={url} alt={name} draggable={false} onError={() => setFailed(true)} />
      </ZoomPan>
    </div>
  );
}

export function VideoView({ id, name, mime }: { id: string; name: string; mime: string }) {
  const url = useBlobUrl(id);
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url) return <Loading />;
  if (failed) {
    return <ExtFallback id={id} name={name} mime={mime} reason="这个视频浏览器放不了（编码或容器不支持）" />;
  }
  return (
    <div className="pv-video">
      <ZoomPan>
        {/* 没有原生 controls：播放/进度/倍速统一走下面的自绘控制条 */}
        <video ref={ref} src={url} playsInline preload="metadata" aria-label={name} onError={() => setFailed(true)} />
      </ZoomPan>
      <MediaTransport media={ref} />
    </div>
  );
}

export function AudioView({ id, name, mime }: { id: string; name: string; mime: string }) {
  const url = useBlobUrl(id);
  const ref = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url) return <Loading />;
  if (failed) {
    return <ExtFallback id={id} name={name} mime={mime} reason="这段音频浏览器放不了（编码不支持）" />;
  }
  return (
    <div className="pv-audio">
      <div className="pv-audio-art">
        <div className="pv-audio-icon" aria-hidden="true">
          ♪
        </div>
        <div className="pv-audio-name">{name}</div>
      </div>
      <audio ref={ref} src={url} preload="metadata" aria-label={name} onError={() => setFailed(true)} />
      <MediaTransport media={ref} />
    </div>
  );
}

export function Loading() {
  return <div className="pv-loading muted">正在读取…</div>;
}
