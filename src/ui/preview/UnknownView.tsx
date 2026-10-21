// 认不出类型时的兜底：把选择权交给用户，而不是显示一句「无法预览」
import { useState } from 'react';
import { downloadFile, openInTab } from '../../core/repo/files';
import { extOf, openOptions, type OpenOption } from './kind';
import { useBlobUrl } from './useBlobUrl';

export function UnknownView({ id, name, mime }: { id: string; name: string; mime: string }) {
  const url = useBlobUrl(id);
  const [picked, setPicked] = useState<OpenOption | null>(null);

  const run = (o: OpenOption) => {
    if (!url) return;
    setPicked(o);
    if (o.how === 'download') downloadFile(url, name);
    else openInTab(url);
  };

  const ext = extOf(name);
  return (
    <div className="pv-unknown">
      <p className="muted">
        这个类型浏览器没法直接显示
        {ext ? `（.${ext}）` : ''}
        。请选择打开方式：
      </p>
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
      <p className="muted small">文件类型：{mime || '未知'}　·　文件名：{name}</p>
    </div>
  );
}
