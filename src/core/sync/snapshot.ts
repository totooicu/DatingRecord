// 生成两份快照：
//   full —— 合库快照（.drp.json 同构，含附件 base64），给「手机上记、电脑上恢复」用
//   lite —— 轻量快照（剔除附件 data 与敏感凭据），日常增量同步走这份
//
// 为什么要分成两份：附件二进制动辄几十 MB，而它天生就是内容寻址、
// 改不了内容——每次同步都把它塞进快照，分片 hash 虽然不变（不重复上传），
// 但本地算哈希、拼 JSON 的钱白花，而且首次同步会把整库附件一口气推上去。
// 所以日常只在「附件行本身变了」时同步，二进制按需单独拉（见 attachments.ts）。
import { buildLibrary } from '../io';
import type { LibraryFile } from '../types';

/** 不该进备份的 meta 键：凭据、设备私有状态 */
export const SECRET_META_PREFIXES = ['ai.key.', 'nutstore.', 'lock.', 'enc.'];

export function strippedLibrary(lib: LibraryFile): LibraryFile {
  return {
    ...lib,
    attachments: (lib.attachments ?? []).map((a) => ({ ...a, data: '' })),
  };
}

export async function buildFullSnapshot(): Promise<string> {
  const lib = await buildLibrary({ includeAttachments: true });
  return stableJson(lib);
}

export async function buildLiteSnapshot(): Promise<string> {
  const lib = await buildLibrary({ includeAttachments: false });
  return stableJson(strippedLibrary(lib));
}

export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * 备份用的稳定序列化：键按字母序，且把每次都变的字段钉住。
 *
 * 为什么必须做这一步：JSON.stringify 的输出顺序跟着对象字面量走，而
 * buildLibrary 里的 meta.exportedAt 每毫秒都在变。不处理的话，数据一个字
 * 没改，分片哈希也全变——增量同步就退化成整库重传，正是要避免的事。
 */
const VOLATILE_META: Record<string, string> = {
  exportedAt: '1970-01-01T00:00:00.000Z',
};

/**
 * 顶层 meta 里不参与「有没有变」判定的字段：
 * 导出时间每次都新；库 id / 设备号属于「这份备份是谁导的」，不是数据内容。
 * 它们留在快照里（便于诊断两台机器互相覆盖），只是不参与哈希稳定化。
 */
function stableMeta(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const src = { ...(v as Record<string, unknown>) };
  // 库 id 是「同一份库」的标识，跨设备不该算变化；导出时间每次都新
  for (const k of ['id', 'deviceId', 'exportedAt']) delete src[k];
  return stableValue(src);
}

function stableValue(v: unknown, key?: string): unknown {
  if (key === 'meta') return stableMeta(v);
  if (key && VOLATILE_META[key] !== undefined) return VOLATILE_META[key];
  if (Array.isArray(v)) return v.map((x) => stableValue(x));
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = stableValue(src[k], k);
    return out;
  }
  return v;
}

/** 稳定序列化（键序固定、易变字段钉死）——只有它变了才说明数据真的变了 */
export function stableJson(v: unknown): string {
  return JSON.stringify(stableValue(v));
}
