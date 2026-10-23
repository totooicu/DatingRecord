// CLI 侧的附件二进制存储：落盘到 <库名>.blobs/ 目录。
//
// 浏览器里二进制在 IndexedDB，CLI 里没有 IndexedDB，就一个文件一个 blob。
// mime 单独存一个同名 .json 边车文件——Blob 本身不带类型，
// 而取回来渲染时（objectURL / base64 dataURL）需要类型。

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BlobStore } from '../core/db/blob';

export function dirOf(dbPath: string): string {
  return path.join(path.dirname(dbPath), `${path.basename(dbPath)}.blobs`);
}

export function fileBlobStore(dbPath: string): BlobStore {
  const dir = dirOf(dbPath);
  const fileOf = (id: string) => path.join(dir, id);
  const metaOf = (id: string) => path.join(dir, `${id}.json`);

  return {
    async get(id) {
      const p = fileOf(id);
      if (!fs.existsSync(p)) return null;
      let type = 'application/octet-stream';
      try {
        type = (JSON.parse(fs.readFileSync(metaOf(id), 'utf8')) as { type?: string }).type ?? type;
      } catch {
        /* 没有边车就用默认类型 */
      }
      return new Blob([new Uint8Array(fs.readFileSync(p))], { type });
    },
    async put(id, blob) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fileOf(id), new Uint8Array(await blob.arrayBuffer()));
      fs.writeFileSync(metaOf(id), JSON.stringify({ type: blob.type || 'application/octet-stream' }));
    },
    async del(id) {
      for (const p of [fileOf(id), metaOf(id)]) if (fs.existsSync(p)) fs.unlinkSync(p);
    },
    async clear() {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    },
  };
}
