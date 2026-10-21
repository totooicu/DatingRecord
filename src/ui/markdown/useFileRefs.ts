import { useEffect, useMemo, useState } from 'react';
import { extractFileRefs } from '../../core/markdown';
import { fileNames, resolveFileIds, urlForFile } from '../../core/repo/files';

export interface FileRefMaps {
  /** 引用名（stored_id 或老 id）→ objectURL */
  urls: Record<string, string>;
  /** 引用名 → 当前显示名 */
  names: Record<string, string>;
}

const EMPTY: FileRefMaps = { urls: {}, names: {} };

/**
 * 把正文里引用的 file:<id> 解析成渲染需要的东西。
 *
 * key 有两种：内容寻址后的 hash 名，以及老数据里的随机 id。这里先做一次
 * 「key → 文件 id」的解析（resolveFileIds 内部两级回退），取名字和 URL 都用
 * 真实 id；最后再把结果翻回 key 键，因为渲染层是按正文里写的 key 查表的。
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
      const keys = key.split(',');
      const keyToId = resolveFileIds(keys);
      const ids = Object.values(keyToId);
      const urls: Record<string, string> = {};
      await Promise.all(
        ids.map(async (id) => {
          const u = await urlForFile(id);
          if (u) urls[id] = u;
        }),
      );
      const names = fileNames(ids);
      const byKey: FileRefMaps = { urls: {}, names: {} };
      for (const k of keys) {
        const id = keyToId[k];
        if (!id) continue;
        if (urls[id]) byKey.urls[k] = urls[id];
        if (names[id]) byKey.names[k] = names[id];
      }
      if (alive) setMaps(byKey);
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  return maps;
}
