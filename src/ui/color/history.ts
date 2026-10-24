// 历史颜色：所有取色面板右侧共用的一份「最近用过」。
//
// 存 localStorage（`dr.recentColors`），和主题偏好一样只在本机、不进备份——
// 它只是操作习惯，不是数据。同一个颜色重复选只挪到最前面，不留重复项。
// 模块级缓存 + 订阅，保证同一页里两个取色器（前景 / 背景）看到同一份历史。

import { useEffect, useState } from 'react';
import { normalizeHex } from './color';

const KEY = 'dr.recentColors';
const MAX = 16;

let cache: string[] | null = null;
const listeners = new Set<() => void>();

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    const list = Array.isArray(raw)
      ? raw.map((v) => normalizeHex(String(v))).filter((v): v is string => !!v)
      : [];
    cache = Array.from(new Set(list)).slice(0, MAX);
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: string[]): void {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 存储满 / 隐私模式禁写：历史只是便利功能，失败不影响取色 */
  }
  listeners.forEach((fn) => fn());
}

export function recentColors(): string[] {
  return read();
}

/** 记住一个刚用过的颜色（认不出的值直接忽略，例如 transparent） */
export function rememberColor(raw: string): void {
  const hex = normalizeHex(raw);
  if (!hex) return;
  const list = read().filter((c) => c !== hex);
  list.unshift(hex);
  write(list.slice(0, MAX));
}

/** 清空历史（设置页的「恢复默认」没必要动它，留个显式入口给以后用） */
export function clearRecentColors(): void {
  write([]);
}

export function useRecentColors(): string[] {
  const [list, setList] = useState<string[]>(recentColors);
  useEffect(() => {
    const fn = () => setList(recentColors());
    listeners.add(fn);
    fn(); // 挂载时再读一次：别的实例可能刚写过
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return list;
}
