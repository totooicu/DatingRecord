// 分享向导：一个入口，四步走完。
//
//   ① 多选事件集（可再展开挑具体事件）
//   ② 选人物：事件涉及的人必带，另外可以多选没涉及到的人
//   ③ 分享程度（人物资料留多少 / 要不要附件）
//   ④ 预览，点人物看资料、点事件看正文，确认无误就生成压缩包
//
// 四步共用一个 state，任意一步都能退回改，改完再往后走时前面算出来的东西
// 会按新选择重算：选人物只看当前事件，预览只看当前全部选择。
import { useEffect, useMemo, useState } from 'react';
import {
  buildShare,
  eventsOfCollections,
  exportShareArchive,
  personsInCollections,
  type ShareOptions,
} from '../../core/io';
import {
  getBreadcrumb,
  getCollection,
  getTree,
  listChildren,
  listSmartEvents,
  type TreeNode,
} from '../../core/repo/collections';
import { listDefs, listPersons } from '../../core/repo/persons';
import { formatTime } from '../../core/time';
import {
  SHARE_LEVELS,
  type Collection,
  type DREvent,
  type Person,
  type ShareFile,
  type ShareLevel,
} from '../../core/types';
import { clearDraft, draftsEnabled, draftTimeLabel, loadDraft, saveDraft } from '../../core/drafts';
import { formatAttrValue } from '../attr';
import { Modal, Empty } from '../common';
import { EventView } from '../event/EventView';
import { Avatar } from '../persons/Avatar';
import { showToast } from '../toast';
import {
  ChatPreview,
  ColPeekModal,
  RepoEventPeek,
  ruleTextOf,
  type ColPeekData,
} from './SharePeeks';

const STEPS = ['事件集', '人物', '程度', '预览'];

/** 草稿只存「选到哪儿了」，不存预览结果与派生的 id 集合 */
const DRAFT_KEY = 'share-wizard';

interface WizardDraft {
  step: number;
  colIds: string[];
  excluded: string[];
  expanded: string[];
  extraPicked: string[];
  level: ShareLevel;
  attrKeys: string[];
  withAttachments: boolean;
}


interface ColRow {
  id: string;
  name: string;
  depth: number;
  smart: boolean;
  /** 含子集在内的事件数 */
  eventCount: number;
  /** 从根到父的 id，用来判断这一行是不是「选择根」 */
  ancestors: string[];
}

/** 把树摊平，根集合本身不列出来——分享「全部」没有意义，也从顶层事件集开始选 */
function rowsOf(tree: TreeNode | null): ColRow[] {
  const out: ColRow[] = [];
  const walk = (n: TreeNode, depth: number, ancestors: string[]) => {
    out.push({
      id: n.id,
      name: n.name,
      depth,
      smart: n.kind === 'smart',
      eventCount: n.totalEventCount,
      ancestors,
    });
    for (const c of n.children) walk(c, depth + 1, [...ancestors, n.id]);
  };
  for (const c of tree?.children ?? []) walk(c, 0, []);
  return out;
}

/** 属性值的展示：按字典顺序，找不到定义就退回 key */
function attrsOf(p: Person, defs: ReturnType<typeof listDefs>) {
  return Object.entries(p.attrs).map(([key, av]) => {
    const def = defs.find((d) => d.key === key);
    return {
      key,
      label: def?.label ?? key,
      text: def ? formatAttrValue(def, av.v) : String(av.v ?? ''),
    };
  });
}

const STATUS_TEXT: Record<Collection['status'], string> = {
  ongoing: '进行中',
  finished: '已完成',
  archived: '已归档',
};

/** 本库的事件集详情：事件按当前勾选状态标出「不分享」 */
function repoColPeek(id: string, excluded: Set<string>): ColPeekData | null {
  const c = getCollection(id);
  if (!c) return null;
  return {
    name: c.name,
    smart: c.kind === 'smart',
    path: getBreadcrumb(id)
      .filter((x) => !x.isRoot && x.id !== id)
      .map((x) => x.name)
      .join(' / '),
    description: c.description,
    ruleText: ruleTextOf(c),
    statusLabel: STATUS_TEXT[c.status] ?? c.status,
    isPrivate: c.isPrivate,
    children: listChildren(id).map((x) => x.name),
    events: eventsOfCollections([id]).map((e) => ({ event: e, off: excluded.has(e.id) })),
  };
}

/** 预览里的事件集详情：只能看打包带走的那些事件与子集 */
function shareColPeek(c: Collection, share: ShareFile): ColPeekData {
  const byId = new Map(share.collections.map((x) => [x.id, x]));
  const path: string[] = [];
  let p = c.parentId ? byId.get(c.parentId) : null;
  while (p) {
    if (!p.isRoot) path.unshift(p.name);
    p = p.parentId ? byId.get(p.parentId) : null;
  }

  // 子集 + 直接挂在本集合上的事件；智能集合没有成员行，事件得按规则现算再和包内事件取交集
  const ids = new Set([c.id]);
  const stack = [c.id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const x of share.collections) {
      if (x.parentId === cur && !ids.has(x.id)) {
        ids.add(x.id);
        stack.push(x.id);
      }
    }
  }
  const eventIds = new Set(
    share.members
      .filter((m) => m.memberType === 'event' && ids.has(m.collectionId))
      .map((m) => m.memberId),
  );
  for (const x of share.collections) {
    if (!ids.has(x.id) || x.kind !== 'smart') continue;
    for (const e of listSmartEvents(x)) eventIds.add(e.id);
  }

  return {
    name: c.name,
    smart: c.kind === 'smart',
    path: path.join(' / '),
    description: c.description,
    ruleText: ruleTextOf(c),
    statusLabel: STATUS_TEXT[c.status] ?? c.status,
    isPrivate: c.isPrivate,
    children: share.collections.filter((x) => x.parentId === c.id).map((x) => x.name),
    events: share.events.filter((e) => eventIds.has(e.id)).map((e) => ({ event: e })),
  };
}

export function ShareWizard({ onClose }: { onClose: () => void }) {
  // 打开时先看看有没有上次没做完的草稿（开关关着时 loadDraft 恒为 null）
  const [restored] = useState(() => loadDraft<WizardDraft>(DRAFT_KEY));
  const saved = restored?.data;
  const [step, setStep] = useState(saved?.step ?? 1);
  const [colIds, setColIds] = useState<string[]>(saved?.colIds ?? []);
  /** 被单独取消勾选的事件（全局生效：同一个事件在别的事件集下也不会分享） */
  const [excluded, setExcluded] = useState<Set<string>>(new Set(saved?.excluded ?? []));
  const [expanded, setExpanded] = useState<Set<string>>(new Set(saved?.expanded ?? []));
  /** 额外多选的人：不在事件里，但资料要一起带走 */
  const [extraPicked, setExtraPicked] = useState<Set<string>>(new Set(saved?.extraPicked ?? []));
  const [level, setLevel] = useState<ShareLevel>(saved?.level ?? 'full');
  const [attrKeys, setAttrKeys] = useState<string[]>(saved?.attrKeys ?? []);
  const [withAttachments, setWithAttachments] = useState(saved?.withAttachments ?? true);
  const [restoredAt, setRestoredAt] = useState<number | null>(restored ? restored.updatedAt : null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [preview, setPreview] = useState<ShareFile | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [personView, setPersonView] = useState<Person | null>(null);
  const [eventView, setEventView] = useState<DREvent | null>(null);
  /** 事件集详情：repo = 挑选阶段看本库，share = 预览阶段看包内 */
  const [colPeek, setColPeek] = useState<{ data: ColPeekData; from: 'repo' | 'share' } | null>(null);
  const [repoEventPeek, setRepoEventPeek] = useState<DREvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const treeRows = useMemo(() => rowsOf(getTree()), []);
  const colsKey = colIds.join(',');

  // 只有「选择根」需要展开事件：子集的事件已经包含在父集里了
  const selectionRoots = useMemo(
    () => colIds.filter((id) => !(treeRows.find((r) => r.id === id)?.ancestors ?? []).some((a) => colIds.includes(a))),
    [colsKey, treeRows],
  );

  const groups = useMemo(() => {
    const byId = new Map(treeRows.map((r) => [r.id, r]));
    return selectionRoots.map((id) => ({
      id,
      name: byId.get(id)?.name ?? '',
      events: eventsOfCollections([id]),
    }));
  }, [selectionRoots, treeRows]);

  /** 最终要带走的事件：选中事件集的并集，减掉被取消勾选的 */
  const eventIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) for (const e of g.events) if (!excluded.has(e.id)) set.add(e.id);
    return [...set];
  }, [groups, excluded]);
  const eventsKey = eventIds.join(',');

  const involved = useMemo(
    () => (colIds.length ? personsInCollections(colIds, eventIds) : []),
    [colsKey, eventsKey],
  );
  const involvedIds = useMemo(() => new Set(involved.map((r) => r.person.id)), [involved]);
  const extras = useMemo(
    () => listPersons().filter((p) => !involvedIds.has(p.id)),
    [involvedIds],
  );

  const pickedIds = useMemo(() => {
    const set = new Set(involved.map((r) => r.person.id));
    for (const id of extraPicked) set.add(id);
    return [...set];
  }, [involved, extraPicked]);
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
          { collectionIds: colIds, eventIds, personIds: pickedIds },
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
  }, [step, colsKey, eventsKey, pickedKey, level, attrKeys, withAttachments]);

  // 草稿跟着每次改动落盘：500ms 防抖，连续点选时不至于一直写 localStorage。
  // 第 4 步的预览结果不存——它由前面的选择算得出来，存了反而会读到过期数据。
  const draftSig = [
    step,
    colsKey,
    [...excluded].sort().join(','),
    [...expanded].sort().join(','),
    [...extraPicked].sort().join(','),
    level,
    attrKeys.join(','),
    String(withAttachments),
  ].join('|');
  useEffect(() => {
    if (!draftsEnabled()) return;
    const empty = step === 1 && colIds.length === 0 && excluded.size === 0 && extraPicked.size === 0;
    if (empty) {
      clearDraft(DRAFT_KEY);
      return;
    }
    const t = setTimeout(() => {
      saveDraft<WizardDraft>(DRAFT_KEY, `分享向导（第 ${step} 步，还没导出）`, {
        step,
        colIds,
        excluded: [...excluded],
        expanded: [...expanded],
        extraPicked: [...extraPicked],
        level,
        attrKeys,
        withAttachments,
      });
    }, 500);
    return () => clearTimeout(t);
    // 依赖统一收进 draftSig，逐项列出会重复触发
  }, [draftSig]);

  const defs = useMemo(() => listDefs(true), []);
  const levelDefs = useMemo(() => (level === 'custom' ? listDefs() : []), [level]);

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

  const toggleCol = (row: ColRow) => {
    if (impliedIds.has(row.id)) return;
    setColIds((old) => (old.includes(row.id) ? old.filter((x) => x !== row.id) : [...old, row.id]));
  };

  const toggleExpand = (id: string) => {
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEvent = (id: string) => {
    setExcluded((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setGroupEvents = (events: DREvent[], on: boolean) => {
    setExcluded((old) => {
      const next = new Set(old);
      for (const e of events) {
        if (on) next.delete(e.id);
        else next.add(e.id);
      }
      return next;
    });
  };

  const toggleExtra = (id: string) => {
    setExtraPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openRepoCol = (id: string) => {
    const data = repoColPeek(id, excluded);
    if (data) setColPeek({ data, from: 'repo' });
  };

  const openShareCol = (c: Collection) => {
    if (!preview) return;
    setColPeek({ data: shareColPeek(c, preview), from: 'share' });
  };

  // 详情弹窗里点事件：挑事件阶段看本库原文，预览阶段看裁剪后的那份
  const peekEvent = (e: DREvent) => {
    if (colPeek?.from === 'share') setEventView(e);
    else setRepoEventPeek(e);
  };

  const canNext = step !== 1 || colIds.length > 0;

  // 有选择时关窗要问一句：这些选择没写进库，关了就得重选
  const discardAndClose = () => {
    clearDraft(DRAFT_KEY);
    setConfirmClose(false);
    onClose();
  };

  const requestClose = () => {
    const hasProgress = step > 1 || colIds.length > 0 || excluded.size > 0 || extraPicked.size > 0;
    if (hasProgress) setConfirmClose(true);
    else discardAndClose();
  };

  const resetAll = () => {
    setStep(1);
    setColIds([]);
    setExcluded(new Set());
    setExpanded(new Set());
    setExtraPicked(new Set());
    setLevel('full');
    setAttrKeys([]);
    setWithAttachments(true);
    setRestoredAt(null);
    clearDraft(DRAFT_KEY);
  };

  const exportNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = await exportShareArchive(
        { collectionIds: colIds, eventIds, personIds: pickedIds },
        opts,
      );
      clearDraft(DRAFT_KEY);
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

  // 预览里每个人出现在几个事件中（额外多选的人会是 0）
  const previewCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of preview?.events ?? []) {
      for (const p of e.participants) map.set(p.personId, (map.get(p.personId) ?? 0) + 1);
    }
    return map;
  }, [preview]);

  const viewMessages = useMemo(
    () => (eventView ? (preview?.messages ?? []).filter((m) => m.eventId === eventView.id) : []),
    [eventView, preview],
  );

  return (
    <>
      <Modal
        wide
        title="开始分享"
        onClose={requestClose}
        footer={
          <>
            <button className="btn btn-ghost" onClick={requestClose}>
              取消
            </button>
            {step > 1 && (
              <button className="btn" onClick={() => setStep((s) => s - 1)}>
                上一步
              </button>
            )}
            {step < 4 && (
              <button
                className="btn btn-primary"
                disabled={!canNext}
                onClick={() => setStep((s) => s + 1)}
              >
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

        {restoredAt !== null && (
          <div className="draft-restored">
            <span className="muted small">已恢复上次没做完的选择 · {draftTimeLabel(restoredAt)}</span>
            <button className="btn btn-sm" onClick={resetAll}>
              清空重选
            </button>
          </div>
        )}

        {step === 1 && (
          <>
            <div className="share-wizard-tools">
              <span className="muted small">
                选中的事件集会连同子事件集一起带走；需要时展开「挑事件」，取消勾选的那些就不分享。
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
              <Empty compact text="还没有事件集。" />
            ) : (
              <div className="share-pick-list">
                {treeRows.map((row) => {
                  const implied = impliedIds.has(row.id);
                  const checked = implied || colIds.includes(row.id);
                  const root = selectionRoots.includes(row.id);
                  const group = groups.find((g) => g.id === row.id);
                  const expandedHere = root && expanded.has(row.id);
                  return (
                    <div key={row.id}>
                      <div
                        className={checked ? 'share-pick-row share-pick-on' : 'share-pick-row'}
                        style={{ paddingLeft: 12 + row.depth * 18 }}
                      >
                        <label className="share-pick-main">
                          <input type="checkbox" checked={checked} disabled={implied} onChange={() => toggleCol(row)} />
                          <span className="share-pick-name">
                            {row.name}
                            {row.smart && <em title="智能集合：成员由规则实时算出">⚡</em>}
                          </span>
                        </label>
                        <span className="muted small">{row.eventCount} 个事件</span>
                        {implied && <span className="share-pick-tag">随上级</span>}
                        <button
                          className="btn btn-sm share-expand"
                          onClick={() => openRepoCol(row.id)}
                          title="看看这个事件集里都有什么"
                        >
                          详情
                        </button>
                        {root && (group?.events.length ?? 0) > 0 && (
                          <button
                            className="btn btn-sm share-expand"
                            onClick={() => toggleExpand(row.id)}
                            aria-expanded={expandedHere}
                          >
                            {expandedHere ? '收起' : '挑事件'}
                          </button>
                        )}
                      </div>

                      {expandedHere && group && (
                        <div className="share-event-picks">
                          <div className="share-event-picks-head">
                            <span className="muted small">
                              {group.events.length} 个事件 · 取消勾选的不分享（跨事件集生效）
                            </span>
                            <span className="share-wizard-btns">
                              <button className="btn btn-sm" onClick={() => setGroupEvents(group.events, true)}>
                                全选
                              </button>
                              <button className="btn btn-sm" onClick={() => setGroupEvents(group.events, false)}>
                                清空
                              </button>
                            </span>
                          </div>
                          {group.events.map((e) => {
                            const on = !excluded.has(e.id);
                            return (
                              <div
                                key={e.id}
                                className={on ? 'share-event-pick' : 'share-event-pick share-event-off'}
                              >
                                <label className="share-event-pick-main">
                                  <input type="checkbox" checked={on} onChange={() => toggleEvent(e.id)} />
                                  <span className="share-event-pick-text">
                                    <span className="share-pick-name">{e.title || '未命名事件'}</span>
                                    <span className="muted small">{formatTime(e.time)}</span>
                                  </span>
                                </label>
                                <button
                                  className="btn btn-sm share-expand"
                                  onClick={() => setRepoEventPeek(e)}
                                  title="看这个事件的正文"
                                >
                                  查看
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
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
                事件里出现的人必须带上资料，否则事件会指向一个不存在的人；下面还可以多选没涉及到的人。
              </span>
              <span className="share-wizard-btns">
                <button
                  className="btn btn-sm"
                  onClick={() => setExtraPicked(new Set(extras.map((p) => p.id)))}
                  disabled={extras.length === 0}
                >
                  全选其他
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setExtraPicked(new Set())}
                  disabled={extraPicked.size === 0}
                >
                  清空其他
                </button>
              </span>
            </div>

            <div className="share-person-section">事件里的人物（必带）</div>
            {involved.length === 0 ? (
              <p className="muted small">当前挑出的事件里没有人物。</p>
            ) : (
              <div className="share-pick-list">
                {involved.map(({ person, eventCount }) => (
                  <div key={person.id} className="share-pick-row share-pick-on">
                    <label className="share-pick-main">
                      <input type="checkbox" checked disabled />
                      <Avatar name={person.displayName} avatar={person.avatar} icon={person.icon} size="sm" />
                      <span className="share-pick-name">{person.displayName}</span>
                    </label>
                    <span className="muted small">出现 {eventCount} 次</span>
                    <span className="share-pick-tag">必带</span>
                  </div>
                ))}
              </div>
            )}

            {extras.length > 0 && (
              <>
                <div className="share-person-section">其他人物（可选）</div>
                <p className="muted small">
                  这些人没有出现在当前事件里，勾上会连他们的资料一起带走，导入后是一个没有事件指向的人。
                </p>
                <div className="share-pick-list">
                  {extras.map((person) => {
                    const on = extraPicked.has(person.id);
                    return (
                      <label
                        key={person.id}
                        className={on ? 'share-pick-row share-pick-on' : 'share-pick-row'}
                      >
                        <input type="checkbox" checked={on} onChange={() => toggleExtra(person.id)} />
                        <Avatar name={person.displayName} avatar={person.avatar} icon={person.icon} size="sm" />
                        <span className="share-pick-name">{person.displayName}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            {involved.length === 0 && extras.length === 0 && (
              <Empty compact text="库里还没有人物。" />
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
                {levelDefs.length === 0 && <p className="muted small">属性字典还是空的，只能带走姓名。</p>}
                <div className="share-attr-list">
                  {levelDefs.map((d) => (
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
                    事件集 {preview.collections.length} 个（含子集） · 事件 {preview.events.length} 个 · 人物{' '}
                    {preview.persons.length} 位（资料 {preview.pickedPersonIds?.length ?? 0} 位） · 引用附件{' '}
                    {preview.missingAttachments} 个
                  </span>
                </div>

                <section className="share-block">
                  <h4>事件集</h4>
                  <div className="share-tree">
                    {preview.collections.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={
                          preview.collectionIds?.includes(c.id)
                            ? 'share-tree-row share-tree-root'
                            : 'share-tree-row'
                        }
                        onClick={() => openShareCol(c)}
                        title="查看事件集详情"
                      >
                        {c.name}
                        {c.kind === 'smart' && <em title="智能集合">⚡</em>}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="share-block">
                  <h4>事件（点开预览）</h4>
                  <div className="share-events">
                    {(showAllEvents ? preview.events : preview.events.slice(0, 8)).map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        className="share-event-row share-row-btn"
                        onClick={() => setEventView(e)}
                      >
                        <span className="share-event-row-text">
                          <strong>{e.title || '未命名事件'}</strong>
                          <span className="muted small">{formatTime(e.time)}</span>
                        </span>
                        <span className="share-row-caret">›</span>
                      </button>
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
                  <h4>人物（点开看资料）</h4>
                  <div className="share-pick-list">
                    {preview.persons.map((p) => {
                      const full = preview.pickedPersonIds?.includes(p.id);
                      const count = previewCounts.get(p.id) ?? 0;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className="share-pick-row share-row-btn"
                          onClick={() => setPersonView(p)}
                        >
                          <Avatar name={p.displayName} avatar={p.avatar} icon={p.icon} size="sm" />
                          <span className="share-pick-name">{p.displayName}</span>
                          <span className="muted small">
                            {count > 0 ? `出现 ${count} 次` : '未出现在事件里'}
                          </span>
                          <span className={full ? 'share-pick-tag' : 'share-pick-tag share-pick-muted'}>
                            {full ? '带资料' : level === 'alias' ? '仅化名' : '仅姓名'}
                          </span>
                        </button>
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

      {/* ---- 事件集详情：挑事件和预览都能点开，事件行还能继续往下看正文 ---- */}
      {colPeek && (
        <ColPeekModal
          data={colPeek.data}
          onClose={() => setColPeek(null)}
          onEvent={peekEvent}
        />
      )}

      {repoEventPeek && <RepoEventPeek event={repoEventPeek} onClose={() => setRepoEventPeek(null)} />}

      {/* 明确放弃：把「选择会丢」说清楚，并顺手把草稿一起删掉 */}
      {confirmClose && (
        <Modal
          title="取消这次分享？"
          onClose={() => setConfirmClose(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmClose(false)}>
                继续编辑
              </button>
              <button className="btn btn-danger" onClick={discardAndClose}>
                放弃并关闭
              </button>
            </>
          }
        >
          <p>取消后这次的选择会丢掉：事件集、挑掉的事件、多选的人物、分享程度都要重新选一遍。</p>
          <p className="muted small">
            {draftsEnabled()
              ? '只有刷新、切走或误关页面时才会自动留底；点「放弃并关闭」会把草稿一起删掉。'
              : '「设置 → 功能体验 → 未完成的记录」可以打开草稿保护，误关页面时自动留底。'}
          </p>
        </Modal>
      )}

      {/* ---- 预览里的两个放大镜：资料 / 事件 ---- */}
      {personView && (
        <Modal title={`人物资料 · ${personView.displayName}`} onClose={() => setPersonView(null)}>
          <div className="share-person-view">
            <div className="share-person-view-head">
              <Avatar
                name={personView.displayName}
                avatar={personView.avatar}
                icon={personView.icon}
                size="lg"
              />
              <div>
                <strong>{personView.displayName}</strong>
                <span className="muted small">
                  {previewCounts.get(personView.id)
                    ? `在这些事件里出现 ${previewCounts.get(personView.id)} 次`
                    : '没有出现在这些事件里'}
                </span>
              </div>
            </div>

            {personView.aliases.length > 0 && (
              <div className="share-view-row">
                <span className="share-view-label">别名</span>
                <span>{personView.aliases.join('、')}</span>
              </div>
            )}
            {personView.tags.length > 0 && (
              <div className="share-view-row">
                <span className="share-view-label">标签</span>
                <span>{personView.tags.join('、')}</span>
              </div>
            )}

            {attrsOf(personView, defs).length > 0 && (
              <div className="share-view-attrs">
                <div className="share-view-label">属性</div>
                <div className="share-attr-list">
                  {attrsOf(personView, defs).map((a) => (
                    <span key={a.key} className="share-attr-pill">
                      <em>{a.label}</em>
                      {a.text}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {personView.notes.trim() && (
              <div className="share-view-row">
                <span className="share-view-label">备注</span>
                <p className="share-person-note">{personView.notes}</p>
              </div>
            )}

            {personView.aliases.length === 0 &&
              personView.tags.length === 0 &&
              Object.keys(personView.attrs).length === 0 &&
              !personView.notes.trim() && (
                <p className="muted small">
                  这份分享按「{SHARE_LEVELS.find((l) => l.key === level)?.title ?? '原样'}」程度只带了姓名。
                </p>
              )}

            <p className="muted small">以上是这份分享里实际带走的资料，导入方看到的就是这些。</p>
          </div>
        </Modal>
      )}

      {eventView && preview && (
        <Modal
          wide
          title={`事件预览 · ${eventView.title || '未命名事件'}`}
          onClose={() => setEventView(null)}
        >
          <EventView
            event={eventView}
            persons={preview.persons.map((p) => ({ id: p.id, displayName: p.displayName }))}
            flat={preview.collections.map((c) => ({ c, depth: 0 }))}
            collectionIds={preview.members
              .filter((m) => m.memberType === 'event' && m.memberId === eventView.id)
              .map((m) => m.collectionId)}
            candidates={preview.events.map((e) => ({ id: e.id, title: e.title }))}
            missingTitle="（未包含在分享里）"
            body={
              eventView.viewMode === 'chat' && viewMessages.length > 0 ? (
                <ChatPreview
                  messages={viewMessages}
                  nameOf={(id) =>
                    preview.persons.find((p) => p.id === id)?.displayName ?? '旁白'
                  }
                />
              ) : undefined
            }
          />
        </Modal>
      )}
    </>
  );
}
