// 纯文本预览：等宽字体、保留换行，超长内容截断避免卡死。
// 提供字号缩放（A− / A＋ / 复位），内容区域可正常滚动查看。
import { useEffect, useState } from 'react';
import { readText, useBlobUrl } from './useBlobUrl';
import { Loading } from './MediaView';
import { ExtFallback } from './UnknownView';

/** 一次最多渲染这么多字符；再多浏览器排版会明显卡 */
const MAX_CHARS = 200_000;

/** 字号档位，100% = 13px（和全局等宽字号一致） */
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const BASE_PX = 13;
const DEFAULT_ZOOM = 2; // index → 100%

export function TextView({ id, name, mime }: { id: string; name: string; mime: string }) {
  const url = useBlobUrl(id);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zi, setZi] = useState(DEFAULT_ZOOM);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    setText(null);
    setErr(null);
    void readText(url)
      .then((t) => {
        if (alive) setText(t);
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : '读取失败');
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (err) return <ExtFallback id={id} name={name} mime={mime} reason={`读不出内容：${err}`} />;
  if (text === null) return <Loading />;

  const truncated = text.length > MAX_CHARS;
  const zoom = ZOOMS[zi] ?? 1;

  return (
    <div className="pv-text">
      <div className="pv-text-bar">
        <div className="pv-text-zoom">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setZi((i) => Math.max(0, i - 1))}
            disabled={zi === 0}
            aria-label="缩小文字"
          >
            A−
          </button>
          <span className="pv-time">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setZi((i) => Math.min(ZOOMS.length - 1, i + 1))}
            disabled={zi === ZOOMS.length - 1}
            aria-label="放大文字"
          >
            A＋
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setZi(DEFAULT_ZOOM)}
            disabled={zi === DEFAULT_ZOOM}
          >
            复位
          </button>
        </div>
        <span className="muted small">可滚动查看</span>
      </div>

      <div className="pv-text-body">
        <pre style={{ fontSize: `${BASE_PX * zoom}px` }}>{truncated ? text.slice(0, MAX_CHARS) : text}</pre>
        {truncated && (
          <p className="muted small">文件较大，只显示了前 {MAX_CHARS.toLocaleString()} 个字符。</p>
        )}
      </div>
    </div>
  );
}
