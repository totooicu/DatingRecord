// 附件（文件）相关工具。

import type { ToolDef } from './types';
import { listFiles, getFile, deleteFile, renameFile, setFilePrivate, countRefs, personsUsingFile, eventsReferencingFile, collectionsUsingFile, urlForFile } from '../repo/files';
import { fileNameDuplicates, resolveFileNameDuplicates } from '../repo/files';
import { probeLink, saveAsMapping, transferRefsInEvents } from '../files';

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
    name: 'file.nameDuplicates', group: 'file', title: '扫描同名文件',
    desc: '扫描可见的存量同名组；trim 后区分大小写，不自动修改',
    mutating: false, params: [], run: () => fileNameDuplicates(),
  },
  {
    name: 'file.resolveNameDuplicates', group: 'file', title: '同名文件编号整理',
    desc: '确认后给一组存量同名文件编号，保留最早文件名称；不改内容或引用，仅处理当前可见文件，分组过期拒绝执行',
    mutating: true,
    params: [
      { name: 'name', type: 'string', desc: '扫描返回的分组名称', required: true },
      { name: 'ids', type: 'array', desc: '扫描返回的该组全部文件 id', required: true },
    ],
    run: (a) => {
      if (typeof a.name !== 'string' || !Array.isArray(a.ids) || !a.ids.every((id) => typeof id === 'string')) throw new Error('需要分组名称和文件 id 数组');
      return resolveFileNameDuplicates(a.name, a.ids as string[]);
    },
  },
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
    name: 'file.addMapping',
    group: 'file',
    title: '添加映射文件',
    desc: '只保存链接、不下载内容（省存储）；引用名按链接 hash 生成 link-…，正文引用与普通附件一致。支持 App 深链（qqmusic://、weixin:// 等自定义 scheme）',
    mutating: true,
    params: [
      { name: 'url', type: 'string', desc: '链接：https / ftp / file://、手机路径，或 App 深链（qqmusic://…）', required: true },
      { name: 'name', type: 'string', desc: '文件名（含扩展名，决定类型）', required: true },
      { name: 'mime', type: 'string', desc: 'MIME 类型；省略时按扩展名猜' },
    ],
    run: async (a) => {
      const r = await saveAsMapping({
        url: a.url as string,
        name: a.name as string,
        mime: (a.mime as string) ?? '',
      });
      return { ...brief(r.file), reused: r.reused };
    },
  },
  {
    name: 'file.probeLink',
    group: 'file',
    title: '测试链接',
    desc: '探测链接能否访问，返回 HTTP 状态、类型、大小与文件名（添加映射文件前用）；App 深链不能探测，会直接说明',
    mutating: false,
    params: [{ name: 'url', type: 'string', desc: '链接', required: true }],
    run: async (a) => probeLink(a.url as string),
  },
  {
    name: 'file.rename',
    group: 'file',
    title: '重命名附件',
    desc: '只改显示名，正文引用不受影响；trim 后区分大小写，重名拒绝并返回建议名称',
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
      return { ok: true, id: a.id, name: f.name ?? '' };
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
