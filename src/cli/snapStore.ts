// CLI 侧的快照存储：整库二进制落盘。
//
// 为什么不能把快照也塞进 SQLite 文件：备份和原件锁在同一个保险柜里，
// 库里出了事（误删表、迁移写坏）快照跟着一起没。所以快照单独放
// <库名>.snapshots/ 目录，一个快照一个 .snap 文件。

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SnapBytes } from '../core/snapshots/store';

export function dirOf(dbPath: string): string {
  return path.join(path.dirname(dbPath), `${path.basename(dbPath)}.snapshots`);
}

export function fileSnapStore(dbPath: string): SnapBytes {
  const dir = dirOf(dbPath);
  const ensure = () => fs.mkdirSync(dir, { recursive: true });
  return {
    async get(id) {
      const p = path.join(dir, `${id}.snap`);
      if (!fs.existsSync(p)) return null;
      return new Uint8Array(fs.readFileSync(p));
    },
    async put(id, bytes) {
      ensure();
      const p = path.join(dir, `${id}.snap`);
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, p); // 先写临时文件再改名：中途断电不会留下半个快照
    },
    async del(id) {
      const p = path.join(dir, `${id}.snap`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    },
  };
}
