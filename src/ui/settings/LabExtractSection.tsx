// 「设置 → AI → 聊天提取」：上传聊天截图 + 提示词，AI 把对话还原成事件。
//
// 这一步是「读图」而不是「聊天」：不走 agent 工具循环，直接把截图发给视觉模型，
// 要它按固定 JSON 抄下每条消息和图片位置。拿到结果后在本机裁图、入库、建事件，
// 随后在下方直接预览这段对话，点「打开事件」就能进正常的聊天视图继续编辑。
//
// 图片为什么必须裁：整张截图里混着状态栏、输入框、时间和别人的头像，
// 直接贴进去既难看又会把无关内容一起存下来。裁图用 canvas 完成，不额外上传。
import { useEffect, useMemo, useRef, useState } from 'react';

import { getDefaultModel, listModels, type AiModel } from '../../core/ai';
import {
  extractChat,
  readShot,
  saveExtraction,
  type SavedExtraction,
  type Shot,
} from '../../core/chatExtract';
import { listPersons } from '../../core/repo/persons';
import { getEvent, listEvents } from '../../core/repo/events';
import type { DREvent } from '../../core/types';
import { bump, useVersion } from '../../store';
import { EventForm } from '../event';
import { LabHead } from './LabEdgeSection';
import { showToast } from '../toast';

const MAX_SHOTS = 6;
const DEFAULT_PROMPT = '把截图里的聊天按原样整理成一段对话，保留说话人、顺序、表情和图片。';

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function ImageIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2" />
      <circle cx="8.6" cy="9.6" r="1.6" />
      <path d="M4.4 17l4.8-4.6 3.6 3.4 2.8-2.6 4 3.8" />
    </svg>
  );
}

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function LabExtractSection() {
  const v = useVersion();
  const [models, setModels] = useState<AiModel[]>(() => listModels());
  const [alias, setAlias] = useState<string>(() => getDefaultModel()?.alias ?? listModels()[0]?.alias ?? '');
  const [shots, setShots] = useState<Shot[]>([]);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selfId, setSelfId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SavedExtraction | null>(null);
  const [opened, setOpened] = useState<DREvent | null>(null);
  const [persons, setPersons] = useState(() => listPersons());
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  const model = useMemo(() => models.find((m) => m.alias === alias) ?? getDefaultModel(), [models, alias]);

  useEffect(() => {
    setModels(listModels());
    setPersons(listPersons());
  }, [v]);

  const recent = useMemo(
    () =>
      listEvents({ tag: '聊天提取' })
        .sort((a, b) => (b.startTs ?? 0) - (a.startTs ?? 0))
        .slice(0, 5),
    [v, result],
  );

  const addFiles = async (list: FileList | File[] | null) => {
    if (!list) return;
    setErr(null);
    const files = Array.from(list).filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name));
    if (!files.length) {
      setErr('只支持图片文件（PNG / JPG / WEBP）。');
      return;
    }
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) {
      setErr(`一次最多 ${MAX_SHOTS} 张截图。`);
      return;
    }
    const next: Shot[] = [];
    for (const f of files.slice(0, room)) {
      try {
        seq.current += 1;
        next.push(await readShot(f, `s${seq.current}`));
      } catch (e) {
        setErr(`「${f.name}」读不出来：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (next.length) setShots((s) => [...s, ...next]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeShot = (key: string) => setShots((s) => s.filter((x) => x.key !== key));

  const start = async () => {
    if (busy) return;
    if (!shots.length) {
      setErr('先选几张聊天截图。');
      return;
    }
    if (!model) {
      setErr('还没有可用的模型。先去「设置 → AI → 模型」配一个；聊天提取需要能看图的模型。');
      return;
    }
    setErr(null);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const extracted = await extractChat({ model, shots, prompt, signal: ac.signal });
      const saved = await saveExtraction(extracted, shots, selfId || null);
      bump();
      setPersons(listPersons());
      setResult(saved);
      showToast(
        `已整理成事件：${Math.max(0, saved.messageCount - saved.dividerCount)} 条消息${
          saved.dividerCount ? `、${saved.dividerCount} 段旁白` : ''
        }${saved.imageCount ? `、${saved.imageCount} 张图` : ''}${
          saved.avatarCount ? `、${saved.avatarCount} 个新头像` : ''
        }`,
      );
    } catch (e) {
      setErr(
        ac.signal.aborted
          ? '已停止。'
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="lab-page extract-page">
      <LabHead title="聊天提取" subKey="labChat" />

      <div className="extract-form">
        <div className="extract-field">
          <span className="extract-label">聊天截图</span>
          <div className="extract-shots">
            {shots.map((s) => (
              <div className="extract-shot" key={s.key}>
                <img src={s.dataUrl} alt={s.name} />
                <button type="button" className="extract-shot-x" onClick={() => removeShot(s.key)} aria-label={`移除 ${s.name}`}>
                  ×
                </button>
              </div>
            ))}
            {shots.length < MAX_SHOTS && (
              <button type="button" className="extract-add" onClick={() => fileRef.current?.click()} disabled={busy}>
                <ImageIcon />
                <span>{shots.length ? '再加一张' : '选择截图'}</span>
              </button>
            )}
          </div>
          <p className="muted small extract-hint">
            最多 {MAX_SHOTS} 张，按顺序发。只截对话区域最好；整屏截图也能认，但输入框和状态栏会被忽略。表情包和头像会借用边缘分割自动找边界；新建的人物会带上截图里的头像。
          </p>
        </div>

        <label className="extract-field">
          <span className="extract-label">提示词</span>
          <textarea
            className="extract-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            placeholder="告诉 AI 这段对话是什么、要保留什么"
          />
        </label>

        <div className="extract-row-fields">
          <label className="extract-field">
            <span className="extract-label">模型</span>
            <select value={alias} onChange={(e) => setAlias(e.target.value)} disabled={busy}>
              {models.length === 0 && <option value="">（未配置模型）</option>}
              {models.map((m) => (
                <option key={m.id} value={m.alias}>
                  {m.alias} · {m.model}
                </option>
              ))}
            </select>
          </label>
          <label className="extract-field">
            <span className="extract-label">对话里的「我」是</span>
            <select value={selfId} onChange={(e) => setSelfId(e.target.value)} disabled={busy}>
              <option value="">不指定（右侧暂时无头像）</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>

        {err && <p className="extract-err">{err}</p>}

        <div className="extract-actions">
          <button type="button" className="btn-primary" onClick={() => void start()} disabled={busy || !shots.length}>
            {busy ? '正在读图整理…' : '开始提取'}
          </button>
          {busy && (
            <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
              停止
            </button>
          )}
          <span className="muted small">截图只发给你配置的模型；裁图与入库都在本机完成。</span>
        </div>
      </div>

      {result && (
        <div className="extract-result">
          <div className="extract-result-head">
            <div>
              <b>{result.title}</b>
              <span className="muted small">
                {Math.max(0, result.messageCount - result.dividerCount)} 条消息
                {result.dividerCount > 0 ? ` · ${result.dividerCount} 段旁白` : ''}
                {result.imageCount ? ` · ${result.imageCount} 张图片` : ''}
                {result.avatarCount ? ` · ${result.avatarCount} 个新头像` : ''}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const ev = getEvent(result.eventId);
                if (ev) setOpened(ev);
              }}
            >
              打开事件
            </button>
          </div>
          {result.avatars.length > 0 && (
            <div className="extract-avatars">
              <span className="extract-label">新人物头像</span>
              {result.avatars.map((a) => (
                <span className="extract-avatar" key={a.personId}>
                  <img src={a.imageUrl} alt={a.speaker} />
                  <span>{a.speaker}</span>
                </span>
              ))}
            </div>
          )}
          {result.warnings.length > 0 && (
            <ul className="extract-warn">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="extract-preview">
            {result.preview.map((m, i) =>
              m.type === 'divider' ? (
                <div key={i} className="extract-divider">
                  {m.text}
                </div>
              ) : (
                <div key={i} className={`extract-msg extract-msg-${m.side}`}>
                  <div className="extract-who">{m.speaker}</div>
                  <div className="extract-bubble">
                    {m.quote && (
                      <div className="extract-quote">
                        {m.quote.speaker && <span className="extract-quote-name">{m.quote.speaker}</span>}
                        <span className="extract-quote-text">{m.quote.text}</span>
                      </div>
                    )}
                    {m.text && <span>{m.text}</span>}
                    {m.imageUrl && <img src={m.imageUrl} alt="聊天图片" />}
                  </div>
                </div>
              ),
            )}
          </div>
          <p className="muted small">已经存成聊天事件，点「打开事件」可以接着改、加旁白或补图。</p>
        </div>
      )}

      {recent.length > 0 && (
        <div className="extract-recent">
          <div className="extract-label">最近提取</div>
          <ul>
            {recent.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => {
                    const ev = getEvent(e.id);
                    if (ev) setOpened(ev);
                  }}
                >
                  <span className="extract-recent-title">{e.title}</span>
                  <span className="muted small">{fmtDay(e.startTs ? new Date(e.startTs).toISOString() : e.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void addFiles(e.target.files)} />

      {/* 就地打开事件：关掉弹窗仍停在聊天提取页，不会把人甩到时间线后回不来 */}
      {opened && (
        <EventForm
          event={opened}
          onClose={() => {
            setOpened(null);
            bump();
          }}
        />
      )}
    </div>
  );
}
