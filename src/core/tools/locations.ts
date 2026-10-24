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

function brief(f: StoredFile, doc: { points: LocationPoint[]; offset: LocationOffset; updatedAt: string }) {
  return {
    id: f.id,
    storedId: f.storedId,
    fileName: f.name,
    name: f.name.replace(/\.drloc$/i, ''),
    points: doc.points.length,
    offset: doc.offset,
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
    desc: '读取点列表与偏移；points 返回的是原始坐标，lat/lng 已按 offset 修正（可直接落图）',
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
      const shifted = applyOffset(tail, doc.offset);
      return {
        ...brief(f, doc),
        total: doc.points.length,
        returned: shifted.length,
        offset: doc.offset,
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
    desc: '在文件库创建 .drloc，可同时带初始点与偏移（偏移单位：度，正值向北/向东）',
    mutating: true,
    params: [
      { name: 'name', type: 'string', desc: '名称（不必带 .drloc）', required: true },
      { name: 'offset', type: 'object', desc: '经纬度偏移 { lat, lng }，省略为 0' },
      { name: 'points', type: 'array', desc: '初始点数组 [{ ts?, lat, lng, accuracy?, note? }]' },
    ],
    run: async (a) => {
      const f = await createLocation({
        name: String(a.name),
        offset: offsetOf(a.offset),
        points: pointsOf(a.points) ?? [],
      });
      return brief(f, await readLocation(f));
    },
  },
  {
    name: 'location.save',
    group: 'location',
    title: '保存定位文件',
    desc: '改名称 / 整表替换点 / 改偏移；省略的参数保持原值。点数量很大时建议用 location.add',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '定位文件 id', required: true },
      { name: 'name', type: 'string', desc: '新名称；省略不改（会同步改文件名）' },
      { name: 'offset', type: 'object', desc: '新的经纬度偏移 { lat, lng }；省略不改' },
      { name: 'points', type: 'array', desc: '整表替换点数组；省略不改' },
    ],
    run: async (a) => {
      const { f, doc } = await load(a.id);
      if (a.name !== undefined) renameFile(f.id, locationFileName(String(a.name)));
      const next = {
        ...doc,
        offset: offsetOf(a.offset) ?? doc.offset,
        points: pointsOf(a.points) ?? doc.points,
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
