// 头像选择器：从文件库选择或上传新图片
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../common';
import { uploadFileQuiet } from '../../core/files';
import { getSmallLimit } from '../filePrefs';
import { listFiles, urlForFile } from '../../core/repo/files';
import { updatePerson } from '../../core/repo/persons';
import { useVersion, bump } from '../../store';

interface AvatarPickerProps {
  personId: string;
  currentAvatar?: string | null;
  onClose: () => void;
}

export function AvatarPicker({ personId, currentAvatar, onClose }: AvatarPickerProps) {
  const v = useVersion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const files = useMemo(() => {
    return listFiles().filter((f) => f.mime.startsWith('image/'));
  }, [v]);

  // 加载缩略图
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        files.map(async (f) => {
          const url = await urlForFile(f.id);
          if (url) next[f.id] = url;
        }),
      );
      if (alive) setThumbs(next);
    })();
    return () => {
      alive = false;
    };
  }, [files]);

  const pick = (fileId: string) => {
    updatePerson(personId, { avatar: `file:${fileId}` });
    bump();
    onClose();
  };

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      const saved = await uploadFileQuiet(list[0], getSmallLimit());
      pick(saved.id);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = () => {
    updatePerson(personId, { avatar: null });
    bump();
    onClose();
  };

  return (
    <Modal title="设置头像" onClose={onClose}>
      <div className="avatar-picker">
        {/* 当前头像 */}
        {currentAvatar && (
          <div className="avatar-picker-current">
            <span className="muted small">当前头像</span>
            <button className="btn btn-ghost btn-sm" onClick={remove}>
              移除
            </button>
          </div>
        )}

        {/* 上传按钮 */}
        <div className="avatar-picker-upload">
          <label className="btn btn-primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? '上传中…' : '上传图片'}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => upload(e.target.files)}
              style={{ display: 'none' }}
            />
          </label>
          <span className="muted small">上传后自动设为头像</span>
        </div>

        {/* 文件库图片 */}
        {files.length > 0 ? (
          <div>
            <div className="muted small" style={{ marginBottom: 8 }}>
              从文件库选择
            </div>
            <div className="avatar-picker-grid">
              {files.map((f) => (
                <button
                  key={f.id}
                  className="avatar-picker-item"
                  onClick={() => pick(f.id)}
                  title={f.name}
                >
                  {thumbs[f.id] ? (
                    <img src={thumbs[f.id]} alt={f.name} />
                  ) : (
                    <span className="avatar-picker-placeholder">?</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="muted small" style={{ padding: '16px 0' }}>
            文件库里还没有图片
          </div>
        )}
      </div>
    </Modal>
  );
}
