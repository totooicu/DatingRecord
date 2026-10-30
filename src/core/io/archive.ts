// .drp.zip 归档（F-I01）：
//
//   library.json        结构化数据（含 schemaVersion；附件只留元数据，不含 base64）
//   attachments/<名字>  附件原文件二进制（按内容寻址的 storedId 命名）
//   manifest.json       格式版本、导出时间、附件清单（id → 包内路径）
//
// 为什么不再把所有东西塞进一个 .drp.json：附件 base64 会让体积凭空 +33%，
// 再加上 2 空格缩进和 JSON 结构本身，几百张照片就能顶到几百 MB；
// 打包成 zip 后二进制原样存放、JSON 文本也能压掉大半，传网盘/同步快得多。
// 旧的 .drp.json 仍然可以导入（向后兼容）。

import { strFromU8, strToU8, unzip, zip } from 'fflate';
import { getBlob, blobToBase64 } from '../db/blob';
import type { Attachment, LibraryFile } from '../types';
import { buildLibrary } from './export';
import type { ImportResult } from './import';
import { saveBytes } from './save';

export const ARCHIVE_FORMAT = 'drp/1';

interface ManifestAttachment {
  id: string;
  path: string;
  name: string;
  mime: string;
  size: number;
  sha256?: string;
}

interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  app: string;
  library: { id: string; name: string };
  attachments: ManifestAttachment[];
}

/** IndexedDB 里附件按 id 存；包内文件名优先用内容寻址的 storedId，缺失时退回 id */
function archivePathOf(a: Attachment): string {
  const name = (a.storedId || a.id).replace(/[^\w.-]+/g, '_');
  return `attachments/${name}`;
}

/**
 * 生成 zip 字节。
 * JSON 用高压缩级；图片/视频本身已压缩，用 store（level 0）省 CPU 也不亏。
 */
export async function buildArchive(opts: { includeAttachments?: boolean } = {}): Promise<Uint8Array> {
  const withAtt = opts.includeAttachments !== false;
  const lib = await buildLibrary({ includeAttachments: withAtt ? 'meta' : false });

  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const manifestAttachments: ManifestAttachment[] = [];

  if (withAtt) {
    for (const a of lib.attachments ?? []) {
      const blob = await getBlob(a.id);
      if (!blob) continue; // 元数据在、二进制丢了（历史脏数据）：导出时跳过，不阻断整体备份
      const path = archivePathOf(a);
      files[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
      manifestAttachments.push({
        id: a.id,
        path,
        name: a.name,
        mime: a.mime,
        size: a.size,
        sha256: a.sha256 || undefined,
      });
    }
  }

  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    schemaVersion: lib.schemaVersion,
    exportedAt: lib.meta.exportedAt,
    app: lib.meta.app,
    library: { id: lib.meta.id, name: lib.meta.name },
    attachments: manifestAttachments,
  };

  files['library.json'] = [strToU8(JSON.stringify(lib)), { level: 6 }];
  files['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];

  return new Promise<Uint8Array>((resolve, reject) => {
    zip(files, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

/** TS 5.7 起 Uint8Array 的缓冲区泛型可能是 SharedArrayBuffer，BlobPart 只收 ArrayBuffer；拷一份最稳 */
function toBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

export async function exportArchiveToFile(opts: { includeAttachments?: boolean } = {}): Promise<string> {
  const bytes = await buildArchive(opts);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const name = `dating-record-${stamp}.drp.zip`;
  // 走 saveBytes：壳里存进手机「下载」，浏览器里弹下载（原来的 <a download> 在壳里毫无反应）
  await saveBytes(bytes, name, 'application/zip');
  return name;
}

/** zip 魔数：PK\x03\x04 */
export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * 解包 .drp.zip → 等价的 library JSON 文本。
 *
 * 把附件二进制重新转成 base64 填回 `attachments[].data`，
 * 这样后续合并/替换逻辑完全复用 importLibrary 那一套，不用分叉。
 */
export async function libraryTextFromArchive(bytes: Uint8Array): Promise<string> {
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (err, data) => (err ? reject(err) : resolve(data)));
  });

  const libBytes = entries['library.json'];
  if (!libBytes) throw new Error('压缩包里没有 library.json，不是有效的 .drp.zip');

  const lib = JSON.parse(strFromU8(libBytes)) as LibraryFile;
  if (!lib || typeof lib !== 'object' || !Array.isArray(lib.persons)) {
    throw new Error('压缩包里的 library.json 格式不正确');
  }

  // manifest 只是加速/兜底：路径对不上时按默认命名规则再找一次
  let manifest: ArchiveManifest | null = null;
  const manBytes = entries['manifest.json'];
  if (manBytes) {
    try {
      manifest = JSON.parse(strFromU8(manBytes)) as ArchiveManifest;
    } catch {
      manifest = null;
    }
  }
  const pathById = new Map((manifest?.attachments ?? []).map((m) => [m.id, m.path]));

  for (const a of lib.attachments ?? []) {
    if (a.data) continue; // 兼容旧包里内联的 base64
    const path = pathById.get(a.id) ?? archivePathOf(a);
    const bin = entries[path];
    if (!bin) continue;
    a.data = await blobToBase64(toBlob(bin, a.mime || 'application/octet-stream'));
  }

  return JSON.stringify(lib);
}

/** 从用户选的文件导入：自动识别 .drp.zip 与旧的 .drp.json */
export async function importFromFile(
  file: File,
  mode: 'merge' | 'replace',
): Promise<ImportResult> {
  const { importLibrary } = await import('./import');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = isZipBytes(bytes) ? await libraryTextFromArchive(bytes) : strFromU8(bytes);
  return importLibrary(text, mode);
}
