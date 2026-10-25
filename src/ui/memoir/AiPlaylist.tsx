// 「AI 配乐」：把文件库里的音频列给模型 → 模型从里面挑 → 生成 .drpl 并挂到回忆录。
//
// 曲目全部来自本机文件库，所以挑出来的每一首都能直接播放；
// 结果先给用户看，确认后才写文件。

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
  const [hint, setHint] = useState('');
  const [result, setResult] = useState<PlaylistAiResult | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await suggestPlaylist(memoir, { hint }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result || result.picks.length === 0) return;
    setSaving(true);
    try {
      const file = await createPlaylist({
        name: result.name,
        description: result.description.slice(0, 500),
        tracks: result.picks.map((p) => p.file),
      });
      updateMemoir(memoir.id, { playlistId: file.id });
      onApply({ ...memoir, playlistId: file.id });
      bump();
      toast(`已生成歌单「${result.name}」，共 ${result.picks.length} 首`);
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
        <input
          className="memoir-ai-input"
          value={hint}
          placeholder="想要什么氛围？（可选）比如：安静的雨天、适合开车、别太吵"
          onChange={(e) => setHint(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void run();
          }}
          disabled={busy || saving}
        />
      </div>
      <div className="memoir-ai-row">
        <span className="muted small">
          先把文件库里的音频列给模型，再从这些曲目里挑；只挑库里有的，所以生成后都能直接播。
        </span>
        {memoir.playlistId && <span className="muted small">会替换当前选择的歌单（原歌单文件保留）</span>}
      </div>

      {err && <p className="small memoir-ai-err">{err}</p>}

      {result && (
        <div className="memoir-ai-panel">
          <div className="memoir-ai-panel-head">
            <strong>{result.name}</strong>
            <span className="muted small">
              曲库 {result.audioCount} 首 · 选中 {result.picks.length} 首
              {result.listedCount < result.audioCount ? `（只在列出的前 ${result.listedCount} 首里挑）` : ''}
            </span>
          </div>
          {result.description && <p className="muted small">{result.description}</p>}

          <div className="memoir-ai-songs">
            <span className="muted small">会写进歌单</span>
            <ul>
              {result.picks.map(({ file, reason }) => (
                <li key={file.id}>
                  <span className="memoir-ai-song">{file.name}</span>
                  {reason && <span className="muted small"> · {reason}</span>}
                </li>
              ))}
            </ul>
          </div>

          <div className="memoir-ai-row">
            <button
              className="btn btn-sm btn-primary"
              disabled={saving || result.picks.length === 0}
              onClick={() => void apply()}
            >
              {saving ? '生成中…' : `生成歌单（${result.picks.length} 首）`}
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
