// 坚果云备份：通道状态 + 账号配置 + 立即同步 + 增量结果展示。
//
// 这一页要说清三件事，否则用户会以为「同步 = 整库重传」「报错就是账号问题」：
//   · 请求是谁发出去的——壳代发（无跨域问题）还是浏览器直连（必须配反代）
//   · 只传变化的分片（下面直接显示「上传 3 片 / 省下 27 片」）
//   · 附件二进制不进日常同步（另走「一次完整上传」）
import { useEffect, useState } from 'react';
import { Section, fmtMeta } from './Section';
import { bump } from '../../store';
import { currentChannel, type DavChannel } from '../../core/sync/nativeHttp';
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
  // null = 探测中（第一次调用 net.capabilities 要等壳回，最多 3 秒）
  const [channel, setChannel] = useState<DavChannel | null>(null);

  useEffect(() => {
    setStatus(getSyncStatus());
  }, []);

  useEffect(() => {
    let alive = true;
    currentChannel()
      .then((c) => alive && setChannel(c))
      .catch(() => alive && setChannel({ native: false, version: '' }));
    return () => {
      alive = false;
    };
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
      <p className={channel?.native ? 'sync-channel sync-channel-native' : 'sync-channel'}>
        {channel === null
          ? '传输通道：正在确认由谁发请求…'
          : channel.native
            ? `传输通道：由壳代发${channel.version ? `（壳 v${channel.version}）` : ''}，走系统网络栈，不受浏览器跨域限制，直连坚果云就行。`
            : '传输通道：浏览器直连。坚果云 WebDAV 不返回跨域头，这条路默认发不出去——装带网络代理的壳，或在下面「高级：服务地址」填一个反向代理。'}
      </p>

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
          默认直连 {DEFAULT_DAV_BASE}。在带网络代理的壳里这就够了（请求由壳发，没有跨域问题）。
          只有用浏览器同步时才需要换成转发到该地址的反向代理（例如 <code>https://你的反代/dav</code>）——
          仓库 <code>tools/nutstore-proxy/</code> 里有 Cloudflare Worker 与本地 Node 两份现成脚本，几分钟就能部署。
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
