// 导入 / 导出：只走 .drp.zip（library.json + 附件原文件 + manifest）。
// 纯文本 JSON 不再产出；旧的 .json 备份只能走 CLI 导入，迁移老文件用。
import { useRef, useState } from 'react';
import { importFromFile } from '../../core/io';
import { exportArchiveToFile } from '../../core/io';
import { getMeta } from '../../core/db';
import { FilePickInput } from '../common';
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
      desc="导出 .drp.zip：库数据 + 附件原文件打包，方便传网盘 / 同步。"
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
      </div>

      <div className="row-actions">
        <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}>
          <option value="merge">合并导入（按 hlc 比较，本地更新的不会被覆盖）</option>
          <option value="replace">替换导入（清空后写入，会先自动导出一份备份）</option>
        </select>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          选择文件导入
        </button>
        <FilePickInput
          inputRef={fileRef}
          accept=".zip,.drp.zip,application/zip"
          onFiles={(files) => void doImport(files[0])}
        />
      </div>

      {result && <div className="alert alert-ok">{result}</div>}
      {error && <div className="alert alert-err">{error}</div>}

      {/* 分享在「备份与分享 → 分享」那一页：只带一段故事，和整库备份不是一回事 */}

      <p className="muted small">
        上次导入：{fmtMeta(getMeta('last_import_at'))}　·　上次打开：{fmtMeta(getMeta('last_opened_at'))}
      </p>
    </Section>
  );
}
