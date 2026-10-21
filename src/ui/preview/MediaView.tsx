// 图片 / 视频 / 音频三种「浏览器能直接放」的预览
import { useBlobUrl } from './useBlobUrl';

export function ImageView({ id, name }: { id: string; name: string }) {
  const url = useBlobUrl(id);
  if (!url) return <Loading />;
  return (
    <div className="pv-media pv-image">
      <img src={url} alt={name} />
    </div>
  );
}

export function VideoView({ id, name }: { id: string; name: string }) {
  const url = useBlobUrl(id);
  if (!url) return <Loading />;
  return (
    <div className="pv-media">
      {/* controls 必须有：手机上没有它就没法播放 */}
      <video src={url} controls playsInline preload="metadata" aria-label={name} />
    </div>
  );
}

export function AudioView({ id, name }: { id: string; name: string }) {
  const url = useBlobUrl(id);
  if (!url) return <Loading />;
  return (
    <div className="pv-audio">
      <div className="pv-audio-icon">♪</div>
      <audio src={url} controls preload="metadata" aria-label={name} />
    </div>
  );
}

export function Loading() {
  return <div className="pv-loading muted">正在读取…</div>;
}
