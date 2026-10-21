import { useMemo, useState } from 'react';
import { createCollection, getTree, type TreeNode } from '../../core/repo/collections';
import { useVersion, bump } from '../../store';

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

  if (!tree) return <div className="muted pad">暂无事件集</div>;

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const c = createCollection({ name: n, parentId: selectedId ?? tree.id });
    bump();
    setName('');
    setCreating(false);
    onSelect(c.id);
  };

  const render = (node: TreeNode, depth: number): JSX.Element => {
    const isCollapsed = collapsed[node.id];
    return (
      <div key={node.id}>
        <div
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
            {node.name}
            {node.totalEventCount > 0 && <em>{node.totalEventCount}</em>}
          </button>
        </div>
        {!isCollapsed && node.children.map((c) => render(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="pane-body">
      <div className="pane-head">
        <strong>事件集</strong>
        <button className="icon-btn" onClick={() => setCreating(true)} title="新建事件集">
          ＋
        </button>
      </div>
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
          <button className="btn btn-primary btn-sm" onClick={submit}>
            创建
          </button>
        </div>
      )}
      {render(tree, 0)}
    </div>
  );
}
