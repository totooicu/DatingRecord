// 网页与壳的版本配对。
//
// 网页是「随时上线」的，壳是「发出去就收不回来」的：一旦页面用上某个新的桥能力，
// 老壳上就会长得像有、点下去静默失败。所以两边各报几个数，页面自己判断能不能配对：
//
//   网页版本    APP_VERSION（package.json，构建时注入）
//   壳版本      AndroidBridge.getEnv().version（UA 里也有 DatingRecord/x.y.z 兜底）
//   壳构建时间  getEnv().builtAt（壳 gradle 打包时刻注入，Asia/Shanghai）
//   壳 git 提交 getEnv().commit（壳打包时的最后一次 git 短哈希）
//   桥协议      BRIDGE_PROTO，壳在 getEnv().proto 里报；不一致就是不能配对
//
// 壳发出去收不回来、同号还可能重打包：版本条（人物主页 head 之上）把
// version + builtAt + commit 一起显示，才能一眼说清「跑的是哪份代码」。
//
// 规矩（发布时照做）：桥只增不删，删/改语义必须同时升 proto 和壳的大版本。
import { APP_VERSION } from '../buildInfo';

/** 当前网页要求的桥协议版本 */
export const BRIDGE_PROTO = 1;

/** 这一版网页要求的最低壳版本，低于它提示升级壳。
 *  1.1.1：壳的 location.setConfig 在缺定位权限时会申请权限并明确上报结果
 *  （网页 startNativeTrack 依赖这个行为，旧壳会静默 ok:true(tracking:false)）。 */
export const SHELL_MIN = '1.1.1';

export type PairState = 'browser' | 'ok' | 'shell-old' | 'proto' | 'unknown';

export interface Pairing {
  /** 网页版本 */
  web: string;
  /** 壳版本；不在壳里为空串 */
  shell: string;
  /** 壳打包时间（壳注入的 "yyyy-MM-dd HH:mm"，Asia/Shanghai）；没有为空串 */
  builtAt: string;
  /** 壳打包时的最后一次 git 提交（短哈希）；没有为空串 */
  commit: string;
  /** 壳报的桥协议；壳没报（老壳）为 0 */
  proto: number;
  state: PairState;
}

/** 读壳的环境：优先 getEnv（有 proto），失败再退回 UA 标记 */
function readShellEnv(): { version: string; proto: number; builtAt: string; commit: string } | null {
  try {
    const raw = (window as unknown as { AndroidBridge?: { getEnv?: () => string } }).AndroidBridge?.getEnv?.();
    if (typeof raw === 'string' && raw) {
      const o = JSON.parse(raw) as { version?: unknown; proto?: unknown; builtAt?: unknown; commit?: unknown };
      const version = typeof o.version === 'string' ? o.version : '';
      const proto = Number(o.proto);
      const str = (v: unknown) => (typeof v === 'string' ? v : '');
      return { version, proto: Number.isFinite(proto) ? proto : 0, builtAt: str(o.builtAt), commit: str(o.commit) };
    }
  } catch {
    // 桥注入但不响应，继续走 UA 兜底
  }
  const m = typeof navigator !== 'undefined' ? /DatingRecord\/(\d+\.\d+\.\d+)/.exec(navigator.userAgent) : null;
  return m ? { version: m[1], proto: 0, builtAt: '', commit: '' } : null;
}

/** 逐段比 semver：a < b 返回负数 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function pairing(): Pairing {
  const env = readShellEnv();
  if (!env) return { web: APP_VERSION, shell: '', builtAt: '', commit: '', proto: 0, state: 'browser' };
  if (!env.version) return { web: APP_VERSION, shell: '', builtAt: env.builtAt, commit: env.commit, proto: env.proto, state: 'unknown' };
  if (env.proto === 0) {
    // 0.2.x 及更早的壳不报 proto：能认出版本但认不出协议，按「老壳」处理
    return { web: APP_VERSION, shell: env.version, builtAt: env.builtAt, commit: env.commit, proto: 0, state: 'shell-old' };
  }
  if (env.proto !== BRIDGE_PROTO) {
    return { web: APP_VERSION, shell: env.version, builtAt: env.builtAt, commit: env.commit, proto: env.proto, state: 'proto' };
  }
  if (compareVersion(env.version, SHELL_MIN) < 0) {
    return { web: APP_VERSION, shell: env.version, builtAt: env.builtAt, commit: env.commit, proto: env.proto, state: 'shell-old' };
  }
  return { web: APP_VERSION, shell: env.version, builtAt: env.builtAt, commit: env.commit, proto: env.proto, state: 'ok' };
}

/** 配对状态写成一句人话 */
export function pairLabel(state: PairState): string {
  switch (state) {
    case 'ok':
      return '配对正常';
    case 'browser':
      return '普通浏览器（没有壳，原生能力不可用）';
    case 'shell-old':
      return '壳太旧：请升级壳到 ' + SHELL_MIN + ' 或更新版本';
    case 'proto':
      return '桥协议不一致：网页要 proto ' + BRIDGE_PROTO + '，壳不是配套版本，换配套的壳再试';
    default:
      return '壳未上报版本（0.2.x 及更早），按老壳对待';
  }
}
