// 文件预览弹窗：按类型分发到对应视图
import { useEffect } from 'react';
import { Modal } from '../common';
import { downloadFile, openInTab, urlForFile } from '../../core/repo/files';
import { showToast } from '../toast';
import type { StoredFile } from '../../core/repo/files';
import { kindLabel, kindOf } from './kind';
import { AudioView, ImageView, VideoView } from './MediaView';
import { TextView } from './TextView';
import { MarkdownPreview } from './MarkdownPreview';
import { PlaylistPreview } from './PlaylistPreview';
import { LocationPreview } from './LocationPreview';
import { UnknownView } from './UnknownView';

export function PreviewModal({ file, onClose }: { file: StoredFile; onClose: () => void }) {
  const kind = kindOf(file.name, file.mime);

  // 预览里也支持 Esc 关闭：底部抽屉铺满屏幕时，找那个 × 挺费劲
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveAs = async () => {
    const url = await urlForFile(file.id);
    if (!url) return;
    // 壳里存「下载」、浏览器里弹下载，失败要把原因说出来（以前是静默什么也没发生）
    try {
      await downloadFile(url, file.name, file.mime);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 2600);
    }
  };

  return (
    <Modal
      media
      title={`${kindLabel(kind)} · ${file.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
          <button className="btn" onClick={() => void saveAs()}>
            下载
          </button>
          <button
            className="btn"
            onClick={() => {
              void urlForFile(file.id).then((u) => u && openInTab(u));
            }}
          >
            新标签页打开
          </button>
        </>
      }
    >
      {kind === 'image' && <ImageView id={file.id} name={file.name} mime={file.mime} />}
      {kind === 'video' && <VideoView id={file.id} name={file.name} mime={file.mime} />}
      {kind === 'audio' && <AudioView id={file.id} name={file.name} mime={file.mime} />}
      {kind === 'location' && <LocationPreview file={file} />}
      {kind === 'playlist' && <PlaylistPreview file={file} />}
      {kind === 'markdown' && <MarkdownPreview id={file.id} name={file.name} mime={file.mime} />}
      {kind === 'text' && <TextView id={file.id} name={file.name} mime={file.mime} />}
      {kind === 'unknown' && <UnknownView id={file.id} name={file.name} mime={file.mime} />}
    </Modal>
  );
}
