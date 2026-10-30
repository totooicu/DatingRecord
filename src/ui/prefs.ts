// 通用界面偏好：目前只管「陪伴 / 专注」两种引导强度。
//
// 和主题色一样存 localStorage 而不是 meta 表——这是「这台设备想怎么看」的偏好，
// 不是库数据，换设备/清缓存回到默认都合理。
//
// 实现上走「根元素 data-guide 属性 + CSS .guide-only 隐藏」的路线：
//   · CSS 隐藏零 JS 成本，设置页里成百上千条小字说明一行 class 就能收掉；
//   · 首屏脚本会先按缓存贴一次 data-guide，避免进设置页才「啪」一下消失；
//   · 需要按模式改行为的逻辑（比如条件渲染的帮助块）再用 useGuide() 读。
import { useSyncExternalStore } from 'react';

export type GuideMode = 'companion' | 'focus';

interface Prefs {
  /** companion=陪伴（默认，带引导与小字）；focus=专注（只留控件，去解释） */
  guide: GuideMode;
}

const KEY = 'dr.prefs.v1';
const DEFAULT_PREFS: Prefs = { guide: 'companion' };

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    if (p && (p.guide === 'companion' || p.guide === 'focus')) {
      return { guide: p.guide };
    }
  } catch {
    /* 存储被禁或内容损坏：退回默认，不阻塞启动 */
  }
  return DEFAULT_PREFS;
}

export function getPrefs(): Prefs {
  return read();
}

export function getGuide(): GuideMode {
  return read().guide;
}

/** 把当前模式写到 :root，驱动 .guide-only 的显隐 */
export function applyGuide(g: GuideMode): void {
  document.documentElement.setAttribute('data-guide', g);
}

export function setGuide(g: GuideMode): void {
  const next: Prefs = { ...read(), guide: g };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用时至少本次会话生效 */
  }
  applyGuide(g);
  // 通知 React 侧（useGuide）重渲染
  window.dispatchEvent(new Event('dr-prefs'));
}

/** 首屏与主题色一起调用：把缓存里的模式贴到 :root */
export function initPrefs(): void {
  applyGuide(getGuide());
}

const listeners = new Set<() => void>();
window.addEventListener('dr-prefs', () => listeners.forEach((l) => l()));

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function snapshot(): GuideMode {
  return getGuide();
}

/** 组件内读取当前模式；模式变化自动重渲染 */
export function useGuide(): GuideMode {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
