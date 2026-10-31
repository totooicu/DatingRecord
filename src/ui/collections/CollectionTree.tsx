import { useMemo, useState } from 'react';
import { createCollection, getTree, type TreeNode } from '../../core/repo/collections';
import { useVersion, bump } from '../../store';
import { CollectionIconView } from './CollectionIcon';
import { HeadStatus } from '../runtime/HeadStatus';
import { PageHead, Empty } from '../common';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';

/** 一行的坐标：节点 + 它所在的层级 */
interface Row {
  node: TreeNode;
  depth: number;
}

/** 把树摊成可见行：折叠节点的子树不进列表（也不进分页计数），
 *  否则「一共多少页」会把看不见的行算进去。 */
function flatten(tree: TreeNode, collapsed: Record<string, boolean>): Row[] {
  const out: Row[] = [];
  const walk = (node: TreeNode, depth: number) => {
    out.push({ node, depth });
    if (!collapsed[node.id]) node.children.forEach((c) => walk(c, depth + 1));
  };
  walk(tree, 0);
  return out;
}

export function CollectionTree({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const v = useVersion();
  const tree = useMemo(() => getTree(), [v]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [newKind, setNewKind] = useState<'manual' | 'smart'>('manual');

  // 事件集可以是几百个的树：与人物 / 时间线 / 文件同一颗分页控件、同一个每页条数。
  // 分页吃在「摊平后的可见行」上，树形缩进照旧，只是每页只渲染这一截。
  const rows = useMemo(() => (tree ? flatten(tree, collapsed) : []), [tree, collapsed]);
  const paged = usePaged(rows, usePageSize());

  if (!tree) return <Empty compact text="暂无事件集" />;

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const c = createCollection({
      name: n,
      parentId: selectedId ?? tree.id,
      kind: newKind === 'smart' ? 'smart' : 'arc',
      rule: newKind === 'smart' ? {} : null,
    });
    bump();
    setName('');
    setNewKind('manual');
    setCreating(false);
    onSelect(c.id);
  };

  /** 一行：缩进由 depth 给，折叠只看 collapsed 里这个节点自己的标记 */
  const row = ({ node, depth }: Row) => {
    const isCollapsed = collapsed[node.id];
    return (
      <div
        key={node.id}
        className={node.id === selectedId ? 'tree-row tree-row-on' : 'tree-row'}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          className="tree-toggle"
          onClick={() => setCollapsed((s) => ({ ...s, [node.id]: !s[node.id] }))}
          disabled={node.children.length === 0}
        >
          {node.children.length ? (isCollapsed ? '▸' : '▾') : '·'}
        </button>
        <button className="tree-name" onClick={() => onSelect(node.id)}>
          <CollectionIconView icon={node.icon} size="sm" fallback={node.name} />
          <span className="tree-label">{node.name}</span>
          {node.kind === 'smart' && <em className="tree-smart" title="智能集合：成员由规则实时算出">⚡</em>}
          {node.isPrivate && <em className="tree-private" title="隐私：开启隐私模式后隐藏">隐私</em>}
          {node.totalEventCount > 0 && <em>{node.totalEventCount}</em>}
        </button>
      </div>
    );
  };

  return (
    <div className="pane-body">
      {/* 主页标题条与其它页面同一形式：吸顶 44px、标题居中、右侧状态区/新建 */}
      <PageHead
        title="事件集"
        right={
          <>
            <HeadStatus />
            <button className="icon-btn" onClick={() => setCreating(true)} title="新建事件集">
              ＋
            </button>
          </>
        }
      />
      {creating && (
        <div className="inline-create">
          <input
            autoFocus
            value={name}
            placeholder="名称"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setCreating(false);
            }}
          />
          <select
            className="inline-create-kind"
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as 'manual' | 'smart')}
            title="普通集合手动添加成员；智能集合按规则自动匹配"
          >
            <option value="manual">普通</option>
            <option value="smart">智能</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={submit}>
            创建
          </button>
        </div>
      )}
      {paged.pageItems.map(row)}
      <Paginator paged={paged} />
    </div>
  );
}
