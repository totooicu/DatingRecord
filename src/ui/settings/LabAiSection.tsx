// 功能体验 → AI 对话。
//
// 不是一个聊天玩具：它背后是 src/core/ai/agent.ts 的 agent 循环——
// 模型能思考、能连续调用多个工具（查数据 / 建人物 / 记事件 / 改消息……），
// 每次调用的结果会喂回去给它看，直到它给出最终回复。
//
// 防误改的三道闸：
//   1. 本轮第一次写库前自动拍整库快照，气泡下面始终挂着「回退本轮」按钮；
//   2. 快照列表收进顶部「快照」面板，任何时候都能手动恢复；
//   3. 工具调用过程全程可见（哪一步调了什么、成没成），不是黑盒。
//
// 防「一轮白跑」：忙的时候日志上方钉一条状态条（第几轮、正在干什么），
// 导航入口（底部 Tab / 设置返回）被 navGuard 拦下，刷新走浏览器原生确认；
// 干完 toast 一句「AI 已完成」。用户再也不用盯着屏幕猜它好没有。
//
// 版面分配（本轮改的重点）：聊天区吃掉整屏剩余高度，说明文字全部收进折叠区。
// 以前这一页顶着「AI 对话」「边缘分割」两段大说明，聊天框只有 44vh，手机上
// 输入法一弹就什么都看不见了。
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
  const [history, setHistory] = useState<AgentMessage[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  /** 当前第几轮（模型↔工具往返），状态条上显示 */
  const [roundNo, setRoundNo] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [snaps, setSnaps] = useState(() => listSnapshots());
  const [snapOpen, setSnapOpen] = useState(false);
  /** 正在看详情的快照（点列表项弹出：这一轮到底做了什么） */
  const [snapDetail, setSnapDetail] = useState<SnapMeta | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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
    setItems((s) => [...s, { kind: 'user', text: t || '（只发了附件）', attachments: sent }]);
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
      setHistory(res.messages);
      if (res.snapshotId) setRollbackId(res.snapshotId);
      const last = [...res.messages].reverse().find((m) => m.role === 'assistant' && !(m.role === 'assistant' && m.toolCalls?.length));
      const text = last && last.role === 'assistant' ? last.content : '';
      setItems((s) => [
        ...s,
        {
          kind: 'assistant',
          text: text || (res.aborted ? '（已停止）' : '（这一轮没有文本回复）'),
          tools: res.usedTools.length ? res.usedTools : undefined,
          snapshotId: res.snapshotId,
        },
      ]);
      reloadSnaps();
      // 明确告诉用户「干完了」：以前忙完只是停止按钮消失，不盯着看根本不知道
      showToast(res.aborted ? '已停止本轮' : 'AI 已完成，可以继续提问或离开');
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

  const canSend = !busy && !!model && (!!input.trim() || atts.length > 0);

  return (
    <div className="lab-page lab-page-chat">
      <LabHead title="AI 对话" subKey="labAi" />

      {/* 工具条：模型 + 快照入口 + 说明开关。一行解决，把高度让给聊天区 */}
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
        <div className="aichat-bar-ops">
          <button
            className={snapOpen ? 'aichat-chip aichat-chip-on' : 'aichat-chip'}
            onClick={() => {
              reloadSnaps();
              setSnapOpen((v) => !v);
            }}
          >
            快照 {snaps.length > 0 && <span className="aichat-chip-n">{snaps.length}</span>}
          </button>
          <button className="aichat-chip" onClick={() => setHelpOpen((v) => !v)} aria-expanded={helpOpen}>
            说明
          </button>
          {busy && (
            <button className="btn-danger aichat-stop" onClick={stop}>
              停止
            </button>
          )}
        </div>
      </div>

      {helpOpen && (
        <div className="aichat-help">
          <p>
            能查数据、建人物、记事件、整理聊天记录。**每次写库前自动备份**，聊完不满意可以整轮回退。
            支持上传文件（文本读内容、图片走视觉），附件只随这一条消息发送，不进文件库。
          </p>
          <p className="muted small">
            我能调用 person / event / chat / collection / file / snapshot / io / system 八组工具。
            模型配置在「AI 模型」页。
          </p>
        </div>
      )}

      {snapOpen && (
        <div className="aichat-snaps">
          <div className="aichat-snaps-head">
            <span className="muted small">快照（AI / CLI 动手前自动拍，也可手动恢复）</span>
            <button className="aichat-linkbtn" onClick={reloadSnaps}>
              刷新
            </button>
          </div>
          {snaps.length === 0 ? (
            <p className="muted small">还没有快照。</p>
          ) : (
            <ul className="aichat-snap-list">
              {snaps.slice(0, 8).map((s) => (
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

      {/* 快照详情：逐条列出这一轮调了什么工具、成没成、几点干的。
          AI 轮次结束后 ops 会回写进快照元数据，所以这里能看到的不只是
          「有一份备份」，而是「备份之前 AI 到底动了什么」。 */}
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

      {models.length === 0 && (
        <p className="aichat-hint">还没有配置模型。到「AI 模型」页添加别名、选服务商、填密钥，回来就能开聊。</p>
      )}

      {/* 状态条：忙不忙、第几轮、正在干什么，一眼可见。
          放在日志外面——日志会滚动，这条得始终钉在眼前。
          以前只有日志里一行「思考中…」和工具条上一个「停止」，不盯着看
          根本不知道 AI 还在干活，手滑切走/刷新就把它中断了。 */}
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

      <input ref={fileRef} type="file" multiple hidden accept="*/*" onChange={(e) => void pickFiles(e.target.files)} />

      {libOpen && (
        <Modal title="文件库 · 选一个发给 AI" wide onClose={() => setLibOpen(false)}>
          <FilesSection onPick={(f) => void pickStored(f)} />
        </Modal>
      )}
    </div>
  );
}
