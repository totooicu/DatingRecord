// 导入导出 / 分享工具。
//
// 文件路径类参数只在 CLI 里有意义（宿主注入了 node:fs）；浏览器里
// 省略路径即可——导出会走浏览器下载，导入直接用文本。

import type { ToolDef } from './types';
import { requireHostFs } from './host';
import { buildLibrary, exportToFile } from '../io/export';
import { importLibrary, type ImportResult } from '../io/import';
import {
  buildPersonShare,
  buildShare,
  buildShareArchive,
  exportShareArchive,
  parseShare,
  readShareBytes,
  planShare,
  applyShare,
  NEW_PERSON,
  type ShareLanding,
} from '../io/share';
import type { ShareLevel } from '../types';
import { createSnapshot } from '../snapshots';
import { getBlob } from '../db/blob';
import { getFile } from '../repo/files';
import { isPrivacyMode } from '../../privacy';
import { kindOf as kindOfFile } from '../ai/attach';
import { SCHEMA_VERSION } from '../types';

function hasHost(): boolean {
  try {
    requireHostFs();
    return true;
  } catch {
    return false;
  }
}

/** 从 path 或 text 里取到分享内容；path 可能是 zip，也可能玩家给了旧的 json */
async function readShareInput(
  a: Record<string, unknown>,
): Promise<{ share: ReturnType<typeof parseShare>; fromPath: string | null }> {
  const path = a.path as string | undefined;
  const text = a.text as string | undefined;
  if (path) {
    return { share: await readShareBytes(requireHostFs().readBytes(path)), fromPath: path };
  }
  if (text) return { share: parseShare(text), fromPath: null };
  throw new Error('必须提供 path（CLI）或 text（分享文件内容）之一');
}

export const IO_TOOLS: ToolDef[] = [
  {
    name: 'io.exportLibrary',
    group: 'io',
    title: '导出整库',
    desc: '把整库导出为 .drp.json（CLI / 脚本用；网页界面只提供 .drp.zip 备份）。CLI 里给 outPath 落盘；浏览器里会触发下载',
    mutating: false,
    params: [
      { name: 'outPath', type: 'string', desc: '输出文件路径（仅 CLI 有意义）', required: false },
      { name: 'includeAttachments', type: 'boolean', desc: '是否内嵌附件 base64（体积会大很多）', required: false, default: false },
    ],
    run: async (a) => {
      const lib = await buildLibrary({ includeAttachments: a.includeAttachments === true });
      const text = JSON.stringify(lib, null, 2);
      const summary = {
        schemaVersion: lib.schemaVersion,
        persons: lib.persons.length,
        events: lib.events.length,
        messages: lib.messages?.length ?? 0,
        collections: lib.collections.length,
        attachments: lib.attachments?.length ?? 0,
        bytes: new TextEncoder().encode(text).length,
      };
      const outPath = a.outPath as string | undefined;
      if (outPath) {
        requireHostFs().writeText(outPath, text);
        return { ...summary, outPath };
      }
      if (hasHost()) return { ...summary, text };
      const name = await exportToFile({ includeAttachments: a.includeAttachments === true });
      return { ...summary, downloaded: name };
    },
  },
  {
    name: 'io.importLibrary',
    group: 'io',
    title: '导入整库',
    desc: '导入 .drp.json。merge=按 hlc 合并（默认，不覆盖本地更新的数据）；replace=先清空再导入（自动先备份）',
    mutating: true,
    params: [
      { name: 'path', type: 'string', desc: '文件路径（仅 CLI 有意义）', required: false },
      { name: 'text', type: 'string', desc: '文件 JSON 内容（与 path 二选一）', required: false },
      { name: 'mode', type: 'string', desc: 'merge=合并, replace=替换', required: false, default: 'merge', enum: ['merge', 'replace'] },
    ],
    run: async (a) => {
      const path = a.path as string | undefined;
      const text = a.text as string | undefined;
      const raw = path ? requireHostFs().readText(path) : text;
      if (!raw) throw new Error('必须提供 path 或 text');
      const mode = (a.mode as 'merge' | 'replace') ?? 'merge';
      let backupName: string | undefined;
      if (mode === 'replace') {
        // 替换导入先拍快照：CLI / AI 没有「下载」这个概念，快照才是它们的备份
        const snap = await createSnapshot('cli', '替换导入前自动备份');
        backupName = snap ? `快照 ${snap.id}` : undefined;
      }
      const r: ImportResult = await importLibrary(raw, mode, {
        onReplaceBackup: async () => backupName ?? '快照',
      });
      return { mode: r.mode, counts: r.counts, skipped: r.skipped, backupName };
    },
  },
  {
    name: 'io.shareBuild',
    group: 'io',
    title: '打包事件集分享',
    desc:
      '把选中的事件集（含子集）打包成分享压缩包 .drshare.zip（share.json + 附件原文件）。' +
      'personIds 只决定带走谁的资料，事件范围始终由 collectionIds 决定',
    mutating: false,
    params: [
      { name: 'collectionIds', type: 'array', desc: '事件集 id 列表（至少一个，各自含子集）', required: true },
      {
        name: 'eventIds',
        type: 'array',
        desc: '在这些事件集里再挑一层：只打包这些事件；省略 = 全部，空数组 = 一个都不带',
        required: false,
      },
      {
        name: 'personIds',
        type: 'array',
        desc: '要带走资料的人物 id；省略 = 事件里的人全带，空数组 = 全部只留姓名',
        required: false,
      },
      { name: 'outPath', type: 'string', desc: '输出文件路径，建议 .drshare.zip（仅 CLI 有意义）', required: false },
      { name: 'includeAttachments', type: 'boolean', desc: '是否带上被引用的附件', required: false, default: true },
      {
        name: 'level',
        type: 'string',
        desc: '分享程度：full 原样 / noPrivate 去私 / namesOnly 只名 / alias 化名 / custom 自选',
        required: false,
        default: 'full',
      },
      { name: 'attrKeys', type: 'array', desc: '自选等级下要带走的属性 key', required: false },
    ],
    run: async (a) => {
      const opts = {
        level: (a.level as ShareLevel | undefined) ?? 'full',
        attrKeys: (a.attrKeys as string[] | undefined) ?? [],
        includeAttachments: a.includeAttachments !== false,
      };
      const sel = {
        collectionIds: (a.collectionIds as string[] | undefined) ?? [],
        eventIds: a.eventIds as string[] | undefined,
        personIds: a.personIds as string[] | undefined,
      };
      const share = await buildShare(sel, opts);
      const summary = {
        format: share.format,
        version: share.version,
        sourceName: share.sourceName,
        collections: share.collections.length,
        events: share.events.length,
        persons: share.persons.length,
        pickedPersons: share.pickedPersonIds?.length ?? 0,
        messages: share.messages?.length ?? 0,
        attachments: share.attachments?.length ?? 0,
        missingAttachments: share.missingAttachments,
      };
      const outPath = a.outPath as string | undefined;
      if (outPath) {
        requireHostFs().writeBytes(outPath, await buildShareArchive(share));
        return { ...summary, outPath };
      }
      if (hasHost()) return { ...summary, text: JSON.stringify(share) };
      const name = await exportShareArchive(sel, opts);
      return { ...summary, downloaded: name };
    },
  },
  {
    name: 'io.sharePerson',
    group: 'io',
    title: '打包人物分享（旧口径）',
    desc:
      '@deprecated 已被 io.shareBuild 取代：新口径从事件集出发，人物只决定带谁的资料。' +
      '保留原因：命令行/脚本仍可能需要「按人导出他参与过的全部事件」，行为与 v2 文件一致',
    mutating: false,
    params: [
      { name: 'personId', type: 'string', desc: '人物 id', required: true },
      { name: 'outPath', type: 'string', desc: '输出文件路径（仅 CLI 有意义）', required: false },
      { name: 'includeAttachments', type: 'boolean', desc: '是否带上被引用的附件', required: false, default: true },
      {
        name: 'level',
        type: 'string',
        desc: '分享程度：full / noPrivate / namesOnly / alias / custom',
        required: false,
        default: 'full',
      },
      { name: 'attrKeys', type: 'array', desc: '自选等级下要带走的属性 key', required: false },
    ],
    run: async (a) => {
      const opts = {
        level: (a.level as ShareLevel | undefined) ?? 'full',
        attrKeys: (a.attrKeys as string[] | undefined) ?? [],
        includeAttachments: a.includeAttachments !== false,
      };
      const share = await buildPersonShare(a.personId as string, opts);
      const outPath = a.outPath as string | undefined;
      if (outPath) {
        requireHostFs().writeBytes(outPath, await buildShareArchive(share));
        return { scope: share.scope, level: share.level, events: share.events.length, persons: share.persons.length, outPath };
      }
      if (hasHost()) return { scope: share.scope, level: share.level, events: share.events.length, text: JSON.stringify(share) };
      return { scope: share.scope, level: share.level, events: share.events.length };
    },
  },
  {
    name: 'io.sharePlan',
    group: 'io',
    title: '分享导入预览',
    desc:
      '解析一份 .drshare.zip（旧的 .drshare.json 也认），给出导入计划：会有哪些事件集/事件，' +
      '以及分享里的人物建议关联到本库的谁（同名自动匹配）',
    mutating: false,
    params: [
      { name: 'path', type: 'string', desc: '分享包路径（仅 CLI 有意义）', required: false },
      { name: 'text', type: 'string', desc: '分享内容（与 path 二选一，仅限旧 json）', required: false },
    ],
    run: async (a) => {
      const { share } = await readShareInput(a);
      const plan = planShare(share);
      return {
        rootName: plan.rootName,
        collectionCount: plan.collectionCount,
        eventCount: plan.eventCount,
        missingAttachments: plan.missingAttachments,
        persons: plan.persons.map((p) => ({
          sharePersonId: p.person.id,
          name: p.person.displayName,
          eventCount: p.eventCount,
          /** 同名自动匹配到的本库人物；null = 库里没有，导入时会新建 */
          suggestedId: p.suggestedId,
        })),
        newPersonToken: NEW_PERSON,
      };
    },
  },
  {
    name: 'io.shareApply',
    group: 'io',
    title: '导入事件集分享',
    desc: '按预览计划落库。personMap 决定分享里的每个人物关联到本库的谁；不给的按同名自动关联，仍无同名则新建',
    mutating: true,
    params: [
      { name: 'path', type: 'string', desc: '分享文件路径（仅 CLI 有意义）', required: false },
      { name: 'text', type: 'string', desc: '分享文件 JSON 内容（与 path 二选一）', required: false },
      {
        name: 'personMap',
        type: 'object',
        desc: `{"<分享里的人物id>":"<本库人物id或${NEW_PERSON}>"}，可省略`,
        required: false,
      },
      {
        name: 'mode',
        type: 'string',
        desc: 'new = 新建事件集（保留分享里的层级）；merge = 并进已有事件集（不建新集合）',
        required: false,
        default: 'new',
      },
      { name: 'parentId', type: 'string', desc: 'mode=new 时挂到哪个事件集下，省略则挂到根', required: false },
      { name: 'name', type: 'string', desc: 'mode=new 且是人物分享时，新事件集的名字', required: false },
      { name: 'collectionId', type: 'string', desc: 'mode=merge 时的目标事件集 id', required: false },
    ],
    run: async (a) => {
      const { share } = await readShareInput(a);
      if (a.mode === 'merge' && !a.collectionId) throw new Error('mode=merge 时必须给 collectionId');
      const landing: ShareLanding =
        a.mode === 'merge'
          ? { mode: 'merge', collectionId: a.collectionId as string }
          : {
              mode: 'new',
              parentId: (a.parentId as string | null | undefined) ?? null,
              name: a.name as string | undefined,
            };
      const r = await applyShare(share, {
        personMap: (a.personMap as Record<string, string> | undefined) ?? {},
        landing,
      });
      return { counts: r.counts, skipped: r.skipped };
    },
  },
  {
    name: 'io.readFile',
    group: 'io',
    title: '读取本地文件内容',
    desc:
      '读一个本地文本文件（txt/md/json/csv/代码等）的内容，或拿到任意文件的元信息。' +
      'CLI 里给 path；浏览器里没有文件系统，只能读文件库（fileId）。' +
      '内容超过 maxChars 会截断。二进制文件只返回元信息，不返回乱码',
    mutating: false,
    params: [
      { name: 'path', type: 'string', desc: '本地文件路径（仅 CLI 有意义）', required: false },
      { name: 'fileId', type: 'string', desc: '文件库里的文件 id（浏览器 / CLI 都可以）', required: false },
      { name: 'maxChars', type: 'number', desc: '最多读多少字符，默认 20000', required: false, default: 20000 },
    ],
    run: async (a) => {
      const maxChars = typeof a.maxChars === 'number' ? a.maxChars : 20000;

      // 文件库：走 getBlob，浏览器（IndexedDB）和 CLI（<db>.blobs/）都通
      if (a.fileId) {
        const meta = getFile(String(a.fileId));
        if (!meta) throw new Error(`文件库里没有 id=${a.fileId}`);
        if (meta.isPrivate && isPrivacyMode()) throw new Error('这个文件标了隐私，隐私模式下不读');
        const blob = await getBlob(meta.id);
        if (!blob) throw new Error(`文件 ${meta.name} 的内容已丢失`);
        const kind = kindOfFile(meta.name, meta.mime);
        const base = { name: meta.name, mime: meta.mime, size: meta.size, kind };
        if (kind === 'unsupported') return { ...base, note: '二进制/不支持的格式，只返回元信息' };
        if (kind === 'image') return { ...base, note: '图片不转文本；改用「从文件库」在 AI 对话里发送' };
        const text = await blob.text();
        return {
          ...base,
          truncated: text.length > maxChars,
          chars: text.length,
          text: text.slice(0, maxChars),
        };
      }

      // 本地路径：只有注入了宿主 fs 的环境（CLI）才行
      const path = a.path as string | undefined;
      if (!path) throw new Error('必须提供 path（CLI）或 fileId（文件库）之一');
      const fs = requireHostFs();
      if (!fs.exists(path)) throw new Error(`文件不存在：${path}`);
      const text = fs.readText(path);
      const name = path.split(/[\\/]/).pop() ?? path;
      const kind = kindOfFile(name, '');
      return {
        name,
        path,
        size: text.length,
        kind,
        truncated: text.length > maxChars,
        chars: text.length,
        text: text.slice(0, maxChars),
      };
    },
  },
];

export { SCHEMA_VERSION };
