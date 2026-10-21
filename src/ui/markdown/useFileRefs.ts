import { useEffect, useMemo, useState } from 'react';
import { extractFileRefs } from '../../core/markdown';
import { fileNames, urlForFile } from '../../core/repo/files';

export interface FileRefMaps {
  /** fileId → objectURL */
  urls: Record<string, string>;
  /** fileId → 当前文件名 */
  names: Record<string, string>;
}

const EMPTY: FileRefMaps = { urls: {}, names: {} };

/**
 * 把正文里引用的 file:<id> 解析成渲染需要的东西。
 *
 * 两样都异步：URL 要读 IndexedDB + createObjectURL，名字要查库。
 * 加载完成前返回空 map，渲染出的图片会显示「附件已删除」占位——
 * 等数据到位再重渲染一次，不会先闪一个错再变对。
 */
export function useFileRefs(source: string): FileRefMaps {
  const key = useMemo(() => extractFileRefs(source).join(','), [source]);
  const [maps, setMaps] = useState<FileRefMaps>(EMPTY);

  useEffect(() => {
    if (!key) {
      setMaps(EMPTY);
      return;
    }
    let alive = true;
    void (async () => {
      const ids = key.split(',');
      const urls: Record<string, string> = {};
      await Promise.all(
        ids.map(async (id) => {
          const u = await urlForFile(id);
          if (u) urls[id] = u;
        }),
      );
      if (alive) setMaps({ urls, names: fileNames(ids) });
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  return maps;
}
