// 添加映射文件：把一条链接当成文件用，正文引用和普通附件完全一样。
//
// 面板上的六个动作对应用户的原话：
//   测试连接   —— HEAD/GET 探一下，能读到类型和大小
//   获取文件名 —— Content-Disposition 优先，其次 URL 最后一段；取不到就让人手写
//   hash 链接名 —— 按链接算引用名（link-…），映射文件不下载内容也能有稳定名字
//   hash 实体文件 —— 下载一份算内容 hash（sha-…），顺便把大小/类型填上
//   保存为映射 —— 只落一行元数据 + 链接，不占存储
//   保存为实体 —— 下载后交给正常上传流程（判重、落 IndexedDB 都走原路）
import { useEffect, useRef, useState } from 'react';
import {
  downloadLink,
  fileNameFromLink,
  guessMime,
  isAppLink,
  isScriptLink,
  linkStoredId,
  normalizeLink,
  probeLink,
  saveAsMapping,
  schemeOf,
  sha256Hex,
  type LinkProbe,
} from '../../core/files';
import { Field, Modal } from '../common';
import { fmtSize } from './fileFormat';

type Busy = '' | 'test' | 'name' | 'link' | 'entity' | 'saveMap' | 'saveEntity';

interface EntityInfo {
  blob: Blob;
  sha256: string;
  mime: string;
  size: number;
  fileName: string;
}

export function MappingModal({
  onClose,
  onSaved,
  onSaveEntity,
}: {
  onClose: () => void;
  onSaved: (text: string) => void;
  /** 下载好的实体文件交给上传流程（判重/落库由调用方负责） */
  onSaveEntity: (file: File) => void;
}) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [probe, setProbe] = useState<LinkProbe | null>(null);
  const [linkId, setLinkId] = useState('');
  const [entity, setEntity] = useState<EntityInfo | null>(null);
  const [busy, setBusy] = useState<Busy>('');
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [proc, setProc] = useState<{ loaded: number; total: number } | null>(null);
  const ctlRef = useRef<AbortController | null>(null);
  const progAt = useRef(0);

  const mimeOf = (n = name) => guessMime(n, probe?.mime);

  // 弹窗关掉（点 ×、点遮罩、切页面）时把还挂着的下载一起掐断
  useEffect(() => () => ctlRef.current?.abort('cancelled'), []);

  const downloading = busy === 'entity' || busy === 'saveEntity';

  const cancelDownload = () => ctlRef.current?.abort('cancelled');

  const run = async (kind: Busy, fn: () => Promise<string | void>) => {
    setBusy(kind);
    setErr(null);
    try {
      const msg = await fn();
      if (msg) setNote(msg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '操作失败';
      // 用户主动取消不算错误，别用红色警示吓人
      if (msg === '已取消下载') setNote(msg);
      else setErr(msg);
    } finally {
      setBusy('');
    }
  };

  /** 下载并算 hash；signal 让「取消下载」在读取和算 hash 之间都能生效 */
  const downloadEntity = async (): Promise<EntityInfo> => {
    const ctl = new AbortController();
    ctlRef.current = ctl;
    progAt.current = 0;
    setProc({ loaded: 0, total: 0 });
    try {
      const d = await downloadLink(url, {
        signal: ctl.signal,
        onProgress: (loaded, total) => {
          // 大文件分片很密，节流到 ~7 帧/秒，别让进度条把主线程拖住
          const now = Date.now();
          if (loaded === total || now - progAt.current > 150) {
            progAt.current = now;
            setProc({ loaded, total });
          }
        },
      });
      const sha = await sha256Hex(d.blob);
      if (ctl.signal.aborted) throw new Error('已取消下载');
      const n = name.trim() || d.fileName || probe?.fileName || fileNameFromLink(d.finalUrl);
      return {
        blob: d.blob,
        sha256: sha,
        mime: d.mime || mimeOf(n),
        size: d.blob.size,
        fileName: n,
      };
    } finally {
      ctlRef.current = null;
      setProc(null);
    }
  };

  const testLink = () =>
    run('test', async () => {
      const p = await probeLink(url);
      setProbe(p);
      if (!p.ok) throw new Error(p.error || `连接失败：HTTP ${p.status}`);
      if (!name.trim() && p.fileName) setName(p.fileName);
      return `连接成功：HTTP ${p.status}${p.mime ? ` · ${p.mime}` : ''}${p.size ? ` · ${fmtSize(p.size)}` : ''}`;
    });

  const fetchName = () =>
    run('name', async () => {
      const target = normalizeLink(url);
      const found = probe?.fileName || fileNameFromLink(target);
      if (!found) throw new Error('链接里取不到文件名，请手动填写');
      setName(found);
      return `文件名：${found}`;
    });

  const hashLink = () =>
    run('link', async () => {
      const target = normalizeLink(url);
      const n = name.trim() || probe?.fileName || fileNameFromLink(target);
      const id = await linkStoredId(target, n, mimeOf(n));
      setLinkId(id);
      if (!name.trim() && n) setName(n);
      // 结果单独一行展示，不再塞进 note，避免同一句话出现两次
    });

  const hashEntity = () =>
    run('entity', async () => {
      const info = await downloadEntity();
      setEntity(info);
      if (!name.trim() && info.fileName) setName(info.fileName);
      setProbe((p) =>
        p ?? { ok: true, status: 200, mime: info.mime, size: info.size, fileName: info.fileName, finalUrl: url },
      );
      return `实体文件：${fmtSize(info.size)}${info.sha256 ? ` · SHA-256 ${info.sha256.slice(0, 12)}…` : ''}`;
    });

  const saveMapping = () =>
    run('saveMap', async () => {
      const n = name.trim() || probe?.fileName || fileNameFromLink(normalizeLink(url));
      if (!n) throw new Error('请填写文件名');
      const res = await saveAsMapping({
        url,
        name: n,
        mime: mimeOf(n),
        size: entity?.size ?? probe?.size ?? 0,
        sha256: entity?.sha256 ?? '',
      });
      const extra = isAppLink(url) ? '，点开时交给手机上的 App' : '';
      if (res.reused) {
        onSaved(`这个链接已经在文件库里：「${res.file.name}」，直接复用`);
      } else {
        onSaved(`已保存映射文件「${res.file.name}」（只存链接，不占空间${extra}）`);
      }
      onClose();
    });

  const saveEntity = () =>
    run('saveEntity', async () => {
      const info = entity ?? (await downloadEntity());
      if (!entity) setEntity(info);
      const n = name.trim() || info.fileName;
      if (!n) throw new Error('请填写文件名');
      const file = new File([info.blob], n, { type: info.mime || mimeOf(n) });
      onSaveEntity(file);
      onClose();
    });

  // javascript: / vbscript: 会被浏览器当脚本执行，任何入口都不收
  const scriptLink = isScriptLink(url);
  const canAct = !!url.trim() && !busy && !scriptLink;
  // App 深链（qqmusic://…）：浏览器 fetch 不到也下载不了，只能存成映射交给手机上的 App
  const appLink = isAppLink(url);
  const appScheme = schemeOf(url);

  return (
    <Modal
      title="添加映射文件"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-ghost"
            onClick={() => {
              cancelDownload();
              onClose();
            }}
            disabled={!!busy && !downloading}
          >
            取消
          </button>
          <button className="btn" onClick={() => void saveMapping()} disabled={!canAct}>
            {busy === 'saveMap' ? '保存中…' : '保存为映射'}
          </button>
          <button className="btn btn-primary" onClick={() => void saveEntity()} disabled={!canAct || appLink}>
            {busy === 'saveEntity' ? '下载中…' : '保存为实体文件'}
          </button>
        </>
      }
    >
      <p className="muted small">
        库存链接、不存内容：适合网盘、图床、局域网目录里的素材，也支持 App 深链（qqmusic://、weixin:// 等，
        点开时交给手机上的 App）。正文引用与普通附件一致（file:引用名）。
      </p>
      <Field label="链接" hint="https / ftp / file://、手机路径，或 App 深链（qqmusic://…）">
        <input
          className="input"
          placeholder="https://…、/storage/emulated/0/… 或 qqmusic://…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setProbe(null);
            setLinkId('');
            setEntity(null);
          }}
        />
      </Field>
      <Field label="文件名" hint="取不到就手写；决定图标类型与扩展名">
        <input
          className="input"
          placeholder="例如 旅行照片.jpg"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      {scriptLink && <p className="warn-line">不支持的协议（{appScheme}）：会被浏览器当脚本执行，不能保存</p>}
      {appLink && (
        <p className="muted small">
          应用链接（{appScheme}）：只能「保存为映射」，点开时交给手机上的 App（如 QQ 音乐、微信）；
          浏览器既探测不了也下载不了，所以测试连接与实体文件两项不可用。
        </p>
      )}

      <div className="mapping-actions">
        <button className="btn btn-sm" onClick={() => void testLink()} disabled={!canAct || appLink}>
          {busy === 'test' ? '测试中…' : '测试连接'}
        </button>
        <button className="btn btn-sm" onClick={() => void fetchName()} disabled={!canAct}>
          {busy === 'name' ? '读取中…' : '获取文件名'}
        </button>
        <button className="btn btn-sm" onClick={() => void hashLink()} disabled={!canAct}>
          {busy === 'link' ? '计算中…' : 'hash 链接名'}
        </button>
        <button className="btn btn-sm" onClick={() => void hashEntity()} disabled={!canAct || appLink}>
          {busy === 'entity' ? '下载中…' : 'hash 实体文件'}
        </button>
      </div>

      {downloading && (
        <p className="muted small mapping-progress">
          <span>
            {proc
              ? proc.total
                ? `已下载 ${fmtSize(proc.loaded)} / ${fmtSize(proc.total)}`
                : `已下载 ${fmtSize(proc.loaded)}`
              : '下载完成，正在计算 hash…'}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={cancelDownload}>
            取消下载
          </button>
        </p>
      )}

      {linkId && <p className="muted small">链接引用名：{linkId}</p>}
      {entity && (
        <p className="muted small">
          实体：{fmtSize(entity.size)}
          {entity.mime ? ` · ${entity.mime}` : ''}
          {entity.sha256 ? ` · sha-${entity.sha256.slice(0, 16)}…` : ''}
        </p>
      )}
      {note && <p className="muted small">{note}</p>}
      {err && <p className="warn-line">{err}</p>}
    </Modal>
  );
}
