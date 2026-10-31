// AI 对话（设置 → AI → AI 对话）。
//
// 不是一个聊天玩具：它背后是 src/core/ai/agent.ts 的 agent 循环——
// 模型能思考、能连续调用多个工具（查数据 / 建人物 / 记事件 / 改消息……），
// 每次调用的结果会喂回去给它看，直到它给出最终回复。
//
// 版面：顶部一排标签「聊天 / 历史会话 / 成果 / 说明」，点哪个哪个
// 铺满整屏，互不挤占。以前快照和说明是嵌在聊天页里的小面板，点开就把聊天区
// 挤掉一半，体验很碎。现在各占一屏，切换只是换显示，组件不卸载、agent 循环
// 不中断——AI 在后台跑着，你切到「成果」看备份也照样跑。
//
// 本文件只负责「状态 + 动作」：轮次执行态在 core/runtime/aiChat 单例里，
// 四个 tab 的界面在 ./labAi/ 下各有一个文件，弹窗同理。以前这些都挤在一个
// 1345 行的文件里，改一个气泡要翻过 900 行 JSX。
//
// 模型配置（别名 / 服务商 / 密钥 / 连通测试）2026-10-24 抽到同组的「模型」子页：
// 配密钥是低频动作，不该长期占着聊天页的标签位置。
//
// 会话持久化（历史会话 tab 的来源）：每轮结束后把整段对话（喂模型的 messages）
// 和界面气泡存进 SQLite 的 meta 表（见 core/ai/sessions.ts）。刷新、退出设置页、
// 甚至被中断，回来都能在历史会话里找回并继续。
//
// 防误改的三道闸：
//   1. 本轮第一次写库前自动拍整库快照，气泡下面始终挂着「回退本轮」按钮；
//   2. 「快照」tab 任何时候都能手动恢复或删除；
//   3. 工具调用过程全程可见（哪一步调了什么、成没成），不是黑盒。
//
// 防「一轮白跑」：忙的时候顶部钉一条状态条（第几轮、正在干什么，跨 tab 不掉），
// 导航入口（底部 Tab / 设置返回）被 navGuard 拦下，刷新走浏览器原生确认；
// 干完 toast 一句「AI 已完成」。用户再也不用盯着屏幕猜它好没有。
//
// 附件：两个入口——「选文件」挑本地任意文件，「文件库」挑已入库的文件。
// 附件只随这一条消息发送，不入库（详见 core/ai/attach.ts）。

import { useEffect, useMemo, useRef, useState } from 'react';

import { bump, useVersion } from '../../store';
import { clearDraft, draftsEnabled, loadDraft, saveDraft } from '../../core/drafts';
import { findByAlias, getDefaultModel, listModels, type AiModel } from '../../core/ai';
// 轮次执行已抽到 core/runtime/aiChat 单例，本组件只做订阅式视图
import {
  type AiItem as Item,
  loadSessionInto,
  markChatRead,
  newSession as aiNewSession,
  removeItem as aiRemoveItem,
  sendTurn,
  setErr as setAiErr,
  setItems as aiSetItems,
  stopTurn,
  useAiChat,
} from '../../core/runtime/aiChat';
import { MAX_ATTACHMENTS, fromFile, fromStored, type Attachment } from '../../core/ai/attach';
import { deleteSessions, listSessions, renameSession, type AiSession } from '../../core/ai/sessions';
import {
  applyPendingSnapshot,
  deleteSnapshot,
  discardPendingSnapshot,
  hasPendingSnapshot,
  listSnapshots,
  renamePendingRecord,
  restoreSnapshot,
  type SnapDiffItem,
  type SnapMeta,
  type SnapTarget,
} from '../../core/snapshots';
import type { StoredFile } from '../../core/repo/files';
import { FilePickInput, Modal } from '../common';
import { usePaged } from '../common/usePaged';
import { usePageSize } from '../prefs';
import { FilesSection } from '../files';
import { LabHead } from './LabEdgeSection';
import { clearSnapReturn, takeSnapReturn } from '../snapReturn';
import { showToast } from '../toast';
import { ChatTab } from './labAi/ChatTab';
import { HistoryTab } from './labAi/HistoryTab';
import { SnapTab } from './labAi/SnapTab';
import { HelpTab } from './labAi/HelpTab';
import { SnapDetailModal } from './labAi/SnapDetailModal';
import { RecordDetailModal } from './labAi/RecordDetailModal';
import { SnapPreviewModal } from './labAi/SnapPreviewModal';
import { actionOf, type TabKey } from './labAi/model';

// Item（聊天气泡）类型由 aiChat 单例导出（见上方 import），与运行时共用同一份。

export function LabAiSection() {
  const [models, setModels] = useState<AiModel[]>(() => listModels());
  // 「模型」标签里增删改别名后会 bump()，这里跟着重拉列表，聊天区的下拉才不会露出已删除的别名
  const v = useVersion();
  useEffect(() => {
    setModels(listModels());
  }, [v]);
  const [alias, setAlias] = useState<string>(() => getDefaultModel()?.alias ?? listModels()[0]?.alias ?? '');
  // 聊天的轮次执行态（busy / items / history / sessionId / activity / roundNo / err）
  // 全部来自 aiChat 单例：离开本页单例照跑，回来重新订阅即可看到完整进度。
  const ai = useAiChat();
  const { items, busy, activity, roundNo, err, sessionId } = ai;
  // 输入框里没发出去的文字也留底（开关在「功能体验 → 未完成的记录」）
  const [inputDraft] = useState(() => loadDraft<{ text: string }>('ai-input'));
  const [input, setInput] = useState(inputDraft?.data.text ?? '');
  const [inputRestoredAt, setInputRestoredAt] = useState<number | null>(
    inputDraft ? inputDraft.updatedAt : null,
  );
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [tab, setTab] = useState<TabKey>('chat');
  const [snaps, setSnaps] = useState(() => listSnapshots());
  // 历史会话 / 成果是「用得越久越多」的两张表，和别处共用分页控件与每页条数。
  // 勾选（批量删除）仍按全量算，分页只管这一屏渲染多少条。
  /** 正在看详情的快照（点列表项弹出：这一轮到底做了什么） */
  const [snapDetail, setSnapDetail] = useState<SnapMeta | null>(null);
  /** 删除类 target 点开展示删前存下的内容（对象已软删，不查库） */
  const [previewTarget, setPreviewTarget] = useState<SnapTarget | null>(null);
  /** 成果里点开的一条记录（待执行的新增 / 删除 / 修改都能看，新增还能改名） */
  const [recordView, setRecordView] = useState<{ snapId: string; item: SnapDiffItem } | null>(null);
  const [recordName, setRecordName] = useState('');
  /** 成果详情里用户勾选为「拒绝」的条目，key 是 `${action}:${id}` */
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<AiSession[]>(() => listSessions());
  const [libOpen, setLibOpen] = useState(false);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  /** 聊天页点开的那条对话（显示删除 / 复制到对话框） */
  const [itemMenu, setItemMenu] = useState<number | null>(null);
  /** 历史会话：批量管理（勾选删除） */
  const [manage, setManage] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  /** 正在改名的会话 + 草稿 */
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  /** 顶部四个键：长时间没人点就收矮，点一下恢复正常高度 */
  const [tabsTight, setTabsTight] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  const aiPagerSize = usePageSize();
  const pagedSessions = usePaged(sessions, aiPagerSize);
  const pagedSnaps = usePaged(snaps, aiPagerSize);

  const model = useMemo(() => findByAlias(alias) ?? getDefaultModel(), [alias, models]);

  // 新消息滚到底
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, activity, busy]);

  const reloadSnaps = () => setSnaps(listSnapshots());
  const reloadSessions = () => setSessions(listSessions());

  // 从成果详情点某个对象跳出去看过，回到本页时原样把那份成果打开——
  // 否则用户看完人物详情就「回不来」了，得重新点四层才能接着处理。
  useEffect(() => {
    const back = takeSnapReturn();
    if (!back) return;
    setSnaps(listSnapshots());
    setTab('snap');
    const meta = listSnapshots().find((x) => x.id === back);
    if (meta) setSnapDetail(meta);
  }, []);

  // 打开成果详情时现算一次净变化：快照里存的是 AI 干完活那一刻的结果，
  // 之后用户自己又改了数据（或又让 AI 做了一轮），这里要反映的是当前状态。
  const snapDetailId = snapDetail?.id ?? null;
  useEffect(() => {
    if (!snapDetailId) return;
    let alive = true;
    void (async () => {
      try {
        const { diffSnapshot } = await import('../../core/snapshots/diff');
        const d = await diffSnapshot(snapDetailId);
        if (!alive || !d) return;
        // 待执行时当前库还是「动手前」，重算会得到空 diff，把暂存的那份覆盖掉
        setSnapDetail((s) =>
          s && s.id === snapDetailId && s.review !== 'pending' ? { ...s, diff: d } : s,
        );
      } catch {
        /* 算不出来就沿用快照里存的那份 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [snapDetailId]);

  // 切到快照 / 历史会话时顺手刷新，避免看到旧数据
  const switchTab = (t: TabKey) => {
    setTab(t);
    if (t === 'snap') reloadSnaps();
    if (t === 'history') reloadSessions();
  };

  // 顶部一排键闲置 8 秒后收成一条细带；点任意一个就恢复，再重新计时
  useEffect(() => {
    if (tabsTight) return;
    const t = window.setTimeout(() => setTabsTight(true), 8000);
    return () => window.clearTimeout(t);
  }, [tabsTight, tab]);

  const wakeTabs = () => setTabsTight(false);

  // 应用内离开已放开（AI 在后台照跑，状态在 aiChat 单例里），只保留刷新 / 关标签页的
  // 原生确认——这一轮在浏览器卸载时会被中断，白跑且可能写了一半的数据。
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [busy]);

  // 打开 AI 对话页即视为已读：head 上「完成的任务」通知消失
  useEffect(() => {
    markChatRead();
  }, []);

  // 一轮跑完（busy 从 true 变 false）刷新成果 / 会话列表，避免看到旧数据
  useEffect(() => {
    if (!busy) {
      reloadSnaps();
      reloadSessions();
    }
  }, [busy]);

  /** 从历史会话里载入一段对话：恢复上下文，切回聊天继续（状态由单例接管） */
  const loadSession = (id: string) => {
    loadSessionInto(id);
    setRollbackId(null);
    setAiErr(null);
    switchTab('chat');
  };

  /** 开一段新对话：清空上下文（不删历史会话里的旧记录） */
  const newSession = () => {
    aiNewSession();
    setRollbackId(null);
    setInput('');
    setAtts([]);
    setItemMenu(null);
    switchTab('chat');
  };

  /** 聊天页单条对话：复制到输入框，改完可重发 */
  const copyItem = (it: Item) => {
    setInput(it.text);
    setAtts(it.kind === 'user' ? (it.attachments ?? []) : []);
    setItemMenu(null);
    showToast('已复制到对话框，改完可以直接发');
  };

  /** 聊天页单条对话：从界面与会话记录里删掉这条 */
  const removeItem = (index: number) => {
    aiRemoveItem(index);
    setItemMenu(null);
    showToast('已删除这条消息');
  };

  const togglePick = (id: string) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removePicked = () => {
    const ids = [...picked];
    if (!ids.length) return;
    if (!window.confirm(`删除选中的 ${ids.length} 个会话？聊天记录会一起删掉，但它们建过的人物事件还在。`)) return;
    deleteSessions(ids);
    if (sessionId && ids.includes(sessionId)) newSession();
    setPicked(new Set());
    setManage(false);
    reloadSessions();
    showToast(`已删除 ${ids.length} 个会话`);
  };

  const startRename = (s: AiSession) => {
    setRenameId(s.id);
    setRenameText(s.title);
  };

  const commitRename = () => {
    if (!renameId) return;
    const title = renameText.trim();
    if (!title) return;
    renameSession(renameId, title);
    setRenameId(null);
    setRenameText('');
    reloadSessions();
    showToast('会话名已修改');
  };

  // 忙的时候两道闸之外的第三道：离开 AI 对话页（设置返回 / 切到别的设置项）
  // 由 Settings 的 navGuard 统一拦，这里只管本页四个 tab 之间的切换——那不中断。

  /** 追加附件；满了就提示，而不是静默丢弃 */
  const addAtts = (list: Attachment[]) => {
    setAtts((cur) => {
      const room = MAX_ATTACHMENTS - cur.length;
      if (room <= 0) {
        setAiErr(`一次最多带 ${MAX_ATTACHMENTS} 个附件`);
        return cur;
      }
      if (list.length > room) setAiErr(`一次最多带 ${MAX_ATTACHMENTS} 个附件，多出的没有加上`);
      return [...cur, ...list.slice(0, room)];
    });
  };

  const pickFiles = async (list: FileList | File[]) => {
    if (list.length === 0) return;
    setAiErr(null);
    const out: Attachment[] = [];
    for (const f of Array.from(list)) {
      seq.current += 1;
      out.push(await fromFile(f, `f${seq.current}`));
    }
    addAtts(out);
  };

  // 输入变化就落一份草稿：打了一大段手滑刷新，回来原样还在。
  // 发出去（send 会 setInput('')）或手动清空时顺手删掉，不留空草稿。
  useEffect(() => {
    if (!draftsEnabled()) return;
    if (!input.trim()) {
      clearDraft('ai-input');
      setInputRestoredAt(null);
      return;
    }
    const t = setTimeout(() => saveDraft('ai-input', 'AI 对话（还没发送）', { text: input }), 400);
    return () => clearTimeout(t);
  }, [input]);

  /** 从文件库挑：文件本来就在库里，这里只把它读出来随消息发送 */
  const pickStored = async (f: StoredFile) => {
    setAiErr(null);
    setLibOpen(false);
    seq.current += 1;
    addAtts([await fromStored(f, `s${seq.current}`)]);
  };

  const removeAtt = (key: string) => setAtts((s) => s.filter((a) => a.key !== key));

  const send = (text: string) => {
    const t = text.trim();
    // 只有附件、没有文字也可以发（「看看这张图」这种）
    if ((!t && atts.length === 0) || busy) return;
    if (!model) {
      setAiErr('还没有可用的模型。去「设置 → AI → 模型」配一个别名和密钥。');
      return;
    }
    // 上一轮的改动还没确认：先让用户执行或放弃，避免两批改动互相覆盖
    if (hasPendingSnapshot()) {
      setAiErr('还有一份成果没确认。先去「成果」里点「执行」或「放弃」，再继续聊。');
      return;
    }
    // 把文字 + 附件交给 aiChat 单例去跑：离开本页单例照跑，head 上任务图标照常变色
    const sent = atts;
    setInput('');
    setAtts([]);
    void sendTurn(t, sent, model);
  };

  const stop = () => stopTurn();

  const rollback = async (id: string) => {
    setAiErr(null);
    if (!window.confirm('拒绝这次改动？\n数据会回退到 AI 动手之前。当前状态会自动留底，踩错了还能再退回来。')) return;
    clearSnapReturn();
    const ok = await restoreSnapshot(id);
    if (!ok) {
      // 备份字节丢失时不能假装成功：数据没变，提示条却关掉了，用户以为回退过
      setAiErr('回退失败：这份备份的数据不见了，可能已被清理。');
      reloadSnaps();
      return;
    }
    bump();
    reloadSnaps();
    setRollbackId(null);
    aiSetItems([...items, { kind: 'assistant', text: '已按这份成果回退数据。' }]);
  };

  const removeSnap = async (id: string) => {
    setAiErr(null);
    if (!window.confirm('确认接受这次改动？\n接受后这条成果记录会被关掉，数据保留不变。')) return;
    clearSnapReturn();
    await deleteSnapshot(id);
    reloadSnaps();
  };

  /** 审核通过：把暂存的那份库换进来，这一轮改动才真正生效 */
  const applySnap = async (id: string) => {
    setAiErr(null);
    if (!window.confirm('确认执行这轮改动？\n执行后这些记录才会真正进库。')) return;
    const r = await applyPendingSnapshot(id);
    if (r === 'stale') {
      // 暂存期间库被外人动过：照旧执行会把那些改动连锅端掉，且撤销栈已清零。
      // 拦住，指一条稳妥的路——放弃这轮，让 AI 照着现在的数据重做。
      setAiErr('执行已拦截：暂存这份成果期间，库里的数据被其他操作改过（手动改动 / 导入 / 同步）。为避免冲掉那些改动，请先「放弃」这轮成果，再让 AI 重新做。');
      reloadSnaps();
      return;
    }
    if (r === 'gone') {
      setAiErr('执行失败：暂存的改动不见了，可能已被清理。请重试或放弃。');
      reloadSnaps();
      return;
    }
    const nextItems = items.map((it) => (it.pendingId === id ? { ...it, pendingId: null } : it));
    aiSetItems(nextItems);
    reloadSnaps();
    setSnapDetail(null);
    // 成果已执行：还开着的记录详情弹窗跟着关，否则保存改名会扑空
    setRecordView(null);
    showToast('已执行，改动已进库');
  };

  /** 不要这轮改动了：两份字节一起删掉，库本来就没动过 */
  const discardSnap = async (id: string) => {
    setAiErr(null);
    if (!window.confirm('放弃这轮改动？\n库里的数据不会变，这份成果会被删掉。')) return;
    await discardPendingSnapshot(id);
    const nextItems = items.map((it) => (it.pendingId === id ? { ...it, pendingId: null } : it));
    aiSetItems(nextItems);
    reloadSnaps();
    setSnapDetail(null);
    setRecordView(null);
    showToast('已放弃，库没有变');
  };

  /** 成果里点开一条记录看详情；新增的还能顺手改名 */
  const openRecord = (snapId: string, item: SnapDiffItem) => {
    setRecordView({ snapId, item });
    setRecordName(item.name);
  };

  const saveRecordName = async () => {
    if (!recordView) return;
    const next = await renamePendingRecord(
      recordView.snapId,
      recordView.item.kind,
      recordView.item.id,
      recordName,
    );
    if (!next) {
      showToast('改名失败：这份成果可能已经执行或放弃');
      return;
    }
    const diff = next.diff;
    const fresh = diff
      ? [...diff.created, ...diff.updated, ...diff.deleted].find(
          (r) => r.kind === recordView.item.kind && r.id === recordView.item.id,
        )
      : undefined;
    if (fresh) setRecordView({ snapId: recordView.snapId, item: fresh });
    reloadSnaps();
    showToast('名字已改，执行后才生效');
  };

  const toggleReject = (key: string) => {
    setRejected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  const applyRejected = async () => {
    if (!snapDetail || rejected.size === 0) return;
    setAiErr(null);
    if (!window.confirm(`拒绝选中的 ${rejected.size} 项改动？\n其余改动保留。`)) return;
    const { revertDiffItems } = await import('../../core/snapshots/diff');
    const diff = snapDetail.diff;
    if (!diff) return;
    const rejects: Array<{ kind: 'person'|'event'|'collection'; id: string; action: 'created'|'updated'|'deleted' }> = [];
    for (const k of rejected) {
      const [action, id] = k.split(':', 2);
      const item = [...diff.created, ...diff.updated, ...diff.deleted].find((t) => t.id === id);
      if (item) rejects.push({ kind: item.kind, id, action: action as 'created'|'updated'|'deleted' });
    }
    try {
      await revertDiffItems(snapDetail.id, rejects);
      const { flushPersist } = await import('../../core/db/persist');
      flushPersist();
      setRejected(new Set());
      reloadSnaps();
      setSnapDetail(null);
      clearSnapReturn();
      showToast('已拒绝选中的改动');
    } catch (e) {
      showToast('操作失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const canSend = !busy && !!model && (!!input.trim() || atts.length > 0);

  return (
    <div className="lab-page lab-page-chat">
      <LabHead title="AI 对话" subKey="labAi" />

      {/* 一排全屏切换按钮：点哪个哪个铺满下面整块。切换不卸载组件，
          所以 agent 循环、busy 状态、聊天记录都还在，会话不会被打断。 */}
      <div
        className={tabsTight ? 'aichat-tabs aichat-tabs-tight' : 'aichat-tabs'}
        role="tablist"
        onPointerDown={wakeTabs}
      >
        <button
          role="tab"
          aria-selected={tab === 'chat'}
          className={tab === 'chat' ? 'aichat-tab aichat-tab-on' : 'aichat-tab'}
          onClick={() => switchTab('chat')}
        >
          聊天
        </button>
        <button
          role="tab"
          aria-selected={tab === 'history'}
          className={tab === 'history' ? 'aichat-tab aichat-tab-on' : 'aichat-tab'}
          onClick={() => switchTab('history')}
        >
          历史会话{sessions.length > 0 && <span className="aichat-tab-n">{sessions.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'snap'}
          className={tab === 'snap' ? 'aichat-tab aichat-tab-on' : 'aichat-tab'}
          onClick={() => switchTab('snap')}
        >
          成果{snaps.length > 0 && <span className="aichat-tab-n">{snaps.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'help'}
          className={tab === 'help' ? 'aichat-tab aichat-tab-on' : 'aichat-tab'}
          onClick={() => switchTab('help')}
        >
          说明
        </button>
      </div>

      {/* 内容区：吃掉剩余高度，四个 tab 共用这块，切换只换里面的视图 */}
      <div className="aichat-body">
        {/* 错误条放在 tab 面板外面：在「成果」tab 点执行 / 放弃改动失败时，
            提示必须当场看得见，不能藏到「聊天」tab 里 */}
        {err && <p className="aichat-err">{err}</p>}
        {tab === 'chat' && (
          <ChatTab
            items={items}
            busy={busy}
            activity={activity}
            roundNo={roundNo}
            itemMenu={itemMenu}
            onItemMenu={setItemMenu}
            onCopy={copyItem}
            onRemove={removeItem}
            atts={atts}
            onRemoveAtt={removeAtt}
            input={input}
            onInput={setInput}
            inputRestoredAt={inputRestoredAt}
            onClearInput={() => setInput('')}
            models={models}
            alias={alias}
            onAlias={setAlias}
            onStop={stop}
            rollbackId={rollbackId}
            onRollback={(id) => void rollback(id)}
            canSend={canSend}
            onSend={(t) => send(t)}
            onPickFile={() => fileRef.current?.click()}
            onOpenLib={() => setLibOpen(true)}
            onGoSnap={() => switchTab('snap')}
            logRef={logRef}
            hasModel={!!model}
          />
        )}

        {tab === 'history' && (
          <HistoryTab
            sessions={sessions}
            paged={pagedSessions}
            manage={manage}
            onManage={setManage}
            picked={picked}
            onTogglePick={togglePick}
            onRemovePicked={removePicked}
            onFinishManage={() => {
              setManage(false);
              setPicked(new Set());
            }}
            onNew={newSession}
            onLoad={loadSession}
            renameId={renameId}
            renameText={renameText}
            onRenameText={setRenameText}
            onStartRename={startRename}
            onCommitRename={commitRename}
            onCancelRename={() => setRenameId(null)}
          />
        )}

        {tab === 'snap' && (
          <SnapTab
            snaps={snaps}
            paged={pagedSnaps}
            onOpen={setSnapDetail}
            onOpenRecord={openRecord}
            onApply={(id) => void applySnap(id)}
            onDiscard={(id) => void discardSnap(id)}
            onAccept={(id) => void removeSnap(id)}
            onRollback={(id) => void rollback(id)}
          />
        )}

        {tab === 'help' && <HelpTab />}
      </div>

      <FilePickInput inputRef={fileRef} multiple onFiles={(files) => void pickFiles(files)} />

      {libOpen && (
        <Modal title="文件库 · 选一个发给 AI" wide onClose={() => setLibOpen(false)}>
          <FilesSection onPick={(f) => void pickStored(f)} />
        </Modal>
      )}

      {snapDetail && (
        <SnapDetailModal
          snap={snapDetail}
          rejected={rejected}
          onToggleReject={toggleReject}
          onRejectPicked={() => void applyRejected()}
          onApply={(id) => void applySnap(id)}
          onDiscard={(id) => void discardSnap(id)}
          onOpenRecord={openRecord}
          onPreview={setPreviewTarget}
          onClose={() => {
            setSnapDetail(null);
            clearSnapReturn();
          }}
        />
      )}

      {recordView &&
        (() => {
          const snap =
            snaps.find((s) => s.id === recordView.snapId) ??
            (snapDetail?.id === recordView.snapId ? snapDetail : null);
          const all = snap?.diff
            ? [...snap.diff.created, ...snap.diff.updated, ...snap.diff.deleted]
            : [];
          const item =
            all.find((r) => r.kind === recordView.item.kind && r.id === recordView.item.id) ??
            recordView.item;
          const action = snap ? actionOf(snap, item) : 'created';
          return (
            <RecordDetailModal
              item={item}
              action={action}
              name={recordName}
              onName={setRecordName}
              onSave={() => void saveRecordName()}
              onClose={() => setRecordView(null)}
              canRename={snap?.review === 'pending' && action === 'created'}
            />
          );
        })()}

      {previewTarget && (
        <SnapPreviewModal target={previewTarget} onClose={() => setPreviewTarget(null)} />
      )}
    </div>
  );
}
