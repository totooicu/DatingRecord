// 功能体验 → AI 对话。
//
// 不是一个聊天玩具：它背后是 src/core/ai/agent.ts 的 agent 循环——
// 模型能思考、能连续调用多个工具（查数据 / 建人物 / 记事件 / 改消息……），
// 每次调用的结果会喂回去给它看，直到它给出最终回复。
//
// 版面：顶部一排标签「聊天 / 模型 / 历史会话 / 成果 / 说明」，点哪个哪个
// 铺满整屏，互不挤占。以前快照和说明是嵌在聊天页里的小面板，点开就把聊天区
// 挤掉一半，体验很碎。现在各占一屏，切换只是换显示，组件不卸载、agent 循环
// 不中断——AI 在后台跑着，你切到「成果」看备份也照样跑。
//
// 「模型」标签里挂的是原来顶级设置里的「AI 模型」整页（别名 / 服务商 / 密钥 / 连通测试），
// 2026-10-23 从顶级目录挪进来：配模型和聊天本就是同一件事的两步，不该隔一层目录。
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
import { clearDraft, draftsEnabled, draftTimeLabel, loadDraft, saveDraft } from '../../core/drafts';
import { findByAlias, getDefaultModel, listModels, type AiModel } from '../../core/ai';
import { agentSystemPrompt, runAgentTurn, type AgentEvent, type AgentMessage } from '../../core/ai/agent';
import {
  MAX_ATTACHMENTS,
  attachText,
  fmtSize,
  fromFile,
  fromStored,
  imagesOf,
  previewOf,
  type Attachment,
} from '../../core/ai/attach';
import {
  createSession,
  deleteSessions,
  listSessions,
  renameSession,
  saveSession,
  titleOf,
  type AiSession,
  type SessionItem,
} from '../../core/ai/sessions';
import {
  deleteSnapshot,
  listSnapshots,
  restoreSnapshot,
  fmtSnapTime,
  fmtBytes,
  summarizeOps,
  type SnapMeta,
  type SnapTarget,
} from '../../core/snapshots';
import type { StoredFile } from '../../core/repo/files';
import { openPerson } from '../openPerson';
import { openEvent } from '../openEvent';
import { openCollection } from '../openCollection';
import { PencilIcon } from '../files/rowIcons';
import { Modal } from '../common';
import { FilesSection } from '../files';
import { MarkdownView } from '../markdown';
import { LabHead } from './LabEdgeSection';
import { AiSection } from './AiSection';
import { setNavGuard } from '../navGuard';
import { clearSnapReturn, setSnapReturn, takeSnapReturn } from '../snapReturn';
import { showToast } from '../toast';

interface Item {
  kind: 'user' | 'assistant';
  text: string;
  /** 这一轮里调用了哪些工具 */
  tools?: string[];
  /** 这一轮的自动快照（可回退） */
  snapshotId?: string | null;
  /** 用户消息带的附件（只在界面上展示，正文已拼进 text 发给模型） */
  attachments?: Attachment[];
}

type TabKey = 'chat' | 'models' | 'history' | 'snap' | 'help';

const QUICK = ['这个库里都有什么？', '最近发生了哪些事？', '把这份文件里的内容整理成一条事件'];

/** 输入区左边的小图标：内联 SVG 而不是 emoji，部分安卓机会把 📎 渲染成方框 */
const ICON = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function AttachIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M20 11.4l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.4-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.8 1.8 0 0 1-2.6-2.6l7.6-7.6" />
    </svg>
  );
}

function LibIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M3.6 7.4h6l1.8 2.2h8.9v9.2a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z" />
      <path d="M3.6 7.4V5.2a1.6 1.6 0 0 1 1.6-1.6h3.6l1.6 2" />
    </svg>
  );
}

/**
 * 附件卡片的缩略图。
 *
 * 三类：真图片直接缩略；文本露几行正文；读不了的（pdf/zip…）把后缀放大显示。
 * 纯展示，不参与发送——发什么由 core/ai/attach.ts 决定。
 */
function AttThumb({ att }: { att: Attachment }) {
  const p = previewOf(att);
  if (p.type === 'image') {
    return <img className="aichat-att-img" src={p.src} alt="" loading="lazy" />;
  }
  if (p.type === 'text') {
    return <span className="aichat-att-text">{p.snippet}</span>;
  }
  return <span className="aichat-att-ext">{p.ext}</span>;
}

/** 附件清单：一张张卡片，横向排不开就换行 */
function AttachmentChips({
  atts,
  onRemove,
}: {
  atts: Attachment[];
  onRemove?: (key: string) => void;
}) {
  return (
    <ul className="aichat-atts">
      {atts.map((a) => (
        <li key={a.key} className={a.warning ? 'aichat-att aichat-att-warn' : 'aichat-att'}>
          <span className="aichat-att-thumb" aria-hidden>
            <AttThumb att={a} />
          </span>
          <span className="aichat-att-meta">
            <span className="aichat-att-name" title={`${a.name}（${fmtSize(a.size)}）`}>
              {a.name}
            </span>
            <span className="aichat-att-size">{fmtSize(a.size)}</span>
          </span>
          {a.warning && (
            <span className="aichat-att-warn-text" title={a.warning}>
              {a.warning}
            </span>
          )}
          {onRemove && (
            <button className="aichat-att-x" onClick={() => onRemove(a.key)} aria-label={`移除 ${a.name}`}>
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 快照来源的人话标签 */
const SNAP_SRC: Record<SnapMeta['source'], string> = {
  manual: '手动',
  ai: 'AI',
  cli: 'CLI',
  auto: '自动',
};

/**
 * 快照列表的主标题：概括这份快照对应的那次操作。
 *
 * 有 ops（AI 轮次结束回写的）就用人话概括，比如「新建人物「林小满」、记 2 条事件」；
 * 没有就退到备注，再没有就按来源说「AI 自动备份」。扫一眼就知道每份快照是干什么的，
 * 不用点开猜。
 */
function snapTitle(s: SnapMeta): string {
  // 用户想看的是「这轮是为了什么」：AI 轮次结束后把第一条用户指令回写成 note，
  // 比如「把这批聊天记录整理进去」，比罗列九个工具调用更像人话。
  if (s.note) return s.note;
  // 没有意图（CLI 触发、手动备份）才退回按操作概括
  if (s.ops?.length) return summarizeOps(s.ops);
  return `${SNAP_SRC[s.source] ?? ''}备份`.replace(/^备份$/, '记录');
}

/**
 * 成果卡 / 详情里的「具体结果」：人名 + 头像、事件集图标、事件名。
 * 点一下直接跳到对应详情——看到「新建人物「林小满」」就能点开确认长什么样。
 */
import type { SnapDiffItem } from '../../core/snapshots';

function DiffChip({ item, onPreview, checked, onToggle, snapId }: {
  item: SnapDiffItem;
  onPreview?: (t: SnapTarget) => void;
  checked: boolean;
  onToggle: () => void;
  /** 这份成果的 id：点开对象详情前记住它，回来能原样回到这份成果 */
  snapId?: string;
}) {
  const open = () => {
    // 删除类只弹「删前内容」的小窗，不离开本页，不需要记来路
    if (item.before && onPreview) {
      onPreview({
        kind: item.kind,
        id: item.id,
        name: item.name,
        snapshot: item.before,
      });
      return;
    }
    // 跳到真实详情页前记一下来路：否则看完就回不到这份成果了
    if (snapId) setSnapReturn(snapId);
    if (item.kind === 'person') openPerson(item.id);
    else if (item.kind === 'event') openEvent(item.id);
    else openCollection(item.id);
  };
  return (
    <label className={`aichat-diff-chip ${checked ? '' : 'aichat-diff-chip-reject'}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <button type="button" className="aichat-target" onClick={open} title={item.before ? `查看「${item.name}」删除前内容` : `打开「${item.name}」`}>
        <span className="aichat-target-mark" aria-hidden>
          {item.kind === 'person' ? '人' : item.kind === 'event' ? '事' : '集'}
        </span>
        <span className="aichat-target-name">{item.name}</span>
      </button>
    </label>
  );
}

export function LabAiSection() {
  const [models, setModels] = useState<AiModel[]>(() => listModels());
  // 「模型」标签里增删改别名后会 bump()，这里跟着重拉列表，聊天区的下拉才不会露出已删除的别名
  const v = useVersion();
  useEffect(() => {
    setModels(listModels());
  }, [v]);
  const [alias, setAlias] = useState<string>(() => getDefaultModel()?.alias ?? listModels()[0]?.alias ?? '');
  const [history, setHistory] = useState<AgentMessage[]>(() => listSessions()[0]?.messages ?? []);
  const [items, setItems] = useState<Item[]>(() => (listSessions()[0]?.items ?? []) as Item[]);
  const [sessionId, setSessionId] = useState<string | null>(() => listSessions()[0]?.id ?? null);
  // 输入框里没发出去的文字也留底（开关在「功能体验 → 未完成的记录」）
  const [inputDraft] = useState(() => loadDraft<{ text: string }>('ai-input'));
  const [input, setInput] = useState(inputDraft?.data.text ?? '');
  const [inputRestoredAt, setInputRestoredAt] = useState<number | null>(
    inputDraft ? inputDraft.updatedAt : null,
  );
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  /** 当前第几轮（模型↔工具往返），状态条上显示 */
  const [roundNo, setRoundNo] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('chat');
  const [snaps, setSnaps] = useState(() => listSnapshots());
  /** 正在看详情的快照（点列表项弹出：这一轮到底做了什么） */
  const [snapDetail, setSnapDetail] = useState<SnapMeta | null>(null);
  /** 删除类 target 点开展示删前存下的内容（对象已软删，不查库） */
  const [previewTarget, setPreviewTarget] = useState<SnapTarget | null>(null);
  /** 成果详情里用户勾选为「拒绝」的条目，key 是 `${action}:${id}` */
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<AiSession[]>(() => listSessions());
  const [libOpen, setLibOpen] = useState(false);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  /** 历史会话点开后的操作菜单（继续 / 复制 / 删除） */
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
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

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
        setSnapDetail((s) => (s && s.id === snapDetailId ? { ...s, diff: d } : s));
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

  // 忙的时候两道防线，都是防「手滑一下，一轮工具调用全白跑」——
  // 会话还在组件 state 里，刷新更是连记录都不剩：
  // ① 导航入口（底部 Tab、设置返回/切页）统一问 navGuard，不让走就 toast 原因；
  // ② 刷新 / 关标签页交给浏览器原生确认（beforeunload）。
  useEffect(() => {
    if (!busy) return;
    setNavGuard(() => 'AI 还在干活，现在离开会中断这一轮。等它做完，或先点「停止」。');
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      setNavGuard(null);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [busy]);

  /** 把当前对话落盘成会话：没有会话就新建，有就更新。标题取首条用户消息 */
  const persistSession = (hist: AgentMessage[], its: Item[]) => {
    const firstUser = its.find((x) => x.kind === 'user');
    const title = titleOf(firstUser?.text ?? '');
    const now = new Date().toISOString();
    let id = sessionId;
    const existing = id ? sessions.find((s) => s.id === id) : undefined;
    if (!existing) {
      const created = createSession();
      id = created.id;
      setSessionId(id);
    }
    const next: AiSession = {
      id: id!,
      title,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages: hist,
      items: its as SessionItem[],
    };
    saveSession(next);
  };

  /** 从历史会话里载入一段对话：恢复上下文，切回聊天继续 */
  const loadSession = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    setSessionId(s.id);
    setHistory(s.messages);
    setItems(s.items as Item[]);
    setRollbackId(null);
    setErr(null);
    switchTab('chat');
  };

  /** 开一段新对话：清空上下文（不删历史会话里的旧记录） */
  const newSession = () => {
    setSessionId(null);
    setHistory([]);
    setItems([]);
    setRollbackId(null);
    setErr(null);
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
    const next = items.filter((_, i) => i !== index);
    setItems(next);
    setItemMenu(null);
    if (sessionId) persistSession(history, next);
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
        setErr(`一次最多带 ${MAX_ATTACHMENTS} 个附件`);
        return cur;
      }
      if (list.length > room) setErr(`一次最多带 ${MAX_ATTACHMENTS} 个附件，多出的没有加上`);
      return [...cur, ...list.slice(0, room)];
    });
  };

  const pickFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setErr(null);
    const out: Attachment[] = [];
    for (const f of Array.from(list)) {
      seq.current += 1;
      out.push(await fromFile(f, `f${seq.current}`));
    }
    addAtts(out);
    if (fileRef.current) fileRef.current.value = '';
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
    setErr(null);
    setLibOpen(false);
    seq.current += 1;
    addAtts([await fromStored(f, `s${seq.current}`)]);
  };

  const removeAtt = (key: string) => setAtts((s) => s.filter((a) => a.key !== key));

  const send = async (text: string) => {
    const t = text.trim();
    // 只有附件、没有文字也可以发（「看看这张图」这种）
    if ((!t && atts.length === 0) || busy) return;
    if (!model) {
      setErr('还没有可用的模型。点上方「模型」标签配一个别名和密钥。');
      return;
    }
    setErr(null);
    const sent = atts;
    setInput('');
    setAtts([]);
    // 先记住这条用户气泡：下面拼完整列表（含助手回复）时要用它，
    // 否则用闭包里的 items 会把刚加的这条冲掉。
    const userItem: Item = { kind: 'user', text: t || '（只发了附件）', attachments: sent };
    setItems((s) => [...s, userItem]);
    setActivity([]);
    setRoundNo(0);
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;
    // 系统提示只在第一轮注入，之后跟着对话历史走
    const base: AgentMessage[] = history.length ? history : [{ role: 'system', content: agentSystemPrompt() }];

    // 附件拼进正文：文本贴原文，图片另走 images（多模态）
    const body = [attachText(sent), t].filter(Boolean).join('\n\n');
    const imgs = imagesOf(sent);
    const userMsg: AgentMessage = imgs.length
      ? { role: 'user', content: body, images: imgs }
      : { role: 'user', content: body };

    const onEvent = (e: AgentEvent) => {
      if (e.type === 'round') {
        setRoundNo(e.n);
      } else if (e.type === 'tool_start') {
        const argKeys = Object.keys(e.args).filter((k) => e.args[k] !== undefined && e.args[k] !== null && e.args[k] !== '');
        setActivity((s) => [...s, `调用 ${e.name}${argKeys.length ? `（${argKeys.join('、')}）` : ''}`]);
      } else if (e.type === 'tool_end') {
        setActivity((s) => [...s, `${e.ok ? '完成' : '失败'} ${e.name}${e.ok ? '' : `：${e.preview}`}`]);
      } else if (e.type === 'snapshot') {
        setActivity((s) => [...s, e.id ? '已自动备份当前数据' : '自动备份失败（仍可继续，但无法一键回退）']);
      } else if (e.type === 'error') {
        setErr(e.message);
      }
    };

    try {
      // 连续对话里复用上一轮的快照：建人→记事件→整理这种多步任务跨几轮时，
      // 所有改动归到同一条成果，而不是每发一条消息就拍一条新快照。
      const lastSnap = [...items].reverse().find((x) => x.kind === 'assistant' && x.snapshotId);
      const res = await runAgentTurn({
        model,
        history: [...base, userMsg],
        signal: ac.signal,
        onEvent,
        resumeSnapshotId: lastSnap?.snapshotId ?? null,
      });
      // 失败不算「发过」：把这条气泡撤掉，原文和附件退回输入框，
      // 用户改一改就能重发，不会在记录里留下一条永远没有回应的提问。
      if (res.error) {
        setItems((s) => s.filter((x) => x !== userItem));
        setInput(t);
        setAtts(sent);
        setErr(res.error);
        return;
      }
      const hist = res.messages;
      setHistory(hist);
      if (res.snapshotId) setRollbackId(res.snapshotId);
      const last = [...hist].reverse().find((m) => m.role === 'assistant' && !(m.role === 'assistant' && m.toolCalls?.length));
      const replyText = last && last.role === 'assistant' ? last.content : '';
      const nextItems: Item[] = [
        ...items,
        userItem,
        {
          kind: 'assistant',
          text: replyText || (res.aborted ? '（已停止）' : '（这一轮没有文本回复）'),
          tools: res.usedTools.length ? res.usedTools : undefined,
          snapshotId: res.snapshotId,
        },
      ];
      setItems(nextItems);
      reloadSnaps();
      // 明确告诉用户「干完了」：以前忙完只是停止按钮消失，不盯着看根本不知道
      showToast(res.aborted ? '已停止本轮' : 'AI 已完成，可以继续提问或离开');
      // 落盘：被中断也能从历史会话里找回并继续
      persistSession(hist, nextItems);
      reloadSessions();
    } catch (e) {
      // 抛异常同样按失败处理：撤掉气泡、把内容退回输入框
      setItems((s) => s.filter((x) => x !== userItem));
      setInput(t);
      setAtts(sent);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setActivity([]);
      setRoundNo(0);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const rollback = async (id: string) => {
    if (!window.confirm('拒绝这次改动？\n数据会回退到 AI 动手之前。当前状态会自动留底，踩错了还能再退回来。')) return;
    clearSnapReturn();
    await restoreSnapshot(id);
    bump();
    reloadSnaps();
    setRollbackId(null);
    setItems((s) => [...s, { kind: 'assistant', text: '已按这份成果回退数据。' }]);
  };

  const removeSnap = async (id: string) => {
    if (!window.confirm('确认接受这次改动？\n接受后这条成果记录会被关掉，数据保留不变。')) return;
    clearSnapReturn();
    await deleteSnapshot(id);
    reloadSnaps();
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
          aria-selected={tab === 'models'}
          className={tab === 'models' ? 'aichat-tab aichat-tab-on' : 'aichat-tab'}
          onClick={() => switchTab('models')}
        >
          模型{models.length > 0 && <span className="aichat-tab-n">{models.length}</span>}
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
        {tab === 'chat' && (
          <div className="aichat-chat">
            <div className="aichat-log" ref={logRef}>
              {items.length === 0 && (
                <div className="aichat-empty">
                  <p>比如可以问我：</p>
                  <ul>
                    {QUICK.map((q) => (
                      <li key={q}>
                        <button className="aichat-quick" onClick={() => send(q)} disabled={busy || !model}>
                          {q}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {items.map((it, i) => (
                <div
                  key={i}
                  className={
                    itemMenu === i
                      ? `aichat-item aichat-${it.kind} aichat-item-open`
                      : `aichat-item aichat-${it.kind}`
                  }
                  onClick={(e) => {
                    // 气泡里的链接 / 按钮自己有事要做，别顺手把操作菜单也切出来
                    if ((e.target as HTMLElement).closest('a,button')) return;
                    setItemMenu(itemMenu === i ? null : i);
                  }}
                >
                  {it.attachments && it.attachments.length > 0 && <AttachmentChips atts={it.attachments} />}
                  {/* 气泡内容按 Markdown 渲染：模型的回复天生带标题/列表/代码块，
                      当纯文本显示就是把 ** 和 # 原样甩给用户。安全性由 core/markdown
                      （marked 解析 + DOMPurify 白名单）保证，这里只管展示。 */}
                  <div className="aichat-bubble">
                    <MarkdownView source={it.text} />
                  </div>
                  {it.tools && it.tools.length > 0 && <div className="aichat-tools">调用了 {it.tools.join('、')}</div>}
                  {it.snapshotId && !busy && (
                    <button className="aichat-rollback" onClick={() => rollback(it.snapshotId!)}>
                      回退本轮改动
                    </button>
                  )}
                  {itemMenu === i && !busy && (
                    <div className="aichat-item-actions">
                      <button
                        className="aichat-linkbtn"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyItem(it);
                        }}
                      >
                        复制到对话框
                      </button>
                      <button
                        className="aichat-linkbtn aichat-linkbtn-dim"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeItem(i);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {busy && activity.length > 0 && (
                <div className="aichat-item aichat-assistant">
                  <div className="aichat-activity">
                    {activity.map((a, i) => (
                      <div key={i} className="aichat-activity-line">
                        {a}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {busy && activity.length === 0 && <div className="aichat-item aichat-assistant">思考中…</div>}
            </div>

            {err && <p className="aichat-err">{err}</p>}

            {/* 待发送的附件：贴在输入框上方，发出去就清空 */}
            {atts.length > 0 && (
              <div className="aichat-pending">
                <AttachmentChips atts={atts} onRemove={removeAtt} />
              </div>
            )}

            <div className="aichat-input">
              {inputRestoredAt !== null && (
                <div className="draft-restored">
                  <span className="muted small">
                    已恢复上次没发出去的内容 · {draftTimeLabel(inputRestoredAt)}
                  </span>
                  <button className="btn btn-sm" onClick={() => setInput('')}>
                    清空
                  </button>
                </div>
              )}
              <div className="aichat-input-tools">
                <button
                  className="aichat-toolbtn"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy || atts.length >= MAX_ATTACHMENTS}
                  title="从本地选文件（手机上就是系统文件选择器）"
                >
                  <AttachIcon /> 选文件
                </button>
                <button
                  className="aichat-toolbtn"
                  onClick={() => setLibOpen(true)}
                  disabled={busy || atts.length >= MAX_ATTACHMENTS}
                  title="从本库的文件里挑一个"
                >
                  <LibIcon /> 文件库
                </button>
                <label className="aichat-model aichat-model-inline" title="选择模型">
                  <select value={alias} onChange={(e) => setAlias(e.target.value)} disabled={busy}>
                    {models.length === 0 && <option value="">（未配置模型）</option>}
                    {models.map((m) => (
                      <option key={m.id} value={m.alias}>
                        {m.alias} · {m.model}
                      </option>
                    ))}
                  </select>
                </label>
                {busy && (
                  <span className="aichat-busy-chip" role="status">
                    <span className="aichat-status-dot" aria-hidden />
                    AI 干活中{roundNo > 1 ? ` · 第 ${roundNo} 轮` : ''}
                    <button className="aichat-busy-stop" onClick={stop}>
                      停止
                    </button>
                  </span>
                )}
                {rollbackId && (
                  <button className="aichat-toolbtn aichat-toolbtn-warn" onClick={() => rollback(rollbackId)}>
                    回退本轮
                  </button>
                )}
              </div>
              <div className="aichat-input-row">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  placeholder={busy ? 'AI 正在干活，说不了话…' : '说点什么，Enter 发送，Shift+Enter 换行'}
                  rows={2}
                  disabled={busy}
                />
                <button className="btn-primary aichat-send" onClick={() => send(input)} disabled={!canSend}>
                  发送
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'models' && (
          <div className="aichat-models">
            <AiSection />
          </div>
        )}

        {tab === 'history' && (
          <div className="aichat-history">
            <div className="aichat-subhead">
              <span className="muted small">点一个会话就打开继续；改名、批量删除在右边。</span>
              <span className="aichat-subhead-actions">
                {manage ? (
                  <>
                    <button className="aichat-chipbtn aichat-chipbtn-danger" onClick={removePicked} disabled={picked.size === 0}>
                      删除选中{picked.size > 0 ? `（${picked.size}）` : ''}
                    </button>
                    <button
                      className="aichat-chipbtn aichat-chipbtn-primary"
                      onClick={() => {
                        setManage(false);
                        setPicked(new Set());
                      }}
                    >
                      完成
                    </button>
                  </>
                ) : (
                  <>
                    <button className="aichat-chipbtn" onClick={() => setManage(true)}>
                      批量删除
                    </button>
                    <button className="aichat-chipbtn aichat-chipbtn-primary" onClick={newSession}>
                      ＋ 新会话
                    </button>
                  </>
                )}
              </span>
            </div>
            {sessions.length === 0 ? (
              <p className="muted small aichat-history-empty">还没有历史会话。在「聊天」里说点什么，会自动存下来。</p>
            ) : (
              <ul className="aichat-session-list">
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    className={
                      manage && picked.has(s.id) ? 'aichat-session aichat-session-picked' : 'aichat-session'
                    }
                  >
                    {manage && (
                      <button
                        type="button"
                        className={picked.has(s.id) ? 'aichat-pick aichat-pick-on' : 'aichat-pick'}
                        onClick={() => togglePick(s.id)}
                        aria-pressed={picked.has(s.id)}
                        aria-label={picked.has(s.id) ? '取消选择' : '选择这个会话'}
                      >
                        {picked.has(s.id) ? '✓' : ''}
                      </button>
                    )}
                    {renameId === s.id ? (
                      <div className="aichat-session-rename">
                        <input
                          value={renameText}
                          autoFocus
                          onChange={(e) => setRenameText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setRenameId(null);
                          }}
                          aria-label="会话名"
                        />
                        <button className="aichat-linkbtn" onClick={commitRename}>
                          保存
                        </button>
                        <button className="aichat-linkbtn aichat-linkbtn-dim" onClick={() => setRenameId(null)}>
                          取消
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="aichat-session-main"
                          onClick={() => (manage ? togglePick(s.id) : loadSession(s.id))}
                          title={manage ? '选中这个会话' : '打开这个会话'}
                        >
                          <span className="aichat-session-title">{s.title}</span>
                          <span className="aichat-session-sub">
                            <span className="aichat-session-time">{fmtSnapTime(s.updatedAt)}</span>
                            <span className="aichat-session-meta">{s.items.length} 条消息</span>
                          </span>
                        </button>
                        {!manage && (
                          <button
                            type="button"
                            className="aichat-session-edit"
                            title="修改会话名"
                            aria-label="修改会话名"
                            onClick={() => startRename(s)}
                          >
                            <PencilIcon />
                          </button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'snap' && (
          <div className="aichat-snaps">
            <div className="aichat-subhead">
              <span className="muted small">AI / CLI 动手前会自动记录：做了什么、做成了什么都在这里，点开能看具体结果。</span>
            </div>
            {snaps.length === 0 ? (
              <p className="muted small aichat-history-empty">还没有成果。</p>
            ) : (
              <ul className="aichat-snap-list">
                {snaps.map((s) => (
                  <li key={s.id}>
                    {/* 卡片只给「标题 + 时间」。具体改了谁、加了谁、删了谁，
                        点开详情里按 新增 / 修改 / 删除 分组看——列表上再堆净变化数字和
                        对象 chip，既占地方又和详情重复，用户扫一眼也分不清哪个是哪个。 */}
                    <div className="aichat-snap-block">
                      <button
                        type="button"
                        className="aichat-snap-main"
                        onClick={() => setSnapDetail(s)}
                        title="查看这份成果的具体操作"
                      >
                        <span className="aichat-snap-title">{snapTitle(s)}</span>
                        <span className="aichat-snap-sub">
                          <span className="aichat-snap-time">{fmtSnapTime(s.createdAt)}</span>
                        </span>
                      </button>
                    </div>
                    <span className="aichat-snap-ops">
                      <button className="aichat-linkbtn" onClick={() => removeSnap(s.id)}>
                        接受
                      </button>
                      <button className="aichat-linkbtn aichat-linkbtn-danger" onClick={() => rollback(s.id)}>
                        放弃改动
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'help' && (
          <div className="aichat-help">
            <p>
              能查数据、建人物、记事件、整理聊天记录。<b>每次写库前自动备份</b>，聊完不满意可以整轮回退。
              支持上传文件（文本读内容、图片走视觉），附件只随这一条消息发送，不进文件库。
            </p>
            <p className="muted small">
              我能调用 person / event / chat / collection / file / snapshot / io / system 八组工具。
              模型的别名、服务商、密钥和连通测试都在上方「模型」标签里。
            </p>
            <p className="muted small">
              顶部五个按钮：<b>聊天</b>是和 AI 对话；<b>模型</b>管别名、服务商与密钥；<b>历史会话</b>是自动保存的对话记录，可载入继续；
              <b>成果</b>是 AI / CLI 做过的改动记录，能看到具体建了谁、删了谁、记了什么事；点进去核对后，<b>接受</b>保留改动并关掉记录，<b>放弃改动</b>则整轮回退到 AI 动手前。<b>说明</b>是本页。切换不中断 AI 正在做的事。
            </p>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" multiple hidden accept="*/*" onChange={(e) => void pickFiles(e.target.files)} />

      {libOpen && (
        <Modal title="文件库 · 选一个发给 AI" wide onClose={() => setLibOpen(false)}>
          <FilesSection onPick={(f) => void pickStored(f)} />
        </Modal>
      )}

      {snapDetail && (
        <Modal
          title="成果详情"
          onClose={() => {
            setSnapDetail(null);
            clearSnapReturn();
          }}
          wide
        >
          <div className="aichat-snap-detail">
            <p className="aichat-snap-detail-title">{snapTitle(snapDetail)}</p>
            <p className="muted small">
              {fmtSnapTime(snapDetail.createdAt)} · {SNAP_SRC[snapDetail.source] ?? snapDetail.source} ·{' '}
              {snapDetail.persons} 人 / {snapDetail.events} 事件 / {fmtBytes(snapDetail.bytes)}
            </p>

            {snapDetail.diff ? (
              <div className="aichat-diff">
                {snapDetail.diff.created.length > 0 && (
                  <div className="aichat-diff-group aichat-diff-created">
                    <div className="aichat-diff-head">新增 {snapDetail.diff.created.length}</div>
                    <div className="aichat-diff-items">
                      {snapDetail.diff.created.map((t) => (
                        <DiffChip key={`c:${t.id}`} item={t} snapId={snapDetail.id}
                          checked={!rejected.has(`created:${t.id}`)}
                          onToggle={() => toggleReject(`created:${t.id}`)} />
                      ))}
                    </div>
                  </div>
                )}
                {snapDetail.diff.updated.length > 0 && (
                  <div className="aichat-diff-group aichat-diff-updated">
                    <div className="aichat-diff-head">修改 {snapDetail.diff.updated.length}</div>
                    <div className="aichat-diff-items">
                      {snapDetail.diff.updated.map((t) => (
                        <DiffChip key={`u:${t.id}`} item={t} snapId={snapDetail.id}
                          checked={!rejected.has(`updated:${t.id}`)}
                          onToggle={() => toggleReject(`updated:${t.id}`)} />
                      ))}
                    </div>
                  </div>
                )}
                {snapDetail.diff.deleted.length > 0 && (
                  <div className="aichat-diff-group aichat-diff-deleted">
                    <div className="aichat-diff-head">删除 {snapDetail.diff.deleted.length}</div>
                    <div className="aichat-diff-items">
                      {snapDetail.diff.deleted.map((t) => (
                        <DiffChip key={`d:${t.id}`} item={t} snapId={snapDetail.id} onPreview={setPreviewTarget}
                          checked={!rejected.has(`deleted:${t.id}`)}
                          onToggle={() => toggleReject(`deleted:${t.id}`)} />
                      ))}
                    </div>
                  </div>
                )}
                {(snapDetail.diff.reverted?.length ?? 0) > 0 && (
                  <p className="muted small aichat-diff-note">
                    另有 {snapDetail.diff.reverted.length} 个对象这一轮动过又复原（比如建了又删），
                    净变化为零，所以不在上面三组里：
                    {snapDetail.diff.reverted.map((t) => t.name).join('、')}
                  </p>
                )}
                {rejected.size > 0 && (
                  <div className="aichat-diff-actions">
                    <button className="aichat-chipbtn aichat-chipbtn-danger" onClick={applyRejected}>
                      拒绝选中的 {rejected.size} 项改动
                    </button>
                    <span className="muted small">其余保留</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </Modal>
      )}

      {previewTarget && (
        <Modal title={`删除前的${previewTarget.kind === 'event' ? '事件' : previewTarget.kind === 'person' ? '人物' : '事件集'}`} onClose={() => setPreviewTarget(null)}>
          <div className="aichat-snap-preview">
            <p className="aichat-snap-preview-name">{previewTarget.name}</p>
            {previewTarget.snapshot?.timeLabel && (
              <p className="muted small">时间：{previewTarget.snapshot.timeLabel}</p>
            )}
            {previewTarget.snapshot?.placeName && (
              <p className="muted small">地点：{previewTarget.snapshot.placeName}</p>
            )}
            {previewTarget.snapshot?.personNames?.length ? (
              <p className="muted small">参与：{previewTarget.snapshot.personNames.join('、')}</p>
            ) : null}
            {previewTarget.snapshot?.content ? (
              <div className="aichat-snap-preview-body">{previewTarget.snapshot.content}</div>
            ) : (
              <p className="muted small">（这条记录没有存正文内容，可点「放弃改动」回退后查看完整记录）</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
