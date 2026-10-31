// 回忆录编辑：排页、换封面、写摘句和导语、挂歌单。
//
// 每一页只保存「指向哪个事件 + 这一页的编辑决策」：标题/日期/地点/正文
// 都实时从事件取，所以改事件不会让回忆录变成一份过期的旧拷贝。

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyScan,
  eventImageIds,
  getMemoir,
  memoirCoverId,
  memoirPages,
  scanMemoir,
  updateMemoir,
  type ScanResult,
} from '../../core/repo/memoirs';
import { getPlaylistFile, listPlaylists } from '../../core/music/playlistFile';
import { formatTime } from '../../core/time';
import { bump, useVersion } from '../../store';
import { useBlobUrl } from '../preview/useBlobUrl';
import { PageHead, Empty } from '../common';
import { pushBackLayer } from '../back';
import type { Memoir, MemoirPage } from '../../core/types';
import { AiMemoirButton } from './AiMemoir';
import { AiPlaylistButton } from './AiPlaylist';
import { PlaylistPicker } from './PlaylistPicker';

function Thumb({ id, alt }: { id: string | null; alt?: string }) {
  const url = useBlobUrl(id);
  if (!url) return null;
  return <img className="memoir-thumb" src={url} alt={alt ?? ''} />;
}

export function MemoirEditor({
  memoirId,
  onBack,
  onRead,
}: {
  memoirId: string;
  onBack: () => void;
  onRead: () => void;
}) {
  const v = useVersion();
  const stored = useMemo(() => getMemoir(memoirId), [memoirId, v]);
  const [draft, setDraft] = useState<Memoir | null>(stored);
  const [scan, setScan] = useState<ScanResult | null>(null);

  useEffect(() => {
    setDraft(getMemoir(memoirId));
  }, [memoirId]);

  useEffect(() => {
    if (stored) setDraft((cur) => (cur && cur.rev === stored.rev ? cur : stored));
  }, [stored]);

  const playlists = useMemo(() => listPlaylists(), [v]);
  const pages = useMemo(() => (draft ? memoirPages(draft) : []), [draft, v]);

  // 壳的系统返回键先退编辑页——和头部 ‹ 一个顺序，再往下一级才是回忆录列表
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  });
  useEffect(() => pushBackLayer(() => backRef.current()), []);

  if (!draft) return <p className="muted">回忆录不存在或已删除。</p>;

  const commit = (patch: Partial<Memoir>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    updateMemoir(draft.id, patch);
    bump();
  };

  const setPage = (pageId: string, patch: Partial<MemoirPage>) => {
    const nextPages = draft.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p));
    commit({ pages: nextPages });
  };

  /** 打字时只改本地，落库放到失焦——否则每敲一个字都要写一次库 */
  const patchPageLocal = (pageId: string, patch: Partial<MemoirPage>) => {
    setDraft({ ...draft, pages: draft.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p)) });
  };

  const movePage = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.pages.length) return;
    const nextPages = [...draft.pages];
    const [item] = nextPages.splice(index, 1);
    nextPages.splice(target, 0, item);
    commit({ pages: nextPages });
  };

  const removePage = (pageId: string) => {
    if (!window.confirm('从这本回忆录里移除这一页？（事件本身不受影响）')) return;
    commit({ pages: draft.pages.filter((p) => p.id !== pageId) });
  };

  const doScan = () => {
    setScan(scanMemoir(draft));
  };

  const acceptScan = () => {
    if (!scan?.added.length) return;
    const next = applyScan(draft, scan.added);
    setDraft(next);
    setScan(null);
    bump();
  };

  const coverId = memoirCoverId(draft);
  const playlist = draft.playlistId ? getPlaylistFile(draft.playlistId) : null;

  return (
    <>
      {/* 子页头与全站其它页同一形式：吸顶 44px、‹ 返回、标题居中、右侧动作 */}
      <PageHead
        className="page-head-embed"
        title={draft.title || '未命名回忆'}
        onBack={onBack}
        right={
          <>
            <button className="btn btn-sm" onClick={doScan}>
              扫描新增事件
            </button>
            <button className="btn btn-sm btn-primary" onClick={onRead}>
              阅读
            </button>
          </>
        }
      />

      <section className="memoir-edit">
        <p className="muted small memoir-edit-meta">
          {draft.pages.length} 页 · 冻结于 {new Date(draft.scope.frozenAt || draft.createdAt).toLocaleDateString()}
        </p>

        {scan && (
          <div className="alert memoir-scan">
            <span>
              {scan.added.length === 0 && scan.removed.length === 0
                ? '没有新事件，当前快照是最新的。'
                : `新增 ${scan.added.length} 条，范围内另有 ${scan.removed.length} 条已不在快照里。`}
            </span>
            {scan.added.length > 0 && (
              <button className="btn btn-sm btn-primary" onClick={acceptScan}>
                并入新事件
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setScan(null)}>
              关闭
            </button>
          </div>
        )}

        <div className="memoir-fields">
          <label className="muted small">
            标题
            <input
              className="music-name-input"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              onBlur={() => commit({ title: draft.title })}
            />
          </label>
          <label className="muted small">
            副标题
            <input
              className="music-name-input"
              value={draft.subtitle}
              placeholder="可选"
              onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
              onBlur={() => commit({ subtitle: draft.subtitle })}
            />
          </label>
        </div>

        <div className="memoir-media-row">
          <div className="memoir-cover-pick">
            <span className="muted small">封面</span>
            <Thumb id={coverId} alt="封面" />
            <select
              className="memoir-select"
              value={draft.coverFileId ?? ''}
              onChange={(e) => commit({ coverFileId: e.target.value || null })}
            >
              <option value="">自动（第一张页图）</option>
              {draft.pages.map((p, i) => {
                const ev = pages.find((x) => x.page.id === p.id)?.event;
                if (!ev) return null;
                return eventImageIds(ev).map((id, k) => (
                  <option key={id} value={id}>
                    第 {i + 1} 页图 {k + 1}
                  </option>
                ));
              })}
            </select>
          </div>
          <div className="memoir-cover-pick">
            <span className="muted small">背景歌单</span>
            <div className="memoir-playlist-row">
              <select
                className="memoir-select"
                value={draft.playlistId ?? ''}
                onChange={(e) => commit({ playlistId: e.target.value || null })}
              >
                <option value="">不播放</option>
                {playlists.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name.replace(/\.drpl$/i, '')}
                  </option>
                ))}
              </select>
              <PlaylistPicker memoir={draft} onApply={(next) => setDraft(next)} />
            </div>
            {draft.playlistId && !playlist && <span className="muted small">歌单文件已不在文件库里</span>}
          </div>
        </div>

        <AiMemoirButton memoir={draft} onApply={(next) => setDraft(next)} />
        <AiPlaylistButton memoir={draft} onApply={(next) => setDraft(next)} />

        <ol className="memoir-pages">
          {pages.map(({ page, event }, i) => (
            <li key={page.id} className="memoir-page-edit">
              <div className="memoir-page-head">
                <span className="memoir-page-no">{i + 1}</span>
                <div className="memoir-page-head-main">
                  <strong>{event ? event.title || '未命名事件' : '原事件已删除'}</strong>
                  <span className="muted small">
                    {event ? formatTime(event.time) : ''}
                    {event?.place.name ? ` · ${event.place.name}` : ''}
                    {page.edited ? ' · 已手改' : ''}
                  </span>
                </div>
                <span className="memoir-page-actions">
                  <button className="icon-btn" title="上移" disabled={i === 0} onClick={() => movePage(i, -1)}>
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    title="下移"
                    disabled={i === pages.length - 1}
                    onClick={() => movePage(i, 1)}
                  >
                    ↓
                  </button>
                  <button className="icon-btn" title="移出这本回忆录" onClick={() => removePage(page.id)}>
                    ×
                  </button>
                </span>
              </div>

              {event && (
                <div className="memoir-page-body">
                  <label className="muted small">
                    导语
                    <textarea
                      className="memoir-textarea"
                      rows={2}
                      placeholder="这一页想说的话"
                      value={page.note ?? ''}
                      onChange={(e) => patchPageLocal(page.id, { note: e.target.value, edited: true })}
                      onBlur={() => setPage(page.id, {})}
                    />
                  </label>
                  <label className="muted small">
                    摘句
                    <textarea
                      className="memoir-textarea"
                      rows={2}
                      placeholder="留空 = 自动取正文开头"
                      value={page.excerpt ?? ''}
                      onChange={(e) => patchPageLocal(page.id, { excerpt: e.target.value, edited: true })}
                      onBlur={() => setPage(page.id, {})}
                    />
                  </label>
                  <label className="muted small">
                    配图
                    <select
                      className="memoir-select"
                      value={page.coverFileId ?? ''}
                      onChange={(e) => setPage(page.id, { coverFileId: e.target.value || undefined, edited: true })}
                    >
                      <option value="">自动（事件第一张图）</option>
                      {eventImageIds(event).map((id, k) => (
                        <option key={id} value={id}>
                          图 {k + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </li>
          ))}
        </ol>

        {draft.pages.length === 0 && <Empty compact text="这本回忆录还没有页。用「扫描新增事件」把范围里的事件加进来。" />}
      </section>
    </>
  );
}
