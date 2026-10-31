// 分享向导：一个入口，四步走完。
//
//   ① 多选事件集（可再展开挑具体事件）
//   ② 选人物：事件涉及的人必带，另外可以多选没涉及到的人
//   ③ 分享程度（人物资料留多少 / 要不要附件）
//   ④ 预览，点人物看资料、点事件看正文，确认无误就生成压缩包
//
// 四步共用一个 state，任意一步都能退回改，改完再往后走时前面算出来的东西
// 会按新选择重算：选人物只看当前事件，预览只看当前全部选择。
//
// 本文件只留「状态 + 派生 + 动作」：四步的界面在 ./wizard/ 下各有一个文件，
// 取数（树摊平、两种事件集详情）在 wizard/model.ts。
import { useEffect, useMemo, useState } from 'react';
import {
  buildShare,
  eventsOfCollections,
  exportShareArchive,
  personsInCollections,
  type ShareOptions,
} from '../../core/io';
import { getTree, type TreeNode } from '../../core/repo/collections';
import { listDefs, listPersons } from '../../core/repo/persons';
import {
  type Collection,
  type DREvent,
  type Person,
  type ShareFile,
  type ShareLevel,
} from '../../core/types';
import { clearDraft, draftsEnabled, draftTimeLabel, loadDraft, saveDraft } from '../../core/drafts';
import { Modal } from '../common';
import { showToast } from '../toast';
import { ColPeekModal, RepoEventPeek, type ColPeekData } from './SharePeeks';
import { PickCollections } from './wizard/PickCollections';
import { PickPersons } from './wizard/PickPersons';
import { PickLevel } from './wizard/PickLevel';
import { PreviewStep } from './wizard/PreviewStep';
import { PersonViewModal } from './wizard/PersonViewModal';
import { EventViewModal } from './wizard/EventViewModal';
import { ConfirmCloseModal, StepBar } from './wizard/StepBar';
import {
  DRAFT_KEY,
  countsOf,
  repoColPeek,
  rowsOf,
  shareColPeek,
  type ColRow,
  type WizardDraft,
} from './wizard/model';

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
  const extras = useMemo(() => listPersons().filter((p) => !involvedIds.has(p.id)), [involvedIds]);

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
  const previewCounts = useMemo(() => countsOf(preview), [preview]);

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
        <StepBar step={step} />

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
          <PickCollections
            rows={treeRows}
            colIds={colIds}
            impliedIds={impliedIds}
            selectionRoots={selectionRoots}
            groups={groups}
            excluded={excluded}
            expanded={expanded}
            onSetCols={setColIds}
            onToggleCol={toggleCol}
            onToggleExpand={toggleExpand}
            onToggleEvent={toggleEvent}
            onSetGroupEvents={setGroupEvents}
            onOpenCol={openRepoCol}
            onPeekEvent={setRepoEventPeek}
          />
        )}

        {step === 2 && (
          <PickPersons
            involved={involved}
            extras={extras}
            extraPicked={extraPicked}
            onSetExtras={setExtraPicked}
            onToggleExtra={toggleExtra}
          />
        )}

        {step === 3 && (
          <PickLevel
            level={level}
            attrKeys={attrKeys}
            withAttachments={withAttachments}
            levelDefs={levelDefs}
            onLevel={setLevel}
            onAttrKeys={setAttrKeys}
            onAttachments={setWithAttachments}
          />
        )}

        {step === 4 && (
          <PreviewStep
            preview={preview}
            previewError={previewError}
            showAllEvents={showAllEvents}
            level={level}
            withAttachments={withAttachments}
            counts={previewCounts}
            onShowAllEvents={setShowAllEvents}
            onOpenCol={openShareCol}
            onOpenEvent={setEventView}
            onOpenPerson={setPersonView}
          />
        )}

        {error && <div className="alert alert-err">{error}</div>}
      </Modal>

      {/* ---- 事件集详情：挑事件和预览都能点开，事件行还能继续往下看正文 ---- */}
      {colPeek && <ColPeekModal data={colPeek.data} onClose={() => setColPeek(null)} onEvent={peekEvent} />}

      {repoEventPeek && <RepoEventPeek event={repoEventPeek} onClose={() => setRepoEventPeek(null)} />}

      {/* 明确放弃：把「选择会丢」说清楚，并顺手把草稿一起删掉 */}
      {confirmClose && (
        <ConfirmCloseModal onKeep={() => setConfirmClose(false)} onDiscard={discardAndClose} />
      )}

      {/* ---- 预览里的两个放大镜：资料 / 事件 ---- */}
      {personView && (
        <PersonViewModal
          person={personView}
          defs={defs}
          level={level}
          eventCount={previewCounts.get(personView.id) ?? 0}
          onClose={() => setPersonView(null)}
        />
      )}

      {eventView && preview && (
        <EventViewModal
          event={eventView}
          preview={preview}
          messages={viewMessages}
          onClose={() => setEventView(null)}
        />
      )}
    </>
  );
}
