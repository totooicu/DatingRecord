// 「分享」页：导出 / 导入两个方向。
//
// 导出的对象只有两种：一个事件集，或一个人。
//   · 事件集带结构（含子事件集），适合「把这一段故事整块给你」；
//   · 人物只带他参与过的事件，不带结构，落到对方哪个事件集由他导入时定。
// 两者涉及的人物都一定会被带上，区别只在人物资料带多少——那是 ShareDialog 里选的。
import { useMemo, useState } from 'react';
import { flattenTree, getTree } from '../../core/repo/collections';
import { listPersons } from '../../core/repo/persons';
import { useVersion } from '../../store';
import { Section } from './Section';
import { ShareImportButton } from '../collections';
import { ShareDialog, type ShareTarget } from '../share/ShareDialog';

type Kind = 'collection' | 'person';

export function ShareSection() {
  useVersion();
  const [kind, setKind] = useState<Kind>('collection');
  const [targetId, setTargetId] = useState('');
  const [dialog, setDialog] = useState<ShareTarget | null>(null);

  const collections = useMemo(() => flattenTree(getTree()), []);
  const persons = useMemo(() => listPersons(), []);

  // 选择的 id 可以指向已经不存在的东西（刚删掉一个事件集再回到这一页），
  // 所以每次取当前值都做一次存在性检查，而不是只靠 state
  const currentId =
    kind === 'collection'
      ? collections.some((c) => c.id === targetId)
        ? targetId
        : collections[0]?.id ?? ''
      : persons.some((p) => p.id === targetId)
        ? targetId
        : persons[0]?.id ?? '';

  const currentName =
    kind === 'collection'
      ? collections.find((c) => c.id === currentId)?.name ?? ''
      : persons.find((p) => p.id === currentId)?.displayName ?? '';

  const open = () => {
    if (!currentId) return;
    setDialog({ kind, id: currentId, name: currentName });
  };

  return (
    <>
      <Section
        title="导出分享"
        desc="只带走你选的这一段：事件、聊天、正文里引用到的附件，以及事件涉及的人物。分享程度决定人物资料带多少。"
      >
        <div className="row-actions share-kind-row">
          <div className="share-kind" role="tablist" aria-label="分享对象">
            <button
              role="tab"
              aria-selected={kind === 'collection'}
              className={kind === 'collection' ? 'share-kind-on' : ''}
              onClick={() => setKind('collection')}
            >
              事件集
            </button>
            <button
              role="tab"
              aria-selected={kind === 'person'}
              className={kind === 'person' ? 'share-kind-on' : ''}
              onClick={() => setKind('person')}
            >
              人物
            </button>
          </div>
        </div>

        <div className="row-actions share-export-row">
          {kind === 'collection' ? (
            <select value={currentId} onChange={(e) => setTargetId(e.target.value)}>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {'　'.repeat(c.depth)}
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <select value={currentId} onChange={(e) => setTargetId(e.target.value)}>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-primary" disabled={!currentId} onClick={open}>
            选择分享程度并导出
          </button>
        </div>

        <p className="muted small">
          {kind === 'collection'
            ? '子事件集会跟着一起走，层级保持原样；只有最外层在对方库里重新挂载。'
            : '只带这个人参与过的事件，不带事件集结构——对方导入时自己挑落地位置。'}
          {kind === 'person' && persons.length === 0 ? ' 目前还没有人物。' : ''}
        </p>
      </Section>

      <Section
        title="导入分享"
        desc="收到别人的 .drshare.json，先预览里面有什么、人物怎么关联、事件集落在哪，确认后才写库。"
      >
        <div className="row-actions share-entry">
          <span className="muted small">
            同名人物会自动关联，也可以手动改成自己库里的人；事件集可以新建，也可以并进已有的一个。
          </span>
          <ShareImportButton text="选择分享文件" />
        </div>
      </Section>

      {dialog && <ShareDialog target={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
