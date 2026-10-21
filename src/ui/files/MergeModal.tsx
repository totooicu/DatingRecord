// 文件合并：把「内容相似但 hash 不同」的文件并到一个目标上。
//
// 内容寻址只能自动去重完全相同的文件；用户可能有同一张图的两个裁剪版、
// 或者改名重传过的副本。这个功能让他们手工指认「这些都算同一张」，
// 然后把引用全部并到目标上，源文件删除。
//
// 一切先预览：改哪些事件、动几个头像、能省多少空间，看清楚了再按确认。
import { useEffect, useMemo, useState } from 'react';
import { urlForFile } from '../../core/repo/files';
import { commitMerge, previewMerge, type MergePreview } from '../../core/files';
import { useVersion, bump } from '../../store';
import { Modal } from '../common';
import { fmtSize } from './fileFormat';

export function MergeModal({
  targetId,
  sourceIds,
  onClose,
  onDone,
}: {
  targetId: string;
  sourceIds: string[];
  onClose: () => void;
  onDone?: (msg: string) => void;
}) {
  const v = useVersion();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = useMemo<MergePreview | null>(() => previewMerge(targetId, sourceIds), [v, targetId, sourceIds]);

  const idsKey = [targetId, ...sourceIds].join(',');
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, string> = {};
      for (const id of idsKey.split(',')) {
        const u = await urlForFile(id);
        if (u) next[id] = u;
      }
      if (alive) setThumbs(next);
    })();
    return () => {
      alive = false;
    };
  }, [idsKey]);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await commitMerge(targetId, sourceIds);
      bump();
      onDone?.(`已合并 ${sourceIds.length} 个文件，引用已全部指向目标`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '合并失败');
    } finally {
      setBusy(false);
    }
  };

  if (!preview) {
    return (
      <Modal title="合并文件" onClose={onClose}>
        <p className="muted">目标文件或源文件已不存在，可能刚刚被删除了。</p>
      </Modal>
    );
  }

  return (
    <Modal
      title="合并文件"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void run()} disabled={busy}>
            {busy ? '合并中…' : '确认合并'}
          </button>
        </>
      }
    >
      <p className="muted small">
        「{preview.target.name}」将接收以下 {preview.sources.length} 个文件的全部引用，源文件随后删除。
        事件正文和人物头像都会自动改指到目标，不需要手工编辑。
      </p>

      <div className="col-grid">
        <div className="col-card col-card-target">
          {thumbs[preview.target.id] ? (
            <img className="col-thumb" src={thumbs[preview.target.id]} alt="" />
          ) : (
            <span className="col-thumb col-thumb-icon">目标</span>
          )}
          <span className="col-name">{preview.target.name}</span>
          <span className="muted small">{fmtSize(preview.target.size)}</span>
        </div>
        {preview.sources.map((s) => (
          <div key={s.id} className="col-card">
            {thumbs[s.id] ? (
              <img className="col-thumb" src={thumbs[s.id]} alt="" />
            ) : (
              <span className="col-thumb col-thumb-icon">{s.mime.split('/')[0]}</span>
            )}
            <span className="col-name">{s.name}</span>
            <span className="muted small">{fmtSize(s.size)}</span>
          </div>
        ))}
      </div>

      <ul className="mig-plan">
        <li>{preview.events.length} 个事件的正文会改写</li>
        <li>
          {preview.avatarPersons.length > 0
            ? `${preview.avatarPersons.length} 个人物头像会改指到目标文件：${preview.avatarPersons
                .map((p) => p.displayName)
                .join('、')}`
            : '没有人物的头像指向这些文件'}
        </li>
        <li>合并后可释放 {fmtSize(preview.freedBytes)}</li>
      </ul>

      {preview.events.length > 0 && (
        <details className="mig-groups" open>
          <summary>将被改写的事件</summary>
          <ul>
            {preview.events.map((e) => (
              <li key={e.id}>
                {e.title} <span className="muted small">（{e.count} 处引用）</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {err && <p className="form-err">{err}</p>}
    </Modal>
  );
}
