// 重复 hash 管理：库里已经攒下的「同一个 hash 挂着几条记录」，在这里逐组处置。
//
// 为什么单独一个面板：上传时的判重只在「新文件撞进来」那一刻起作用，
// 而重复记录多是历史留下的——老数据没算过 hash、迁移留下的副本、改名重传、
// 当初选了「都不一样」。这些事后没人管，空间就一直占着，正文里还散落着几份引用。
//
// 处置动作与上传冲突弹窗同一套语义，不让用户记两套词：
//   合并   → 引用全部改指目标那条，其余记录与二进制删掉（走 MergeModal，先看影响再执行）
//   标记为不同内容 → 置 hash_shared，这组退出判重候选，以后再传同样的也不再问
//   什么都不做 → 留着
// 面板只读地列出（auditFiles），动手全在用户按下去之后。
import { useMemo, useState } from 'react';
import { auditFiles, hashMissingFiles, type HashGroup } from '../../core/files';
import { countTotalRefs, deleteFile, setHashShared, type StoredFile } from '../../core/repo/files';
import { bump, useVersion } from '../../store';
import { fmtSize } from './fileFormat';
import { MergeModal } from './MergeModal';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';

/** 合并目标默认挑引用最多的那条：改写面最小 */
function bestTarget(g: HashGroup): StoredFile {
  return [...g.files].sort((a, b) => countTotalRefs(b) - countTotalRefs(a) || a.createdAt.localeCompare(b.createdAt))[0];
}

/** 这组里「留着不动」之外还能省多少空间（除目标外的字节） */
function wasteOf(g: HashGroup, targetId: string): number {
  return g.files.filter((f) => f.id !== targetId).reduce((s, f) => s + f.size, 0);
}

function GroupCard({
  group,
  onSearchHash,
  onDone,
}: {
  group: HashGroup;
  onSearchHash: (q: string) => void;
  onDone: (msg: string) => void;
}) {
  const [targetId, setTargetId] = useState<string>(() => bestTarget(group).id);
  const [merge, setMerge] = useState<{ target: string; sources: string[] } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);

  const marked = group.files.filter((f) => f.hashShared);
  const allMarked = marked.length === group.files.length;
  const target = group.files.find((f) => f.id === targetId) ?? group.files[0];
  const sources = group.files.filter((f) => f.id !== target.id);
  const refsOf = (f: StoredFile) => countTotalRefs(f);
  const orphans = sources.filter((f) => refsOf(f) === 0);

  const mark = (shared: boolean) => {
    setHashShared(group.files.map((f) => f.id), shared);
    bump();
    onDone(
      shared
        ? `已把 ${group.sha256.slice(0, 12)}… 这 ${group.files.length} 个标记为不同内容，以后上传不再当重复`
        : `已取消 ${group.sha256.slice(0, 12)}… 的标记，这组重新按重复处理`,
    );
  };

  const dropOrphans = async () => {
    for (const f of orphans) await deleteFile(f.id);
    setConfirmDrop(false);
    bump();
    onDone(`已删除 ${orphans.length} 个没有引用的副本，释放 ${fmtSize(orphans.reduce((s, f) => s + f.size, 0))}`);
  };

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(group.sha256);
      onDone('已复制完整 hash，可粘到搜索框');
    } catch {
      onDone(group.sha256);
    }
  };

  return (
    <div className="dup-group">
      <div className="dup-head">
        <button type="button" className="dup-hash" onClick={() => void copyHash()} title="点击复制完整 sha256">
          <code>{group.sha256.slice(0, 16)}…</code>
        </button>
        <span className="muted small">
          {group.files.length} 个 · 留一个可省 {fmtSize(wasteOf(group, target.id))}
          {!group.sameSize && ' · 大小不一，内容未必相同'}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => onSearchHash(group.sha256)}
          title="把这组的 hash 填进搜索框，只列出这几条"
        >
          在列表里搜
        </button>
      </div>

      <ul className="dup-files">
        {group.files.map((f) => {
          const n = refsOf(f);
          return (
            <li key={f.id} className={f.id === target.id ? 'dup-file dup-file-on' : 'dup-file'}>
              <label className="dup-pick">
                <input
                  type="radio"
                  name={`dup-target-${group.sha256}`}
                  checked={f.id === target.id}
                  onChange={() => setTargetId(f.id)}
                  aria-label={`把 ${f.name} 作为保留的那个`}
                />
              </label>
              <span className="dup-name" title={`${f.name} · ${f.storedId}`}>
                {f.name}
                {f.id === target.id && <em className="dup-tag">保留这个</em>}
                {f.hashShared && <em className="dup-tag dup-tag-mark">已确认不同内容</em>}
              </span>
              <span className="muted small">
                {fmtSize(f.size)} · {n === 0 ? '未被引用' : `${n} 处引用`}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="row-actions">
        {allMarked ? (
          <button className="btn btn-sm" onClick={() => mark(false)}>
            取消标记，重新当重复
          </button>
        ) : (
          <>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setMerge({ target: target.id, sources: sources.map((f) => f.id) })}
              disabled={sources.length === 0}
            >
              合并其余 {sources.length} 个到「{target.name}」
            </button>
            {orphans.length > 0 && (
              <button
                className="btn btn-sm"
                onClick={() => (confirmDrop ? void dropOrphans() : setConfirmDrop(true))}
              >
                {confirmDrop ? `确认删除这 ${orphans.length} 个副本` : `删除 ${orphans.length} 个无引用副本`}
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => mark(true)}>
              标记为不同内容
            </button>
          </>
        )}
      </div>
      {confirmDrop && (
        <p className="dup-warn small">
          删除会连二进制一起清掉，救不回来；只删没有任何事件、头像、图标引用的副本，被引用的那条不动。
        </p>
      )}

      {merge && (
        <MergeModal
          targetId={merge.target}
          sourceIds={merge.sources}
          onClose={() => setMerge(null)}
          onDone={(m) => onDone(m)}
        />
      )}
    </div>
  );
}

export function DupHashSection({
  onSearchHash,
  onDone,
}: {
  /** 把 hash 填进文件列表的搜索框（列表在上面的 FilesSection 里） */
  onSearchHash: (q: string) => void;
  onDone: (msg: string) => void;
}) {
  const v = useVersion();
  const audit = useMemo(() => auditFiles(), [v]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const pending = audit.groups.filter((g) => g.files.some((f) => !f.hashShared));
  const marked = audit.groups.filter((g) => g.files.every((f) => f.hashShared));
  // 重复组一组一张卡，几千个文件能出几百张卡：两块各自分页（组内的文件不拆）
  const pagedPending = usePaged(pending, usePageSize());
  const pagedMarked = usePaged(marked, usePageSize());
  const wasted = pending.reduce((s, g) => s + wasteOf(g, bestTarget(g).id), 0);

  const backfill = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const n = await hashMissingFiles((done, total) => setMsg(`补算 hash ${done} / ${total}`));
      bump();
      setMsg(n ? `已给 ${n} 个文件补算 hash，重复分组重新列好了` : '没有能补算的文件（映射文件没有内容可算）');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dup">
      <p className="muted small">
        共 {audit.total} 个文件。
        {audit.noHash > 0 && `其中 ${audit.noHash} 个还没算 hash（算不了就判不了重）。`}
        {pending.length > 0
          ? ` ${pending.length} 组同 hash 待处理，只留一个能省约 ${fmtSize(wasted)}。`
          : ' 没有待处理的同 hash 文件。'}
      </p>

      <div className="row-actions">
        {audit.noHash > 0 && (
          <button className="btn btn-sm" onClick={() => void backfill()} disabled={busy}>
            {busy ? '计算中…' : `给 ${audit.noHash} 个文件补算 hash`}
          </button>
        )}
        {msg && <span className="muted small">{msg}</span>}
      </div>

      {pagedPending.pageItems.map((g) => (
        <GroupCard key={g.sha256} group={g} onSearchHash={onSearchHash} onDone={onDone} />
      ))}
      <Paginator paged={pagedPending} />

      {marked.length > 0 && (
        <details className="dup-marked">
          <summary>已确认「同 hash 但内容不同」的 {marked.length} 组（不再当重复）</summary>
          {pagedMarked.pageItems.map((g) => (
            <GroupCard key={g.sha256} group={g} onSearchHash={onSearchHash} onDone={onDone} />
          ))}
          <Paginator paged={pagedMarked} />
        </details>
      )}
    </div>
  );
}
