import { useEffect, useMemo, useState } from 'react';
import { extractFileRefs } from '../../core/markdown';
import { urlForFile } from '../../core/repo/files';

/**
 * 把正文里引用的 file:<id> 换成可用的 objectURL。
 *
 * 加载是异步的（IndexedDB 读 + createObjectURL），所以先返回空 map，
 * 渲染出的图片会显示「附件已删除」占位——等 URL 到位再重渲染一次。
 */
export function useFileUrls(source: string): Record<string, string> {
  const key = useMemo(() => extractFileRefs(source).join(','), [source]);
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!key) {
      setMap({});
      return;
    }
    let alive = true;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        key.split(',').map(async (id) => {
          const url = await urlForFile(id);
          if (url) next[id] = url;
        }),
      );
      if (alive) setMap(next);
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  return map;
}
