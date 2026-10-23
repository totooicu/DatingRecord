// 快照工具：整库备份 / 回退。
//
// 这是 AI 误操作的安全网——AI 每轮第一次调写库工具前会自动拍一个快照，
// 用户不满意可以整轮回退到 AI 动手之前。

import type { ToolDef } from './types';
import { createSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot, fmtBytes, fmtSnapTime } from '../snapshots';

export const SNAPSHOT_TOOLS: ToolDef[] = [
  {
    name: 'snapshot.create',
    group: 'snapshot',
    title: '创建快照',
    desc: '给当前整个库拍一份备份（人物/事件/消息/事件集/附件元数据 + 二进制）',
    mutating: false,
    params: [
      {
        name: 'source',
        type: 'string',
        desc: '来源标记',
        required: false,
        default: 'manual',
        enum: ['manual', 'ai', 'cli', 'auto'],
      },
      { name: 'note', type: 'string', desc: '备注（会显示在快照列表里）', required: false },
    ],
    run: async (a) => {
      const m = await createSnapshot((a.source as 'manual' | 'ai' | 'cli' | 'auto') ?? 'manual', a.note as string | undefined);
      if (!m) throw new Error('创建快照失败');
      return { id: m.id, createdAt: m.createdAt, bytes: fmtBytes(m.bytes) };
    },
  },
  {
    name: 'snapshot.list',
    group: 'snapshot',
    title: '快照列表',
    desc: '所有快照（时间/来源/备注/体积/当时的人物与事件数）',
    mutating: false,
    params: [],
    run: () =>
      listSnapshots().map((s) => ({
        id: s.id,
        source: s.source,
        note: s.note,
        createdAt: fmtSnapTime(s.createdAt),
        persons: s.persons,
        events: s.events,
        bytes: fmtBytes(s.bytes),
      })),
  },
  {
    name: 'snapshot.restore',
    group: 'snapshot',
    title: '恢复快照（危险）',
    desc: '把整个库回退到某个快照。恢复前会自动给当前状态再留一份快照，踩错了还能再退回来',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '快照 id', required: true }],
    run: async (a) => {
      const ok = await restoreSnapshot(a.id as string);
      if (!ok) throw new Error(`快照不存在：${a.id}`);
      return { ok: true };
    },
  },
  {
    name: 'snapshot.delete',
    group: 'snapshot',
    title: '删除快照',
    desc: '删掉一份快照（不可恢复）',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '快照 id', required: true }],
    run: async (a) => {
      await deleteSnapshot(a.id as string);
      return { ok: true };
    },
  },
];
