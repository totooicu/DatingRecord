// 把树摊平成带层深的列表，供下拉框 / 选择器使用

import type { TreeNode } from './read';

export interface FlatNode {
  id: string;
  name: string;
  depth: number;
}

export function flattenTree(n: TreeNode | null, out: FlatNode[] = [], d = 0): FlatNode[] {
  if (!n) return out;
  out.push({ id: n.id, name: n.name, depth: d });
  for (const c of n.children) flattenTree(c, out, d + 1);
  return out;
}
