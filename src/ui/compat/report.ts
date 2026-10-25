// 「软件适配测试」页顶部的汇总表：各项测过没有、过没过。
//
// 每张卡测完自己报到（setTestResult），页面顶部只读汇总。状态放模块级而不是
// 组件里，是为了离开这一页再回来还能看到刚才的结果——原生桥、蓝牙授权这类
// 步骤有系统弹窗，重来一遍很烦。
//
// 不打分、不算总分：适配测试的结论是「哪一类能力这台机器 / 这个壳不支持」，
// 一个数字会把「麦克风被拒」和「壳没注入桥」这两件完全不同的事混成一样。
import { useSyncExternalStore } from 'react';

export type TestId =
  | 'engine'
  | 'bridge'
  | 'mic'
  | 'geo'
  | 'bleCentral'
  | 'blePeripheral'
  | 'filePrivate'
  | 'filePublic'
  | 'screen'
  | 'deps';

export type TestState = 'idle' | 'ok' | 'err';

export const TEST_LABELS: { id: TestId; label: string }[] = [
  { id: 'engine', label: '引擎信息' },
  { id: 'bridge', label: '原生桥' },
  { id: 'mic', label: '麦克风' },
  { id: 'geo', label: '定位' },
  { id: 'bleCentral', label: '蓝牙中心' },
  { id: 'blePeripheral', label: '蓝牙外设' },
  { id: 'filePrivate', label: '文件私有' },
  { id: 'filePublic', label: '文件公共' },
  { id: 'screen', label: '录屏' },
  { id: 'deps', label: '应用依赖' },
];

export interface TestResult {
  id: TestId;
  label: string;
  state: TestState;
  note?: string;
}

const results = new Map<TestId, { state: TestState; note?: string }>();
const subscribers = new Set<() => void>();
let snapshot: TestResult[] = TEST_LABELS.map((t) => ({ ...t, state: 'idle' }));

/** 只在写的时候重建一次；useSyncExternalStore 要求同一份状态返回同一个引用 */
function rebuild(): void {
  snapshot = TEST_LABELS.map((t) => {
    const r = results.get(t.id);
    return { ...t, state: r?.state ?? 'idle', note: r?.note };
  });
  subscribers.forEach((fn) => fn());
}

/** 一张卡测完 / 失败后报到。note 用于汇总里的一句话原因（如「超时」「未注入」） */
export function setTestResult(id: TestId, state: TestState, note?: string): void {
  const prev = results.get(id);
  if (prev && prev.state === state && prev.note === note) return;
  results.set(id, { state, note });
  rebuild();
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

const read = (): TestResult[] => snapshot;

/** 汇总用的快照 */
export function useTestResults(): TestResult[] {
  return useSyncExternalStore(subscribe, read, read);
}
