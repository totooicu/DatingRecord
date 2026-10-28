// 上传冲突裁决弹窗：大文件同 hash 同大小时，由人判断「是不是同一份」。
//
// 为什么不让程序决定：逐字节比一个 50MB 的视频要读 100MB 数据，
// 在浏览器里就是几秒的卡顿；而人看一眼缩略图就能断定。
// 所以阈值以上一律弹窗，选项里永远有「都不一样」——那才是 hash 碰撞。
//
// 三种处置：
//   复用   → 不新增记录、不写二进制，直接用旧那条的引用名
//   覆盖   → 用新内容替换旧那条的二进制，id 与引用名都不变（正文里已有引用照旧可用）
//   都不一样 → 新记录，引用名顺延 _1/_2
// 勾选「后续同样处理」后，本批剩余冲突不再弹窗，按同一处置自动走。
import { useEffect, useState } from 'react';
import { getBlob, urlForFile, type StoredFile } from '../../core/repo/files';
import { Modal } from '../common';
import { fmtSize } from './fileFormat';
import type { CollisionAction, CollisionDecision, CollisionPrompt } from '../../core/files';

/** 弹窗回传给编排层的东西：内核裁决 + 是否记住 */
export type CollisionChoice = CollisionDecision & { applyRest: boolean };

/** 候选卡片：缩略图、缺失标记、选中态 */
function CandidateCard({
  file,
  thumb,
  broken,
  selected,
  onPick,
}: {
  file: StoredFile;
  thumb?: string;
  /** 库里这条记录的二进制取不到（复用它会指向空内容） */
  broken: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`col-card${selected ? ' col-card-sel' : ''}${broken ? ' col-card-broken' : ''}`}
      onClick={onPick}
    >
      {thumb ? (
        <img className="col-thumb" src={thumb} alt="" />
      ) : (
        <span className="col-thumb col-thumb-icon">{file.mime.split('/')[0]}</span>
      )}
      <span className="col-name">{file.name}</span>
      <span className="muted small">
        {fmtSize(file.size)} · {file.storedId.slice(0, 14)}…
      </span>
      {broken && <span className="col-badge col-badge-warn">二进制缺失</span>}
      {selected && <span className="col-badge">已选中</span>}
    </button>
  );
}

export function CollisionModal({
  prompt,
  uploading,
  onDecide,
  onCancel,
}: {
  prompt: CollisionPrompt;
  /** 上传中这张图的临时预览（objectURL），可选 */
  uploading?: string;
  onDecide: (choice: CollisionChoice) => void;
  onCancel: () => void;
}) {
  const first = prompt.candidates[0] ?? null;
  const [sel, setSel] = useState<string | null>(first?.id ?? null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [applyRest, setApplyRest] = useState(false);
  const [confirmOver, setConfirmOver] = useState(false);

  // 缩略图与「二进制还在不在」都要异步取；一次算完，别在渲染里现取
  useEffect(() => {
    let alive = true;
    void (async () => {
      const img: Record<string, string> = {};
      const miss: Record<string, boolean> = {};
      for (const c of prompt.candidates) {
        // getBlob 只取 Blob 句柄、不读内容，几十 MB 也不卡
        if (!(await getBlob(c.id))) miss[c.id] = true;
        if (!c.mime.startsWith('image/')) continue;
        const u = await urlForFile(c.id);
        if (u) img[c.id] = u;
      }
      if (alive) {
        setThumbs(img);
        setBroken(miss);
      }
    })();
    return () => {
      alive = false;
    };
  }, [prompt]);

  const target = prompt.candidates.find((c) => c.id === sel) ?? null;
  const decide = (action: CollisionAction) =>
    onDecide({ action, target: action === 'create' ? null : target, applyRest });

  return (
    <Modal
      title="这个文件可能与已有的相同"
      onClose={onCancel}
      wide
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            取消上传
          </button>
          <button className="btn btn-ghost" onClick={() => decide('create')}>
            都不一样，作为新文件
          </button>
          <button className="btn" disabled={!target} onClick={() => decide('reuse')}>
            复用所选
          </button>
          <button
            className="btn btn-danger"
            disabled={!target || confirmOver}
            onClick={() => setConfirmOver(true)}
          >
            覆盖所选
          </button>
        </>
      }
    >
      <p className="muted small">
        「{prompt.name}」（{fmtSize(prompt.size)}）的内容摘要与下面这些文件相同。先选中一条，再决定怎么处理：
      </p>
      {uploading && <img className="col-self" src={uploading} alt="" />}

      <div className="col-grid">
        {prompt.candidates.map((c) => (
          <CandidateCard
            key={c.id}
            file={c}
            thumb={thumbs[c.id]}
            broken={!!broken[c.id]}
            selected={c.id === sel}
            onPick={() => {
              setSel(c.id);
              setConfirmOver(false);
            }}
          />
        ))}
      </div>

      {target && broken[target.id] && (
        <p className="col-hint">
          选中这条在库里取不到二进制：复用它会指向空内容，用「覆盖所选」把新内容补回去正好能修好它。
        </p>
      )}

      {confirmOver && target && (
        <div className="col-confirm">
          <p className="small">
            确认用「{prompt.name}」替换 <b>{target.name}</b> 的内容？
            <br />
            引用名 <code>{target.storedId}</code> 不变，正文里的引用照旧可用；<b>旧内容不保留，撤销不了</b>。
          </p>
          <div className="row-actions">
            <button className="btn" onClick={() => setConfirmOver(false)}>
              返回
            </button>
            <button className="btn btn-danger" onClick={() => decide('overwrite')}>
              确认覆盖
            </button>
          </div>
        </div>
      )}

      <label className="col-rest">
        <input type="checkbox" checked={applyRest} onChange={(e) => setApplyRest(e.target.checked)} />
        这一批后面再遇到同样的冲突，按我这次的处置自动处理，不再问
      </label>

      {prompt.sizeDiffers.length > 0 && (
        <p className="muted small">
          另有 {prompt.sizeDiffers.length} 个文件摘要相同但大小不同，已按「不同内容」处理，不在候选里。
        </p>
      )}
      <p className="muted small">
        复用 → 不新增记录、不占额外空间。
        <br />
        覆盖 → 换掉旧那条的二进制，引用名不变，适合旧内容损坏/丢失。
        <br />
        都不一样 → 视为 hash 碰撞，新文件拿到顺延名（如 _1、_2）。
      </p>
    </Modal>
  );
}
