// 坚果云配置的读写。
//
// 账号密码存在 meta 表里，键名统一带 nutstore. 前缀——snapshot.ts 的
// SECRET_META_PREFIXES 会在生成备份时把这些键剔除，所以凭据不会跟着
// 备份文件或云端快照跑到别人的机器上。
import { getMeta, setMeta } from '../db';
import { DEFAULT_DAV_BASE, testConnection, type DavConfig } from './webdav';

const K_USER = 'nutstore.user';
const K_PASS = 'nutstore.pass';
const K_BASE = 'nutstore.base';
const K_FOLDER = 'nutstore.folder';
const K_AUTO = 'nutstore.auto';
const K_ATT = 'nutstore.att';
const K_EVERY = 'nutstore.every';
const K_CHANGES = 'nutstore.changes';

/** 定时间隔的合法值（分钟）：0 = 不定时。UI 的下拉与工具入参共用这一张表 */
export const EVERY_CHOICES = [0, 5, 10, 15, 30, 60] as const;

/** 不在表里的值一律归到 0：工具/CLI 传进来的乱七八糟数字不该变成后台定时器 */
function normalizeEvery(v: unknown): number {
  const n = Math.round(Number(v));
  return EVERY_CHOICES.includes(n as (typeof EVERY_CHOICES)[number]) ? n : 0;
}

export interface NutstoreSettings {
  user: string;
  /** 应用密码；不是坚果云登录密码 */
  password: string;
  base: string;
  folder: string;
  /** 自动同步总开关：开软件自启动，并在启动时先把云端拉齐一次 */
  auto: boolean;
  /** 附件二进制一起上传（默认开：关着的话别的设备只看得到文件名，看不到图） */
  attachments: boolean;
  /** 定时间隔（分钟），0 = 不定时。只在 auto 开着时生效 */
  everyMin: number;
  /** 本机有改动就同步（默认开，但同样只在 auto 开着时生效） */
  onChanged: boolean;
}

export function loadSettings(): NutstoreSettings {
  return {
    user: getMeta(K_USER) ?? '',
    password: getMeta(K_PASS) ?? '',
    base: getMeta(K_BASE) ?? DEFAULT_DAV_BASE,
    folder: getMeta(K_FOLDER) ?? 'DatingRecord',
    auto: getMeta(K_AUTO) === '1',
    // 只有明确存过 '0' 才算关：老库没有这个键，默认要跟着「文件也要上传」走
    attachments: getMeta(K_ATT) !== '0',
    everyMin: normalizeEvery(getMeta(K_EVERY) ?? '0'),
    // 自动同步本身就是「不想手动点」才开的，所以改动触发默认开；
    // 总开关 auto 默认关着，没配置账号时这套一个请求都不会发。
    onChanged: getMeta(K_CHANGES) !== '0',
  };
}

export function saveSettings(s: NutstoreSettings): void {
  setMeta(K_USER, s.user.trim());
  setMeta(K_PASS, s.password.trim());
  setMeta(K_BASE, s.base.trim() || DEFAULT_DAV_BASE);
  setMeta(K_FOLDER, s.folder.trim() || 'DatingRecord');
  setMeta(K_AUTO, s.auto ? '1' : '0');
  setMeta(K_ATT, s.attachments ? '1' : '0');
  setMeta(K_EVERY, String(normalizeEvery(s.everyMin)));
  setMeta(K_CHANGES, s.onChanged ? '1' : '0');
}

export function toConfig(s: NutstoreSettings): DavConfig {
  return {
    base: (s.base.trim() || DEFAULT_DAV_BASE).replace(/\/+$/, ''),
    user: s.user.trim(),
    password: s.password.trim(),
    folder: s.folder.trim().replace(/^\/+|\/+$/g, '') || 'DatingRecord',
  };
}

export function isConfigured(s: NutstoreSettings): boolean {
  return !!s.user.trim() && !!s.password.trim();
}

export { testConnection };
