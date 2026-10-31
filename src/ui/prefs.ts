// 通用界面偏好：引导强度（陪伴 / 专注）、事件集详情的排版、列表每页条数。
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

/** 事件集详情里事件的默认排版：列表（成员行）/ 表格（只读阅览） */
export type CollectionView = 'list' | 'table';

interface Prefs {
  /** companion=陪伴（默认，带引导与小字）；focus=专注（只留控件，去解释） */
  guide: GuideMode;
  /** 上次在事件集详情选的视图；跟着设备走，不进库也不进备份 */
  collectionView: CollectionView;
  /** 各列表共用的每页条数（一台设备一个数，不分页分别记） */
  pageSize: number;
}

const KEY = 'dr.prefs.v1';
const DEFAULT_PREFS: Prefs = { guide: 'companion', collectionView: 'list', pageSize: 50 };

/** 每页条数只认这几档：其它值（包括手改 localStorage）一律回默认，别把列表切成一条一页 */
export const PAGE_SIZES = [20, 50, 100, 200, 500];

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    // 逐项校验：任意一项损坏只回落该项，不把整份偏好清掉
    return {
      guide: p?.guide === 'focus' ? 'focus' : 'companion',
      collectionView: p?.collectionView === 'table' ? 'table' : 'list',
      pageSize: PAGE_SIZES.includes(Number(p?.pageSize)) ? Number(p.pageSize) : DEFAULT_PREFS.pageSize,
    };
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

export function getCollectionView(): CollectionView {
  return read().collectionView;
}

/** 当前每页条数：分页控件与 usePaged 都读这一个数 */
export function getPageSize(): number {
  return read().pageSize;
}

/** 改每页条数：全局偏好，一次改动所有分页列表同时生效 */
export function setPageSize(n: number): void {
  if (!PAGE_SIZES.includes(n)) return;
  const next: Prefs = { ...read(), pageSize: n };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存不下也先让本次会话生效（调用方自己还持有当前值） */
  }
  window.dispatchEvent(new Event('dr-prefs'));
}

/** 记住事件集详情的列表/表格选择；只写本机偏好，不碰库数据 */
export function setCollectionView(v: CollectionView): void {
  const next: Prefs = { ...read(), collectionView: v };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用时本次会话仍生效（调用方自己持有 state） */
  }
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

/** 组件内读取每页条数；在任一分页控件里改了，其它列表同帧跟着变 */
export function usePageSize(): number {
  return useSyncExternalStore(subscribe, getPageSize, getPageSize);
}
