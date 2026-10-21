// 图片缩略图：给文件列表拿到可放进 <img src> 的 objectURL。
//
// 只对 image/* 取，其他类型返回空，让 FileRow 退回显示类型首字——
// 给一个 200MB 的视频建 objectURL 毫无意义，还容易把内存拖爆。
import { useEffect, useState } from 'react';
import { urlForFile, type StoredFile } from '../../core/repo/files';

export function useThumbs(files: StoredFile[]): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  // 只跟着 id 集合变化重跑，筛选/排序不影响
  const key = files.map((f) => f.id).join(',');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        files
          .filter((f) => f.mime.startsWith('image/'))
          .map(async (f) => {
            const u = await urlForFile(f.id);
            if (u) next[f.id] = u;
          }),
      );
      if (alive) setThumbs(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return thumbs;
}
