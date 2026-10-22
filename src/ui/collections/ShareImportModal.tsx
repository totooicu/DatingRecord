// 导入事件集分享：先预览，再决定要不要真的进来。
//
// 预览这一层不是走过场——分享文件来自别人的库，里面的人物在我这儿
// 可能是同一个人（同名）、也可能是全新的人。认错人会把两段记录拧成两个人，
// 之后再想合就很麻烦。所以这里把「每个人落到谁身上」摊开给用户看，
// 同名已经预选好，用户只需要扫一眼。
//
// 只读预览：不点「导入」就一个字节都不会写进库里。
import { useMemo, useRef, useState } from 'react';
import { NEW_PERSON, applyShare, parseShare, planShare, type SharePlan } from '../../core/io';
import { flattenTree, getRoot, getTree } from '../../core/repo/collections';
import { listPersons } from '../../core/repo/persons';
import { formatTime } from '../../core/time';
import { bump } from '../../store';
import { Modal } from '../common';
import { Avatar } from '../persons/Avatar';
import type { ShareFile } from '../../core/types';

/** 入口按钮：自己管弹窗开关，方便在任何地方塞一个 */
export function ShareImportButton({ text = '导入分享' }: { text?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)} title="从 .drshare.json 预览并导入别人的事件集">
        ⇩ {text}
      </button>
      {open && <ShareImportModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function ShareImportModal({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<SharePlan | null>(null);
  const [personMap, setPersonMap] = useState<Record<string, string>>({});
  const [parentId, setParentId] = useState<string>('');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const persons = useMemo(() => listPersons({ includeArchived: true }), []);
  const flat = useMemo(() => flattenTree(getTree()), []);

  const load = async (file: File) => {
    setError(null);
    setResult(null);
    try {
      const share: ShareFile = parseShare(await file.text());
      const p = planShare(share);
      setPlan(p);
      // 同名自动关联的结果直接预选上：绝大多数情况不用动
      const auto: Record<string, string> = {};
      for (const row of p.persons) if (row.suggestedId) auto[row.person.id] = row.suggestedId;
      setPersonMap(auto);
      setParentId(getRoot()?.id ?? '');
      setShowAll(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doImport = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const r = await applyShare(plan.share, { personMap, parentId: parentId || null });
      bump();
      setResult(
        `已导入：事件 ${r.counts.events}、事件集 ${r.counts.collections}、` +
          `成员 ${r.counts.members}、人物 ${r.counts.persons}、消息 ${r.counts.messages ?? 0}、` +
          `附件 ${r.counts.attachments ?? 0}；跳过 ${r.skipped}（本地已有更新版本）`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={plan ? `导入分享 · ${plan.rootName}` : '导入事件集分享'}
      onClose={onClose}
      footer={
        <>
          {result ? (
            <button className="btn btn-primary" onClick={onClose}>
              完成
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={onClose}>
                取消
              </button>
              <button className="btn btn-primary" disabled={!plan || busy} onClick={() => void doImport()}>
                {busy ? '导入中…' : plan ? `导入 ${plan.eventCount} 个事件` : '导入'}
              </button>
            </>
          )}
        </>
      }
    >
      {!plan && (
        <div className="share-pick">
          <p className="muted">
            选择一份 .drshare.json（别人「分享事件集」生成的文件）。先预览里面有什么、
            人物怎么关联，确认后再导入。
          </p>
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
            选择分享文件
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.drshare.json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {plan && (
        <div className="share-preview">
          {result ? (
            <div className="alert alert-ok">{result}</div>
          ) : (
            <>
              <div className="share-summary">
                <span>
                  <em>{plan.rootName}</em>
                </span>
                <span className="muted small">
                  事件集 {plan.collectionCount} 个 · 事件 {plan.eventCount} 个 · 人物{' '}
                  {plan.persons.length} 位
                </span>
              </div>

              {plan.missingAttachments > 0 && (
                <div className="alert">
                  有 {plan.missingAttachments} 处引用了原库的图片/文件，这份分享没带上，
                  导入后这些位置会显示不出来。
                </div>
              )}

              <section className="share-block">
                <h4>事件集结构</h4>
                <div className="share-tree">
                  {plan.share.collections.map((c) => (
                    <div
                      key={c.id}
                      className={c.id === plan.share.rootId ? 'share-tree-row share-tree-root' : 'share-tree-row'}
                    >
                      {c.name}
                      {c.kind === 'smart' && <em title="智能集合：成员由规则实时算出">⚡</em>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="share-block">
                <h4>事件</h4>
                <div className="share-events">
                  {(showAll ? plan.share.events : plan.share.events.slice(0, 8)).map((e) => (
                    <div key={e.id} className="share-event-row">
                      <strong>{e.title || '未命名事件'}</strong>
                      <span className="muted small">{formatTime(e.time)}</span>
                    </div>
                  ))}
                </div>
                {plan.share.events.length > 8 && (
                  <button className="btn btn-sm" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? '收起' : `展开全部 ${plan.share.events.length} 个`}
                  </button>
                )}
              </section>

              <section className="share-block">
                <h4>人物关联</h4>
                <p className="muted small">
                  同名人物已自动关联（下方预选），请确认没有认错。选「新建人物」会在本库
                  新建一位；什么都不选、又找不到同名的，导入时也会新建。
                </p>
                {plan.persons.length === 0 && <p className="muted">这份分享里没有人物。</p>}
                <div className="share-map">
                  {plan.persons.map((row) => (
                    <div key={row.person.id} className="share-map-row">
                      <Avatar
                        name={row.person.displayName}
                        avatar={row.person.avatar}
                        icon={row.person.icon}
                        size="sm"
                      />
                      <div className="share-map-from">
                        <strong>{row.person.displayName}</strong>
                        <span className="muted small">
                          {row.eventCount > 0 ? `出现 ${row.eventCount} 次` : '未直接出现'}
                        </span>
                      </div>
                      <span className="share-map-arrow">→</span>
                      <select
                        value={personMap[row.person.id] ?? NEW_PERSON}
                        onChange={(e) =>
                          setPersonMap((m) => ({ ...m, [row.person.id]: e.target.value }))
                        }
                      >
                        <option value={NEW_PERSON}>新建人物（{row.person.displayName}）</option>
                        {persons.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                            {p.id === row.suggestedId ? '（同名）' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </section>

              <section className="share-block">
                <h4>放到哪里</h4>
                <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  {flat.map(({ id, name, depth }) => (
                    <option key={id} value={id}>
                      {'　'.repeat(depth)}
                      {name}
                    </option>
                  ))}
                </select>
                <p className="muted small">
                  分享里的子事件集会保持原来的层级，只有最外层挂到你选的位置。
                </p>
              </section>
            </>
          )}
        </div>
      )}

      {error && <div className="alert alert-err">{error}</div>}
    </Modal>
  );
}
