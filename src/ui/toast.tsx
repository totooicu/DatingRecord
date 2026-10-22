// 轻提示。
//
// 和「撤销 snackbar」是两回事：那个要留给用户点回去，这个只是说一句
// 「刚才那下成了」，说完自己消失，不抢焦点、不跳转、不弹窗。
//
// 典型场景：保存事件后原地不动继续写，只飘一句「已保存」——
// 以前是保存即关闭弹窗，等于把刚进入状态的人赶出去。
import { useEffect, useState } from 'react';

interface Item {
  id: number;
  text: string;
}

let seq = 0;
let items: Item[] = [];
const listeners = new Set<(list: Item[]) => void>();

function emit(): void {
  for (const fn of listeners) fn(items);
}

/** 飘一句提示，默认 1.8 秒后自己消失 */
export function showToast(text: string, ms = 1800): void {
  const id = ++seq;
  items = [...items, { id, text }];
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, ms);
}

/** 挂在应用根节点上；没有提示时不渲染任何东西 */
export function ToastHost() {
  const [list, setList] = useState<Item[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  if (list.length === 0) return null;
  return (
    <div className="toast-host">
      {list.map((t) => (
        <div key={t.id} className="toast" role="status">
          {t.text}
        </div>
      ))}
    </div>
  );
}
