// 「文件库里的音频」——AI 配乐和手动挑歌都从这一份清单里选。
//
// 判断音频不只看 mime：有些 mp3 是从别处拷来的，浏览器给的类型是空的，
// 甚至 application/octet-stream，所以后缀也认。

import { listFiles, type StoredFile } from '../repo/files';

const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba']);

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function isAudioFile(f: Pick<StoredFile, 'name' | 'mime'>): boolean {
  return (f.mime || '').toLowerCase().startsWith('audio/') || AUDIO_EXT.has(extOf(f.name));
}

/** 文件库里所有音频，按名字排，顺序稳定（AI 编号和手动列表共用） */
export function libraryAudio(): StoredFile[] {
  return listFiles()
    .filter(isAudioFile)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}
