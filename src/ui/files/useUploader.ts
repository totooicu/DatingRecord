// 上传编排：串起「算 hash → 判重 → 撞车弹窗 → 落库」。
//
// 为什么单独一个 hook：FilesSection 要管列表、筛选、批量、预览、合并，
// 再塞进一段带弹窗 await 的上传流程就彻底读不动了。这里只关心上传本身。
import { useCallback, useRef, useState } from 'react';
import { uploadFile, type CollisionDecision, type CollisionPrompt, type UploadOutcome } from '../../core/files';
import type { StoredFile } from '../../core/repo/files';
import { getSmallLimit } from '../filePrefs';
import { bump } from '../../store';
import type { CollisionChoice } from './CollisionModal';

/** 自动按前面的选择处理时，各动作在提示语里的说法 */
const ACTION_TEXT: Record<CollisionDecision['action'], string> = {
  reuse: '复用已有',
  create: '作为新文件',
  overwrite: '覆盖已有',
};

export interface PendingAsk {
  prompt: CollisionPrompt;
  /** null = 用户取消这条，不上传 */
  step: (choice: CollisionChoice | null) => void;
  cancel: () => void;
  /** 上传中那张图的临时预览（仅图片有） */
  preview?: string;
}

export function useUploader(onNote: (text: string) => void) {
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<PendingAsk | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * 逐个 await，不能并发：同一批里传两张一样的小图，
   * 第一张必须落库后第二张才能查重命中，并发会把两份都插进去。
   * 返回本次落库的文件（调用方可能要接着用，如音乐面板把歌加进歌单）。
   */
  const upload = useCallback(
    async (list: FileList | File[] | null): Promise<StoredFile[]> => {
      if (!list || list.length === 0) return [];
      setBusy(true);
      const notes: string[] = [];
      const done: StoredFile[] = [];
      // 只在本次这批内生效：勾了「后续同样处理」之后，剩下的冲突不再打扰用户。
      // 记的是动作而不是目标记录 —— 每条冲突的候选各不相同，目标一律取该条的第一个候选。
      let sticky: CollisionDecision['action'] | null = null;
      try {
        for (const f of Array.from(list)) {
          let outcome: UploadOutcome = await uploadFile(f, { smallLimit: getSmallLimit() });
          if (outcome.kind === 'ask') {
            const pending = outcome;
            let choice: CollisionChoice | null;
            if (sticky) {
              choice = {
                action: sticky,
                target: sticky === 'create' ? null : pending.prompt.candidates[0] ?? null,
                applyRest: true,
              };
              notes.push(`「${f.name}」按前面的选择${ACTION_TEXT[sticky]}`);
            } else {
              const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
              choice = await new Promise<CollisionChoice | null>((resolve) => {
                setAsk({ prompt: pending.prompt, step: resolve, cancel: () => resolve(null), preview });
              });
              if (preview) URL.revokeObjectURL(preview);
              setAsk(null);
              if (choice?.applyRest) sticky = choice.action;
            }
            if (!choice) continue; // 取消上传：这条直接跳过，不落库
            outcome = await pending.resolve({ action: choice.action, target: choice.target });
          }
          if (outcome.kind === 'reused') {
            notes.push(`「${f.name}」内容已在库中，已复用 ${outcome.file.name}`);
          } else if (outcome.kind === 'overwritten') {
            notes.push(`「${f.name}」已覆盖 ${outcome.over.name}（引用名不变）`);
          } else if (outcome.kind === 'created' && outcome.renamed) {
            notes.push(`「${f.name}」被存成 ${outcome.renamed}`);
          }
          if (outcome.kind !== 'ask' && outcome.file) {
            done.push(outcome.file);
          }
        }
        bump();
        if (notes.length) onNote(notes.join('；'));
        return done;
      } finally {
        setBusy(false);
      }
    },
    [onNote],
  );

  return { busy, ask, inputRef, upload, openPicker: () => inputRef.current?.click() };
}
