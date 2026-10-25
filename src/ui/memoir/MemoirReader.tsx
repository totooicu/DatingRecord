// 回忆录阅读版：滚动长文，一页一个事件。
//
// 播放形式和阅读形式共用同一份数据（见后续播放器），所以这里不做任何
// 单页裁切：正文该多长就多长，手机上滚着看。

import { useEffect, useMemo, useRef, useState } from 'react';
import { eventImageIds, getMemoir, memoirCoverId, memoirPages } from '../../core/repo/memoirs';
import { getPlaylistFile } from '../../core/music/playlistFile';
import { getMusicState, openPlaylist, toggle, useMusic } from '../../core/runtime/music';
import { markdownToText } from '../../core/markdown';
import { formatTime } from '../../core/time';
import { useVersion } from '../../store';
import { openEvent } from '../openEvent';
import { useBlobUrl } from '../preview/useBlobUrl';
import { hides } from '../../privacy';
import type { DREvent } from '../../core/types';

function Figure({ id, className }: { id: string | null; className: string }) {
  const url = useBlobUrl(id);
  if (!url) return null;
  return <img className={className} src={url} alt="" />;
}

function pageText(event: DREvent, excerpt: string | undefined): string {
  if (excerpt) return excerpt;
  const text = markdownToText(event.content);
  if (text.length <= 160) return text;
  return `${text.slice(0, 160)}…`;
}

export function MemoirReader({
  memoirId,
  onBack,
  onEdit,
}: {
  memoirId: string;
  onBack: () => void;
  onEdit: () => void;
}) {
  const v = useVersion();
  const music = useMusic();
  const memoir = useMemo(() => getMemoir(memoirId), [memoirId, v]);
  // 隐私模式下，回忆录里夹带的隐私事件也一并藏起来
  const pages = useMemo(
    () => (memoir ? memoirPages(memoir).filter((p) => !p.event || !hides(p.event)) : []),
    [memoir, v],
  );
  const started = useRef(false);
  const [err, setErr] = useState<string | null>(null);

  const playlistId = memoir?.playlistId ?? null;
  const playlistFile = playlistId ? getPlaylistFile(playlistId) : null;
  const attached = !!playlistId && music.playlistId === playlistId;
  const playing = attached && music.playing;

  // 进阅读页自动起歌单；浏览器拦截自动播放时 runtime 会把 pendingPlay 标出来
  useEffect(() => {
    if (!playlistId) return;
    started.current = true;
    setErr(null);
    void openPlaylist(playlistId, { play: true }).catch((e) => {
      started.current = false;
      setErr(e instanceof Error ? e.message : String(e));
    });
    return () => {
      if (!started.current) return;
      const s = getMusicState();
      if (s.playlistId === playlistId && s.playing) toggle();
    };
  }, [playlistId]);

  /**
   * 播放按钮不能只调 toggle()：如果歌单没挂上（打开失败 / 在音乐页换成了别的歌单），
   * toggle 会去播「别的队列」，看起来就是点了没反应。这里先确保挂的是这本册子的歌单。
   */
  const play = async () => {
    setErr(null);
    if (!playlistId) return;
    if (!attached) {
      try {
        await openPlaylist(playlistId, { play: true });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    toggle();
  };

  if (!memoir) return <p className="muted">回忆录不存在或已删除。</p>;

  const coverId = memoirCoverId(memoir);
  const first = pages.find((p) => p.event)?.event;
  const last = [...pages].reverse().find((p) => p.event)?.event;
  const span = first && last
    ? first.startTs && last.startTs
      ? `${new Date(first.startTs).toLocaleDateString()} – ${new Date(last.startTs).toLocaleDateString()}`
      : ''
    : '';
  const problem = err ?? (attached ? music.error : null);

  return (
    <section className="memoir-read">
      <div className="memoir-toolbar memoir-read-bar">
        <button className="btn btn-sm" onClick={onBack}>
          ← 返回
        </button>
        <span className="memoir-toolbar-end">
          <button className="btn btn-sm" onClick={onEdit}>
            编辑
          </button>
        </span>
      </div>

      <header className="memoir-cover-head">
        <Figure id={coverId} className="memoir-cover-img" />
        <div className="memoir-cover-text">
          <h1 className="memoir-read-title">{memoir.title}</h1>
          {memoir.subtitle && <p className="memoir-read-sub">{memoir.subtitle}</p>}
          <p className="muted small">
            {pages.length} 个片段
            {span ? ` · ${span}` : ''}
          </p>
        </div>
      </header>

      {playlistId && (
        <div className="memoir-playlist">
          <span className="muted small">背景歌单</span>
          <strong>{playlistFile ? playlistFile.name.replace(/\.drpl$/i, '') : '歌单文件已不在文件库里'}</strong>
          {playlistFile && !(attached && music.tracks.length === 0) && (
            <button className="btn btn-sm" onClick={() => void play()}>
              {playing ? '暂停' : attached && music.pendingPlay ? '点击播放' : '播放'}
            </button>
          )}
          {attached && music.current && (
            <span className="muted small memoir-now" title={music.current.name}>
              {music.tracks.length} 首 · {music.current.name}
            </span>
          )}
          {attached && music.playlistMissing > 0 && music.tracks.length > 0 && (
            <span className="muted small">{music.playlistMissing} 首找不到文件</span>
          )}
          {attached && music.tracks.length === 0 && (
            <span className="muted small">
              歌单里的音频都找不到文件（{music.playlistMissing} 首），去「编辑」里重新挑几首。
            </span>
          )}
          {problem && <span className="small memoir-playlist-err">{problem}</span>}
        </div>
      )}

      <div className="memoir-body">
        {pages.map(({ page, event }, i) => {
          if (!event) {
            return (
              <article key={page.id} className="memoir-entry memoir-entry-missing">
                <span className="memoir-entry-no">{i + 1}</span>
                <p className="muted">这一页的原事件已删除。</p>
              </article>
            );
          }
          const img = page.coverFileId ?? eventImageIds(event)[0] ?? null;
          const text = pageText(event, page.excerpt);
          return (
            <article key={page.id} className="memoir-entry">
              <div className="memoir-entry-meta">
                <span className="memoir-entry-no">{i + 1}</span>
                <span>{formatTime(event.time)}</span>
                {event.place.name && <span>· {event.place.name}</span>}
              </div>
              <Figure id={img} className="memoir-entry-img" />
              <h2 className="memoir-entry-title">{event.title || '未命名事件'}</h2>
              {page.note && <p className="memoir-entry-note">{page.note}</p>}
              {text && <p className="memoir-entry-text">{text}</p>}
              <button
                className="memoir-source"
                title="打开原事件"
                onClick={() => openEvent(event.id)}
              >
                来自事件：{event.title || '未命名事件'} →
              </button>
            </article>
          );
        })}
      </div>

      {pages.length === 0 && <p className="muted">这本回忆录还没有页。</p>}
    </section>
  );
}
