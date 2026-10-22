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

export interface NutstoreSettings {
  user: string;
  /** 应用密码；不是坚果云登录密码 */
  password: string;
  base: string;
  folder: string;
  auto: boolean;
}

export function loadSettings(): NutstoreSettings {
  return {
    user: getMeta(K_USER) ?? '',
    password: getMeta(K_PASS) ?? '',
    base: getMeta(K_BASE) ?? DEFAULT_DAV_BASE,
    folder: getMeta(K_FOLDER) ?? 'DatingRecord',
    auto: getMeta(K_AUTO) === '1',
  };
}

export function saveSettings(s: NutstoreSettings): void {
  setMeta(K_USER, s.user.trim());
  setMeta(K_PASS, s.password.trim());
  setMeta(K_BASE, s.base.trim() || DEFAULT_DAV_BASE);
  setMeta(K_FOLDER, s.folder.trim() || 'DatingRecord');
  setMeta(K_AUTO, s.auto ? '1' : '0');
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
