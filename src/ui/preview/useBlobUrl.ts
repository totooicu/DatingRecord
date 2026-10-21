import { useEffect, useState } from 'react';
import { urlForFile } from '../../core/repo/files';

/**
 * 文件的 objectURL。
 *
 * 不用 useFileRefs：那个是给正文批量解析引用用的，这里只要一个。
 * URL 由 core/db/blob 的缓存统一持有，组件卸载时**不能** revoke——
 * 正文里可能还有别处在用同一个文件，撤销了会把别人的图弄成裂图。
 */
export function useBlobUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }
    let alive = true;
    void urlForFile(id).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  return url;
}

/** 读文本内容：优先按 UTF-8 解，失败就退回 Blob（调用方自己兜底提示） */
export async function readText(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}
