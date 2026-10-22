// 隐私模式（查看偏好，非加密）。
//
// 与 F-X02 应用锁同一套路：模块级状态 + 订阅 + localStorage 持久化 + React 绑定。
// 区别是——锁是「防顺手翻看」的会话闸门，隐私模式是「把标了隐私的东西藏起来」的
// 全局开关，刷新后仍然记得上次的选择。
//
// 关键约束：切隐私模式必须 bump()（见 setPrivacyMode）。列表组件都用 useVersion
// 把数据 memo 在 v 上，不 bump 它们不会重查，藏起来的东西就「藏在缓存里」——看起来
// 没生效。bump 一次，全站依赖数据的组件统一重算，过滤条件自然生效。

import { useSyncExternalStore } from 'react';
import { bump } from './store';

const KEY = 'dr.privacy.mode';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false; // 无痕模式等禁用存储：当作未开
  }
}

let mode = load();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

/** 当前是否处于隐私模式 */
export function isPrivacyMode(): boolean {
  return mode;
}

/** 开启 / 关闭隐私模式。切换时 bump，让全站列表重新按新模式过滤 */
export function setPrivacyMode(on: boolean): void {
  if (mode === on) return;
  mode = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 存不进去也不致命，本次会话仍按新值生效 */
  }
  bump();
  emit();
}

export function subscribePrivacy(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrivacyMode(): boolean {
  return useSyncExternalStore(subscribePrivacy, isPrivacyMode, isPrivacyMode);
}

/**
 * 某条数据在「当前模式下」该不该被藏起来。
 * 只认 isPrivate + 隐私模式两个信号；归档 / 软删由各自查询负责，不在这里掺和。
 */
export function hides(item: { isPrivate?: boolean } | null | undefined): boolean {
  return !!mode && !!item?.isPrivate;
}
