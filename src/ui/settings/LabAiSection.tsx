// 功能体验 → AI 对话。
//
// 不是一个聊天玩具：它背后是 src/core/ai/agent.ts 的 agent 循环——
// 模型能思考、能连续调用多个工具（查数据 / 建人物 / 记事件 / 改消息……），
// 每次调用的结果会喂回去给它看，直到它给出最终回复。
//
// 版面（本轮重做）：顶部四个按钮「聊天 / 历史会话 / 快照 / 说明」，点哪个哪个
// 铺满整屏，互不挤占。以前快照和说明是嵌在聊天页里的小面板，点开就把聊天区
// 挤掉一半，体验很碎。现在各占一屏，切换只是换显示，组件不卸载、agent 循环
// 不中断——AI 在后台跑着，你切到「快照」看备份也照样跑。
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

import { bump } from '../../store';
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
  deleteSession,
  listSessions,
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
} from '../../core/snapshots';
import type { StoredFile } from '../../core/repo/files';
import { Modal } from '../common';
import { FilesSection } from '../files';
import { MarkdownView } from '../markdown';
import { LabHead } from './LabEdgeSection';
import { setNavGuard } from '../navGuard';
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

type TabKey = 'chat' | 'history' | 'snap' | 'help';

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
  if (s.ops?.length) return summarizeOps(s.ops);
  if (s.note) return s.note;
  return `${SNAP_SRC[s.source] ?? ''}备份`.replace(/^备份$/, '快照');
}

export function LabAiSection() {
  const [models] = useState<AiModel[]>(() => listModels());
  const [alias, setAlias] = useState<string>(() => getDefaultModel()?.alias ?? listModels()[0]?.alias ?? '');
  const [history, setHistory] = useState<AgentMessage[]>(() => listSessions()[0]?.messages ?? []);
  const [items, setItems] = useState<Item[]>(() => (listSessions()[0]?.items ?? []) as Item[]);
  const [sessionId, setSessionId] = useState<string | null>(() => listSessions()[0]?.id ?? null);
  const [input, setInput] = useState('');
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
  const [sessions, setSessions] = useState<AiSession[]>(() => listSessions());
  const [libOpen, setLibOpen] = useState(false);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
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

  // 切到快照 / 历史会话时顺手刷新，避免看到旧数据
  const switchTab = (t: TabKey) => {
    setTab(t);
    if (t === 'snap') reloadSnaps();
    if (t === 'history') reloadSessions();
  };

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
    switchTab('chat');
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
      setErr('还没有可用的模型。先去「AI 模型」页配一个别名和密钥。');
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
      const res = await runAgentTurn({
        model,
        history: [...base, userMsg],
        signal: ac.signal,
        onEvent,
      });
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
    if (!window.confirm('把整个库恢复到这一步之前？\n当前数据会先自动留一份快照，踩错了还能再退回来。')) return;
    await restoreSnapshot(id);
    bump();
    reloadSnaps();
    setRollbackId(null);
    setItems((s) => [...s, { kind: 'assistant', text: '已按快照回退数据。' }]);
  };

  const removeSnap = async (id: string) => {
    if (!window.confirm('删除这份快照？删掉就再也回不去了。')) return;
    await deleteSnapshot(id);
    reloadSnaps();
  };

  const removeSession = async (id: string) => {
    if (!window.confirm('删除这段历史会话？只删聊天记录，不影响库里的人物和事件。')) return;
    deleteSession(id);
    if (sessionId === id) newSession();
    reloadSessions();
  };

  const canSend = !busy && !!model && (!!input.trim() || atts.length > 0);

  return (
    <div className="lab-page lab-page-chat">
      <LabHead title="AI 对话" subKey="labAi" />

      {/* 四个全屏切换按钮：点哪个哪个铺满下面整块。切换不卸载组件，
          所以 agent 循环、busy 状态、聊天记录都还在，会话不会被打断。 */}
      <div className="aichat-tabs" role="tablist">
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
          快照{snaps.length > 0 && <span className="aichat-tab-n">{snaps.length}</span>}
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

      {/* 状态条：忙不忙、第几轮、正在干什么，一眼可见。跨 tab 不掉——
          你在「快照」tab 看备份，AI 仍在后台跑，这条始终钉在眼前。 */}
      {busy && (
        <div className="aichat-status" role="status">
          <span className="aichat-status-dot" aria-hidden />
          <span className="aichat-status-text">
            <b>AI 正在干活{roundNo > 1 ? `（第 ${roundNo} 轮）` : ''}</b>
            {' · '}
            {activity[activity.length - 1] ?? '思考中'}
          </span>
          <button className="aichat-status-stop" onClick={stop}>
            停止
          </button>
        </div>
      )}

      {/* 内容区：吃掉剩余高度，四个 tab 共用这块，切换只换里面的视图 */}
      <div className="aichat-body">
        {tab === 'chat' && (
          <div className="aichat-chat">
            <div className="aichat-bar">
              <label className="aichat-model">
                <select value={alias} onChange={(e) => setAlias(e.target.value)} disabled={busy}>
                  {models.length === 0 && <option value="">（未配置模型）</option>}
                  {models.map((m) => (
                    <option key={m.id} value={m.alias}>
                      {m.alias} · {m.model}
                    </option>
                  ))}
                </select>
              </label>
              <button className="aichat-chip" onClick={newSession} disabled={busy} title="开一段新对话">
                ＋ 新会话
              </button>
            </div>

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
                <div key={i} className={`aichat-item aichat-${it.kind}`}>
                  {it.attachments && it.attachments.length > 0 && <AttachmentChips atts={it.attachments} />}
                  {/* 气泡内容按 Markdown 渲染：模型的回复天生带标题/列表/代码块，
                      当纯文本显示就是把 ** 和 # 原样甩给用户。安全性由 core/markdown
                      （marked 解析 + DOMPurify 白名单）保证，这里只管展示。 */}
                  <div className="aichat-bubble">
                    <MarkdownView source={it.text} />
                  </div>
                  {it.tools && it.tools.length > 0 && <div className="aichat-tools">调用了 {it.tools.join('、')}</div>}
                  {it.snapshotId && (
                    <button className="aichat-rollback" onClick={() => rollback(it.snapshotId!)}>
                      回退本轮改动
                    </button>
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

        {tab === 'history' && (
          <div className="aichat-history">
            <div className="aichat-subhead">
              <span className="muted small">聊过的对话会自动存到这里，刷新或中断后都能回来继续。</span>
              <button className="aichat-linkbtn" onClick={newSession}>
                ＋ 新会话
              </button>
            </div>
            {sessions.length === 0 ? (
              <p className="muted small aichat-history-empty">还没有历史会话。在「聊天」里说点什么，会自动存下来。</p>
            ) : (
              <ul className="aichat-session-list">
                {sessions.map((s) => (
                  <li key={s.id} className="aichat-session">
                    <button
                      type="button"
                      className="aichat-session-main"
                      onClick={() => loadSession(s.id)}
                      title="载入这段对话，切回聊天继续"
                    >
                      <span className="aichat-session-title">{s.title}</span>
                      <span className="aichat-session-sub">
                        <span className="aichat-session-time">{fmtSnapTime(s.updatedAt)}</span>
                        <span className="aichat-session-meta">{s.items.length} 条消息</span>
                      </span>
                    </button>
                    <button
                      className="aichat-linkbtn aichat-linkbtn-dim"
                      onClick={() => removeSession(s.id)}
                      aria-label="删除这段历史会话"
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'snap' && (
          <div className="aichat-snaps">
            <div className="aichat-subhead">
              <span className="muted small">AI / CLI 动手前自动拍，也可留作备份。点开看这一轮具体动了什么。</span>
            </div>
            {snaps.length === 0 ? (
              <p className="muted small aichat-history-empty">还没有快照。</p>
            ) : (
              <ul className="aichat-snap-list">
                {snaps.map((s) => (
                  <li key={s.id}>
                    {/* 整块可点：点开看「这一轮具体做了什么」。恢复/删除是另一组按钮，
                        点它们别触发详情——所以详情用单独的一块，不包住操作按钮 */}
                    <button
                      type="button"
                      className="aichat-snap-main"
                      onClick={() => setSnapDetail(s)}
                      title="查看这份快照对应的具体操作"
                    >
                      <span className="aichat-snap-title">{snapTitle(s)}</span>
                      <span className="aichat-snap-sub">
                        <span className="aichat-snap-time">{fmtSnapTime(s.createdAt)}</span>
                        <span className="aichat-snap-src">{SNAP_SRC[s.source] ?? s.source}</span>
                        <span className="aichat-snap-meta">
                          {s.persons} 人 / {s.events} 事件 / {fmtBytes(s.bytes)}
                        </span>
                        {s.ops?.length ? (
                          <span className="aichat-snap-more">{s.ops.length} 项操作 ›</span>
                        ) : null}
                      </span>
                    </button>
                    <span className="aichat-snap-ops">
                      <button className="aichat-linkbtn" onClick={() => rollback(s.id)}>
                        恢复
                      </button>
                      <button className="aichat-linkbtn aichat-linkbtn-dim" onClick={() => removeSnap(s.id)}>
                        删除
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
              模型配置在「AI 模型」页。
            </p>
            <p className="muted small">
              顶部四个按钮：<b>聊天</b>是和 AI 对话；<b>历史会话</b>是自动保存的对话记录，可载入继续；
              <b>快照</b>是数据备份点，可一键恢复或删除；<b>说明</b>是本页。切换不中断 AI 正在做的事。
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
        <Modal title="快照详情" onClose={() => setSnapDetail(null)} wide>
          <div className="aichat-snap-detail">
            <p className="aichat-snap-detail-title">{snapTitle(snapDetail)}</p>
            <p className="muted small">
              {fmtSnapTime(snapDetail.createdAt)} · {SNAP_SRC[snapDetail.source] ?? snapDetail.source} ·{' '}
              {snapDetail.persons} 人 / {snapDetail.events} 事件 / {fmtBytes(snapDetail.bytes)}
            </p>
            {snapDetail.ops?.length ? (
              <ul className="aichat-op-list">
                {snapDetail.ops.map((o, i) => (
                  <li key={i} className={o.ok ? 'aichat-op' : 'aichat-op aichat-op-bad'}>
                    <span className="aichat-op-mark">{o.ok ? '✓' : '✗'}</span>
                    <span className="aichat-op-text">{o.text}</span>
                    <span className="aichat-op-side">
                      <span className="aichat-op-tool">{o.tool}</span>
                      <span className="aichat-op-time">{fmtSnapTime(o.at)}</span>
                    </span>
                    {!o.ok && o.err && <span className="aichat-op-err">{o.err}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">
                这份快照没有记录具体操作（手动拍的，或是早于操作记录功能之前拍的）。
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
