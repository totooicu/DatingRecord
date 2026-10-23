// 工具运行时的「宿主文件访问」。
//
// 浏览器里 JS 不能随便读写用户磁盘，所以 io.* 工具里凡是带路径的参数
// （导出到哪、从哪个文件导入）都走这一层抽象：宿主（CLI）注入一个 node:fs
// 实现，浏览器侧保持 null，遇到路径参数就明确报错，而不是默默失败。
//
// 和 db/persist.ts 的 PersistSink、snapshots/store.ts 的 SnapBytes 同一个套路：
// core 不直接依赖环境，环境把能力倒灌进来。

export interface HostFs {
  readText(path: string): string;
  writeText(path: string, text: string): void;
  /** 二进制读写：分享包、备份包都是 zip，不能当文本处理 */
  readBytes(path: string): Uint8Array;
  writeBytes(path: string, bytes: Uint8Array): void;
  exists(path: string): boolean;
}

let hostFs: HostFs | null = null;

export function setHostFs(fs: HostFs | null): void {
  hostFs = fs;
}

export function getHostFs(): HostFs | null {
  return hostFs;
}

/** 取宿主文件访问；没有宿主（浏览器）时抛一句人能看懂的错 */
export function requireHostFs(): HostFs {
  if (!hostFs) {
    throw new Error('当前环境（浏览器）不能直接读写文件路径，请省略路径参数，或改用 CLI');
  }
  return hostFs;
}
