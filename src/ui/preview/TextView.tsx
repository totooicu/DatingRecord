// 纯文本预览：等宽字体、保留换行，超长内容截断避免卡死
import { useEffect, useState } from 'react';
import { readText, useBlobUrl } from './useBlobUrl';
import { Loading } from './MediaView';

/** 一次最多渲染这么多字符；再多浏览器排版会明显卡 */
const MAX_CHARS = 200_000;

export function TextView({ id }: { id: string }) {
  const url = useBlobUrl(id);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  if (err) return <div className="pv-error">读不出内容：{err}</div>;
  if (text === null) return <Loading />;

  const truncated = text.length > MAX_CHARS;
  return (
    <div className="pv-text">
      <pre>{truncated ? text.slice(0, MAX_CHARS) : text}</pre>
      {truncated && <p className="muted small">文件较大，只显示了前 {MAX_CHARS.toLocaleString()} 个字符。</p>}
    </div>
  );
}
