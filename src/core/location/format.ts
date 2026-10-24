// 定位数据（.drloc）的格式与纯计算。
//
// 定位记录不是数据库对象，就是文件库里的一条普通附件——这样备份、同步、分享、
// 文件筛选、隐私都能复用同一套机制。旧版直接把点写成 CSV，和人手建的表格混在
// 一起、筛选不出来；现在换成独一份的 .drloc（JSON）。
//
// 偏移值（offset）是「这个文件坐标系相对地图的修正量」，单位是度：
//   显示坐标 = 原始坐标 + offset。
// 原始点保持不变，改偏移就能整体平移，方便修正导入数据或底图偏差。

export const LOCATION_EXT = 'drloc';
export const LOCATION_FILE_EXT = '.drloc';
export const LOCATION_MIME = 'application/x-dr-location';
export const LOCATION_FORMAT = 'dr.location';
export const LOCATION_VERSION = 1;

export interface LocationPoint {
  /** ISO 时间；旧 CSV 导入的可能是本地日期串，展示时交给 Date 解析 */
  ts: string;
  lat: number;
  lng: number;
  /** 定位精度（米），0 = 未知 */
  accuracy: number;
  note: string;
}

export interface LocationOffset {
  /** 纬度偏移（度）：正值向北 */
  lat: number;
  /** 经度偏移（度）：正值向东 */
  lng: number;
}

export interface LocationDoc {
  format: string;
  version: number;
  name: string;
  offset: LocationOffset;
  points: LocationPoint[];
  createdAt: string;
  updatedAt: string;
}

export function isLocationFile(f: { name: string; mime?: string }): boolean {
  return (f.mime || '').toLowerCase() === LOCATION_MIME || (f.name || '').toLowerCase().endsWith(LOCATION_FILE_EXT);
}

export function isLocationMime(mime: string): boolean {
  return (mime || '').toLowerCase() === LOCATION_MIME;
}

/** 文件名去掉 .drloc 后的显示名 */
export function locationNameOf(f: { name: string }): string {
  const name = f.name || '';
  return name.toLowerCase().endsWith(LOCATION_FILE_EXT) ? name.slice(0, -LOCATION_FILE_EXT.length) : name;
}

/** 清洗用户输入的定位文件名：去后缀、压空白、限长 */
export function cleanLocationName(name: string): string {
  const raw = (name || '').trim().replace(/\.drloc$/i, '');
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return (oneLine || '定位记录').slice(0, 60);
}

export function locationFileName(name: string): string {
  return `${cleanLocationName(name)}${LOCATION_FILE_EXT}`;
}

/** 同名的 .drloc 已存在时顺延成「名字 (2)」 */
export function uniqueLocationName(name: string, files: { name: string }[]): string {
  const base = cleanLocationName(name);
  const used = new Set(
    files
      .filter((f) => (f.name || '').toLowerCase().endsWith(LOCATION_FILE_EXT))
      .map((f) => locationNameOf(f).toLowerCase()),
  );
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} (${i})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now().toString(36)})`;
}

export function emptyLocationDoc(name: string, offset?: Partial<LocationOffset>): LocationDoc {
  const now = new Date().toISOString();
  return {
    format: LOCATION_FORMAT,
    version: LOCATION_VERSION,
    name: cleanLocationName(name),
    offset: cleanOffset(offset),
    points: [],
    createdAt: now,
    updatedAt: now,
  };
}

function cleanOffset(raw: unknown): LocationOffset {
  const o = (raw ?? {}) as { lat?: unknown; lng?: unknown };
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  return {
    lat: Number.isFinite(lat) ? round6(lat) : 0,
    lng: Number.isFinite(lng) ? round6(lng) : 0,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function cleanPoint(raw: unknown): LocationPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const acc = Number(p.accuracy);
  return {
    ts: typeof p.ts === 'string' ? p.ts : String(p.ts ?? ''),
    lat,
    lng,
    accuracy: Number.isFinite(acc) && acc > 0 ? acc : 0,
    note: typeof p.note === 'string' ? p.note : String(p.note ?? ''),
  };
}

/** 解析 .drloc 正文；坏 JSON / 不是这个格式都抛出人话错误 */
export function parseLocationDoc(text: string, fallbackName = '定位记录'): LocationDoc {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('不是有效的定位文件（.drloc 应为 JSON）');
  }
  if (!raw || typeof raw !== 'object') throw new Error('定位文件内容为空');
  if (raw.format && raw.format !== LOCATION_FORMAT) {
    throw new Error(`不是定位文件（format=${String(raw.format)}）`);
  }
  const points = Array.isArray(raw.points)
    ? raw.points.map(cleanPoint).filter((p: LocationPoint | null): p is LocationPoint => !!p)
    : [];
  const now = new Date().toISOString();
  return {
    format: LOCATION_FORMAT,
    version: LOCATION_VERSION,
    name: cleanLocationName(String(raw.name || fallbackName)),
    offset: cleanOffset(raw.offset),
    points,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

/** 旧版 CSV → 点数组。有表头就跳过，没有也照样读 */
export function parseLegacyCsv(text: string): LocationPoint[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const out: LocationPoint[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const parts = splitCsvLine(lines[i]);
    if (parts.length < 3) continue;
    const lat = Number(parts[1]);
    const lng = Number(parts[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue; // 表头落到这里
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    out.push({
      ts: parts[0],
      lat,
      lng,
      accuracy: Number(parts[3]) || 0,
      note: parts[4] || '',
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  return (
    line
      .match(/("([^"]|"")*"|[^,]*)(,|$)/g)
      ?.map((p) => p.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()) ?? []
  );
}

/** 一段文本可能是 .drloc，也可能是旧 CSV：先按 JSON 试，失败再按 CSV */
export function parseLocationText(text: string, fallbackName = '导入的定位记录'): LocationDoc {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const doc = parseLocationDoc(trimmed, fallbackName);
    doc.points = doc.points.sort(byTime);
    return doc;
  }
  const doc = emptyLocationDoc(fallbackName);
  doc.points = parseLegacyCsv(text).sort(byTime);
  return doc;
}

function byTime(a: LocationPoint, b: LocationPoint): number {
  const ta = Date.parse(a.ts);
  const tb = Date.parse(b.ts);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return ta - tb;
}

/** 显示 / 落图用的坐标：原始点整体加上文件里的偏移 */
export function applyOffset(points: LocationPoint[], offset: LocationOffset): LocationPoint[] {
  if (!offset.lat && !offset.lng) return points;
  return points.map((p) => ({ ...p, lat: p.lat + offset.lat, lng: p.lng + offset.lng }));
}

export function serializeLocationDoc(doc: LocationDoc): string {
  const clean: LocationDoc = {
    format: LOCATION_FORMAT,
    version: LOCATION_VERSION,
    name: cleanLocationName(doc.name),
    offset: cleanOffset(doc.offset),
    points: doc.points.map((p) => ({
      ts: p.ts,
      lat: round6(p.lat),
      lng: round6(p.lng),
      accuracy: Math.round(p.accuracy || 0),
      note: p.note || '',
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  return JSON.stringify(clean, null, 2);
}

export function locationBlob(doc: LocationDoc): Blob {
  return new Blob([serializeLocationDoc(doc)], { type: `${LOCATION_MIME};charset=utf-8` });
}
