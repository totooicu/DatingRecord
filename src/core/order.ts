// Fractional Index：字符串排序键，两个已有键之间可无限插入，永不重排全表。
// 这是跨端同步能无损合并顺序的关键（整数 1/2/3 会在两端并发插入时冲突）。

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const DEFAULT_MID = DIGITS[Math.floor(BASE / 2)]; // 'V'

function idx(ch: string): number {
  const i = DIGITS.indexOf(ch);
  return i < 0 ? 0 : i;
}

/**
 * 求 lo 与 hi 之间的中点键。
 * hi 为 null 表示无上界（无穷大）。要求 lo < hi（字典序）。
 */
function midpoint(lo: string, hi: string | null): string {
  let i = 0;
  let prefix = '';

  while (true) {
    const a = i < lo.length ? idx(lo[i]) : 0;
    const b = hi !== null && i < hi.length ? idx(hi[i]) : BASE;

    if (a === b) {
      prefix += DIGITS[a];
      i += 1;
      continue;
    }

    // 中间还有空间，直接取中点
    if (b - a > 1) {
      const mid = DIGITS[a + Math.floor((b - a) / 2)];
      return prefix + mid;
    }

    // b === a + 1：本层已满，先写下 a，再递归处理 lo 的剩余部分与「无穷大」
    prefix += DIGITS[a];
    return prefix + midpoint(lo.slice(i + 1), null);
  }
}

/** 生成位于 a 与 b 之间的排序键（a/b 可为 null 表示首/尾） */
export function orderKeyBetween(a?: string | null, b?: string | null): string {
  const lo = a ?? '';
  const hi = b ?? null;
  if (hi !== null && lo >= hi) {
    // 防御：顺序异常时退化为追加到 lo 之后
    return lo + DEFAULT_MID;
  }
  const key = midpoint(lo, hi);
  // 避免以 '0' 结尾（保持排序无歧义）
  return key.endsWith('0') ? key.slice(0, -1) + '1' : key;
}

export const FIRST_ORDER_KEY = DEFAULT_MID;
