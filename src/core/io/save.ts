// 把一份文件交到用户手里：壳里存进手机「下载」，浏览器里走 <a download>。
//
// 为什么不能只靠 <a download>：安卓 WebView/GeckoView 里的 blob: 链接
// 没有任何人接（DownloadManager 也拿不到 blob:），点了就是「一点反应都没有」。
// 用户在壳里导出备份、下载附件、保存分享包，全都撞在这上面。
//
// 桥那边对应 file.capabilities / file.writePublic（见壳仓库 ADAPTATION_GUIDE §4.2）：
//   · 能力只问一次：发 file.capabilities，有人回才算「支持二进制写」，
//     没人回（浏览器）就退回 <a download>。不回环境猜、不读 UA。
//   · 二进制按 2MB 分片：一次 postMessage 塞几十 MB 的 base64 会卡死页面，
//     第一片带 name/mime 建文件，后续片带 uri + append 续写。
//   · 有壳但写失败时**不**回退 <a download>：壳里那条路本来就没反应，
//     回退等于二次静默失败，宁可把错误抛给调用方。

import { bytesToBase64, invoke } from '../compat/bridge';
import { showToast } from '../../ui/toast';

/** 单片原始字节数。base64 后约 2.7MB 字符串，手机上一次 postMessage 还算轻快 */
const CHUNK = 2 * 1024 * 1024;

/** 能力探测的短超时：浏览器里没有人回，不能让用户干等 15 秒才开始下载 */
const PROBE_MS = 1200;

export type SaveVia = 'shell' | 'browser';

export interface SaveResult {
  name: string;
  via: SaveVia;
  /** 壳给的位置（「下载」/绝对路径），浏览器为空 */
  location?: string;
}

interface Caps {
  binary: boolean;
  maxChunk: number;
}

let capsPromise: Promise<Caps> | null = null;

/** 能力探测只做一次，正负都记住 */
function caps(): Promise<Caps> {
  if (!capsPromise) {
    capsPromise = invoke('file.capabilities', {}, PROBE_MS)
      .then((r) => ({
        binary: r.binary === true,
        maxChunk: Number(r.maxChunkBytes) > 0 ? Number(r.maxChunkBytes) : CHUNK,
      }))
      .catch(() => ({ binary: false, maxChunk: CHUNK }));
  }
  return capsPromise;
}

/** 浏览器路径：objectURL 没有文件名，必须靠 a.download 把名字带下去 */
function anchorDownload(bytes: Uint8Array, name: string, mime: string): void {
  if (typeof document === 'undefined') throw new Error('当前环境没有下载能力');
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: mime || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 壳路径：分片写公共目录。返回壳给的 uri/路径与位置说明 */
async function writeThroughShell(bytes: Uint8Array, name: string, mime: string, maxChunk: number): Promise<SaveResult> {
  const size = Math.max(1, Math.min(maxChunk, CHUNK));
  let uri = '';
  let location = '';
  // 空文件也要写一次，否则壳里连个 0 字节的文件都留不下
  for (let off = 0; off === 0 || off < bytes.length; off += size) {
    const part = bytes.subarray(off, Math.min(off + size, bytes.length));
    const r = await invoke(
      'file.writePublic',
      {
        name,
        mime: mime || 'application/octet-stream',
        encoding: 'base64',
        content: bytesToBase64(part),
        append: off > 0,
        ...(uri ? { uri } : {}),
      },
      // 大文件写盘慢：5 分钟内没回包才判超时（壳自己也会在写失败时立刻报错）
      300000,
    );
    if (off === 0) {
      uri = String(r.uri ?? r.path ?? '');
      location = String(r.location ?? '');
    }
  }
  return { name, via: 'shell', location };
}

/**
 * 保存一份二进制（备份包、分享包、附件原文件）。
 *
 * 调用方只管给字节和名字：壳里存「下载」，浏览器里弹下载。
 * 成功会弹一条 toast；失败抛错，由调用方的错误条显示。
 */
export async function saveBytes(bytes: Uint8Array, name: string, mime = ''): Promise<SaveResult> {
  const c = await caps();
  if (!c.binary) {
    anchorDownload(bytes, name, mime);
    showToast(`已开始下载 ${name}`);
    return { name, via: 'browser' };
  }
  const r = await writeThroughShell(bytes, name, mime, c.maxChunk);
  showToast(`已保存到手机${r.location ? `「${r.location}」` : ''}：${name}`, 2600);
  return r;
}

/** 文本也走同一套：先编码成字节，省得壳里再分一份 UTF-8/base64 两条路 */
export function saveText(text: string, name: string, mime = 'text/plain;charset=utf-8'): Promise<SaveResult> {
  return saveBytes(new TextEncoder().encode(text), name, mime);
}
