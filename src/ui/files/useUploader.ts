// 上传编排：串起「算 hash → 判重 → 撞车弹窗 → 落库」。
//
// 为什么单独一个 hook：FilesSection 要管列表、筛选、批量、预览、合并，
// 再塞进一段带弹窗 await 的上传流程就彻底读不动了。这里只关心上传本身。
import { useCallback, useRef, useState } from 'react';
import { uploadFile, type CollisionPrompt, type UploadOutcome } from '../../core/files';
import type { StoredFile } from '../../core/repo/files';
import { getSmallLimit } from '../filePrefs';
import { bump } from '../../store';

export interface PendingAsk {
  prompt: CollisionPrompt;
  step: (pick: StoredFile | null) => void;
  cancel: () => void;
  /** 上传中那张图的临时预览（仅图片有） */
  preview?: string;
}

export function useUploader(onNote: (text: string) => void) {
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<PendingAsk | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearInput = () => {
    if (inputRef.current) inputRef.current.value = '';
  };

  /**
   * 逐个 await，不能并发：同一批里传两张一样的小图，
   * 第一张必须落库后第二张才能查重命中，并发会把两份都插进去。
   */
  const upload = useCallback(
    async (list: FileList | File[] | null) => {
      if (!list || list.length === 0) return;
      setBusy(true);
      const notes: string[] = [];
      try {
        for (const f of Array.from(list)) {
          let outcome: UploadOutcome = await uploadFile(f, { smallLimit: getSmallLimit() });
          if (outcome.kind === 'ask') {
            const pending = outcome;
            const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
            const picked = await new Promise<StoredFile | null>((resolve) => {
              setAsk({ prompt: pending.prompt, step: resolve, cancel: () => resolve(null), preview });
            });
            if (preview) URL.revokeObjectURL(preview);
            setAsk(null);
            outcome = await pending.resolve(picked);
          }
          if (outcome.kind === 'reused') {
            notes.push(`「${f.name}」内容已在库中，已复用 ${outcome.file.name}`);
          } else if (outcome.kind === 'created' && outcome.renamed) {
            notes.push(`「${f.name}」被存成 ${outcome.renamed}`);
          }
        }
        bump();
        if (notes.length) onNote(notes.join('；'));
      } finally {
        setBusy(false);
        clearInput();
      }
    },
    [onNote],
  );

  return { busy, ask, inputRef, upload, openPicker: () => inputRef.current?.click() };
}
