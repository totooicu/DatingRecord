// 让 AI 给回忆录写导语与摘句。
//
// 边界（和 dating-record-ai-capabilities.md 的底线一致）：
//   · AI 只产出「这一页怎么写」，不产出事实：时间/地点/人物/标题一律从事件取；
//   · 结果必须落到同一份草稿上，用户改过的页（edited）不被覆盖；
//   · 没有配置模型时整条路径直接不可用，手工编辑完全等价。

import { chat, getDefaultModel } from '../ai';
import { getEvent } from '../repo/events';
import { getPerson } from '../repo/persons';
import { markdownToText } from '../markdown';
import type { Memoir, MemoirPage } from '../types';

export interface AiMemoirPage {
  eventId: string;
  note?: string;
  excerpt?: string;
}

/** 一页喂给模型的素材：只给这一页需要的，不多给 */
function pageMaterial(page: MemoirPage, index: number): string {
  const e = getEvent(page.eventId);
  if (!e) return `第 ${index + 1} 页：原事件已删除（eventId=${page.eventId}）`;
  const people = e.participants
    .map((p) => {
      const person = getPerson(p.personId);
      return person ? person.displayName : '（已删除的人）';
    })
    .filter(Boolean);
  const body = markdownToText(e.content).slice(0, 600);
  const facts = [
    e.title || '未命名事件',
    e.time.raw || '',
    e.place.name || '',
    people.length ? `人物：${people.join('、')}` : '',
    e.tags.length ? `标签：${e.tags.join('、')}` : '',
    e.metrics.rating ? `评分：${e.metrics.rating}` : '',
    e.metrics.mood ? `心情：${e.metrics.mood}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `第 ${index + 1} 页 eventId=${e.id}\n${facts}\n正文：${body || '（无正文）'}`;
}

const SYSTEM = `你在帮用户把一段关系里的事件整理成一本回忆录。
只写「这一页的导语和摘句」，不要编造事实，不要改变事件的时间、地点、人物、标题。
导语：1-3 句，把这一页放回整本册子的叙述里，语气克制、具体，不要用夸张的形容词。
摘句：从该事件正文里挑一句最能代表当时场景的话，或压缩成一两句原意不变的话；正文为空时留空。
严格只输出 JSON，不要 Markdown 代码块，不要解释：
{"pages":[{"eventId":"原样照抄","note":"导语","excerpt":"摘句"}]}
pages 的顺序与输入一致，eventId 必须与输入完全一致。`;

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回可解析的 JSON');
  return JSON.parse(t.slice(start, end + 1));
}

/**
 * 给「还没被手改」的页生成导语与摘句。
 * 返回合并后的 pages 和用的模型别名；调用方负责落库。
 */
export async function generateMemoirPages(
  memoir: Memoir,
  opts: { signal?: AbortSignal } = {},
): Promise<{ pages: MemoirPage[]; modelAlias: string }> {
  const model = getDefaultModel();
  if (!model) throw new Error('还没有配置 AI 模型：去「设置 → AI」加一个模型再回来');

  const targets = memoir.pages.filter((p) => !p.hidden && !p.edited);
  if (!targets.length) throw new Error('没有可生成的页：手改过的页会保留，先加几页或取消「已手改」');

  const material = targets.map((p, i) => pageMaterial(p, i)).join('\n\n');
  const user = `这本回忆录叫《${memoir.title}》${memoir.subtitle ? `，副标题「${memoir.subtitle}」` : ''}。
下面是需要写的页（最多 ${targets.length} 页）：

${material}`;

  const reply = await chat(model, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    temperature: 0.6,
    maxTokens: Math.min(4096, 400 + targets.length * 260),
    signal: opts.signal,
  });

  const data = parseJson(reply.content) as { pages?: unknown };
  if (!Array.isArray(data.pages)) throw new Error('模型返回的结构不对：缺少 pages 数组');

  const byId = new Map<string, AiMemoirPage>();
  for (const raw of data.pages) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.eventId !== 'string') continue;
    byId.set(o.eventId, {
      eventId: o.eventId,
      note: typeof o.note === 'string' ? o.note.trim() : undefined,
      excerpt: typeof o.excerpt === 'string' ? o.excerpt.trim() : undefined,
    });
  }

  const pages = memoir.pages.map((p) => {
    if (p.hidden || p.edited) return p;
    const ai = byId.get(p.eventId);
    if (!ai) return p;
    return {
      ...p,
      note: ai.note || p.note,
      excerpt: ai.excerpt || p.excerpt,
    };
  });

  if (!pages.some((p, i) => p !== memoir.pages[i])) {
    throw new Error('模型没有返回任何可用内容，稍后再试');
  }
  return { pages, modelAlias: model.alias || model.model };
}
