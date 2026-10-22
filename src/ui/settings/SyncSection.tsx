// 坚果云备份：账号配置 + 立即同步 + 增量结果展示。
//
// 这一页要说清两件事，否则用户会以为「同步 = 整库重传」：
//   · 只传变化的分片（下面直接显示「上传 3 片 / 省下 27 片」）
//   · 附件二进制不进日常同步（另走「一次完整上传」）
import { useEffect, useState } from 'react';
import { Section, fmtMeta } from './Section';
import { bump } from '../../store';
import {
  DEFAULT_DAV_BASE,
  getSyncStatus,
  isConfigured,
  loadSettings,
  saveSettings,
  syncNow,
  testConnection,
  toConfig,
  type NutstoreSettings,
  type SyncResult,
} from '../../core/sync';

const ACTION_TEXT: Record<SyncResult['action'], string> = {
  upload: '已上传本地改动',
  download: '已下载云端改动',
  both: '两边都有改动，已合并后上传',
  noop: '云端与本地一致，未传输数据',
};

export function SyncSection() {
  const [s, setS] = useState<NutstoreSettings>(() => loadSettings());
  const [busy, setBusy] = useState<'' | 'test' | 'sync'>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [status, setStatus] = useState(() => getSyncStatus());
  const [progress, setProgress] = useState('');

  useEffect(() => {
    setStatus(getSyncStatus());
  }, []);

  const patch = (p: Partial<NutstoreSettings>) => setS((old) => ({ ...old, ...p }));

  const doSave = () => {
    saveSettings(s);
    setMsg('已保存');
    setErr(null);
  };

  const doTest = async () => {
    setBusy('test');
    setErr(null);
    setMsg(null);
    try {
      saveSettings(s);
      await testConnection(toConfig(s));
      setMsg('连接正常，应用目录已就绪');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const doSync = async (full: boolean) => {
    setBusy('sync');
    setErr(null);
    setMsg(null);
    setProgress('');
    try {
      saveSettings(s);
      const r = await syncNow(toConfig(s), { full, onProgress: setProgress });
      setResult(r);
      setStatus(getSyncStatus());
      if (r.action === 'download' || r.action === 'both') bump();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
      setProgress('');
    }
  };

  const ready = isConfigured(s);

  return (
    <Section
      title="坚果云备份"
      desc="把库同步到坚果云的 WebDAV 目录。按内容分片上传，只传变化的那几片，不改动的内容不会重复占用上行带宽。"
    >
      <label className="field">
        <span className="field-label">坚果云账号（邮箱）</span>
        <input
          value={s.user}
          placeholder="you@example.com"
          autoComplete="username"
          onChange={(e) => patch({ user: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">应用密码</span>
        <input
          type="password"
          value={s.password}
          placeholder="坚果云 → 账户信息 → 安全选项 → 添加应用密码"
          autoComplete="current-password"
          onChange={(e) => patch({ password: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">远端目录</span>
        <input value={s.folder} onChange={(e) => patch({ folder: e.target.value })} />
      </label>

      <details className="sync-advanced">
        <summary>高级：服务地址</summary>
        <label className="field">
          <span className="field-label">WebDAV 地址</span>
          <input
            value={s.base}
            placeholder={DEFAULT_DAV_BASE}
            onChange={(e) => patch({ base: e.target.value })}
          />
        </label>
        <p className="muted small">
          默认直连 {DEFAULT_DAV_BASE}。坚果云不返回跨域许可，若浏览器拦下请求，
          填一个转发到该地址的反向代理（例如 <code>https://your-proxy/dav</code>）。
        </p>
      </details>

      <label className="checkbox">
        <input type="checkbox" checked={s.auto} onChange={(e) => patch({ auto: e.target.checked })} />
        打开应用时自动同步一次
      </label>

      <div className="row-actions">
        <button className="btn" onClick={doSave}>
          保存设置
        </button>
        <button className="btn" disabled={!ready || busy !== ''} onClick={() => void doTest()}>
          {busy === 'test' ? '测试中…' : '测试连接'}
        </button>
        <button
          className="btn btn-primary"
          disabled={!ready || busy !== ''}
          onClick={() => void doSync(false)}
        >
          {busy === 'sync' ? progress || '同步中…' : '立即同步'}
        </button>
      </div>

      <div className="row-actions">
        <button className="btn" disabled={!ready || busy !== ''} onClick={() => void doSync(true)}>
          强制完整上传（换机建档用）
        </button>
        <span className="muted small">上次同步：{fmtMeta(status.lastAt)}</span>
      </div>

      {msg && <p className="sync-ok">{msg}</p>}
      {err && <p className="sync-err">{err}</p>}

      {result && (
        <div className="sync-result">
          <p>
            <strong>{ACTION_TEXT[result.action]}</strong>
            {result.merged && (
              <span className="muted small">
                {' '}
                （合并：人物 {result.merged.persons}、事件 {result.merged.events}、事件集{' '}
                {result.merged.collections}；跳过 {result.merged.skipped}）
              </span>
            )}
          </p>
          <table className="sync-table">
            <tbody>
              <tr>
                <td>本次上传</td>
                <td>
                  {result.uploadedChunks} 片 · {kb(result.uploadedBytes)}
                </td>
              </tr>
              <tr>
                <td>因未变化而跳过</td>
                <td>
                  {result.savedChunks} 片 · {kb(result.savedBytes)}
                </td>
              </tr>
              <tr>
                <td>本次下载</td>
                <td>{kb(result.downloadedBytes)}</td>
              </tr>
              <tr>
                <td>库快照大小</td>
                <td>{kb(result.totalBytes)}</td>
              </tr>
            </tbody>
          </table>
          {result.savedBytes > 0 && (
            <p className="muted small">
              相比整份覆盖上传，这次少传了{' '}
              <strong>{pct(result.savedBytes, result.totalBytes)}</strong>。
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function kb(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
