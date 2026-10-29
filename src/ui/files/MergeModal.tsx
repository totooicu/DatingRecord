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

  const [selectedTarget, setSelectedTarget] = useState(targetId);
  const candidates = useMemo(() => [...new Set([targetId, ...sourceIds])], [targetId, sourceIds]);
  const selectedSources = useMemo(() => candidates.filter((id) => id !== selectedTarget), [candidates, selectedTarget]);
  const preview = useMemo<MergePreview | null>(
    () => previewMerge(selectedTarget, selectedSources),
    [v, selectedTarget, selectedSources],
  );

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
      await commitMerge(selectedTarget, selectedSources);
      bump();
      onDone?.(`已合并 ${selectedSources.length} 个文件，引用已全部指向目标`);
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

      <p className="muted small">点击文件卡片切换要保留的目标，其他文件将合并到它。</p>
      <div className="col-grid">
        {candidates.map((id) => {
          const f = [preview.target, ...preview.sources].find((file) => file.id === id);
          if (!f) return null;
          const selected = id === selectedTarget;
          return (
            <button
              key={id}
              type="button"
              className={`col-card${selected ? ' col-card-target' : ''}`}
              aria-label={`保留 ${f.name}`}
              aria-pressed={selected}
              disabled={busy}
              onClick={() => {
                setSelectedTarget(id);
                setErr(null);
              }}
            >
              {thumbs[id] ? (
                <img className="col-thumb" src={thumbs[id]} alt="" />
              ) : (
                <span className="col-thumb col-thumb-icon">{f.mime.split('/')[0]}</span>
              )}
              <span className="col-name">{f.name}</span>
              <span className="muted small">{fmtSize(f.size)}</span>
              {selected && <span className="col-badge">保留这个</span>}
            </button>
          );
        })}
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
