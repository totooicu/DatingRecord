// Markdown 文件预览：读文本 → 走正文同一套渲染（含附件引用解析）
import { useEffect, useState } from 'react';
import { MarkdownView } from '../markdown';
import { readText, useBlobUrl } from './useBlobUrl';
import { Loading } from './MediaView';
import { ExtFallback } from './UnknownView';

export function MarkdownPreview({ id, name, mime }: { id: string; name: string; mime: string }) {
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

  if (err) return <ExtFallback id={id} name={name} mime={mime} reason={`读不出内容：${err}`} />;
  if (text === null) return <Loading />;
  if (!text.trim()) return <div className="pv-loading muted">这个文件是空的</div>;
  return (
    <div className="pv-markdown">
      <MarkdownView source={text} />
    </div>
  );
}
