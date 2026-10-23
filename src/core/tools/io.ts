// 导入导出 / 分享工具。
//
// 文件路径类参数只在 CLI 里有意义（宿主注入了 node:fs）；浏览器里
// 省略路径即可——导出会走浏览器下载，导入直接用文本。

import type { ToolDef } from './types';
import { requireHostFs } from './host';
import { buildLibrary, exportToFile } from '../io/export';
import { importLibrary, type ImportResult } from '../io/import';
import { buildShare, parseShare, planShare, applyShare, exportShareFile, NEW_PERSON } from '../io/share';
import { createSnapshot } from '../snapshots';
import { SCHEMA_VERSION } from '../types';

function hasHost(): boolean {
  try {
    requireHostFs();
    return true;
  } catch {
    return false;
  }
}

/** 从 path 或 text 里取到分享文件内容 */
function readShareInput(a: Record<string, unknown>): { share: ReturnType<typeof parseShare>; fromPath: string | null } {
  const path = a.path as string | undefined;
  const text = a.text as string | undefined;
  if (path) {
    const raw = requireHostFs().readText(path);
    return { share: parseShare(raw), fromPath: path };
  }
  if (text) return { share: parseShare(text), fromPath: null };
  throw new Error('必须提供 path（CLI）或 text（分享文件 JSON 内容）之一');
}

export const IO_TOOLS: ToolDef[] = [
  {
    name: 'io.exportLibrary',
    group: 'io',
    title: '导出整库',
    desc: '把整个人物/事件/消息/事件集库导出为 .drp.json。CLI 里给 outPath 落盘；浏览器里会触发下载',
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
    desc: '把一个事件集（含子集、事件、聊天消息、相关人物）打包成 .drshare.json。CLI 里给 outPath 落盘',
    mutating: false,
    params: [
      { name: 'collectionId', type: 'string', desc: '事件集 id', required: true },
      { name: 'outPath', type: 'string', desc: '输出文件路径（仅 CLI 有意义）', required: false },
      { name: 'includeAttachments', type: 'boolean', desc: '是否内嵌被引用的附件', required: false, default: true },
    ],
    run: async (a) => {
      const share = await buildShare(a.collectionId as string, {
        includeAttachments: a.includeAttachments !== false,
      });
      const text = JSON.stringify(share, null, 2);
      const summary = {
        format: share.format,
        version: share.version,
        rootName: share.collections.find((c) => c.id === share.rootId)?.name,
        collections: share.collections.length,
        events: share.events.length,
        persons: share.persons.length,
        messages: share.messages?.length ?? 0,
        attachments: share.attachments?.length ?? 0,
        missingAttachments: share.missingAttachments,
      };
      const outPath = a.outPath as string | undefined;
      if (outPath) {
        requireHostFs().writeText(outPath, text);
        return { ...summary, outPath };
      }
      if (hasHost()) return { ...summary, text };
      const name = await exportShareFile(a.collectionId as string, {
        includeAttachments: a.includeAttachments !== false,
      });
      return { ...summary, downloaded: name };
    },
  },
  {
    name: 'io.sharePlan',
    group: 'io',
    title: '分享导入预览',
    desc: '解析一份 .drshare.json，给出导入计划：会有哪些事件集/事件，以及分享里的人物建议关联到本库的谁（同名自动匹配）',
    mutating: false,
    params: [
      { name: 'path', type: 'string', desc: '分享文件路径（仅 CLI 有意义）', required: false },
      { name: 'text', type: 'string', desc: '分享文件 JSON 内容（与 path 二选一）', required: false },
    ],
    run: (a) => {
      const { share } = readShareInput(a);
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
      { name: 'parentId', type: 'string', desc: '挂到哪个事件集下，省略则挂到根', required: false },
    ],
    run: async (a) => {
      const { share } = readShareInput(a);
      const r = await applyShare(share, {
        personMap: (a.personMap as Record<string, string> | undefined) ?? {},
        parentId: (a.parentId as string | null | undefined) ?? null,
      });
      return { counts: r.counts, skipped: r.skipped };
    },
  },
];

export { SCHEMA_VERSION };
