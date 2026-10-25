// 定位（.drloc 文件）相关工具。
//
// 与网页 UI 共用 core/location 的同一套实现：CLI / AI 建出来的轨迹
// 同样躺在文件库里，能被类型筛选、预览、备份，偏移也一起写进文件。

import type { ToolDef } from './types';
import { getFile, renameFile, type StoredFile } from '../repo/files';
import {
  createLocation,
  deleteLocation,
  getLocationFile,
  importLocationText,
  listLocations,
  readLocation,
  writeLocation,
} from '../location/locationFile';
import {
  applyOffset,
  locationFileName,
  metersFromOffset,
  offsetFromMeters,
  refLatOf,
  type LocationOffset,
  type LocationPoint,
} from '../location/format';

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function offsetOf(raw: unknown): LocationOffset | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new Error('offset 必须是 { lat, lng } 对象');
  const o = raw as Record<string, unknown>;
  const lat = Number(o.lat ?? 0);
  const lng = Number(o.lng ?? 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('offset.lat / offset.lng 必须是数字（单位：度）');
  return { lat: round6(lat), lng: round6(lng) };
}

function offsetMetersOf(raw: unknown): { north: number; east: number } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new Error('offsetMeters 必须是 { north, east } 对象');
  const o = raw as Record<string, unknown>;
  const north = Number(o.north ?? 0);
  const east = Number(o.east ?? 0);
  if (!Number.isFinite(north) || !Number.isFinite(east)) {
    throw new Error('offsetMeters.north / east 必须是数字（单位：米）');
  }
  return { north, east };
}

/** 有米制偏移时按点的平均纬度换算；没有点没法换算经度，直接报错 */
function metersToOffset(
  meters: { north: number; east: number } | undefined,
  points: LocationPoint[],
): LocationOffset | undefined {
  if (!meters) return undefined;
  const lat = refLatOf(points);
  if (lat == null) throw new Error('文件还没有点，无法按米换算偏移（经度需要参考纬度）');
  return offsetFromMeters(meters.north, meters.east, lat);
}

/** 目标坐标：把文件第 1 个点放到这里 */
function targetOf(raw: unknown): { lat: number; lng: number } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new Error('target 必须是 { lat, lng } 对象');
  const t = raw as Record<string, unknown>;
  const lat = Number(t.lat);
  const lng = Number(t.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('target.lat / target.lng 必须是数字（单位：度）');
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error(`目标坐标超出范围：${lat}, ${lng}`);
  return { lat, lng };
}

/** 目标坐标 → 偏移：锚点固定取第 1 个点（原始坐标），补点也不会改变目标 */
function targetToOffset(
  target: { lat: number; lng: number } | undefined,
  points: LocationPoint[],
): LocationOffset | undefined {
  if (!target) return undefined;
  const anchor = points[0];
  if (!anchor) throw new Error('文件还没有点，无法按目标坐标换算偏移（锚点是第 1 个点）');
  return { lat: round6(target.lat - anchor.lat), lng: round6(target.lng - anchor.lng) };
}

/** 三种修正方式（度数 / 米 / 目标坐标）只能选一种，避免互相覆盖 */
function resolveOffset(
  input: { offset?: unknown; offsetMeters?: unknown; target?: unknown },
  points: LocationPoint[],
): LocationOffset | undefined {
  const deg = offsetOf(input.offset);
  const meters = offsetMetersOf(input.offsetMeters);
  const target = targetOf(input.target);
  const given: string[] = [];
  if (deg) given.push('offset');
  if (meters) given.push('offsetMeters');
  if (target) given.push('target');
  if (given.length > 1) throw new Error(`${given.join(' / ')} 只能给一个：三种修正方式选一种`);
  if (deg) return deg;
  if (meters) return metersToOffset(meters, points);
  return targetToOffset(target, points);
}

function pointOf(raw: unknown): LocationPoint {
  if (!raw || typeof raw !== 'object') throw new Error('points 里的每一项必须是 { lat, lng, ... } 对象');
  const p = raw as Record<string, unknown>;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('点的 lat / lng 必须是数字');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error(`坐标超出范围：${lat}, ${lng}`);
  const acc = Number(p.accuracy);
  return {
    ts: typeof p.ts === 'string' && p.ts ? p.ts : new Date().toISOString(),
    lat: round6(lat),
    lng: round6(lng),
    accuracy: Number.isFinite(acc) && acc > 0 ? Math.round(acc) : 0,
    note: typeof p.note === 'string' ? p.note : '',
  };
}

function pointsOf(raw: unknown): LocationPoint[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error('points 必须是数组');
  return raw.map(pointOf);
}

function brief(f: StoredFile, doc: { points: LocationPoint[]; offset: LocationOffset; offsets?: { fromIndex: number }[]; updatedAt: string }) {
  return {
    id: f.id,
    storedId: f.storedId,
    fileName: f.name,
    name: f.name.replace(/\.drloc$/i, ''),
    points: doc.points.length,
    offset: doc.offset,
    offsets: (doc.offsets ?? []).map((s) => ({ ...s })),
    updatedAt: doc.updatedAt,
  };
}

async function load(id: unknown): Promise<{ f: StoredFile; doc: Awaited<ReturnType<typeof readLocation>> }> {
  const f = getLocationFile(String(id));
  if (!f) throw new Error(`定位文件不存在：${String(id)}`);
  return { f, doc: await readLocation(f) };
}

export const LOCATION_TOOLS: ToolDef[] = [
  {
    name: 'location.list',
    group: 'location',
    title: '列出定位文件',
    desc: '文件库里全部 .drloc：名称、点数、偏移、更新时间',
    mutating: false,
    params: [],
    run: async () =>
      Promise.all(
        listLocations().map(async (f) => {
          try {
            const doc = await readLocation(f);
            return brief(f, doc);
          } catch (e) {
            return { id: f.id, storedId: f.storedId, fileName: f.name, error: e instanceof Error ? e.message : String(e) };
          }
        }),
      ),
  },
  {
    name: 'location.get',
    group: 'location',
    title: '定位文件详情',
    desc: '读取点列表与偏移；points 返回的是原始坐标，lat/lng 已按 offset 与分段修正（offsets，见 format.ts）换算（可直接落图）；anchor 是第 1 个原始点，target 是它修正后的坐标（三种填法可互相换算）',
    mutating: false,
    params: [
      { name: 'id', type: 'string', desc: '定位文件 id（f 开头）', required: true },
      {
        name: 'limit',
        type: 'number',
        desc: '最多返回多少个点（取最新的一段），默认 1000；0 = 全部',
        default: 1000,
      },
    ],
    run: async (a) => {
      const { f, doc } = await load(a.id);
      const limit = a.limit === undefined ? 1000 : Math.max(0, Number(a.limit) || 0);
      const tail = limit > 0 ? doc.points.slice(-limit) : doc.points;
      // 分段修正同样生效：offsets 里的段按锚点区间平移，没覆盖到的点用整份 offset
      const shifted = applyOffset(tail, doc.offset, doc.offsets);
      const lat = refLatOf(doc.points);
      const first = doc.points[0];
      const anchor = first ? { lat: first.lat, lng: first.lng } : null;
      return {
        ...brief(f, doc),
        total: doc.points.length,
        returned: shifted.length,
        offset: doc.offset,
        offsetMeters: lat == null ? null : metersFromOffset(doc.offset, lat),
        refLat: lat,
        anchor,
        target: anchor
          ? { lat: round6(anchor.lat + doc.offset.lat), lng: round6(anchor.lng + doc.offset.lng) }
          : null,
        points: shifted.map((p, i) => ({
          ts: p.ts,
          lat: p.lat,
          lng: p.lng,
          rawLat: tail[i].lat,
          rawLng: tail[i].lng,
          accuracy: p.accuracy,
          note: p.note,
        })),
      };
    },
  },
  {
    name: 'location.create',
    group: 'location',
    title: '新建定位文件',
    desc: '在文件库创建 .drloc，可同时带初始点与偏移。三种修正方式选一种：offset（度）/ offsetMeters（米）/ target（把第 1 个点放到指定坐标）',
    mutating: true,
    params: [
      { name: 'name', type: 'string', desc: '名称（不必带 .drloc）', required: true },
      { name: 'offset', type: 'object', desc: '经纬度偏移 { lat, lng }（度），省略为 0' },
      { name: 'offsetMeters', type: 'object', desc: '距离偏移 { north, east }（米），按点平均纬度换算；需要 points' },
      { name: 'target', type: 'object', desc: '目标坐标 { lat, lng }：把第 1 个点放到这里；需要 points' },
      { name: 'points', type: 'array', desc: '初始点数组 [{ ts?, lat, lng, accuracy?, note? }]' },
    ],
    run: async (a) => {
      const points = pointsOf(a.points) ?? [];
      const f = await createLocation({
        name: String(a.name),
        offset: resolveOffset(a, points) ?? { lat: 0, lng: 0 },
        points,
      });
      return brief(f, await readLocation(f));
    },
  },
  {
    name: 'location.save',
    group: 'location',
    title: '保存定位文件',
    desc: '改名称 / 整表替换点 / 改偏移。三种修正方式选一种：offset（度）/ offsetMeters（米）/ target（把第 1 个点放到指定坐标）；省略的参数保持原值',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '定位文件 id', required: true },
      { name: 'name', type: 'string', desc: '新名称；省略不改（会同步改文件名）' },
      { name: 'offset', type: 'object', desc: '新的经纬度偏移 { lat, lng }（度）；省略不改' },
      { name: 'offsetMeters', type: 'object', desc: '新的距离偏移 { north, east }（米），按点平均纬度换算；没有点会报错' },
      { name: 'target', type: 'object', desc: '新的目标坐标 { lat, lng }：把第 1 个点放到这里；没有点会报错' },
      { name: 'points', type: 'array', desc: '整表替换点数组；省略不改' },
    ],
    run: async (a) => {
      const { f, doc } = await load(a.id);
      if (a.name !== undefined) renameFile(f.id, locationFileName(String(a.name)));
      const points = pointsOf(a.points) ?? doc.points;
      const next = {
        ...doc,
        offset: resolveOffset(a, points) ?? doc.offset,
        points,
      };
      await writeLocation(f.id, next);
      const fresh = getFile(f.id);
      if (!fresh) throw new Error('定位文件在保存过程中被删除');
      return brief(fresh, await readLocation(fresh));
    },
  },
  {
    name: 'location.add',
    group: 'location',
    title: '追加定位点',
    desc: '往 .drloc 末尾追加一个点（不做去重）；原始坐标入库，偏移只影响展示',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '定位文件 id', required: true },
      { name: 'lat', type: 'number', desc: '纬度（原始坐标）', required: true },
      { name: 'lng', type: 'number', desc: '经度（原始坐标）', required: true },
      { name: 'accuracy', type: 'number', desc: '定位精度（米），省略为 0' },
      { name: 'note', type: 'string', desc: '备注' },
      { name: 'ts', type: 'string', desc: 'ISO 时间；省略为当前时间' },
    ],
    run: async (a) => {
      const { f, doc } = await load(a.id);
      const point = pointOf({ lat: a.lat, lng: a.lng, accuracy: a.accuracy, note: a.note, ts: a.ts });
      const next = { ...doc, points: [...doc.points, point] };
      await writeLocation(f.id, next);
      const fresh = getFile(f.id);
      if (!fresh) throw new Error('定位文件在保存过程中被删除');
      return { ...brief(fresh, await readLocation(fresh)), point };
    },
  },
  {
    name: 'location.remove',
    group: 'location',
    title: '删除定位点',
    desc: '按顺序下标删除一个点（0 开始，和 location.get 返回的数组顺序一致）',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '定位文件 id', required: true },
      { name: 'index', type: 'number', desc: '要删除的点下标（0 开始）', required: true },
    ],
    run: async (a) => {
      const { f, doc } = await load(a.id);
      const index = Number(a.index);
      if (!Number.isInteger(index) || index < 0 || index >= doc.points.length) {
        throw new Error(`下标越界：${String(a.index)}（共 ${doc.points.length} 个点）`);
      }
      const next = { ...doc, points: doc.points.filter((_, i) => i !== index) };
      await writeLocation(f.id, next);
      const fresh = getFile(f.id);
      if (!fresh) throw new Error('定位文件在保存过程中被删除');
      return { ...brief(fresh, await readLocation(fresh)), removed: index };
    },
  },
  {
    name: 'location.import',
    group: 'location',
    title: '导入定位数据',
    desc: '把 .drloc JSON 或旧版 CSV 文本导入为新的 .drloc 文件',
    mutating: true,
    params: [
      { name: 'text', type: 'string', desc: '.drloc JSON 或 CSV 正文', required: true },
      { name: 'name', type: 'string', desc: '来源文件名，用于命名' },
    ],
    run: async (a) => {
      const f = await importLocationText(String(a.text), a.name ? String(a.name) : '导入的定位记录.drloc');
      return brief(f, await readLocation(f));
    },
  },
  {
    name: 'location.delete',
    group: 'location',
    title: '删除定位文件',
    desc: '删除 .drloc 文件（硬删除）',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '定位文件 id', required: true }],
    run: async (a) => {
      const f = getLocationFile(String(a.id));
      if (!f) throw new Error(`定位文件不存在：${String(a.id)}`);
      await deleteLocation(f.id);
      return { ok: true, id: f.id, fileName: f.name };
    },
  },
];
