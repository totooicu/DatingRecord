// 「AI 配乐」：给建议 → 在库里匹配 → 生成 .drpl 并挂到回忆录。
//
// 匹配结果先给用户看，确认后才写文件：命中的会成为可播放曲目，
// 未命中的留在清单里，提示用户把对应音频导进文件库。

import { useState } from 'react';
import { suggestPlaylist, type PlaylistAiResult } from '../../core/memoir/playlistAi';
import { createPlaylist } from '../../core/music/playlistFile';
import { updateMemoir } from '../../core/repo/memoirs';
import { bump } from '../../store';
import { showToast as toast } from '../toast';
import type { Memoir } from '../../core/types';

export function AiPlaylistButton({
  memoir,
  onApply,
}: {
  memoir: Memoir;
  onApply: (next: Memoir) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<PlaylistAiResult | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await suggestPlaylist(memoir));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result || result.matched.length === 0) return;
    setSaving(true);
    try {
      const unmatchedNote = result.unmatched.length
        ? `｜未匹配 ${result.unmatched.length} 首：${result.unmatched
            .slice(0, 8)
            .map((s) => s.title)
            .join('、')}`
        : '';
      const file = await createPlaylist({
        name: result.name,
        description: `${result.description}${unmatchedNote}`.slice(0, 500),
        tracks: result.matched.map((m) => m.file),
      });
      updateMemoir(memoir.id, { playlistId: file.id });
      onApply({ ...memoir, playlistId: file.id });
      bump();
      toast(`已生成歌单「${result.name}」，命中 ${result.matched.length} 首`);
      setResult(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="memoir-ai memoir-ai-playlist">
      <div className="memoir-ai-row">
        <button className="btn btn-sm" disabled={busy || saving || memoir.pages.length === 0} onClick={() => void run()}>
          {busy ? 'AI 正在选曲…' : 'AI 配乐'}
        </button>
        <span className="muted small">
          按事件氛围给建议，再在文件库里找对应的音频；只把能找到的写成歌单。
        </span>
        {memoir.playlistId && <span className="muted small">会替换当前选择的歌单（原歌单文件保留）</span>}
      </div>

      {err && <p className="small memoir-ai-err">{err}</p>}

      {result && (
        <div className="memoir-ai-panel">
          <div className="memoir-ai-panel-head">
            <strong>{result.name}</strong>
            <span className="muted small">
              建议 {result.matched.length + result.unmatched.length} 首 · 库里命中 {result.matched.length} 首
            </span>
          </div>
          {result.description && <p className="muted small">{result.description}</p>}

          {result.audioCount === 0 && (
            <p className="small memoir-ai-warn">
              文件库里还没有音频文件，所以一首也匹配不上。先把歌导入「文件库」，再回来点「重新生成」。
            </p>
          )}

          {result.matched.length > 0 && (
            <div className="memoir-ai-songs">
              <span className="muted small">会写进歌单</span>
              <ul>
                {result.matched.map(({ song, file }) => (
                  <li key={file.id}>
                    <span className="memoir-ai-song">{song.title}</span>
                    {song.artist && <span className="muted small"> — {song.artist}</span>}
                    <span className="muted small"> · {file.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.unmatched.length > 0 && (
            <div className="memoir-ai-songs">
              <span className="muted small">库里没找到（导入对应音频后会匹配上）</span>
              <ul>
                {result.unmatched.map((s) => (
                  <li key={`${s.title}-${s.artist}`}>
                    <span className="muted small">{s.title}</span>
                    {s.artist && <span className="muted small"> — {s.artist}</span>}
                    {s.reason && <span className="muted small"> · {s.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="memoir-ai-row">
            <button
              className="btn btn-sm btn-primary"
              disabled={saving || result.matched.length === 0}
              onClick={() => void apply()}
            >
              {saving ? '生成中…' : `生成歌单（${result.matched.length} 首）`}
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => void run()}>
              重新生成
            </button>
            <button className="btn btn-sm" onClick={() => setResult(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
