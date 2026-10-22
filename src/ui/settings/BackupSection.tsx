// 导入 / 导出：默认导出 .drp.zip（library.json + 附件原文件 + manifest），
// 也保留 .drp.json（纯文本可 diff）。导入两种格式都认。
import { useRef, useState } from 'react';
import { exportToFile, importFromFile } from '../../core/io';
import { exportArchiveToFile } from '../../core/io';
import { getMeta } from '../../core/db';
import { Section, fmtMeta } from './Section';
import { bump } from '../../store';

export function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [withAttachments, setWithAttachments] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doImport = async (file: File) => {
    setError(null);
    setResult(null);
    try {
      const r = await importFromFile(file, importMode);
      bump();
      setResult(
        `导入完成（${r.mode === 'merge' ? '合并' : '替换'}）：` +
          `属性 ${r.counts.defs}、人物 ${r.counts.persons}、事件 ${r.counts.events}、` +
          `事件集 ${r.counts.collections}、成员 ${r.counts.members}；跳过 ${r.skipped}（本地更新）` +
          (r.backupName ? `。已自动备份：${r.backupName}` : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** 导出期间锁按钮：大库打包要几秒，连点会重复下载 */
  const runExport = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="数据备份（导入 / 导出）"
      desc="默认导出 .drp.zip：库数据 + 附件原文件打包，比内联 JSON 小得多，方便传网盘/同步。也保留纯文本 JSON（可 diff、可进 git）。"
    >
      <div className="row-actions">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={withAttachments}
            onChange={(e) => setWithAttachments(e.target.checked)}
          />
          包含附件（原文件打包进压缩包）
        </label>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void runExport(() => exportArchiveToFile({ includeAttachments: withAttachments }))}
        >
          {busy ? '打包中…' : '导出备份（.zip）'}
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void runExport(() => exportToFile({ includeAttachments: withAttachments }))}
          title="纯文本、可 diff；附件会以 base64 内联，文件较大"
        >
          导出 JSON
        </button>
      </div>

      <div className="row-actions">
        <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}>
          <option value="merge">合并导入（按 hlc 比较，本地更新的不会被覆盖）</option>
          <option value="replace">替换导入（清空后写入，会先自动导出一份备份）</option>
        </select>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          选择文件导入
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.drp.zip,.json,.drp.json,application/zip,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
        />
      </div>

      {result && <div className="alert alert-ok">{result}</div>}
      {error && <div className="alert alert-err">{error}</div>}
      <p className="muted small">
        上次导入：{fmtMeta(getMeta('last_import_at'))}　·　上次打开：{fmtMeta(getMeta('last_opened_at'))}
      </p>
    </Section>
  );
}
