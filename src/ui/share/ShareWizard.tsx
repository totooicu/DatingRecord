// 分享向导：一个入口，四步走完。
//
//   ① 多选事件集（选中的会连子事件集一起带走）
//   ② 多选人物（只决定「谁的资料被带走」——事件仍然是第一步圈定的那些）
//   ③ 分享程度（人物资料留多少 / 要不要附件）
//   ④ 预览，确认无误就生成压缩包
//
// 四步共用一个 state，任意一步都能退回改，改完再往后走时前面算出来的东西
// 会按新选择重算：选人物只看当前事件集里的人，预览只看当前全部选择。
import { useEffect, useMemo, useState } from 'react';
import {
  buildShare,
  exportShareArchive,
  personsInCollections,
  type ShareOptions,
} from '../../core/io';
import { getTree, type TreeNode } from '../../core/repo/collections';
import { listDefs } from '../../core/repo/persons';
import { formatTime } from '../../core/time';
import { SHARE_LEVELS, type ShareFile, type ShareLevel } from '../../core/types';
import { Modal } from '../common';
import { Avatar } from '../persons/Avatar';
import { showToast } from '../toast';

const STEPS = ['事件集', '人物', '程度', '预览'];

interface ColRow {
  id: string;
  name: string;
  depth: number;
  smart: boolean;
  /** 含子集在内的事件数 */
  eventCount: number;
}

/** 把树摊平，根集合本身不列出来——分享「全部」没有意义，也从顶层事件集开始选 */
function rowsOf(tree: TreeNode | null): ColRow[] {
  const out: ColRow[] = [];
  const walk = (n: TreeNode, depth: number) => {
    out.push({
      id: n.id,
      name: n.name,
      depth,
      smart: n.kind === 'smart',
      eventCount: n.totalEventCount,
    });
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const c of tree?.children ?? []) walk(c, 0);
  return out;
}

export function ShareWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [colIds, setColIds] = useState<string[]>([]);
  /** 记录「没勾」的人，而不是「勾了」的人：换事件集后新出现的人默认带上资料 */
  const [unpicked, setUnpicked] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<ShareLevel>('full');
  const [attrKeys, setAttrKeys] = useState<string[]>([]);
  const [withAttachments, setWithAttachments] = useState(true);
  const [preview, setPreview] = useState<ShareFile | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const treeRows = useMemo(() => rowsOf(getTree()), []);
  const colsKey = colIds.join(',');
  const people = useMemo(() => (colIds.length ? personsInCollections(colIds) : []), [colsKey]);

  // 上级被选中时，子孙跟着走；这一行只展示，不再单独切换
  const impliedIds = useMemo(() => {
    const out = new Set<string>();
    const walk = (n: TreeNode, inherited: boolean) => {
      const on = inherited || colIds.includes(n.id);
      for (const c of n.children) {
        if (on) out.add(c.id);
        walk(c, on);
      }
    };
    const tree = getTree();
    if (tree) walk(tree, false);
    return out;
  }, [colsKey]);

  const pickedIds = useMemo(
    () => people.map((r) => r.person.id).filter((id) => !unpicked.has(id)),
    [people, unpicked],
  );
  const pickedKey = pickedIds.join(',');

  const opts: ShareOptions = useMemo(
    () => ({
      level,
      attrKeys: level === 'custom' ? attrKeys : [],
      includeAttachments: withAttachments,
    }),
    [level, attrKeys, withAttachments],
  );

  // 预览不读附件二进制：统计口径一样，但不用为了看一眼把整包图片搬进内存
  useEffect(() => {
    if (step !== 4) return;
    let alive = true;
    setPreview(null);
    setPreviewError(null);
    void (async () => {
      try {
        const share = await buildShare(
          { collectionIds: colIds, personIds: pickedIds },
          { ...opts, includeAttachments: false },
        );
        if (alive) setPreview(share);
      } catch (e) {
        if (alive) setPreviewError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [step, colsKey, pickedKey, level, attrKeys, withAttachments]);

  const defs = useMemo(() => (level === 'custom' ? listDefs() : []), [level]);

  const toggleCol = (row: ColRow) => {
    if (impliedIds.has(row.id)) return;
    setColIds((old) => (old.includes(row.id) ? old.filter((x) => x !== row.id) : [...old, row.id]));
  };

  const togglePerson = (id: string) => {
    setUnpicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canNext = step !== 1 || colIds.length > 0;

  const exportNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = await exportShareArchive({ collectionIds: colIds, personIds: pickedIds }, opts);
      showToast(`已生成分享压缩包：${name}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stepTitle =
    step === 1
      ? '选择要分享的事件集'
      : step === 2
        ? '选择要带走资料的人物'
        : step === 3
          ? '选择分享程度'
          : '预览并导出';

  return (
    <Modal
      wide
      title="开始分享"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          {step > 1 && (
            <button className="btn" onClick={() => setStep((s) => s - 1)}>
              上一步
            </button>
          )}
          {step < 4 && (
            <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              下一步
            </button>
          )}
          {step === 4 && (
            <button
              className="btn btn-primary"
              disabled={busy || !preview}
              onClick={() => void exportNow()}
            >
              {busy ? '打包中…' : '生成压缩包'}
            </button>
          )}
        </>
      }
    >
      <div className="share-steps" aria-label="分享步骤">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const cls =
            n === step
              ? 'share-step share-step-on'
              : n < step
                ? 'share-step share-step-done'
                : 'share-step';
          return (
            <span key={label} className={cls}>
              <em>{n}</em>
              {label}
            </span>
          );
        })}
      </div>

      <h4 className="share-wizard-title">{stepTitle}</h4>

      {step === 1 && (
        <>
          <div className="share-wizard-tools">
            <span className="muted small">
              选中的事件集会连同子事件集一起带走；改主意可以随时回到这一步。
            </span>
            <span className="share-wizard-btns">
              <button
                className="btn btn-sm"
                onClick={() => setColIds(treeRows.filter((r) => r.depth === 0).map((r) => r.id))}
              >
                全选
              </button>
              <button className="btn btn-sm" onClick={() => setColIds([])}>
                清空
              </button>
            </span>
          </div>
          {treeRows.length === 0 ? (
            <p className="muted">还没有事件集。</p>
          ) : (
            <div className="share-pick-list">
              {treeRows.map((row) => {
                const implied = impliedIds.has(row.id);
                const checked = implied || colIds.includes(row.id);
                return (
                  <label
                    key={row.id}
                    className={checked ? 'share-pick-row share-pick-on' : 'share-pick-row'}
                    style={{ paddingLeft: 12 + row.depth * 18 }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={implied}
                      onChange={() => toggleCol(row)}
                    />
                    <span className="share-pick-name">
                      {row.name}
                      {row.smart && <em title="智能集合：成员由规则实时算出">⚡</em>}
                    </span>
                    <span className="muted small">{row.eventCount} 个事件</span>
                    {implied && <span className="share-pick-tag">随上级</span>}
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <div className="share-wizard-tools">
            <span className="muted small">
              只决定带谁的资料：没勾的人仍然出现在事件里，但只留姓名（按分享程度可能化名）。
            </span>
            <span className="share-wizard-btns">
              <button
                className="btn btn-sm"
                onClick={() => setUnpicked(new Set())}
                disabled={people.length === 0}
              >
                全选
              </button>
              <button
                className="btn btn-sm"
                onClick={() => setUnpicked(new Set(people.map((r) => r.person.id)))}
                disabled={people.length === 0}
              >
                全不选
              </button>
            </span>
          </div>
          {people.length === 0 ? (
            <p className="muted">
              选中事件集里还没有人物。事件仍然可以分享，导入后对方看到的是没有人物关联的记录。
            </p>
          ) : (
            <div className="share-pick-list">
              {people.map(({ person, eventCount }) => {
                const checked = !unpicked.has(person.id);
                return (
                  <label
                    key={person.id}
                    className={checked ? 'share-pick-row share-pick-on' : 'share-pick-row'}
                  >
                    <input type="checkbox" checked={checked} onChange={() => togglePerson(person.id)} />
                    <Avatar
                      name={person.displayName}
                      avatar={person.avatar}
                      icon={person.icon}
                      size="sm"
                    />
                    <span className="share-pick-name">{person.displayName}</span>
                    <span className="muted small">出现 {eventCount} 次</span>
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}

      {step === 3 && (
        <div className="share-levels">
          <p className="muted small">
            事件集和事件固定就是前两步圈定的那些，这里只决定人物资料留多少。
          </p>
          {SHARE_LEVELS.map((lv) => (
            <label
              key={lv.key}
              className={level === lv.key ? 'share-level share-level-on' : 'share-level'}
            >
              <input
                type="radio"
                name="share-level"
                checked={level === lv.key}
                onChange={() => setLevel(lv.key)}
              />
              <span className="share-level-text">
                <strong>{lv.title}</strong>
                <span className="muted small">{lv.desc}</span>
              </span>
            </label>
          ))}

          {level === 'custom' && (
            <div className="share-attrs">
              <div className="share-attrs-title">带哪些属性</div>
              {defs.length === 0 && <p className="muted small">属性字典还是空的，只能带走姓名。</p>}
              <div className="share-attr-list">
                {defs.map((d) => (
                  <label key={d.key} className="checkbox">
                    <input
                      type="checkbox"
                      checked={attrKeys.includes(d.key)}
                      onChange={(e) =>
                        setAttrKeys((old) =>
                          e.target.checked ? [...old, d.key] : old.filter((k) => k !== d.key),
                        )
                      }
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="checkbox share-attach-toggle">
            <input
              type="checkbox"
              checked={withAttachments}
              onChange={(e) => setWithAttachments(e.target.checked)}
            />
            带上正文引用的图片与附件
          </label>

          {level !== 'full' && (
            <p className="muted small">这个程度下，标记为隐私的事件整条不带走。</p>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="share-preview">
          {previewError && <div className="alert alert-err">{previewError}</div>}
          {!preview && !previewError && <p className="muted">正在统计…</p>}
          {preview && (
            <>
              <div className="share-summary">
                <span>
                  <em>{preview.sourceName ?? '分享'}</em>
                </span>
                <span className="muted small">
                  事件集 {preview.collections.length} 个（含子集） · 事件{' '}
                  {preview.events.length} 个 · 人物 {preview.persons.length} 位（资料{' '}
                  {preview.pickedPersonIds?.length ?? 0} 位） · 引用附件 {preview.missingAttachments}{' '}
                  个
                </span>
              </div>

              <section className="share-block">
                <h4>事件集</h4>
                <div className="share-tree">
                  {preview.collections.map((c) => (
                    <span
                      key={c.id}
                      className={
                        preview.collectionIds?.includes(c.id)
                          ? 'share-tree-row share-tree-root'
                          : 'share-tree-row'
                      }
                    >
                      {c.name}
                      {c.kind === 'smart' && <em title="智能集合">⚡</em>}
                    </span>
                  ))}
                </div>
              </section>

              <section className="share-block">
                <h4>事件</h4>
                <div className="share-events">
                  {(showAllEvents ? preview.events : preview.events.slice(0, 8)).map((e) => (
                    <div key={e.id} className="share-event-row">
                      <strong>{e.title || '未命名事件'}</strong>
                      <span className="muted small">{formatTime(e.time)}</span>
                    </div>
                  ))}
                  {preview.events.length === 0 && <p className="muted small">没有事件。</p>}
                </div>
                {preview.events.length > 8 && (
                  <button className="btn btn-sm" onClick={() => setShowAllEvents((v) => !v)}>
                    {showAllEvents ? '收起' : `展开全部 ${preview.events.length} 个`}
                  </button>
                )}
              </section>

              <section className="share-block">
                <h4>人物</h4>
                <div className="share-pick-list">
                  {preview.persons.map((p) => {
                    const full = preview.pickedPersonIds?.includes(p.id);
                    return (
                      <div key={p.id} className="share-pick-row share-pick-static">
                        <span className="share-pick-name">{p.displayName}</span>
                        <span className={full ? 'share-pick-tag' : 'share-pick-tag share-pick-muted'}>
                          {full ? '带资料' : level === 'alias' ? '仅化名' : '仅姓名'}
                        </span>
                      </div>
                    );
                  })}
                  {preview.persons.length === 0 && <p className="muted small">没有人物。</p>}
                </div>
              </section>

              <p className="muted small">
                {withAttachments
                  ? `正文引用到的 ${preview.missingAttachments} 个附件会一起打进压缩包（库里找不到的会略过）。`
                  : '按你的选择，不打包附件；对方看到的图片位置会显示不出来。'}
              </p>
            </>
          )}
        </div>
      )}

      {error && <div className="alert alert-err">{error}</div>}
    </Modal>
  );
}
