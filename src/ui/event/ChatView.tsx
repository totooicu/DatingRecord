// 聊天形式：把一场事件呈现成一段对话。
//
// 设计取向是「录入按随手记、观感按群聊」：
//   · 消息默认只有顺序，不逼用户给每句话编时间（时间写在事件设置里）；
//   · 需要节奏时插一条「旁白」——占一行、无头像，可写时间也可随便写；
//   · 旁白一出现，画面自然就是群聊里那种时间分隔的样子。
//
// 点气泡进入选中态，底部浮出一组操作：回复 / 修改 / 上下移 / 上下插消息 /
// 上下插旁白 / 删除。
// 回复是「引用」：气泡顶上挂一条被引用的原文摘要，点它能跳过去。
// 移动是「与相邻一条交换 order_key」：一次撤销就是一步。
// 点头像弹出：人物资料（悬浮卡）/ 换个人 / 新建人物。
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  appendMessage,
  deleteMessage,
  getMessageAny,
  insertMessageAt,
  listMessages,
  moveMessage,
  updateMessage,
} from '../../core/repo/chat';
import { listPersons } from '../../core/repo/persons';
import { createPerson } from '../../core/repo/persons/write';
import { listEvents } from '../../core/repo/events';
import { bump, useVersion } from '../../store';
import { MarkdownEditor, MarkdownView } from '../markdown';
import { Avatar } from '../persons/Avatar';
import { Modal } from '../common';
import type { ChatMessage, DREvent, Person } from '../../core/types';

/** 时间输入框（datetime-local）用的本地时间字符串 */
function toLocalInput(ts: number | null): string {
  if (ts == null) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

function fromLocalInput(s: string): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 旁白上显示的时间：群里那种「10/22 23:40」，不写年份 */
function tsLabel(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 引用摘要用的纯文本：把 md 的记号抹掉，压成一行 */
function plainText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUMMARY_LEN = 40;

export function ChatView({ event }: { event: DREvent }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => listMessages(event.id));
  const [sel, setSel] = useState<string | null>(null);
  /** 正在就地编辑的那一条；新建的消息也会立刻进这个状态 */
  const [editing, setEditing] = useState<string | null>(null);
  /** 编辑缓冲：消息用 md，旁白用单行 */
  const [buf, setBuf] = useState('');
  /** 旁白正在编辑的时间；手敲太累，所以单独给一个时间选择器 */
  const [editTs, setEditTs] = useState<number | null>(null);
  /** 头像菜单挂在哪条消息上 */
  const [menuOn, setMenuOn] = useState<string | null>(null);
  /** 刚跳转过去的那条：亮一下，让眼睛知道落到哪儿了 */
  const [flash, setFlash] = useState<string | null>(null);
  /** 就地编辑区：长内容要能滚到眼前，不然写着写着就看不见了 */
  const editRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    editRef.current?.scrollIntoView({ block: 'nearest' });
  }, [editing]);

  // 撤销 / 重做 / 导入 / 同步都是「把整个库实例换掉」，本组件却把消息读成了
  // 本地 state——不跟着版本号重读的话，撤销完画面还停在旧顺序上，
  // 用户会以为撤销没生效，接着再点一次就把更早的状态翻出来了。
  const version = useVersion();
  useEffect(() => {
    setMsgs(listMessages(event.id));
    setPersons(listPersons({ includeArchived: true }));
  }, [version, event.id]);

  // 人物列表要能刷新：新建人物后得立刻取到它，否则刚指派完还显示「未指派」
  const [persons, setPersons] = useState<Person[]>(() => listPersons({ includeArchived: true }));
  const personOf = useMemo(() => {
    const m = new Map<string, Person>();
    for (const p of persons) m.set(p.id, p);
    return m;
  }, [persons]);

  // 本事件的「我」：参与者里 role='self' 的那位，他的消息默认在右侧
  const selfId = useMemo(
    () => event.participants.find((p) => p.role === 'self')?.personId ?? null,
    [event.participants],
  );

  const refresh = () => {
    setMsgs(listMessages(event.id));
    setPersons(listPersons({ includeArchived: true }));
    bump();
  };

  const sideFor = (personId: string | null) =>
    personId && personId === selfId ? 'right' : 'left';

  /** 引用块要显示的内容。原消息被删了也得说一声，否则读者不知道指向谁 */
  const byId = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);
  const replyInfoOf = (m: ChatMessage): { id: string; name: string; text: string } | null => {
    if (!m.replyToId) return null;
    const t = byId.get(m.replyToId) ?? getMessageAny(m.replyToId);
    // getMessageAny 不排除已删除的——软删的引用要显示成「原消息已删除」
    if (!t || t.deletedAt) return null;
    const p = t.personId ? personOf.get(t.personId) : undefined;
    const text = plainText(t.body);
    return {
      id: t.id,
      name: p?.displayName ?? '未指派',
      text: text.length > SUMMARY_LEN ? `${text.slice(0, SUMMARY_LEN)}…` : text || '（空消息）',
    };
  };

  /** 跳到被引用的那条：滚到视野中间 + 亮一下 + 选中 */
  const jumpTo = (id: string) => {
    const el = document.querySelector(`[data-msg-id="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setSel(id);
    setFlash(id);
    window.setTimeout(() => setFlash((cur) => (cur === id ? null : cur)), 1200);
  };

  /** 新增一条并立刻进入编辑；不写东西就取消的话不留空壳 */
  const addAt = (anchorId: string | null, where: 'above' | 'below', type: 'msg' | 'divider') => {
    const anchor = anchorId ? msgs.find((m) => m.id === anchorId) ?? null : null;
    const created = anchor
      ? insertMessageAt(event.id, anchor, where, { type, side: 'left' })
      : appendMessage(event.id, { type, side: 'left' });
    refresh();
    setSel(created.id);
    setEditing(created.id);
    setBuf('');
    setEditTs(null);
  };

  /**
   * 回复：紧挨着被回复的那条下面插一条新的，带上引用关系并进入编辑。
   *
   * 一步到位而不是「先标记回复目标、再自己选位置插」——后者有两次点击、
   * 还容易插到别的位置上去，反而不顺手。
   */
  const startReply = (m: ChatMessage) => {
    const created = insertMessageAt(event.id, m, 'below', {
      type: 'msg',
      side: 'left',
      replyToId: m.id,
    });
    refresh();
    setSel(created.id);
    setEditing(created.id);
    setBuf('');
    setEditTs(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setBuf('');
    setEditTs(null);
  };

  const commitEdit = (id: string) => {
    const text = buf.trim();
    if (!text) {
      // 空内容不保留：新增时点了又没写，或把原来的内容全删了
      deleteMessage(id);
    } else {
      updateMessage(id, { body: text });
    }
    closeEdit();
    refresh();
  };

  /** 旁白：时间和文字分开存，时间那格空着就是「不写时间」 */
  const commitDivider = (id: string) => {
    const text = buf.trim();
    if (!text && editTs == null) {
      deleteMessage(id);
    } else {
      updateMessage(id, { body: text, ts: editTs });
    }
    closeEdit();
    refresh();
  };

  /** 取消编辑：新建出来但什么都没写的空壳要撤掉，不留垃圾行 */
  const cancelEdit = (m: ChatMessage) => {
    closeEdit();
    if (!m.body && m.ts == null) deleteMessage(m.id);
    refresh();
  };

  const startEdit = (m: ChatMessage) => {
    setBuf(m.body);
    setEditTs(m.ts);
    setEditing(m.id);
  };

  const remove = (id: string) => {
    deleteMessage(id);
    setSel(null);
    refresh();
  };

  const flip = (m: ChatMessage) => {
    updateMessage(m.id, { side: m.side === 'left' ? 'right' : 'left' });
    refresh();
  };

  /** 上移 / 下移：与相邻一条交换 order_key，撤销一步到位 */
  const move = (m: ChatMessage, dir: -1 | 1) => {
    if (!moveMessage(m.id, dir)) return;
    refresh();
  };

  const selected = sel ? msgs.find((m) => m.id === sel) ?? null : null;
  /** 选中条在列表里的位置——决定「上移/下移」能不能点 */
  const selIdx = selected ? msgs.findIndex((m) => m.id === selected.id) : -1;

  return (
    <div className="chat">
      <div className="chat-list" onClick={() => setSel(null)}>
        {msgs.length === 0 && (
          <p className="muted chat-empty">
            还没有聊天内容。用下面的「记一句」开始，或用「加旁白」插一行说明。
          </p>
        )}

        {msgs.map((m) => {
          if (m.type === 'divider') {
            return (
              <div
                key={m.id}
                data-msg-id={m.id}
                className={[
                  'chat-divider',
                  sel === m.id ? 'chat-divider-on' : '',
                  editing === m.id ? 'chat-divider-editing' : '',
                  flash === m.id ? 'chat-flash' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={(e) => {
                  e.stopPropagation();
                  setSel(sel === m.id ? null : m.id);
                }}
              >
                {editing === m.id ? (
                  <div className="chat-divider-edit" ref={editRef} onClick={(e) => e.stopPropagation()}>
                    {/* 时间单独一格：手敲「10/22 23:40」既慢又容易格式不统一 */}
                    <input
                      type="datetime-local"
                      className="input chat-divider-time"
                      value={toLocalInput(editTs)}
                      onChange={(e) => setEditTs(fromLocalInput(e.target.value))}
                      aria-label="旁白时间"
                    />
                    <input
                      className="input chat-divider-input"
                      autoFocus
                      value={buf}
                      placeholder="说明，可留空，例如：三天后她才回"
                      onChange={(e) => setBuf(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitDivider(m.id);
                        if (e.key === 'Escape') cancelEdit(m);
                      }}
                    />
                    <div className="chat-divider-edit-foot">
                      <button className="btn btn-sm" onClick={() => cancelEdit(m)}>
                        取消
                      </button>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => commitDivider(m.id)}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {m.ts != null && <em className="chat-divider-ts">{tsLabel(m.ts)}</em>}
                    {m.body}
                    {m.ts == null && !m.body && <span className="muted">（空旁白）</span>}
                  </>
                )}
              </div>
            );
          }

          const p = m.personId ? personOf.get(m.personId) : undefined;
          const name = p?.displayName ?? '未指派';
          const right = m.side === 'right';

          return (
            <div
              key={m.id}
              data-msg-id={m.id}
              className={[
                'chat-row',
                right ? 'chat-row-right' : 'chat-row-left',
                sel === m.id ? 'chat-row-on' : '',
                // 编辑时把气泡的宽度限制放开：气泡宽是给「看」的，写的时候要宽
                editing === m.id ? 'chat-row-editing' : '',
                flash === m.id ? 'chat-flash' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="chat-avatar-wrap">
                <Avatar
                  name={name}
                  avatar={p?.avatar}
                  icon={p?.icon}
                  onClick={() => setMenuOn(menuOn === m.id ? null : m.id)}
                />
                {menuOn === m.id && (
                  <AvatarMenu
                    person={p}
                    persons={persons}
                    onClose={() => setMenuOn(null)}
                    onPicked={(personId) => {
                      updateMessage(m.id, { personId, side: sideFor(personId) });
                      refresh();
                    }}
                  />
                )}
              </div>

              <div className="chat-main">
                <div className="chat-name">{name}</div>
                {editing === m.id ? (
                  <div className="chat-edit" ref={editRef} onClick={(e) => e.stopPropagation()}>
                    {/* 正在回复谁：挂在编辑器顶上，✕ 只摘掉引用、不删这条 */}
                    {(() => {
                      const q = replyInfoOf(m);
                      if (!q) return null;
                      return (
                        <div className="chat-quote-bar">
                          <span className="chat-quote-bar-name">回复 {q.name}</span>
                          <span className="chat-quote-bar-text">{q.text}</span>
                          <button
                            className="chat-quote-bar-x"
                            title="去掉这条引用"
                            onClick={() => {
                              updateMessage(m.id, { replyToId: null });
                              refresh();
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })()}
                    {/* 高度跟着内容长：固定三行时写长消息要不停往回滚，很别扭 */}
                    <MarkdownEditor value={buf} onChange={setBuf} autoFocus rows={6} autoGrow />
                    <div className="chat-edit-foot">
                      <button className="btn btn-sm" onClick={() => cancelEdit(m)}>
                        取消
                      </button>
                      <button className="btn btn-sm btn-primary" onClick={() => commitEdit(m.id)}>
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="chat-bubble"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSel(sel === m.id ? null : m.id);
                    }}
                  >
                    {m.replyToId &&
                      (() => {
                        const q = replyInfoOf(m);
                        return (
                          <div
                            className={q ? 'chat-quote' : 'chat-quote chat-quote-gone'}
                            onClick={(e) => {
                              // 原消息没了就只是个提示，别再拦点击
                              if (!q) return;
                              e.stopPropagation();
                              jumpTo(q.id);
                            }}
                          >
                            <span className="chat-quote-name">{q ? q.name : '原消息已删除'}</span>
                            {q && <span className="chat-quote-text">{q.text}</span>}
                          </div>
                        );
                      })()}
                    {m.body.trim() ? (
                      <MarkdownView source={m.body} />
                    ) : (
                      <span className="muted">（空消息）</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部常驻入口：记一句 / 加旁白 */}
      <div className="chat-compose">
        <button className="btn btn-sm" onClick={() => addAt(null, 'below', 'msg')}>
          ＋ 记一句
        </button>
        <button className="btn btn-sm" onClick={() => addAt(null, 'below', 'divider')}>
          ＋ 旁白
        </button>
        {selected && (
          <button
            className="btn btn-sm"
            onClick={() => selected && flip(selected)}
            title="把这条换到另一侧"
          >
            ⇄ 换边
          </button>
        )}
      </div>

      {/* 选中后浮出的操作，按「怎么处置这一条」分组 */}
      {selected && (
        <div className="chat-actions">
          {selected.type === 'msg' && (
            <button className="btn btn-sm btn-primary" onClick={() => startReply(selected)}>
              ↩ 回复
            </button>
          )}
          <button className="btn btn-sm" onClick={() => startEdit(selected)}>
            修改
          </button>

          <span className="chat-actions-sep" />

          <button
            className="btn btn-sm"
            disabled={selIdx <= 0}
            onClick={() => move(selected, -1)}
            title="与上一条交换位置（旁白也算一条）"
          >
            ↑ 上移
          </button>
          <button
            className="btn btn-sm"
            disabled={selIdx < 0 || selIdx >= msgs.length - 1}
            onClick={() => move(selected, 1)}
            title="与下一条交换位置（旁白也算一条）"
          >
            ↓ 下移
          </button>

          <span className="chat-actions-sep" />

          <button className="btn btn-sm" onClick={() => addAt(selected.id, 'above', 'msg')}>
            上插消息
          </button>
          <button className="btn btn-sm" onClick={() => addAt(selected.id, 'below', 'msg')}>
            下插消息
          </button>
          <button className="btn btn-sm" onClick={() => addAt(selected.id, 'above', 'divider')}>
            上插旁白
          </button>
          <button className="btn btn-sm" onClick={() => addAt(selected.id, 'below', 'divider')}>
            下插旁白
          </button>

          <span className="chat-actions-sep" />

          <button className="btn btn-sm btn-danger" onClick={() => remove(selected.id)}>
            删除
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 点头像弹出的菜单：人物资料（悬浮卡）/ 换个人 / 新建人物。
 * 悬浮卡直接就地展开，不跳页——看一眼就该回来继续记。
 */
function AvatarMenu({
  person,
  persons,
  onClose,
  onPicked,
}: {
  person: Person | undefined;
  persons: Person[];
  onClose: () => void;
  onPicked: (personId: string) => void;
}) {
  const [card, setCard] = useState(false);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点空白处收起：菜单是浮层，不该要求用户非得再点一次头像
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div className="chat-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      {person && (
        <button className="chat-menu-item" onClick={() => setCard((v) => !v)}>
          人物资料
        </button>
      )}
      <button className="chat-menu-item" onClick={() => setPicking(true)}>
        换个人
      </button>
      <button className="chat-menu-item" onClick={() => setCreating(true)}>
        新建人物
      </button>

      {card && person && (
        <div className="chat-card">
          <div className="chat-card-head">
            <Avatar name={person.displayName} avatar={person.avatar} icon={person.icon} size="lg" />
            <div>
              <strong>{person.displayName}</strong>
              {person.tags.length > 0 && (
                <div className="chat-card-tags">
                  {person.tags.map((t) => (
                    <span key={t} className="ev-chip ev-chip-tag">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          {person.notes.trim() && <p className="chat-card-notes">{person.notes}</p>}
          <div className="muted small">共同参与 {countEventsOf(person.id)} 场事件</div>
        </div>
      )}

      {picking && (
        <Modal title="换个人" onClose={() => setPicking(false)}>
          <div className="chat-pick">
            {persons.map((p) => (
              <button
                key={p.id}
                className="chat-pick-row"
                onClick={() => {
                  onPicked(p.id);
                  setPicking(false);
                  onClose();
                }}
              >
                <Avatar name={p.displayName} avatar={p.avatar} icon={p.icon} />
                <span>{p.displayName}</span>
              </button>
            ))}
            {persons.length === 0 && <p className="muted">还没有人物，用「新建人物」加一个</p>}
          </div>
        </Modal>
      )}

      {creating && (
        <NewPersonModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            onPicked(id);
            setCreating(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}

function NewPersonModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <Modal
      title="新建人物"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              const p = createPerson({ displayName: name.trim() });
              bump();
              onCreated(p.id);
            }}
          >
            创建
          </button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        value={name}
        placeholder="昵称，例如：林小满"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            const p = createPerson({ displayName: name.trim() });
            bump();
            onCreated(p.id);
          }
        }}
      />
      <p className="muted small" style={{ marginTop: 8 }}>
        建完直接挂到这条消息上，详细的属性可以之后去「人物」页补。
      </p>
    </Modal>
  );
}

function countEventsOf(personId: string): number {
  return listEvents({}).filter((e) => e.participants.some((p) => p.personId === personId)).length;
}
