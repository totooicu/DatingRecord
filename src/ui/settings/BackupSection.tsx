// 导入 / 导出：单文件 .drp.json，纯文本可 diff
import { useRef, useState } from 'react';
import { exportToFile, importLibrary } from '../../core/io';
import { getMeta } from '../../core/db';
import { Section, fmtMeta } from './Section';
import { bump } from '../../store';

export function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [withAttachments, setWithAttachments] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doImport = async (file: File) => {
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const r = await importLibrary(text, importMode);
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

  return (
    <Section
      title="数据备份（导入 / 导出）"
      desc="导出为单文件 .drp.json：纯文本、可 diff、可放进 git 做版本管理。建议定期导出到网盘。"
    >
      <div className="row-actions">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={withAttachments}
            onChange={(e) => setWithAttachments(e.target.checked)}
          />
          包含附件（图片等，会让文件变大）
        </label>
        <button className="btn btn-primary" onClick={() => void exportToFile({ includeAttachments: withAttachments })}>
          导出备份文件
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
          accept=".json,.drp.json,application/json"
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
