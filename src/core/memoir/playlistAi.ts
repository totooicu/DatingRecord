// AI 配乐：先把文件库里的音频列给模型，让它从这些曲目里挑。
//
// 早先的做法是「让模型凭记忆点歌，再拿歌名去库里模糊匹配」，命中率低得离谱，
// 而且模型会一本正经地推荐库里根本不存在的歌。现在反过来：
// 曲库是事实，模型只负责「在这堆音频里挑哪几首、为什么」。
// 这样产出的歌单每一首都能直接播放，也不会出现「未匹配」清单。

import { chat, getDefaultModel } from '../ai';
import { getEvent } from '../repo/events';
import { listFiles, type StoredFile } from '../repo/files';
import { markdownToText } from '../markdown';
import type { Memoir } from '../types';

const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba']);

/** 一次最多给模型列多少首：太多既塞不下，也会让模型挑花眼 */
const MAX_LISTED = 200;

export interface PlaylistPick {
  file: StoredFile;
  /** 模型给的理由，给用户看 */
  reason: string;
}

export interface PlaylistAiResult {
  name: string;
  description: string;
  picks: PlaylistPick[];
  modelAlias: string;
  /** 文件库里的音频总数 */
  audioCount: number;
  /** 实际列给模型的曲目数（超过上限时小于 audioCount） */
  listedCount: number;
}

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function isAudio(f: StoredFile): boolean {
  return (f.mime || '').toLowerCase().startsWith('audio/') || AUDIO_EXT.has(extOf(f.name));
}

/** 文件库里所有音频，按名字排一下，编号稳定好对 */
export function libraryAudio(): StoredFile[] {
  return listFiles()
    .filter(isAudio)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

const SYSTEM = `你在帮一段真实的相处记录挑一张背景歌单。
用户会给你「曲库」——这是用户本机文件库里真实存在的音频，序号只能用这些。
你的任务是：从曲库里挑出最贴合这段回忆的曲目（理想 8-12 首；曲库不足时有多少挑多少），
并给歌单起名、写一句整体氛围。
硬性要求：
- 只能使用曲库里出现过的序号，绝对不要编造曲库以外的歌名或歌手；
- 序号不重复，reason 用一句话说明这首歌对应哪段场景或情绪；
- 如果曲库整体不合适，也要挑相对最接近的，不要返回空数组。
严格只输出 JSON，不要 Markdown 代码块，不要解释：
{"name":"四到十个字的歌单名","description":"一句话说明整体氛围","picks":[{"index":1,"reason":"为什么放这里"}]}`;

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回可解析的 JSON');
  return JSON.parse(t.slice(start, end + 1));
}

/** 把回忆录的事件压成一段给模型看的素材 */
function memoirMaterial(m: Memoir): string {
  const lines: string[] = [];
  let used = 0;
  for (const page of m.pages) {
    if (page.hidden) continue;
    const e = getEvent(page.eventId);
    if (!e) continue;
    const body = markdownToText(e.content).slice(0, 200);
    const line = [
      `- ${e.title || '未命名事件'}`,
      e.time.raw || '',
      e.place.name || '',
      e.metrics.mood ? `心情：${e.metrics.mood}` : '',
      e.tags.length ? `标签：${e.tags.join('、')}` : '',
      body ? `内容：${body}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(line);
    used += line.length;
    if (used > 3000) break; // 别把整本册子塞进上下文
  }
  return lines.join('\n');
}

function catalogText(files: StoredFile[]): string {
  return files.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
}

export async function suggestPlaylist(
  memoir: Memoir,
  opts: { signal?: AbortSignal; hint?: string } = {},
): Promise<PlaylistAiResult> {
  const model = getDefaultModel();
  if (!model) throw new Error('还没有配置 AI 模型：去「设置 → AI」加一个模型再回来');

  const audio = libraryAudio();
  if (!audio.length) {
    throw new Error('文件库里还没有音频文件：先在「设置 → 文件」里导入几首歌，再让 AI 选曲');
  }

  const material = memoirMaterial(memoir);
  if (!material) throw new Error('这本回忆录还没有可用的事件');

  const listed = audio.slice(0, MAX_LISTED);
  const hint = (opts.hint ?? '').trim();
  const user = [
    `回忆录《${memoir.title}》${memoir.subtitle ? `（${memoir.subtitle}）` : ''}里的事件：\n${material}`,
    '',
    `曲库（共 ${audio.length} 首${audio.length > listed.length ? `，这里只列前 ${listed.length} 首` : ''}）：`,
    catalogText(listed),
    hint ? `\n用户的额外要求（优先满足）：${hint}` : '',
  ]
    .filter((s) => s !== '')
    .join('\n');

  const reply = await chat(model, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    temperature: 0.6,
    maxTokens: 1600,
    signal: opts.signal,
  });

  const data = parseJson(reply.content) as {
    name?: unknown;
    description?: unknown;
    picks?: unknown;
  };
  if (!Array.isArray(data.picks)) throw new Error('模型返回的结构不对：缺少 picks 数组');

  const picks: PlaylistPick[] = [];
  const used = new Set<number>();
  for (const raw of data.picks) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const idx = Number(o.index);
    if (!Number.isInteger(idx) || idx < 1 || idx > listed.length) continue; // 越界/瞎编的一律丢掉
    if (used.has(idx)) continue;
    used.add(idx);
    picks.push({
      file: listed[idx - 1],
      reason: typeof o.reason === 'string' ? o.reason.trim() : '',
    });
  }
  if (!picks.length) throw new Error('模型没有挑出任何曲库里存在的歌，再试一次或补几首音频');

  return {
    name: (typeof data.name === 'string' && data.name.trim()) || `${memoir.title}配乐`,
    description: typeof data.description === 'string' ? data.description.trim() : '',
    picks,
    modelAlias: model.alias || model.model,
    audioCount: audio.length,
    listedCount: listed.length,
  };
}
