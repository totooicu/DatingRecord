// 第 4 步：预览——点事件集看包内的详情、点事件看正文、点人物看资料。
//
// 预览是「不读附件二进制」算出来的（见父组件）：统计口径和真导出一致，
// 但不用为了看一眼把整包图片搬进内存。

import { formatTime } from '../../../core/time';
import type { Collection, DREvent, Person, ShareFile, ShareLevel } from '../../../core/types';
import { Avatar } from '../../persons/Avatar';

export function PreviewStep({
  preview,
  previewError,
  showAllEvents,
  level,
  withAttachments,
  counts,
  onShowAllEvents,
  onOpenCol,
  onOpenEvent,
  onOpenPerson,
}: {
  preview: ShareFile | null;
  previewError: string | null;
  showAllEvents: boolean;
  level: ShareLevel;
  withAttachments: boolean;
  /** 每个人在预览事件里出现的次数 */
  counts: Map<string, number>;
  onShowAllEvents: (v: boolean) => void;
  onOpenCol: (c: Collection) => void;
  onOpenEvent: (e: DREvent) => void;
  onOpenPerson: (p: Person) => void;
}) {
  return (
    <div className="share-preview">
      {previewError && <div className="alert alert-err">{previewError}</div>}
      {!preview && !previewError && <p className="muted">正在统计…</p>}
      {preview && (
        <>
          <div className="share-summary">
            <span>
              <em>{preview.sourceName ?? '分享'}</em>
            </span>
            <span className="muted small">
              事件集 {preview.collections.length} 个（含子集） · 事件 {preview.events.length} 个 · 人物{' '}
              {preview.persons.length} 位（资料 {preview.pickedPersonIds?.length ?? 0} 位） · 引用附件{' '}
              {preview.missingAttachments} 个
            </span>
          </div>

          <section className="share-block">
            <h4>事件集</h4>
            <div className="share-tree">
              {preview.collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={
                    preview.collectionIds?.includes(c.id) ? 'share-tree-row share-tree-root' : 'share-tree-row'
                  }
                  onClick={() => onOpenCol(c)}
                  title="查看事件集详情"
                >
                  {c.name}
                  {c.kind === 'smart' && <em title="智能集合">⚡</em>}
                </button>
              ))}
            </div>
          </section>

          <section className="share-block">
            <h4>事件（点开预览）</h4>
            <div className="share-events">
              {(showAllEvents ? preview.events : preview.events.slice(0, 8)).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="share-event-row share-row-btn"
                  onClick={() => onOpenEvent(e)}
                >
                  <span className="share-event-row-text">
                    <strong>{e.title || '未命名事件'}</strong>
                    <span className="muted small">{formatTime(e.time)}</span>
                  </span>
                  <span className="share-row-caret">›</span>
                </button>
              ))}
              {preview.events.length === 0 && <p className="muted small">没有事件。</p>}
            </div>
            {preview.events.length > 8 && (
              <button className="btn btn-sm" onClick={() => onShowAllEvents(!showAllEvents)}>
                {showAllEvents ? '收起' : `展开全部 ${preview.events.length} 个`}
              </button>
            )}
          </section>

          <section className="share-block">
            <h4>人物（点开看资料）</h4>
            <div className="share-pick-list">
              {preview.persons.map((p) => {
                const full = preview.pickedPersonIds?.includes(p.id);
                const count = counts.get(p.id) ?? 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="share-pick-row share-row-btn"
                    onClick={() => onOpenPerson(p)}
                  >
                    <Avatar name={p.displayName} avatar={p.avatar} icon={p.icon} size="sm" />
                    <span className="share-pick-name">{p.displayName}</span>
                    <span className="muted small">
                      {count > 0 ? `出现 ${count} 次` : '未出现在事件里'}
                    </span>
                    <span className={full ? 'share-pick-tag' : 'share-pick-tag share-pick-muted'}>
                      {full ? '带资料' : level === 'alias' ? '仅化名' : '仅姓名'}
                    </span>
                  </button>
                );
              })}
              {preview.persons.length === 0 && <p className="muted small">没有人物。</p>}
            </div>
          </section>

          <p className="muted small">
            {withAttachments
              ? `正文引用到的 ${preview.missingAttachments} 个附件会一起打进压缩包（库里找不到的会略过）。`
              : '按你的选择，不打包附件；对方看到的图片位置会显示不出来。'}
          </p>
        </>
      )}
    </div>
  );
}
