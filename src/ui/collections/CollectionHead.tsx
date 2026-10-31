// 事件集详情头：面包屑 + 图标 + 改名/描述 + 状态 + 移动 + 删除
import { useState } from 'react';
import {
  deleteCollection,
  updateCollection,
  setCollectionPrivate,
  setCollectionIcon,
} from '../../core/repo/collections';
import { ConfirmButton, PrivacyButton } from '../common';
import { bump } from '../../store';
import { getEvent } from '../../core/repo/events';
import { hides } from '../../privacy';
import type { Collection } from '../../core/types';
import { CollectionIconView } from './CollectionIcon';
import { IconPicker } from './IconPicker';
import { TemplateEventModal } from './TemplateEventModal';

export function CollectionHead({
  collection,
  breadcrumb,
  onMove,
  onError,
}: {
  collection: Collection;
  breadcrumb: { id: string; name: string }[];
  onMove: () => void;
  onError: (msg: string) => void;
}) {
  const [iconOpen, setIconOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const template = collection.templateEventId ? getEvent(collection.templateEventId) : null;
  const templateShown = template && !hides(template) ? template : null;

  return (
    <>
      <div className="breadcrumb">
        {breadcrumb.map((b, i) => (
          <span key={b.id}>
            {i > 0 && <em>/</em>}
            {b.name}
          </span>
        ))}
      </div>

      <div className="detail-head">
        <button
          type="button"
          className="head-icon-btn"
          title={collection.icon ? '更换图标' : '设置图标'}
          aria-label={collection.icon ? '更换图标' : '设置图标'}
          onClick={() => setIconOpen(true)}
        >
          <CollectionIconView icon={collection.icon} size="lg" fallback={collection.name} />
        </button>
        <div className="detail-head-main">
          <input
            className="title-input"
            value={collection.name}
            onChange={(e) => updateCollection(collection.id, { name: e.target.value })}
            onBlur={() => bump()}
          />
          <input
            className="sub-input"
            placeholder="描述（可选）"
            value={collection.description}
            onChange={(e) => updateCollection(collection.id, { description: e.target.value })}
            onBlur={() => bump()}
          />
        </div>
        <div className="detail-head-actions">
          <select
            value={collection.status}
            onChange={(e) => {
              updateCollection(collection.id, { status: e.target.value as Collection['status'] });
              bump();
            }}
          >
            <option value="ongoing">进行中</option>
            <option value="finished">已结束</option>
            <option value="archived">已归档</option>
          </select>
          <button
            className="btn"
            onClick={() => setTemplateOpen(true)}
            title={templateShown ? `新建事件模板：${templateShown.title}` : '设置新建事件的模板事件'}
          >
            模板
          </button>
          <button className="btn" onClick={onMove}>
            移动
          </button>
          <PrivacyButton
            active={collection.isPrivate}
            onToggle={() => {
              setCollectionPrivate(collection.id, !collection.isPrivate);
              bump();
            }}
          />
          {!collection.isRoot && (
            <ConfirmButton
              text="删除"
              danger
              confirmText="确认删除？（不会删除事件本身）"
              onConfirm={() => {
                const r = deleteCollection(collection.id);
                if (!r.ok) onError(r.reason ?? '删除失败');
                bump();
              }}
            />
          )}
        </div>
      </div>

      {collection.templateEventId && (
        <p className="muted small collect-template-hint">
          {templateShown
            ? `新建事件将按模板《${templateShown.title}》自动填充`
            : '模板事件不可用，新建事件不会填充；可在「模板」里重选'}
        </p>
      )}

      {iconOpen && (
        <IconPicker
          icon={collection.icon}
          fallback={collection.name}
          onSave={(icon) => {
            setCollectionIcon(collection.id, icon);
            bump();
          }}
          onClose={() => setIconOpen(false)}
        />
      )}
      {templateOpen && (
        <TemplateEventModal collectionId={collection.id} onClose={() => setTemplateOpen(false)} />
      )}
    </>
  );
}
