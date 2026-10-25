// 文件预览弹窗：按类型分发到对应视图
import { useEffect } from 'react';
import { Modal } from '../common';
import { downloadFile, openInTab, urlForFile } from '../../core/repo/files';
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
    if (url) downloadFile(url, file.name);
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
