// 适配测试：文件写入两张卡——私有目录（APP 自己的沙盒，不需要权限）与公共目录（Downloads，
// 走 MediaStore 那套）。壳里这两条路完全不同，失败时一边是路径问题、一边是权限问题。
//
// 只读写壳给的测试文件，不碰本项目的库与附件。
import { useState } from 'react';

import { invoke } from '../../core/compat/bridge';
import { CompatCard, CompatRow, CompatStatus } from './ui';
import { useBridgeStatus } from './useBridgeStatus';

/** 私有目录 */
export function FilePrivateCard() {
  const status = useBridgeStatus('filePrivate', '未测试');
  const [name, setName] = useState('log.txt');
  const [content, setContent] = useState('hello private');

  const call = async (action: string, params: Record<string, unknown>, okText: (r: Record<string, unknown>) => string) => {
    status.wait(`${action} …`);
    try {
      const r = await invoke(action, params);
      status.ok(okText(r));
    } catch (e) {
      status.fail(`${action} 失败：${(e as Error).message}`);
    }
  };

  return (
    <CompatCard title="文件写入 · 私有目录（无权限）" desc="写进壳自己的 files 目录；这条不通，多半是路径或桥没起来。">
      <CompatRow>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="文件名" aria-label="私有文件名" />
        <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="内容" aria-label="私有文件内容" />
      </CompatRow>
      <CompatRow>
        <button
          className="btn btn-primary"
          onClick={() =>
            void call('file.writePrivate', { name, content }, (r) => `已写入私有目录：${r.path ?? ''}（${r.size ?? '?'}B）`)
          }
        >
          写入
        </button>
        <button
          className="btn"
          onClick={() =>
            void call('file.appendPrivate', { name, content: `${content}\n` }, (r) => `已追加：${r.path ?? ''}（${r.size ?? '?'}B）`)
          }
        >
          追加
        </button>
        <button
          className="btn"
          onClick={() => void call('file.readPrivate', { name }, (r) => `读取：${String(r.content ?? '')}`)}
        >
          读取
        </button>
        <button className="btn" onClick={() => void call('file.listPrivate', {}, (r) => `列表：${JSON.stringify(r.files ?? [])}`)}>
          列表
        </button>
        <button
          className="btn"
          onClick={() => void call('file.deletePrivate', { name }, (r) => `删除结果：${r.deleted ? '已删除' : '未找到'}`)}
        >
          删除
        </button>
      </CompatRow>
      <CompatStatus state={status.state} text={status.text} />
    </CompatCard>
  );
}

/** 公共目录（Downloads） */
export function FilePublicCard() {
  const status = useBridgeStatus('filePublic', '未测试');
  const [name, setName] = useState('report.txt');
  const [content, setContent] = useState('hello public');
  // 公共目录的读取/删除只认 uri，所以记住最后一次写入的那一个
  const [lastUri, setLastUri] = useState('');

  const call = async (action: string, params: Record<string, unknown>, okText: (r: Record<string, unknown>) => string) => {
    status.wait(`${action} …`);
    try {
      const r = await invoke(action, params);
      status.ok(okText(r));
      return r;
    } catch (e) {
      status.fail(`${action} 失败：${(e as Error).message}`);
      return null;
    }
  };

  return (
    <CompatCard title="文件写入 · 公共目录（Downloads）" desc="写进系统下载目录，要 MediaStore 权限；读取与删除按 uri 走。">
      <CompatRow>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="文件名" aria-label="公共文件名" />
        <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="内容" aria-label="公共文件内容" />
      </CompatRow>
      <CompatRow>
        <button
          className="btn btn-primary"
          onClick={() => {
            void call('file.writePublic', { name, content, mime: 'text/plain' }, (r) => {
              const uri = String(r.uri ?? r.path ?? '');
              setLastUri(uri);
              return `已写入公共目录：${uri}`;
            });
          }}
        >
          写入
        </button>
        <button
          className="btn"
          onClick={() => {
            if (!lastUri) {
              status.fail('先写入一个公共文件，读取只认最后写入的 uri');
              return;
            }
            void call('file.readPublic', { uri: lastUri }, (r) => `读取：${String(r.content ?? '')}`);
          }}
        >
          读取（最后写入）
        </button>
        <button
          className="btn"
          onClick={() => {
            if (!lastUri) {
              status.fail('先写入一个公共文件，删除只认最后写入的 uri');
              return;
            }
            void call('file.deletePublic', { uri: lastUri }, (r) => {
              setLastUri('');
              return `删除结果：${r.deleted ? '已删除' : '未找到'}`;
            });
          }}
        >
          删除（最后写入）
        </button>
      </CompatRow>
      <CompatStatus state={status.state} text={status.text} />
    </CompatCard>
  );
}
