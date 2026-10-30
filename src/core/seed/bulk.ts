// 批量示例数据：按数量级造数据，用来看应用在极端数据量下的表现。
//
// 和 index.ts 那份「精选 25 条」是两回事：那边是让人一眼看懂这个应用怎么用，
// 这边是压测——10 / 100 / 1000 / 10000 四个数量级，人物、事件集、事件、
// 文件、定位点、歌单各自能单独调，文本长度还会跟着量级一起放大。
//
// 性能上做了几处必要的让步，否则上万条根本跑不完：
//   · 全程 suspendUndo：每条写入都会去 oplog 里 ORDER BY seq 查一次最新行，
//     不挂起的话是 O(n²)。
//   · 事件集建成两层：createCollection 每次要 listChildren 算排序键，
//     全挂同一层是 O(N²)，分成「若干个父集合 + 均分的子集合」降下来。
//   · 文件名自带序号：availableFileName 每次全表扫一遍，重名还会进 while 递增。
//   · 每 YIELD_EVERY 条让出一次事件循环，进度条能动，页面不至于假死。

import { noteUndoStep, suspendUndo, resumeUndo, run, transact, appendOplog, getDeviceId } from '../db';
import { newId } from '../id';
import { hlcNow } from '../time';
import { orderKeyBetween } from '../order';
import { upsertDef, createPerson, setAttribute } from '../repo/persons';
import { createEvent, setEventPrivate } from '../repo/events';
import { addMember, normalizeCollectionTree, getRoot } from '../repo/collections';
import { rebuildClosure } from '../repo/collections/closure';
import { appendMessage } from '../repo/chat';
import { createLocation } from '../location/locationFile';
import { createPlaylist } from '../music/playlistFile';
import { insertFileRaw } from '../repo/files';
import { sha256Hex } from '../files/naming';
import type { Participant } from '../types';
import { SCENES, sceneSvg } from './images';
import {
  makeRng,
  pick,
  int,
  personName,
  placeName,
  addressOf,
  eventTitle,
  contentOf,
  tagList,
  chatLine,
  noteOf,
  fileName,
  collectionName,
  collectionDesc,
  playlistName,
  songName,
  moodOf,
  eventKindOf,
  cityOf,
  geoOf,
  type TextScale,
  withN,
} from './corpus';

/** 四个数量级。数字指「事件数」，其余实体按它派生（也都能单独改）。 */
export const SCALE_TIERS = [10, 100, 1000, 10000] as const;
export type ScaleTier = (typeof SCALE_TIERS)[number];

export interface BulkPlan {
  persons: number;
  collections: number;
  events: number;
  files: number;
  /** 定位点总数（会自动分到多个定位文件里） */
  points: number;
  /** 歌单个数 */
  playlists: number;
  /** 每个歌单的曲目数 */
  tracksPerPlaylist: number;
  /** 每个事件的聊天消息数；0 = 不生成聊天形式的事件 */
  chatPerEvent: number;
  /** 每个事件挂到几个事件集上 */
  collectionsPerEvent: number;
  /** 文本长度档位 */
  textScale: TextScale;
}

export interface BulkResult {
  persons: number;
  collections: number;
  events: number;
  files: number;
  points: number;
  playlists: number;
  tracks: number;
  messages: number;
  /** 各阶段耗时（毫秒），方便看瓶颈在哪 */
  timings: Record<string, number>;
  totalMs: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** 按数量级派生一份默认计划 */
export function planFor(tier: ScaleTier): BulkPlan {
  const n = tier;
  return {
    persons: clamp(n / 8, 5, 1000),
    collections: clamp(n / 10, 3, 500),
    events: n,
    // 文件要真写 IndexedDB 二进制，量级上去代价很大，压到 1000 封顶
    files: clamp(n / 5, 5, 1000),
    points: clamp(n * 3, 60, 30000),
    playlists: clamp(n / 100, 1, 100),
    tracksPerPlaylist: clamp(n / 20, 5, 200),
    // 聊天消息是「事件 × 条数」，一万条事件再乘消息数会直接爆掉
    chatPerEvent: n >= 10000 ? 0 : n >= 1000 ? 2 : n >= 100 ? 4 : 8,
    collectionsPerEvent: 1,
    textScale: n >= 10000 ? 3 : n >= 1000 ? 2 : n >= 100 ? 1 : 0,
  };
}

/** 总数估算，给 UI 显示「这次大概要造多少」 */
export function estimateRows(p: BulkPlan): number {
  return (
    p.persons +
    p.collections +
    p.events +
    p.events * 2 + // 参与者
    p.files +
    p.points +
    p.playlists +
    p.playlists * p.tracksPerPlaylist +
    p.events * p.chatPerEvent
  );
}

const YIELD_EVERY = 200;

/** 让出一次事件循环：进度条要能动，页面不能看起来死了 */
function breathe(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

const POINTS_PER_FILE = 2000;

/**
 * 直接插一条事件集，不走 createCollection。
 *
 * 原因很实在：createCollection 每建一个集合就 rebuildClosure() 一次，而那是
 * 「DELETE 全表 + 逐条 INSERT 整棵树」。建 500 个集合 = 500 次全树重建 =
 * 25 万次 SQL，实测 41 秒——比造 10000 条事件还慢。这里改成逐条插行、
 * 全部插完之后只重建一次闭包，语义完全一致（同样的字段、同样的 oplog），
 * 只是把 O(N²) 的那次全表重建挪到了最后。
 */
function insertCollectionFast(input: {
  name: string;
  kind: 'arc' | 'topic';
  parentId: string | null;
  description: string;
  lastKey: string | null;
}): { id: string; orderKey: string } {
  const id = newId('c');
  const now = new Date().toISOString();
  const orderKey = orderKeyBetween(input.lastKey, null);
  transact(() => {
    run(
      `INSERT INTO collections
       (id,name,kind,parent_id,order_key,description,status,rule_json,is_root,time_range_auto,device_id,rev,hlc,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.name,
        input.kind,
        input.parentId,
        orderKey,
        input.description,
        'ongoing',
        null,
        0,
        1,
        getDeviceId(),
        1,
        hlcNow(getDeviceId()),
        now,
        now,
      ],
    );
    appendOplog('collection', id, 'insert', { name: input.name, parentId: input.parentId, kind: input.kind });
  });
  return { id, orderKey };
}

export interface BulkProgress {
  label: string;
  done: number;
  total: number;
}

export async function loadBulkData(
  plan: BulkPlan,
  onProgress?: (p: BulkProgress) => void,
): Promise<BulkResult> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const mark = (k: string, from: number) => {
    timings[k] = Math.round(performance.now() - from);
  };

  noteUndoStep(`载入${plan.events}条示例数据`);
  suspendUndo();
  try {
    const rnd = makeRng(20261030);
    const scale = plan.textScale;
    // 文本长度按「总字符预算 ÷ 条数」封顶，所以每个阶段要知道自己造多少条
    const base = { rnd, scale, n: 1 };
    const ctxP = withN(base, plan.persons);
    const ctxC = withN(base, plan.collections);
    const ctxF = withN(base, plan.files);
    const ctxE = withN(base, plan.events);
    const ctxPt = withN(base, plan.points);
    const ctxPl = withN(base, plan.playlists);
    const report = (label: string, done: number, total: number) => onProgress?.({ label, done, total });

    // ---------- 1. 属性定义 ----------
    let t = performance.now();
    upsertDef({ key: 'city', label: '所在城市', type: 'text', group: '基本信息' });
    upsertDef({ key: 'occupation', label: '职业', type: 'text', group: '基本信息' });
    upsertDef({ key: 'affinity', label: '亲近度', type: 'number', group: '关系' });
    upsertDef({ key: 'mbti', label: 'MBTI', type: 'enum', group: '喜好', options: ['INFP', 'ENFP', 'INTJ', 'ENFJ', '其他'] });
    upsertDef({ key: 'hobbies', label: '爱好', type: 'tag', group: '喜好' });
    mark('属性定义', t);

    // ---------- 2. 人物 ----------
    t = performance.now();
    const personIds: string[] = [];
    const personNames: string[] = [];
    for (let i = 0; i < plan.persons; i += 1) {
      const name = personName(ctxP, i);
      const p = createPerson({ displayName: name, tags: [pick(rnd, ['朋友', '同事', '同学', '家人', '自己'] as const)] });
      personIds.push(p.id);
      personNames.push(name);
      setAttribute(p.id, 'city', cityOf(ctxP));
      setAttribute(p.id, 'occupation', pick(rnd, ['设计师', '产品', '教师', '摄影', '开发', '医生', '店长'] as const));
      setAttribute(p.id, 'affinity', int(rnd, 1, 5));
      if (i % 3 === 0) setAttribute(p.id, 'mbti', pick(rnd, ['INFP', 'ENFP', 'INTJ', 'ENFJ'] as const));
      if (i % 2 === 0) setAttribute(p.id, 'hobbies', [pick(rnd, ['咖啡', '攀岩', '胶片', '骑行', '读书'] as const)]);
      if (i % YIELD_EVERY === 0) {
        report('人物', i, plan.persons);
        await breathe();
      }
    }
    mark('人物', t);

    // ---------- 3. 事件集（两层，避开 listChildren 的 O(N²)） ----------
    t = performance.now();
    const collectionIds: string[] = [];
    const rootId = getRoot()?.id ?? null;
    const lastKeys = new Map<string | null, string | null>();
    // 两层：根下挂若干父集合，子集合均分到各父下。
    // 全挂一层的话 listChildren 每次都要扫同一个父，量级上去又是 O(N²)。
    const parentCount = Math.max(1, Math.min(plan.collections, Math.ceil(Math.sqrt(plan.collections))));
    const parents: string[] = [];
    for (let i = 0; i < parentCount; i += 1) {
      const r = insertCollectionFast({
        name: collectionName(ctxC, i),
        kind: i % 2 === 0 ? 'arc' : 'topic',
        parentId: rootId,
        description: collectionDesc(ctxC),
        lastKey: lastKeys.get(rootId) ?? null,
      });
      lastKeys.set(rootId, r.orderKey);
      parents.push(r.id);
      collectionIds.push(r.id);
    }
    let ci = 0;
    while (collectionIds.length < plan.collections) {
      const parentId = parents[ci % parents.length];
      ci += 1;
      const r = insertCollectionFast({
        name: collectionName(ctxC, collectionIds.length),
        kind: 'topic',
        parentId,
        description: collectionDesc(ctxC),
        lastKey: lastKeys.get(parentId) ?? null,
      });
      lastKeys.set(parentId, r.orderKey);
      collectionIds.push(r.id);
      if (collectionIds.length % YIELD_EVERY === 0) {
        report('事件集', collectionIds.length, plan.collections);
        await breathe();
      }
    }
    // 闭包只在最后重建一次；normalizeCollectionTree 顺手把没根的收编回根
    rebuildClosure();
    normalizeCollectionTree();
    mark('事件集', t);

    // ---------- 4. 文件 ----------
    t = performance.now();
    const fileIds: string[] = [];
    for (let i = 0; i < plan.files; i += 1) {
      const scene = SCENES[i % SCENES.length];
      // 掺一点差异，避免所有文件 hash 相同被判成同一个
      const svg = `${sceneSvg(scene)}<!--${i}-->`;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const sha = await sha256Hex(blob);
      const f = await insertFileRaw({
        file: blob,
        name: fileName(ctxF, i, '.svg'),
        storedId: `${sha.slice(0, 32)}.svg`,
        sha256: sha,
        createdAt: new Date(Date.now() - i * 60_000).toISOString(),
      });
      fileIds.push(f.id);
      if (i % 50 === 0) {
        report('文件', i, plan.files);
        await breathe();
      }
    }
    mark('文件', t);

    // ---------- 5. 事件 ----------
    t = performance.now();
    const eventIds: string[] = [];
    for (let i = 0; i < plan.events; i += 1) {
      const who = personNames.length ? personNames[i % personNames.length] : '';
      const place = placeName(ctxE);
      const geo = geoOf(ctxE, i);
      const daysAgo = 1 + (i % 900);
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      d.setHours(8 + (i % 14), i % 60, 0, 0);
      const start = d.toISOString();

      const participants: Participant[] = [];
      const pn = 1 + (i % Math.min(3, Math.max(1, personIds.length)));
      for (let k = 0; k < pn; k += 1) {
        const pid = personIds[(i + k) % personIds.length];
        if (pid) participants.push({ personId: pid, role: k === 0 ? 'self' : 'primary', note: '' });
      }

      const e = createEvent({
        title: eventTitle(ctxE, i, who, place),
        kind: eventKindOf(ctxE),
        time: { kind: 'instant', start, precision: 'minute' },
        place: { name: place, address: addressOf(ctxE), geo },
        participants,
        content: contentOf(ctxE, who, place),
        tags: tagList(ctxE),
        media: fileIds.length && i % 4 === 0 ? [fileIds[i % fileIds.length]] : [],
        metrics: { rating: int(rnd, 1, 5), cost: int(rnd, 0, 400), currency: 'CNY', mood: moodOf(ctxE), intimacyDelta: int(rnd, -2, 5) },
        viewMode: plan.chatPerEvent > 0 && i % 5 === 0 ? 'chat' : 'doc',
      });
      eventIds.push(e.id);

      // 挂到事件集
      for (let k = 0; k < plan.collectionsPerEvent; k += 1) {
        const cid = collectionIds[(i + k * 7) % Math.max(1, collectionIds.length)];
        if (cid) addMember(cid, 'event', e.id);
      }
      if (i % 11 === 0) setEventPrivate(e.id, true);

      // 聊天消息
      if (plan.chatPerEvent > 0 && i % 5 === 0 && personIds.length) {
        for (let k = 0; k < plan.chatPerEvent; k += 1) {
          const speaker = personIds[(i + k) % personIds.length];
          appendMessage(e.id, {
            type: 'msg',
            body: chatLine(ctxE, i * 100 + k, personNames[(i + k) % personNames.length] ?? ''),
            side: k % 2 === 0 ? 'right' : 'left',
            personId: k % 2 === 0 ? null : speaker,
          });
        }
      }

      if (i % YIELD_EVERY === 0) {
        report('事件', i, plan.events);
        await breathe();
      }
    }
    mark('事件', t);

    // ---------- 6. 定位点（分文件，避免单个 JSON 过大） ----------
    t = performance.now();
    let pointsMade = 0;
    let fileNo = 0;
    while (pointsMade < plan.points) {
      const n = Math.min(POINTS_PER_FILE, plan.points - pointsMade);
      const points = [];
      for (let k = 0; k < n; k += 1) {
        const idx = pointsMade + k;
        const g = geoOf(ctxPt, idx);
        const ts = new Date(Date.now() - (idx % 900) * 86_400_000 - (idx % 1440) * 60_000).toISOString();
        points.push({ ts, lat: g.lat, lng: g.lng, accuracy: int(rnd, 3, 25), note: noteOf(ctxPt, idx) });
      }
      await createLocation({ name: `压测轨迹 ${fileNo + 1}（${n} 点）`, points });
      pointsMade += n;
      fileNo += 1;
      report('定位点', pointsMade, plan.points);
      await breathe();
    }
    mark('定位点', t);

    // ---------- 7. 歌单 ----------
    t = performance.now();
    let tracks = 0;
    for (let i = 0; i < plan.playlists; i += 1) {
      const doc = {
        format: 'dr.playlist' as const,
        version: 1,
        name: playlistName(ctxPl, i),
        description: collectionDesc(ctxPl),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tracks: Array.from({ length: plan.tracksPerPlaylist }, (_, k) => ({
          storedId: `${(i * 1000 + k).toString(16).padStart(40, '0')}.mp3`,
          name: `${songName(ctxPl)}.mp3`,
          mime: 'audio/mpeg',
          size: int(rnd, 2_000_000, 12_000_000),
        })),
      };
      tracks += doc.tracks.length;
      await createPlaylist({ name: doc.name, description: doc.description, doc });
      if (i % 10 === 0) {
        report('歌单', i, plan.playlists);
        await breathe();
      }
    }
    mark('歌单', t);

    const totalMs = Math.round(performance.now() - t0);
    return {
      persons: personIds.length,
      collections: collectionIds.length,
      events: eventIds.length,
      files: fileIds.length,
      points: pointsMade,
      playlists: plan.playlists,
      tracks,
      messages: Math.floor(plan.events / 5) * plan.chatPerEvent,
      timings,
      totalMs,
    };
  } finally {
    resumeUndo();
  }
}
