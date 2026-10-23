// 附件（文件）相关工具。

import type { ToolDef } from './types';
import { listFiles, getFile, deleteFile, renameFile, setFilePrivate, countRefs, personsUsingFile, eventsReferencingFile, collectionsUsingFile, urlForFile } from '../repo/files';
import { transferRefsInEvents } from '../files';

function brief(f: ReturnType<typeof listFiles>[number]): Record<string, unknown> {
  return {
    id: f.id,
    storedId: f.storedId,
    name: f.name,
    mime: f.mime,
    size: f.size,
    createdAt: f.createdAt,
    isPrivate: f.isPrivate,
    refs: countRefs(f),
  };
}

export const FILE_TOOLS: ToolDef[] = [
  {
    name: 'file.list',
    group: 'file',
    title: '列出附件',
    desc: '全部附件（元数据）：名称/类型/大小/被引用次数',
    mutating: false,
    params: [],
    run: () => listFiles().map(brief),
  },
  {
    name: 'file.get',
    group: 'file',
    title: '附件详情',
    desc: '单个附件信息 + 谁在引用它',
    mutating: false,
    params: [{ name: 'id', type: 'string', desc: '附件 id（f 开头）', required: true }],
    run: (a) => {
      const f = getFile(a.id as string);
      if (!f) throw new Error(`附件不存在：${a.id}`);
      return {
        ...brief(f),
        refs: {
          persons: personsUsingFile(f).map((p) => ({ id: p.id, displayName: p.displayName })),
          events: eventsReferencingFile(f).map((e) => ({ id: e.id, title: e.title })),
          collections: collectionsUsingFile(f).map((c) => ({ id: c.id, name: c.name })),
        },
      };
    },
  },
  {
    name: 'file.rename',
    group: 'file',
    title: '重命名附件',
    desc: '只改显示名，正文里的引用（file:<storedId>）不受影响',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '附件 id', required: true },
      { name: 'name', type: 'string', desc: '新名称', required: true },
    ],
    run: (a) => {
      renameFile(a.id as string, a.name as string);
      return getFile(a.id as string);
    },
  },
  {
    name: 'file.setPrivate',
    group: 'file',
    title: '标记 / 取消隐私',
    desc: '隐私模式开启后隐藏',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '附件 id', required: true },
      { name: 'on', type: 'boolean', desc: 'true=标记隐私, false=取消', required: true },
    ],
    run: (a) => {
      setFilePrivate(a.id as string, a.on === true);
      return getFile(a.id as string);
    },
  },
  {
    name: 'file.delete',
    group: 'file',
    title: '删除附件',
    desc: '删除附件及其二进制。仍有正文引用它的会被拒绝（先改正文再删）',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '附件 id', required: true }],
    run: async (a) => {
      const f = getFile(a.id as string);
      if (!f) throw new Error(`附件不存在：${a.id}`);
      const n = countRefs(f);
      if (n > 0) throw new Error(`还有 ${n} 处引用，先解除引用再删`);
      await deleteFile(a.id as string);
      return { ok: true };
    },
  },
  {
    name: 'file.transferRefs',
    group: 'file',
    title: '批量转移事件引用',
    desc: '把指定事件正文里对附件 a 的引用换成附件 b；只动事件正文，头像/图标不受影响',
    mutating: true,
    params: [
      { name: 'fromId', type: 'string', desc: '源附件 id', required: true },
      { name: 'toId', type: 'string', desc: '目标附件 id', required: true },
      { name: 'eventIds', type: 'array', desc: '要处理的事件 id 列表；省略=所有正文引用源附件的事件' },
    ],
    run: (a) => {
      const from = getFile(a.fromId as string);
      const to = getFile(a.toId as string);
      if (!from) throw new Error(`附件不存在：${a.fromId}`);
      if (!to) throw new Error(`附件不存在：${a.toId}`);
      const ids = Array.isArray(a.eventIds)
        ? (a.eventIds as string[])
        : eventsReferencingFile(from).map((e) => e.id);
      const changed = transferRefsInEvents(ids, [from.storedId, from.id], to.storedId, to.name);
      return { requested: ids.length, changed };
    },
  },
  {
    name: 'file.url',
    group: 'file',
    title: '附件访问地址',
    desc: '取附件的 objectURL（浏览器里可直接用于 <img src>）',
    mutating: false,
    params: [{ name: 'id', type: 'string', desc: '附件 id', required: true }],
    run: async (a) => {
      const url = await urlForFile(a.id as string);
      if (!url) throw new Error(`附件不存在：${a.id}`);
      return { url };
    },
  },
];
