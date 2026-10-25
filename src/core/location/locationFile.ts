// 定位文件的读写（文件库里的 .drloc 附件）。
//
// 和歌单 .drpl 同一套路：定位记录不单独建表，就是文件库里的一条附件。
// 备份 / 同步 / 隐私 / 类型筛选 / 分享全部自动覆盖，运行时只需记住当前文件 id。
//
// 约定：
//   · 新建时按内容算 stored_id（普通附件一致），重名由 pickStoredId 顺延；
//   · 编辑走 overwriteFileContent（id / stored_id 不变）；
//   · 文件名是唯一显示名，正文里的 name 会被文件名的词法覆盖。

import {
  deleteFile,
  getFile,
  insertFileRaw,
  listFiles,
  nameSlots,
  overwriteFileContent,
  type StoredFile,
} from '../repo/files';
import { getBlob } from '../db/blob';
import { hashStem, pickStoredId, sha256Text, stemOf } from '../files/naming';
import {
  LOCATION_FILE_EXT,
  LOCATION_FORMAT,
  LOCATION_MIME,
  LOCATION_VERSION,
  cleanLocationName,
  emptyLocationDoc,
  isLocationFile,
  locationBlob,
  locationFileName,
  locationNameOf,
  parseLocationDoc,
  parseLocationText,
  serializeLocationDoc,
  uniqueLocationName,
  type LocationDoc,
  type LocationOffset,
  type LocationPoint,
} from './format';

const ACTIVE_KEY = 'dr.locationFileId';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// ---------------- 当前文件 ----------------

export function getActiveLocationId(): string | null {
  try {
    return storage()?.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}

export function setActiveLocationId(id: string | null): void {
  try {
    const s = storage();
    if (!s) return;
    if (id) s.setItem(ACTIVE_KEY, id);
    else s.removeItem(ACTIVE_KEY);
  } catch {
    /* 隐私模式写不进就算了 */
  }
}

// ---------------- 查询 ----------------

/** 文件库里的全部定位文件，新上传的在前 */
export function listLocations(): StoredFile[] {
  return listFiles().filter(isLocationFile);
}

export function getLocationFile(id: string): StoredFile | null {
  const f = getFile(id);
  return f && isLocationFile(f) ? f : null;
}

export function locationDisplayName(f: StoredFile): string {
  return locationNameOf(f);
}

/** 读定位正文；文件不存在 / 内容坏了都抛人话错误 */
export async function readLocation(fileOrId: StoredFile | string): Promise<LocationDoc> {
  const f = typeof fileOrId === 'string' ? getLocationFile(fileOrId) : fileOrId;
  if (!f) throw new Error('定位文件不存在（可能已被删除）');
  const blob = await getBlob(f.id);
  if (!blob) throw new Error(`定位文件「${locationNameOf(f)}」的内容丢失了（可能还没同步到本机）`);
  const doc = parseLocationDoc(await blob.text(), locationNameOf(f));
  // 文件名是用户可见的唯一名字：在文件库里改名后，正文里的旧名字不该抢回去
  doc.name = locationNameOf(f);
  return doc;
}

// ---------------- 写入 ----------------

async function insertLocationFile(doc: LocationDoc): Promise<StoredFile> {
  const text = serializeLocationDoc(doc);
  const blob = new Blob([text], { type: LOCATION_MIME });
  const sha = await sha256Text(text);
  const stem = sha ? hashStem(sha) : `loc-${Date.now().toString(36)}`;
  const storedId = pickStoredId(stem, LOCATION_FILE_EXT, nameSlots());
  const name = uniqueLocationName(doc.name, listFiles());
  return insertFileRaw({
    file: blob,
    name: locationFileName(name),
    storedId,
    sha256: sha,
  });
}

export interface CreateLocationInput {
  name: string;
  offset?: Partial<LocationOffset>;
  points?: LocationPoint[];
  /** 已解析好的正文（导入 / 工具用）；给了就不再从 name/offset/points 重建 */
  doc?: LocationDoc;
}

/** 新建定位文件；返回落库后的附件（名字可能因重名顺延） */
export async function createLocation(input: CreateLocationInput): Promise<StoredFile> {
  const base = input.doc ?? emptyLocationDoc(input.name, input.offset);
  const doc: LocationDoc = {
    ...base,
    format: LOCATION_FORMAT,
    version: LOCATION_VERSION,
    name: cleanLocationName(base.name || input.name),
    points: (input.points ?? base.points ?? []).slice(),
  };
  return insertLocationFile(doc);
}

/** 导入一段 .drloc JSON 或旧版 CSV，统一落成 .drloc */
export async function importLocationText(text: string, sourceName = '导入的定位记录'): Promise<StoredFile> {
  const fallback = sourceName.toLowerCase().endsWith(LOCATION_FILE_EXT)
    ? sourceName.slice(0, -LOCATION_FILE_EXT.length)
    : stemOf(sourceName) || sourceName;
  const doc = parseLocationText(text, fallback || '导入的定位记录');
  doc.name = cleanLocationName(fallback || doc.name);
  return insertLocationFile(doc);
}

/**
 * 覆盖保存。updatedAt 由这里统一刷新；文件名不动（改名走文件库）。
 */
export async function writeLocation(id: string, doc: LocationDoc): Promise<StoredFile> {
  const f = getLocationFile(id);
  if (!f) throw new Error('定位文件不存在（可能已被删除）');
  const next: LocationDoc = {
    ...doc,
    format: LOCATION_FORMAT,
    version: LOCATION_VERSION,
    name: locationNameOf(f),
    updatedAt: new Date().toISOString(),
  };
  await overwriteFileContent(id, locationBlob(next));
  return getFile(id)!;
}

export async function deleteLocation(id: string): Promise<void> {
  const f = getLocationFile(id);
  if (!f) throw new Error('定位文件不存在（可能已被删除）');
  await deleteFile(id);
}
