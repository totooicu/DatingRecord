// 判断一个文件该怎么预览。
//
// 依据是「扩展名 + MIME」两条线索，缺一不可：
// 用户上传的文件 MIME 常常是空的（尤其是从安卓的某些来源），
// 而 MIME 有时又与扩展名不符（把 .txt 改名成 .md 之类）。
// 两条都对不上就退化成「未知」，交给用户选打开方式。

import { PLAYLIST_MIME } from '../../core/music/format';

export type PreviewKind = 'image' | 'video' | 'audio' | 'playlist' | 'markdown' | 'text' | 'unknown';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'heic'];
const VIDEO_EXT = ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'];
const PLAYLIST_EXT = ['drpl'];
const TEXT_EXT = [
  'txt', 'log', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'css',
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'sh', 'ini', 'conf',
];
const MD_EXT = ['md', 'markdown', 'mdown'];

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function kindOf(name: string, mime: string): PreviewKind {
  const ext = extOf(name);
  const m = (mime || '').toLowerCase();

  // MIME 优先：它比扩展名更可信（.jpg 里装的可能其实是 png）
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  // 歌单是应用自己的格式：后缀和 MIME 都是独一份的，优先认出来
  if (m === PLAYLIST_MIME || PLAYLIST_EXT.includes(ext)) return 'playlist';
  // text/markdown 在各浏览器里的写法不一致，扩展名兜底更稳
  if (MD_EXT.includes(ext) || m.includes('markdown')) return 'markdown';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml') return 'text';

  // MIME 缺失或不认识时退回扩展名
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (PLAYLIST_EXT.includes(ext)) return 'playlist';
  if (TEXT_EXT.includes(ext)) return 'text';

  return 'unknown';
}

/** 无法内置预览时，给用户挑的打开方式 */
export interface OpenOption {
  key: string;
  label: string;
  /** 用系统默认程序（下载）还是交给浏览器新标签页 */
  how: 'download' | 'tab';
}

export function openOptions(name: string, mime: string): OpenOption[] {
  const opts: OpenOption[] = [];
  // 一律先给「用系统程序打开」——这是最通用的一条路
  opts.push({ key: 'system', label: '用系统程序打开（先下载到本地）', how: 'download' });
  // PDF 浏览器自己能看，值得单独给一条
  if (mime === 'application/pdf' || extOf(name) === 'pdf') {
    opts.push({ key: 'pdf', label: '在浏览器里打开 PDF', how: 'tab' });
  }
  opts.push({ key: 'tab', label: '在新标签页打开原始文件', how: 'tab' });
  return opts;
}

export function kindLabel(k: PreviewKind): string {
  switch (k) {
    case 'image':
      return '图片';
    case 'video':
      return '视频';
    case 'audio':
      return '音频';
    case 'playlist':
      return '歌单';
    case 'markdown':
      return 'Markdown';
    case 'text':
      return '文本';
    default:
      return '其他';
  }
}
