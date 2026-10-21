// 上传冲突裁决弹窗：大文件同 hash 同大小时，由人判断「是不是同一份」。
//
// 为什么不让程序决定：逐字节比一个 50MB 的视频要读 100MB 数据，
// 在浏览器里就是几秒的卡顿；而人看一眼缩略图就能断定。
// 所以阈值以上一律弹窗，选项里永远有「都不一样」——那才是 hash 碰撞。
import { useEffect, useState } from 'react';
import { urlForFile, type StoredFile } from '../../core/repo/files';
import { Modal } from '../common';
import { fmtSize } from './fileFormat';
import type { CollisionPrompt } from '../../core/files';

/** 候选缩略图 + 「我已核对过」标记 */
function CandidateCard({
  file,
  thumb,
  verified,
  onPick,
}: {
  file: StoredFile;
  thumb?: string;
  verified: boolean;
  onPick: () => void;
}) {
  return (
    <button type="button" className="col-card" onClick={onPick}>
      {thumb ? (
        <img className="col-thumb" src={thumb} alt="" />
      ) : (
        <span className="col-thumb col-thumb-icon">{file.mime.split('/')[0]}</span>
      )}
      <span className="col-name">{file.name}</span>
      <span className="muted small">
        {fmtSize(file.size)} · {file.storedId.slice(0, 14)}…
      </span>
      {verified && <span className="col-badge">已核对一致</span>}
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
  /** 上传中的预览图（objectURL），可选 */
  uploading?: string;
  onDecide: (pick: StoredFile | null) => void;
  onCancel: () => void;
}) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, string> = {};
      for (const c of prompt.candidates) {
        if (!c.mime.startsWith('image/')) continue;
        const u = await urlForFile(c.id);
        if (u) next[c.id] = u;
      }
      if (alive) setThumbs(next);
    })();
    return () => {
      alive = false;
    };
  }, [prompt]);

  /** 点候选＝认定同一份。标记一下让用户看到自己选了什么 */
  const pick = (c: StoredFile) => {
    setVerified((v) => ({ ...v, [c.id]: true }));
    onDecide(c);
  };

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
          <button className="btn btn-ghost" onClick={() => onDecide(null)}>
            都不一样，作为新文件
          </button>
        </>
      }
    >
      <p className="muted small">
        「{prompt.name}」（{fmtSize(prompt.size)}）的内容摘要与下面这些文件相同。请确认它是不是同一份：
      </p>
      {uploading && <img className="col-self" src={uploading} alt="" />}

      <div className="col-grid">
        {prompt.candidates.map((c) => (
          <CandidateCard
            key={c.id}
            file={c}
            thumb={thumbs[c.id]}
            verified={!!verified[c.id]}
            onPick={() => pick(c)}
          />
        ))}
      </div>

      {prompt.sizeDiffers.length > 0 && (
        <p className="muted small">
          另有 {prompt.sizeDiffers.length} 个文件摘要相同但大小不同，已按「不同内容」处理，不在候选里。
        </p>
      )}
      <p className="muted small">
        选一个 → 认定为同一份内容，直接复用它的引用（不占额外空间）。
        <br />
        选「都不一样」→ 视为 hash 碰撞，新文件会拿到顺延的名字（如 _1、_2）。
      </p>
    </Modal>
  );
}
