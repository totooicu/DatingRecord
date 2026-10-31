// 示例数据：首次打开时一键铺一整套「像真用过一阵子」的库。
//
// 之前只有 2 个人、5 条事件，看一眼就看完了。现在按「一段关系 + 几个朋友 +
// 各种场所」铺开：25 条事件横跨咖啡店、影院、面馆、江边、美术馆、地铁口、
// 书店、公园、火锅店、Livehouse、体育馆、游乐园、医院、海边、山里、机场、
// 菜市场、母校……还留了一套回忆录和一份定位记录。
//
// 两个约束：
//   · 全部数据都能在设置页「清空全部数据」里一次扫掉，别留附件孤儿；
//   · 整个载入只记一步撤销（suspendUndo），撤销条上只出现一条「载入示例数据」。

import { queryOne, noteUndoStep, suspendUndo, resumeUndo } from '../db';
import { upsertDef, createPerson, setAttribute } from '../repo/persons';
import { createEvent, getEvent, setEventPrivate, updateEvent } from '../repo/events';
import { createCollection, addMember, normalizeCollectionTree, setCollectionIcon } from '../repo/collections';
import { createMemoir, updateMemoir } from '../repo/memoirs';
import { appendMessage } from '../repo/chat';
import { createLocation } from '../location/locationFile';
import { uploadFileQuiet } from '../files';
import type { StoredFile } from '../repo/files';
import type { Participant, Place } from '../types';
import type { TimeSpec } from '../time';
import { SCENES, sceneFile } from './images';
import {
  SAMPLE_COLLECTIONS,
  SAMPLE_EVENTS,
  SAMPLE_MEMOIRS,
  SAMPLE_PERSONS,
  type SampleEventDef,
} from './data';

export interface SampleCounts {
  persons: number;
  events: number;
  collections: number;
  memoirs: number;
  files: number;
}

function isoAt(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** 回忆录的冻结范围用「日期」而不是时刻：界面上选的就是日期 */
function dateKey(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function timeOf(def: SampleEventDef): TimeSpec {
  const start = isoAt(def.at.daysAgo, def.at.hour, def.at.minute);
  if (def.fuzzy) return { kind: 'fuzzy', start, precision: 'day', raw: def.fuzzy };
  if (def.end) {
    return { kind: 'interval', start, end: isoAt(def.end.daysAgo, def.end.hour, def.end.minute), precision: 'minute' };
  }
  return { kind: 'instant', start, precision: 'minute' };
}

function placeOf(def: SampleEventDef): Place {
  return { name: def.place, address: def.address ?? '', geo: def.geo ?? null };
}

export async function loadSampleData(): Promise<SampleCounts> {
  noteUndoStep('载入示例数据');
  suspendUndo();
  try {
    // 1. 配图：程序化生成的 SVG，走和用户上传完全相同的入库路径
    const images = new Map<string, StoredFile>();
    for (const scene of SCENES) {
      images.set(scene.key, await uploadFileQuiet(sceneFile(scene), Number.MAX_SAFE_INTEGER));
    }

    // 2. 人物
    upsertDef({ key: 'mbti', label: 'MBTI', type: 'enum', group: '喜好', options: ['INFP', 'ENFP', 'INTJ', 'ENFJ', '其他'] });
    upsertDef({ key: 'favorite_food', label: '爱吃', type: 'tag', group: '喜好' });
    upsertDef({ key: 'city', label: '所在城市', type: 'text', group: '基本信息' });

    const personIds = new Map<string, string>();
    for (const def of SAMPLE_PERSONS) {
      const p = createPerson({ displayName: def.name, tags: def.tags, groupName: def.group });
      personIds.set(def.key, p.id);
      for (const [key, value] of Object.entries(def.attrs)) setAttribute(p.id, key, value);
    }

    // 3. 事件集：父集合先建，子集合按 SAMPLE_COLLECTIONS 的顺序挂上去
    const collectionIds = new Map<string, string>();
    for (const def of SAMPLE_COLLECTIONS) {
      const parentId = def.parent ? collectionIds.get(def.parent) ?? null : null;
      const c = createCollection({
        name: def.name,
        kind: def.kind,
        parentId,
        description: def.description,
        rule: def.rule ?? null,
      });
      collectionIds.set(def.key, c.id);
      if (def.icon) setCollectionIcon(c.id, def.icon);
    }
    // 老库可能没有根集合（例如「清空全部数据」之后的老版本），那样这些集合
    // 会全部挂在 parent_id=null 上、树里看不见。这里统一收编回根。
    normalizeCollectionTree();

    // 4. 事件
    const eventIds = new Map<string, string>();
    const eventImage = new Map<string, string>();
    for (const def of SAMPLE_EVENTS) {
      const selfId = personIds.get('me');
      const participants: Participant[] = (def.people ?? []).map((key) => ({
        personId: personIds.get(key)!,
        role: 'primary',
        note: '',
      }));
      if (def.self && selfId) participants.unshift({ personId: selfId, role: 'self', note: '' });

      const image = def.image ? images.get(def.image) : undefined;
      const e = createEvent({
        title: def.title,
        kind: def.kind,
        time: timeOf(def),
        place: placeOf(def),
        participants,
        content: def.content ?? '',
        tags: def.tags ?? [],
        media: image ? [image.id] : [],
        metrics: {
          rating: def.rating,
          cost: def.cost,
          currency: 'CNY',
          mood: def.mood,
          intimacyDelta: def.intimacy,
        },
        viewMode: def.viewMode ?? 'doc',
      });
      eventIds.set(def.key, e.id);
      if (image) eventImage.set(def.key, image.id);
      for (const key of def.collections ?? []) {
        const cid = collectionIds.get(key);
        if (cid) addMember(cid, 'event', e.id);
      }
    }

    // 隐私开关走单独入口（updateEvent 刻意不碰 is_private）
    for (const def of SAMPLE_EVENTS) {
      if (!def.private) continue;
      const id = eventIds.get(def.key);
      if (id) setEventPrivate(id, true);
    }

    // 5. 事件关联（需要目标事件已经存在，所以放在第二趟）
    for (const def of SAMPLE_EVENTS) {
      if (!def.followedBy) continue;
      const from = eventIds.get(def.key);
      const to = eventIds.get(def.followedBy);
      if (from && to) updateEvent(from, { relatedEvents: [{ type: 'followedBy', targetId: to }] });
    }

    // 6. 聊天形式的事件：补消息
    for (const def of SAMPLE_EVENTS) {
      if (!def.chat?.length) continue;
      const eventId = eventIds.get(def.key);
      if (!eventId) continue;
      const selfId = personIds.get('me') ?? null;
      for (const line of def.chat) {
        if (line.divider) {
          appendMessage(eventId, { type: 'divider', body: line.body, side: 'left', personId: null });
          continue;
        }
        const who = line.who ? personIds.get(line.who) ?? null : selfId;
        appendMessage(eventId, { type: 'msg', body: line.body, side: line.who ? 'left' : 'right', personId: who });
      }
    }

    // 7. 回忆录：范围冻结在「参与的事件」上，正文只存编辑决策
    let memoirs = 0;
    for (const def of SAMPLE_MEMOIRS) {
      const collectionId = collectionIds.get(def.collection);
      if (!collectionId) continue;
      const events = def.eventKeys
        .map((k) => (eventIds.get(k) ? getEvent(eventIds.get(k)!) : null))
        .filter((e): e is NonNullable<typeof e> => !!e);
      if (!events.length) continue;
      const lastDay = Math.max(...def.eventKeys.map((k) => SAMPLE_EVENTS.find((e) => e.key === k)?.at.daysAgo ?? 0));
      const m = createMemoir({
        collectionId,
        title: def.title,
        subtitle: def.subtitle,
        scope: {
          eventIds: events.map((e) => e.id),
          from: dateKey(lastDay),
          to: dateKey(0),
          frozenAt: new Date().toISOString(),
        },
        events,
        source: 'manual',
      });
      const pages = m.pages.map((page) => {
        const d = def.pages.find((p) => eventIds.get(p.eventKey) === page.eventId);
        if (!d) return page;
        return {
          ...page,
          note: d.note ?? '',
          excerpt: d.excerpt ?? '',
          hidden: d.hidden ?? false,
          edited: d.edited ?? false,
        };
      });
      updateMemoir(m.id, { pages, coverFileId: def.coverFromEvent ? eventImage.get(def.coverFromEvent) ?? null : null });
      memoirs += 1;
    }

    // 8. 定位记录：一次周末漫游，覆盖几家店
    const points = [
      { days: 21, hour: 9, minute: 20, note: '米仓咖啡（等位 20 分钟）', lat: 30.2811, lng: 120.0287 },
      { days: 21, hour: 10, minute: 5, note: '文一西路 → 天目里', lat: 30.2763, lng: 120.1012 },
      { days: 21, hour: 11, minute: 40, note: '天目里 · %Arabica 门口', lat: 30.2732, lng: 120.1071 },
      { days: 21, hour: 13, minute: 15, note: '午饭：一家云南米线', lat: 30.2718, lng: 120.1098 },
      { days: 21, hour: 15, minute: 30, note: '单向空间 · 乐堤港', lat: 30.2905, lng: 120.1421 },
      { days: 21, hour: 17, minute: 50, note: '江边步道（风很大）', lat: 30.2402, lng: 120.2213 },
      { days: 21, hour: 19, minute: 30, note: '九宫格老火锅', lat: 30.2796, lng: 120.1702 },
      { days: 20, hour: 10, minute: 10, note: '太子湾公园 · 草地', lat: 30.2273, lng: 120.1491 },
      { days: 20, hour: 13, minute: 0, note: '浙江美术馆', lat: 30.2321, lng: 120.1562 },
      { days: 20, hour: 16, minute: 20, note: '南山路 · 树下躲雨', lat: 30.2354, lng: 120.1534 },
      { days: 20, hour: 19, minute: 40, note: '茅廊巷菜场（收摊前）', lat: 30.2444, lng: 120.1689 },
      { days: 20, hour: 21, minute: 0, note: '回家', lat: 30.3002, lng: 120.1417 },
    ].map((p) => ({
      ts: isoAt(p.days, p.hour, p.minute),
      lat: p.lat,
      lng: p.lng,
      accuracy: 8,
      note: p.note,
    }));
    await createLocation({ name: '和小满的周末漫游', points });

    return {
      persons: SAMPLE_PERSONS.length,
      events: SAMPLE_EVENTS.length,
      collections: SAMPLE_COLLECTIONS.length,
      memoirs,
      files: images.size + 1,
    };
  } finally {
    resumeUndo();
  }
}

export function hasAnyPerson(): boolean {
  const row = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM persons WHERE deleted_at IS NULL');
  return (row?.c ?? 0) > 0;
}
