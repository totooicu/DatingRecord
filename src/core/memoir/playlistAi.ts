// AI 配乐：按事件氛围给建议，再在文件库已有的音频里做匹配。
//
// 为什么不是「直接生成一个歌单」：.drpl 的每一条都是本地音频文件的引用
// （storedId + mime），模型既不知道你库里有什么，也拿不到音频本身。
// 所以这里走两步：先让模型给曲目建议，再拿歌名/歌手去库里模糊匹配；
// 命中的写成歌单，未命中的列在界面上，提示用户自己补文件。

import { chat, getDefaultModel } from '../ai';
import { getEvent } from '../repo/events';
import { listFiles, type StoredFile } from '../repo/files';
import { markdownToText } from '../markdown';
import type { Memoir } from '../types';

const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba']);

export interface SongSuggestion {
  /** 歌名 */
  title: string;
  artist: string;
  /** 为什么放在这一段里，给用户看 */
  reason: string;
}

export interface PlaylistAiResult {
  /** 模型给歌单起的名字 */
  name: string;
  description: string;
  matched: { song: SongSuggestion; file: StoredFile }[];
  unmatched: SongSuggestion[];
  modelAlias: string;
  /** 文件库里的音频总数：0 时说明「当前不可能匹配到」 */
  audioCount: number;
}

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function isAudio(f: StoredFile): boolean {
  return (f.mime || '').toLowerCase().startsWith('audio/') || AUDIO_EXT.has(extOf(f.name));
}

/** 去掉后缀、空格、括号和常见标点，只留下能互相比较的字 */
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[\s_\-—–()（）[\]【】.,，、/\\&+'"!?！？:：;；]/g, '');
}

const SYSTEM = `你在帮一段真实的相处记录配一张歌单。
根据事件的时间、地点、人物、心情和正文片段，挑 10-12 首氛围合适的歌。
优先选中文歌，也可以有少量英文歌；不要选歌词露骨或攻击性强的歌。
严格只输出 JSON，不要 Markdown 代码块，不要解释：
{"name":"四到十个字的歌单名","description":"一句话说明整体氛围","songs":[{"title":"歌名","artist":"歌手","reason":"为什么放这里"}]}`;

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
    const body = markdownToText(e.content).slice(0, 240);
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
    if (used > 4000) break; // 别把整本册子塞进上下文
  }
  return lines.join('\n');
}

/** 在文件库里按歌名/歌手找最像的那一首；同一首歌只配一个文件 */
function matchSongs(
  songs: SongSuggestion[],
  files: StoredFile[],
): { matched: { song: SongSuggestion; file: StoredFile }[]; unmatched: SongSuggestion[] } {
  const audio = files.filter(isAudio);
  const used = new Set<string>();
  const matched: { song: SongSuggestion; file: StoredFile }[] = [];
  const unmatched: SongSuggestion[] = [];

  for (const song of songs) {
    const t = norm(song.title);
    const a = norm(song.artist);
    if (!t) {
      unmatched.push(song);
      continue;
    }
    let best: { file: StoredFile; score: number } | null = null;
    for (const f of audio) {
      if (used.has(f.id)) continue;
      const stem = norm(f.name);
      if (!stem.includes(t)) continue;
      let score = stem === t ? 10 : 6;
      if (a && stem.includes(a)) score += 3;
      if (stem.length - t.length <= 6) score += 1;
      if (!best || score > best.score) best = { file: f, score };
    }
    if (best) {
      used.add(best.file.id);
      matched.push({ song, file: best.file });
    } else {
      unmatched.push(song);
    }
  }
  return { matched, unmatched };
}

export async function suggestPlaylist(memoir: Memoir, opts: { signal?: AbortSignal } = {}): Promise<PlaylistAiResult> {
  const model = getDefaultModel();
  if (!model) throw new Error('还没有配置 AI 模型：去「设置 → AI」加一个模型再回来');
  const material = memoirMaterial(memoir);
  if (!material) throw new Error('这本回忆录还没有可用的事件');

  const reply = await chat(model, {
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `回忆录《${memoir.title}》${memoir.subtitle ? `（${memoir.subtitle}）` : ''}里的事件：\n${material}`,
      },
    ],
    temperature: 0.8,
    maxTokens: 1600,
    signal: opts.signal,
  });

  const data = parseJson(reply.content) as {
    name?: unknown;
    description?: unknown;
    songs?: unknown;
  };
  if (!Array.isArray(data.songs)) throw new Error('模型返回的结构不对：缺少 songs 数组');

  const songs: SongSuggestion[] = [];
  for (const raw of data.songs) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!title) continue;
    songs.push({
      title,
      artist: typeof o.artist === 'string' ? o.artist.trim() : '',
      reason: typeof o.reason === 'string' ? o.reason.trim() : '',
    });
  }
  if (!songs.length) throw new Error('模型没有给出任何曲目');

  const files = listFiles();
  const { matched, unmatched } = matchSongs(songs, files);
  return {
    name: (typeof data.name === 'string' && data.name.trim()) || `${memoir.title}配乐`,
    description: typeof data.description === 'string' ? data.description.trim() : '',
    matched,
    unmatched,
    modelAlias: model.alias || model.model,
    audioCount: files.filter(isAudio).length,
  };
}
