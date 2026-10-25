// 编辑页里的「AI 写导语」按钮。
//
// 只做一件事：把还没手改的页交给模型，写导语与摘句，再并回同一份草稿。
// 手改过的页（page.edited）原样保留；事实字段完全不经过模型。
// 输入框里的提示词只影响语气与写法，不会被当成事实写进正文。

import { useState } from 'react';
import { generateMemoirPages } from '../../core/memoir/ai';
import { updateMemoir } from '../../core/repo/memoirs';
import { bump } from '../../store';
import type { Memoir } from '../../core/types';

export function AiMemoirButton({
  memoir,
  onApply,
}: {
  memoir: Memoir;
  onApply: (next: Memoir) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [hint, setHint] = useState('');

  const run = async () => {
    setBusy(true);
    setErr(null);
    setDone(false);
    try {
      const { pages, modelAlias } = await generateMemoirPages(memoir, { hint });
      updateMemoir(memoir.id, { pages, source: 'ai', aiModel: modelAlias });
      onApply({ ...memoir, pages, source: 'ai', aiModel: modelAlias });
      bump();
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="memoir-ai">
      <div className="memoir-ai-row">
        <button className="btn btn-sm" disabled={busy || memoir.pages.length === 0} onClick={() => void run()}>
          {busy ? 'AI 正在写…' : 'AI 写导语与摘句'}
        </button>
        <input
          className="memoir-ai-input"
          value={hint}
          placeholder="想怎么写？（可选）比如：克制一点、多写细节、少用形容词"
          onChange={(e) => setHint(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void run();
          }}
          disabled={busy}
        />
      </div>
      <span className="muted small">只写文字，不编事实；手改过的页会跳过。</span>
      {done && <span className="small memoir-ai-ok">已写入，可继续手改</span>}
      {err && <span className="small memoir-ai-err">{err}</span>}
    </div>
  );
}
