// 聊天形式：把一场事件呈现成一段对话。
//
// 设计取向是「录入按随手记、观感按群聊」：
//   · 消息默认只有顺序，不逼用户给每句话编时间（时间写在事件设置里）；
//   · 需要节奏时插一条「旁白」——占一行、无头像，可写时间也可随便写；
//   · 旁白一出现，画面自然就是群聊里那种时间分隔的样子。
//
// 点气泡进入选中态，底部浮出六个操作：改 / 删 / 上下插消息 / 上下插旁白。
// 点头像弹出：人物资料（悬浮卡）/ 换个人 / 新建人物。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  appendMessage,
  deleteMessage,
  insertMessageAt,
  listMessages,
  updateMessage,
} from '../../core/repo/chat';
import { listPersons } from '../../core/repo/persons';
import { createPerson } from '../../core/repo/persons/write';
import { listEvents } from '../../core/repo/events';
import { bump } from '../../store';
import { MarkdownEditor, MarkdownView } from '../markdown';
import { Avatar } from '../persons/Avatar';
import { Modal } from '../common';
import type { ChatMessage, DREvent, Person } from '../../core/types';

export function ChatView({ event }: { event: DREvent }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => listMessages(event.id));
  const [sel, setSel] = useState<string | null>(null);
  /** 正在就地编辑的那一条；新建的消息也会立刻进这个状态 */
  const [editing, setEditing] = useState<string | null>(null);
  /** 编辑缓冲：消息用 md，旁白用单行 */
  const [buf, setBuf] = useState('');
  /** 头像菜单挂在哪条消息上 */
  const [menuOn, setMenuOn] = useState<string | null>(null);

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
  };

  const commitEdit = (id: string) => {
    const text = buf.trim();
    if (!text) {
      // 空内容不保留：新增时点了又没写，或把原来的内容全删了
      deleteMessage(id);
    } else {
      updateMessage(id, { body: text });
    }
    setEditing(null);
    setBuf('');
    refresh();
  };

  const startEdit = (m: ChatMessage) => {
    setBuf(m.body);
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

  const selected = sel ? msgs.find((m) => m.id === sel) ?? null : null;

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
                className={sel === m.id ? 'chat-divider chat-divider-on' : 'chat-divider'}
                onClick={(e) => {
                  e.stopPropagation();
                  setSel(sel === m.id ? null : m.id);
                }}
              >
                {editing === m.id ? (
                  <input
                    className="input chat-divider-input"
                    autoFocus
                    value={buf}
                    placeholder="时间或说明，例如：10/22 21:30 —— 三天后"
                    onChange={(e) => setBuf(e.target.value)}
                    onBlur={() => commitEdit(m.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(m.id);
                      if (e.key === 'Escape') {
                        setEditing(null);
                        if (!m.body) deleteMessage(m.id);
                        refresh();
                      }
                    }}
                  />
                ) : (
                  m.body || <span className="muted">（空旁白）</span>
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
              className={`chat-row ${right ? 'chat-row-right' : 'chat-row-left'}${
                sel === m.id ? ' chat-row-on' : ''
              }`}
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
                  <div className="chat-edit" onClick={(e) => e.stopPropagation()}>
                    <MarkdownEditor value={buf} onChange={setBuf} autoFocus rows={3} />
                    <div className="chat-edit-foot">
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setEditing(null);
                          if (!m.body) deleteMessage(m.id);
                          refresh();
                        }}
                      >
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

      {/* 选中后浮出的六个操作 */}
      {selected && (
        <div className="chat-actions">
          <button className="btn btn-sm" onClick={() => startEdit(selected)}>
            修改
          </button>
          <button className="btn btn-sm" onClick={() => addAt(selected.id, 'above', 'msg')}>
            ↑ 消息
          </button>
          <button className="btn btn-sm" onClick={() => addAt(selected.id, 'below', 'msg')}>
            ↓ 消息
          </button>
          <button className="btn btn-sm" onClick={() => addAt(selected.id, 'above', 'divider')}>
            ↑ 旁白
          </button>
          <button className="btn btn-sm" onClick={() => addAt(selected.id, 'below', 'divider')}>
            ↓ 旁白
          </button>
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
