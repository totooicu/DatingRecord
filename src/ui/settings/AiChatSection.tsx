// 设置 → 功能体验 里的「AI 对话」。
//
// 不是一个聊天玩具：它背后是 src/core/ai/agent.ts 的 agent 循环——
// 模型能思考、能连续调用多个工具（查数据 / 建人物 / 记事件 / 改消息……），
// 每次调用的结果会喂回去给它看，直到它给出最终回复。
//
// 防误改的三道闸：
//   1. 本轮第一次写库前自动拍整库快照，面板上始终挂着「回退本轮」按钮；
//   2. 快照列表就在下面，任何时候都能手动恢复；
//   3. 工具调用过程全程可见（哪一步调了什么、成没成），不是黑盒。
//
// 模型配置不在这一页——去「AI 模型」页加别名和服务商密钥。

import { useEffect, useMemo, useRef, useState } from 'react';

import { Section } from './Section';
import { bump } from '../../store';
import { findByAlias, getDefaultModel, listModels, type AiModel } from '../../core/ai';
import { agentSystemPrompt, runAgentTurn, type AgentEvent, type AgentMessage } from '../../core/ai/agent';
import { deleteSnapshot, listSnapshots, restoreSnapshot, fmtSnapTime, fmtBytes } from '../../core/snapshots';

interface Item {
  kind: 'user' | 'assistant';
  text: string;
  /** 这一轮里调用了哪些工具 */
  tools?: string[];
  /** 这一轮的自动快照（可回退） */
  snapshotId?: string | null;
}

const QUICK = ['这个库里都有什么？', '最近发生了哪些事？', '帮我建一个人物：王五，电话 13800138000'];

export function AiChatSection() {
  const [models] = useState<AiModel[]>(() => listModels());
  const [alias, setAlias] = useState<string>(() => getDefaultModel()?.alias ?? listModels()[0]?.alias ?? '');
  const [history, setHistory] = useState<AgentMessage[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [snaps, setSnaps] = useState(() => listSnapshots());
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const model = useMemo(() => findByAlias(alias) ?? getDefaultModel(), [alias, models]);

  // 新消息滚到底
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, activity, busy]);

  const reloadSnaps = () => setSnaps(listSnapshots());

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    if (!model) {
      setErr('还没有可用的模型。先去「AI 模型」页配一个别名和密钥。');
      return;
    }
    setErr(null);
    setInput('');
    setItems((s) => [...s, { kind: 'user', text: t }]);
    setActivity([]);
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;
    // 系统提示只在第一轮注入，之后跟着对话历史走
    const base: AgentMessage[] = history.length ? history : [{ role: 'system', content: agentSystemPrompt() }];

    const onEvent = (e: AgentEvent) => {
      if (e.type === 'tool_start') {
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
        history: [...base, { role: 'user', content: t }],
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setActivity([]);
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

  return (
    <Section
      title="AI 对话"
      desc="能思考、能动手的助手：它可以查数据、建人物、记事件、整理聊天记录。每次写数据前会自动备份，不满意可以整轮回退。"
    >
      <div className="aichat">
        <div className="aichat-bar">
          <label className="aichat-model">
            模型
            <select value={alias} onChange={(e) => setAlias(e.target.value)} disabled={busy}>
              {models.length === 0 && <option value="">（未配置）</option>}
              {models.map((m) => (
                <option key={m.id} value={m.alias}>
                  {m.alias} · {m.model}
                </option>
              ))}
            </select>
          </label>
          {busy ? (
            <button className="btn-danger" onClick={stop}>
              停止
            </button>
          ) : (
            <span className="muted small">{history.length ? '对话进行中' : '新对话'}</span>
          )}
        </div>

        {models.length === 0 && (
          <p className="aichat-hint">
            还没有配置模型。到「AI 模型」页添加别名、选服务商、填密钥，回来就能开聊。
          </p>
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
              <p className="muted small">
                我能调用 {`person / event / chat / collection / file / snapshot / io / system`} 八组工具，
                所以「把上周那顿饭记下来，参与者是张三」这种事可以直接交给我。
              </p>
            </div>
          )}

          {items.map((it, i) => (
            <div key={i} className={`aichat-item aichat-${it.kind}`}>
              <div className="aichat-bubble">{it.text}</div>
              {it.tools && it.tools.length > 0 && (
                <div className="aichat-tools">调用了 {it.tools.join('、')}</div>
              )}
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

        <div className="aichat-input">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="说点什么，Enter 发送，Shift+Enter 换行"
            rows={2}
            disabled={busy}
          />
          <button className="btn-primary" onClick={() => send(input)} disabled={busy || !input.trim() || !model}>
            发送
          </button>
        </div>

        {rollbackId && (
          <p className="aichat-note">
            本轮改动已自动备份。
            <button className="aichat-linkbtn" onClick={() => rollback(rollbackId)}>
              立即回退
            </button>
          </p>
        )}

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
              {snaps.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <span className="aichat-snap-time">{fmtSnapTime(s.createdAt)}</span>
                  <span className="aichat-snap-src">{s.source}</span>
                  <span className="aichat-snap-meta">
                    {s.persons} 人 / {s.events} 事件 / {fmtBytes(s.bytes)}
                  </span>
                  <span className="aichat-snap-note">{s.note ?? ''}</span>
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
      </div>
    </Section>
  );
}
