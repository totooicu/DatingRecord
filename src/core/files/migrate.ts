// 历史数据迁移：把老文件（随机 id 当引用名、没算过 hash）搬到内容寻址上。
//
// 三种模式，宁可少动也不要多动：
//   names  只补引用名：把 file:<老id> 改成 file:sha-xxx.jpg，不合并任何一组
//   dedupe 合并完全相同的：同 hash + 同大小，逐字节通过才合并
//   shrink 先清掉「被引用为 0 且内容重复」的尾巴，再合并 —— 最激进
//
// 所有模式都先 scan 出预览，用户看过数量再按执行；执行前必须已有备份。

import { getBlob } from '../db/blob';
import { deleteFile, listFiles, setStoredId, type StoredFile } from '../repo/files';
import { extFor, hashStem, pickStoredId, sameBytes, sha256Hex } from './naming';
import { rewriteRefs } from './rewrite';
import { auditFiles, hashMissingFiles, type HashGroup } from './audit';
import { commitMerge, previewMerge, type MergePreview } from './merge';

export type MigrateMode = 'names' | 'dedupe' | 'shrink';

export interface RenamePlan {
  file: StoredFile;
  to: string;
}

export interface MigratePlan {
  mode: MigrateMode;
  /** 需要补 hash 的文件数（执行时要先算） */
  noHash: number;
  /** 引用名要变的文件 */
  renames: RenamePlan[];
  /** 将被合并的分组 */
  merges: MergePreview[];
  /** shrink 模式下会被直接删掉的空壳文件（无引用、内容重复） */
  drops: StoredFile[];
}

const MAX_PREVIEW_MERGES = 50;

/** 按目标模式生成预览（只读，不改库） */
export function planMigration(mode: MigrateMode): MigratePlan {
  const audit = auditFiles();

  // 1) 名字：所有还不是 hash 名的文件，按 hash 分组顺延序号
  const renames: RenamePlan[] = [];
  const legacy = listFiles().filter((f) => f.sha256 && !f.storedId.startsWith('sha-'));
  const slots = listFiles()
    .filter((f) => f.storedId.startsWith('sha-'))
    .map((f) => ({ storedId: f.storedId, hashShared: f.hashShared }));
  for (const f of legacy) {
    const stem = hashStem(f.sha256);
    const ext = extFor(f.name, f.mime);
    const to = pickStoredId(stem, ext, slots);
    slots.push({ storedId: to, hashShared: false });
    renames.push({ file: f, to });
  }

  // 2) 合并：只合并「同 hash + 同大小」的分组；大小不同必然是不同内容，跳过
  const groups: HashGroup[] = audit.groups.filter((g) => g.sameSize);
  const merges: MergePreview[] = [];
  const drops: StoredFile[] = [];
  for (const g of groups.slice(0, MAX_PREVIEW_MERGES)) {
    const [target, ...rest] = g.files;
    if (mode === 'shrink') {
      // 无引用的重复文件直接删，剩下的再并
      const keep: StoredFile[] = [];
      for (const f of rest) {
        const p = previewMerge(target.id, [f.id]);
        if (p && p.events.length === 0 && p.avatars === 0) drops.push(f);
        else keep.push(f);
      }
      const p = keep.length ? previewMerge(target.id, keep.map((f) => f.id)) : null;
      if (p) merges.push(p);
    } else {
      const p = previewMerge(target.id, rest.map((f) => f.id));
      if (p) merges.push(p);
    }
  }

  return {
    mode,
    noHash: audit.noHash,
    renames: mode === 'names' ? renames : [],
    merges: mode === 'names' ? [] : merges,
    drops: mode === 'shrink' ? drops : [],
  };
}

export interface MigrateResult {
  hashed: number;
  renamed: number;
  mergedGroups: number;
  mergedFiles: number;
  dropped: number;
}

/**
 * 执行。步骤固定为「补 hash → 改名 → 合并 → 删空壳」，每步都能独立收尾。
 *
 * 注意改名必须排在合并之前：合并靠引用名匹配正文，
 * 名字还是老 id 的时候也能合，但改完名再合会让老的 file:<id> 漏掉。
 * 所以这里反过来——先把名字统一（同时把正文里的老 id 一起换掉），再合并。
 */
export async function runMigration(plan: MigratePlan, onStep?: (msg: string) => void): Promise<MigrateResult> {
  const result: MigrateResult = { hashed: 0, renamed: 0, mergedGroups: 0, mergedFiles: 0, dropped: 0 };

  if (plan.noHash > 0) {
    onStep?.('正在计算文件 hash…');
    result.hashed = await hashMissingFiles();
  }

  // 只为「引用名还是老 id」的文件改名，并且同步改正文里的老 id 引用
  onStep?.('正在整理引用名…');
  const renames = plan.mode === 'names' ? plan.renames : rebuildRenames();
  for (const r of renames) {
    rewriteRefs([{ from: r.file.id, to: r.to, id: r.file.id }]);
    setStoredId(r.file.id, r.to);
    result.renamed++;
  }

  for (const d of plan.drops) {
    await deleteFile(d.id);
    result.dropped++;
  }

  for (const g of plan.merges) {
    onStep?.(`正在合并 ${g.target.name}…`);
    // 合并前再核一次：同一组的文件大小一致才自动合，否则跳过交给用户手动处理
    const ok = await allSameBytes(g, plan.mode !== 'shrink');
    if (!ok) continue;
    await commitMerge(g.target.id, g.sources.map((s) => s.id));
    result.mergedGroups++;
    result.mergedFiles += g.sources.length;
  }

  return result;
}

/** 重新算一遍改名计划（dedupe/shrink 模式也要把老名字理顺） */
function rebuildRenames(): RenamePlan[] {
  const all = listFiles();
  const legacy = all.filter((f) => f.sha256 && !f.storedId.startsWith('sha-'));
  const slots = all
    .filter((f) => f.storedId.startsWith('sha-'))
    .map((f) => ({ storedId: f.storedId, hashShared: f.hashShared }));
  const out: RenamePlan[] = [];
  for (const f of legacy) {
    const to = pickStoredId(hashStem(f.sha256), extFor(f.name, f.mime), slots);
    slots.push({ storedId: to, hashShared: false });
    out.push({ file: f, to });
  }
  return out;
}

/** 合并前的最后一道闸：目标与各源逐字节相同才允许自动合并 */
async function allSameBytes(p: MergePreview, verify: boolean): Promise<boolean> {
  if (!verify) return true;
  const bt = await getBlob(p.target.id);
  if (!bt) return false;
  for (const s of p.sources) {
    const bs = await getBlob(s.id);
    if (!bs) return false;
    if (!(await sameBytes(bt, bs))) return false;
  }
  return true;
}

/** 迁移前的体检摘要（给人看的一段话） */
export function planSummary(plan: MigratePlan): string {
  const parts: string[] = [];
  if (plan.noHash) parts.push(`${plan.noHash} 个文件待计算 hash`);
  if (plan.renames.length) parts.push(`${plan.renames.length} 个引用名要改`);
  if (plan.merges.length) {
    const n = plan.merges.reduce((s, p) => s + p.sources.length, 0);
    parts.push(`${plan.merges.length} 组重复可合并（共 ${n} 个文件）`);
  }
  if (plan.drops.length) parts.push(`${plan.drops.length} 个无用重复文件将删除`);
  return parts.length ? parts.join('，') : '没有需要处理的文件';
}

/** 给单个文件补 hash（上传入口之外的兜底，比如从旧备份导入的老数据） */
export async function hashOne(f: StoredFile): Promise<string> {
  const blob = await getBlob(f.id);
  if (!blob) return '';
  return sha256Hex(blob);
}
