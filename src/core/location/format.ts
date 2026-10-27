// 定位数据（.drloc）的格式与纯计算。
//
// 定位记录不是数据库对象，就是文件库里的一条普通附件——这样备份、同步、分享、
// 文件筛选、隐私都能复用同一套机制。旧版直接把点写成 CSV，和人手建的表格混在
// 一起、筛选不出来；现在换成独一份的 .drloc（JSON）。
//
// 偏移值（offset）是「这个文件坐标系相对地图的修正量」，单位是度：
//   显示坐标 = 原始坐标 + offset。
// 原始点保持不变，改偏移就能整体平移，方便修正导入数据或底图偏差。
//
// 除了整份文件的 offset，还可以做「分段修正」：offsets 里每段记一个锚点
// （fromIndex，0 基下标），从该点起、到下一个锚点前（不含）的所有点都按
// 这段偏移修正；没被任何段覆盖的点仍用整份 offset。例：100 个点，在
// 第 5 / 20 / 60 个点各填一段偏移，实际修正 5-19、20-59、60-100，
// 第 1-4 个点不受影响。旧文件没有 offsets，行为与从前完全一致。

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

/** 一段分段修正：从第 fromIndex 个点（0 基）起生效，到下一个锚点前 */
export interface OffsetSegment {
  /** 生效起点（0 基下标，闭区间） */
  fromIndex: number;
  /** 纬度偏移（度）：正值向北 */
  lat: number;
  /** 经度偏移（度）：正值向东 */
  lng: number;
}

export interface LocationDoc {
  format: string;
  version: number;
  name: string;
  /** 整份文件的默认偏移：没被分段修正覆盖的点用它；旧数据也只有这一个 */
  offset: LocationOffset;
  /** 分段修正：按 fromIndex 升序；命中最后一个 fromIndex<=i 的段 */
  offsets: OffsetSegment[];
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
    offsets: [],
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

/** 清洗分段修正：过滤坏项、按 fromIndex 升序、同锚点后者胜 */
export function cleanOffsetSegments(raw: unknown): OffsetSegment[] {
  if (!Array.isArray(raw)) return [];
  const byIndex = new Map<number, OffsetSegment>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const fromIndex = Number(s.fromIndex);
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    if (!Number.isInteger(fromIndex) || fromIndex < 0) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    byIndex.set(fromIndex, { fromIndex, lat: round6(lat), lng: round6(lng) });
  }
  return [...byIndex.values()].sort((a, b) => a.fromIndex - b.fromIndex);
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
    // 旧文件没有 offsets：解析成空数组，行为和从前一致
    offsets: cleanOffsetSegments(raw.offsets),
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

/** 点 i 实际生效的偏移：命中最后一个 fromIndex<=i 的段，未命中用整份 offset */
export function effectiveOffsetAt(
  segments: OffsetSegment[] | undefined,
  offset: LocationOffset,
  index: number,
): LocationOffset {
  const segs = segments;
  if (segs && segs.length > 0) {
    // 段按 fromIndex 升序：从后往前找第一个起点不超过 i 的
    for (let k = segs.length - 1; k >= 0; k -= 1) {
      if (segs[k].fromIndex <= index) return { lat: segs[k].lat, lng: segs[k].lng };
    }
  }
  return offset;
}

/** 显示 / 落图用的坐标：原始点按分段规则加偏移（整份 offset + 分段修正） */
export function applyOffset(
  points: LocationPoint[],
  offset: LocationOffset,
  segments?: OffsetSegment[],
): LocationPoint[] {
  const segs = segments && segments.length > 0 ? segments : null;
  if (!offset.lat && !offset.lng && !segs) return points;
  return points.map((p, i) => {
    const hit = effectiveOffsetAt(segs ?? undefined, offset, i);
    if (!hit.lat && !hit.lng) return p;
    return { ...p, lat: p.lat + hit.lat, lng: p.lng + hit.lng };
  });
}

/** 两点间距离（米），haversine */
function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * 相邻两点之间的速度（km/h），长度 = 点数 - 1。
 *
 * 时间不前进（同一秒连点两下、旧 CSV 的日期串解析不出来）时给 null——
 * 硬写成 0 km/h 会把「不知道」画成「站着不动」，速度色阶上就分不清了。
 * 距离用 haversine，入参是**已经应用过偏移**的坐标（线和点画的是同一份）。
 */
export function segmentSpeeds(points: { lat: number; lng: number; ts: string }[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dt = (Date.parse(b.ts) - Date.parse(a.ts)) / 1000;
    if (!Number.isFinite(dt) || dt <= 0) {
      out.push(null);
      continue;
    }
    out.push((metersBetween(a, b) / dt) * 3.6);
  }
  return out;
}

/** 在 fromIndex 处放一段修正（替换已有同点段），返回按锚点升序的新数组 */export function upsertOffsetSegment(
  segments: OffsetSegment[] | undefined,
  fromIndex: number,
  offset: LocationOffset,
): OffsetSegment[] {
  if (!Number.isInteger(fromIndex) || fromIndex < 0) return segments ?? [];
  const next = cleanOffsetSegments([
    ...(segments ?? []).filter((s) => s.fromIndex !== fromIndex),
    { fromIndex, lat: offset.lat, lng: offset.lng },
  ]);
  return next;
}

/** 删掉 fromIndex 处的修正段 */
export function removeOffsetSegment(
  segments: OffsetSegment[] | undefined,
  fromIndex: number,
): OffsetSegment[] {
  return (segments ?? []).filter((s) => s.fromIndex !== fromIndex);
}

/**
 * 一段修正影响的点区间（1 基，含两端，供 UI 显示「第 N–M 个点」）。
 * 到下一个锚点前为止；没有下一个锚点就一直到末尾。
 */
export function segmentRange(
  segments: OffsetSegment[],
  fromIndex: number,
  total: number,
): { from: number; to: number } | null {
  if (!segments.some((s) => s.fromIndex === fromIndex)) return null;
  const next = segments
    .filter((s) => s.fromIndex > fromIndex)
    .sort((a, b) => a.fromIndex - b.fromIndex)[0];
  const to = next ? next.fromIndex - 1 : total - 1;
  if (to < fromIndex) return null; // 锚点已经超出点数（点被删过）
  return { from: fromIndex + 1, to: to + 1 };
}

// ---- 米 ↔ 度 ----
//
// 文件里存的是度（和底图坐标系一致）；面板让用户按「米」输入，
// 保存时按点的平均纬度换算：纬度 1° ≈ 111320m，经度还要乘 cos(纬度)。
// 没有点时算不出参考纬度，所以「先不换算」——UI 会要求先打点。

export const METERS_PER_DEG_LAT = 111320;

/** 点的平均纬度：经度换算的参考线；没有点返回 null */
export function refLatOf(points: { lat: number }[]): number | null {
  if (points.length === 0) return null;
  let sum = 0;
  for (const p of points) sum += p.lat;
  return sum / points.length;
}

function lngScale(refLat: number): number {
  const c = Math.cos((refLat * Math.PI) / 180);
  // 极区 cos 会趋近 0，别把经度算成天文数字
  return METERS_PER_DEG_LAT * Math.max(0.01, c);
}

/** 距离（米）→ 经纬度偏移（度）：north 正值向北，east 正值向东 */
export function offsetFromMeters(
  north: number,
  east: number,
  refLat: number,
): LocationOffset {
  return {
    lat: round6(north / METERS_PER_DEG_LAT),
    lng: round6(east / lngScale(refLat)),
  };
}

/** 经纬度偏移（度）→ 距离（米） */
export function metersFromOffset(offset: LocationOffset, refLat: number): { north: number; east: number } {
  return {
    north: offset.lat * METERS_PER_DEG_LAT,
    east: offset.lng * lngScale(refLat),
  };
}

export function serializeLocationDoc(doc: LocationDoc): string {
  const clean: LocationDoc = {
    format: LOCATION_FORMAT,
    version: LOCATION_VERSION,
    name: cleanLocationName(doc.name),
    offset: cleanOffset(doc.offset),
    offsets: cleanOffsetSegments(doc.offsets),
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
