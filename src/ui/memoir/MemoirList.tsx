// 事件集里的「回忆」列表：一本本翻，或新建一本。
//
// 和「事件」页签的分工：那边是流水（按时间/成员看全部事件），这边是成品
// （挑好的事件 + 排好的顺序 + 配图与导语）。数据仍然是同一份事件。

import { useMemo, useState } from 'react';
import { deleteMemoir, listMemoirs, memoirCoverId } from '../../core/repo/memoirs';
import { useVersion, bump } from '../../store';
import { ConfirmButton, Empty } from '../common';
import { useBlobUrl } from '../preview/useBlobUrl';
import type { Memoir } from '../../core/types';
import { MemoirComposer } from './MemoirComposer';
import { MemoirEditor } from './MemoirEditor';
import { MemoirReader } from './MemoirReader';

function Cover({ id }: { id: string | null }) {
  const url = useBlobUrl(id);
  if (!url) return <div className="memoir-cover memoir-cover-empty" aria-hidden />;
  return <img className="memoir-cover" src={url} alt="" />;
}

function Card({
  memoir,
  onRead,
  onEdit,
  onDeleted,
}: {
  memoir: Memoir;
  onRead: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const pages = memoir.pages.filter((p) => !p.hidden).length;
  const when = new Date(memoir.updatedAt || memoir.createdAt);
  return (
    <article className="memoir-card">
      <Cover id={memoirCoverId(memoir)} />
      <div className="memoir-card-main">
        <h4 className="memoir-card-title">{memoir.title}</h4>
        {memoir.subtitle && <p className="muted small memoir-card-sub">{memoir.subtitle}</p>}
        <p className="muted small">
          {pages} 页 · {memoir.source === 'ai' ? 'AI 草稿' : '手工'} ·{' '}
          {Number.isNaN(when.getTime()) ? '—' : when.toLocaleDateString()}
          {memoir.playlistId ? ' · 配乐' : ''}
        </p>
      </div>
      <div className="memoir-card-actions">
        <button className="btn btn-sm btn-primary" onClick={onRead}>
          阅读
        </button>
        <button className="btn btn-sm" onClick={onEdit}>
          编辑
        </button>
        <ConfirmButton
          text="删除"
          danger
          confirmText="删除这本回忆录？（不会删除事件）"
          onConfirm={() => {
            deleteMemoir(memoir.id);
            bump();
            onDeleted();
          }}
        />
      </div>
    </article>
  );
}

export function MemoirList({ collectionId, collectionName }: { collectionId: string; collectionName: string }) {
  const v = useVersion();
  const list = useMemo(() => listMemoirs(collectionId), [collectionId, v]);
  const [mode, setMode] = useState<'list' | 'new'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [readId, setReadId] = useState<string | null>(null);
  /** 阅读页从哪儿进来的：从编辑页进来时，「返回」要回编辑页而不是列表 */
  const [readFrom, setReadFrom] = useState<'list' | 'edit'>('list');

  if (readId) {
    return (
      <MemoirReader
        memoirId={readId}
        onBack={() => {
          setReadId(null);
          if (readFrom === 'edit') setEditId(readId);
          bump();
        }}
        onEdit={() => {
          setEditId(readId);
          setReadId(null);
        }}
      />
    );
  }

  if (editId) {
    return (
      <MemoirEditor
        memoirId={editId}
        onBack={() => setEditId(null)}
        onRead={() => {
          setReadFrom('edit');
          setReadId(editId);
          setEditId(null);
        }}
      />
    );
  }

  if (mode === 'new') {
    return (
      <MemoirComposer
        collectionId={collectionId}
        collectionName={collectionName}
        onCancel={() => setMode('list')}
        onCreated={(m) => {
          setMode('list');
          setEditId(m.id);
          bump();
        }}
      />
    );
  }

  return (
    <section className="memoirs">
      <div className="memoir-toolbar">
        <button className="btn btn-primary" onClick={() => setMode('new')}>
          ＋ 新建回忆
        </button>
        <span className="muted small">从事件里挑一段，排成一本可以慢慢翻的册子。</span>
      </div>

      {list.length === 0 ? (
        <Empty text="还没有回忆录。新建一本，挑几个事件开始。" />
      ) : (
        <div className="memoir-cards">
          {list.map((m) => (
            <Card
              key={m.id}
              memoir={m}
              onRead={() => {
                setReadFrom('list');
                setReadId(m.id);
              }}
              onEdit={() => setEditId(m.id)}
              onDeleted={() => setMode('list')}
            />
          ))}
        </div>
      )}
    </section>
  );
}
