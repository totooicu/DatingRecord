import { useEffect, useRef, useState } from 'react';
import { getBlob, type StoredFile } from '../../core/repo/files';
import { kindOf } from '../preview/kind';
import { fmtSize } from './fileFormat';
import { usePaged } from '../common/usePaged';
import { Paginator } from '../common/Paginator';
import { usePageSize } from '../prefs';

type Status = 'missing' | 'failed' | 'unknown' | 'ok';
type Result = { file: StoredFile; status: Status; reason: string; actual?: number };
const labels: Record<Status, string> = { missing: '内容丢失', failed: '打开失败', unknown: '无法验证', ok: '初步检查通过' };

async function inspect(file: StoredFile, signal: AbortSignal): Promise<Result> {
  const result = (status: Status, reason: string, actual?: number): Result => ({ file, status, reason, actual });
  if (file.sourceUrl) return result('unknown', '映射链接：未访问外部地址，无法确认内容是否存在');
  const blob = await getBlob(file.id);
  if (!blob) return result('missing', '记录存在，但本地找不到文件内容');
  const kind = kindOf(file.name, file.mime);
  if (!['image', 'audio', 'video', 'text', 'markdown'].includes(kind)) {
    return result('unknown', '内容存在，但此格式没有自动打开检测器', blob.size);
  }
  if (kind === 'text' || kind === 'markdown') {
    await blob.slice(0, 65536).text();
    return result('ok', '文本开头可读取（未校验全文）', blob.size);
  }
  if (signal.aborted) return result('unknown', '扫描已取消', blob.size);
  const element = kind === 'image' ? new Image() : document.createElement(kind === 'audio' ? 'audio' : 'video');
  if (element instanceof HTMLMediaElement && file.mime && file.mime !== 'application/octet-stream' && !element.canPlayType(file.mime)) {
    return result('unknown', '浏览器不支持声明的媒体格式，不代表文件损坏', blob.size);
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<Result>((resolve) => {
      const finish = (status: Status, reason: string) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        element.onload = null;
        element.onerror = null;
        if (element instanceof HTMLMediaElement) element.onloadeddata = null;
        resolve(result(status, reason, blob.size));
      };
      const cancel = () => finish('unknown', '扫描已取消');
      const timer = setTimeout(() => finish('unknown', '打开超时，无法确认是否损坏'), 12000);
      signal.addEventListener('abort', cancel, { once: true });
      element.onerror = () => {
        const unsupported = element instanceof HTMLMediaElement && element.error?.code === 4;
        finish(unsupported ? 'unknown' : 'failed', unsupported
          ? '格式或编码不受支持，也可能内容异常，无法确认损坏'
          : '浏览器无法解码打开；可能损坏或编码不兼容');
      };
      if (element instanceof HTMLMediaElement) {
        element.preload = 'auto';
        element.muted = true;
        element.onloadeddata = () => finish('ok', '首帧可读取（未验证完整播放）');
      } else element.onload = () => finish('ok', '图片可解码打开');
      element.src = url;
    });
  } finally {
    if (element instanceof HTMLMediaElement) {
      element.pause();
      element.removeAttribute('src');
      element.load();
    } else element.src = '';
    URL.revokeObjectURL(url);
  }
}

export function FileHealthSection({ files }: { files: StoredFile[] }) {
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<Status | 'issues' | 'all'>('issues');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const scan = async () => {
    if (controller.current) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setResults([]);
    setTotal(files.length);
    try {
      for (const file of files) {
        if (c.signal.aborted) break;
        let r: Result;
        try { r = await inspect(file, c.signal); }
        catch { r = { file, status: 'unknown', reason: '读取失败，请检查浏览器存储权限后重试' }; }
        if (!c.signal.aborted && mounted.current) setResults((previous) => [...previous, r]);
      }
    } finally {
      controller.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const visible = results.filter((r) => filter === 'all' || (filter === 'issues' ? r.status === 'missing' || r.status === 'failed' : r.status === filter));
  // 整库体检一次就是一文件一行，上千个文件必须分页；换筛选条件时回到第一页
  const pagedVisible = usePaged(visible, usePageSize());
  useEffect(() => {
    pagedVisible.setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  return (
    <section className="files-advanced file-health">
      <h4>扫描丢失 / 无法打开的文件</h4>
      <p className="muted small">只读检查，不修改或删除文件。逐个检测图片解码、音视频首帧；不保证完整播放。映射链接和不支持的格式单列为无法验证。结果是扫描时的快照，修复后请重新扫描。</p>
      <div className="row-actions">
        <button className="btn btn-sm" disabled={busy} onClick={() => void scan()}>开始扫描</button>
        {busy && <button className="btn btn-sm" onClick={() => controller.current?.abort()}>停止扫描</button>}
        <span role="status">{busy ? '扫描中' : '已检查'} {results.length} / {total}</span>
      </div>
      <label>扫描结果筛选{' '}
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="issues">丢失或打开失败</option>
          <option value="missing">内容丢失</option><option value="failed">打开失败</option>
          <option value="unknown">无法验证 / 不支持</option><option value="all">全部结果</option>
        </select>
      </label>
      <p className="muted small">{(['missing', 'failed', 'unknown', 'ok'] as Status[]).map((s) => `${labels[s]} ${results.filter((r) => r.status === s).length}`).join(' · ')}</p>
      {pagedVisible.pageItems.map((r) => <div className="dup-group" key={r.file.id}>
        <strong style={{ overflowWrap: 'anywhere' }}>{r.file.name}</strong>
        <p className="small" style={{ overflowWrap: 'anywhere' }}>hash：{r.file.sha256 || '未记录'}<br />记录大小：{fmtSize(r.file.size)}（{r.file.size} 字节）{r.actual !== undefined && <> · 实际大小：{fmtSize(r.actual)}（{r.actual} 字节）</>}</p>
        <p className="small">{labels[r.status]}：{r.reason}</p>
      </div>)}
      <Paginator paged={pagedVisible} />
      {!busy && results.length > 0 && !visible.length && <p className="muted">当前筛选下没有结果；请同时查看“无法验证”。</p>}
    </section>
  );
}
