// 认不出类型时的兜底：把选择权交给用户，而不是显示一句「无法预览」。
// 浏览器放不了内容时，用大字号把扩展名亮出来，用户一眼知道手里是什么文件。
import { useState } from 'react';
import { downloadFile, openInTab } from '../../core/repo/files';
import { extOf, openOptions, type OpenOption } from './kind';
import { useBlobUrl } from './useBlobUrl';

export function ExtFallback({
  id,
  name,
  mime,
  reason = '浏览器没法直接预览这个文件',
}: {
  id: string;
  name: string;
  mime: string;
  reason?: string;
}) {
  const url = useBlobUrl(id);
  const [picked, setPicked] = useState<OpenOption | null>(null);

  const run = (o: OpenOption) => {
    if (!url) return;
    setPicked(o);
    if (o.how === 'download') downloadFile(url, name);
    else openInTab(url);
  };

  const ext = extOf(name);
  // 没有扩展名时用 MIME 子类型顶一下（image/png → PNG），总比只写「文件」有用
  const sub = (mime.split(';')[0].split('/')[1] ?? '').replace(/^x-/, '').split('+')[0].trim();
  const label = ext ? ext.toUpperCase() : sub ? sub.toUpperCase() : '文件';
  return (
    <div className="pv-unknown">
      <div className="pv-ext-card">
        <span className="pv-ext" aria-hidden="true">
          {label}
        </span>
        <div className="pv-ext-info">
          <div className="pv-ext-name">{name}</div>
          <div className="muted small">
            {mime || '类型未知'}
            {ext ? ` · .${ext}` : ' · 无扩展名'}
          </div>
        </div>
      </div>
      <p className="muted">{reason}。请选择打开方式：</p>
      <div className="pv-unknown-actions">
        {openOptions(name, mime).map((o) => (
          <button key={o.key} className="btn btn-primary" onClick={() => run(o)} disabled={!url}>
            {o.label}
          </button>
        ))}
      </div>
      {picked?.how === 'download' && (
        <p className="muted small">
          已触发下载。如果手机上没有反应，可能是被浏览器拦了——改用「在新标签页打开」。
        </p>
      )}
    </div>
  );
}

/** 本来就是未知类型：没有任何内建视图可用 */
export function UnknownView({ id, name, mime }: { id: string; name: string; mime: string }) {
  return <ExtFallback id={id} name={name} mime={mime} reason="这个类型浏览器没法直接显示" />;
}
