// 引用名（hash 名）徽标：点一下复制 file:<名字>。
//
// 用户实际看到的是「实际名」，hash 名只在需要精确引用时才关心，
// 所以它放在元信息行里、字号更小、用等宽字体，不抢文件名的主视觉。
import { useState } from 'react';

export function HashBadge({ storedId }: { storedId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`file:${storedId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 剪贴板不可用时静默失败，用户仍可手动选中文字 */
    }
  };
  return (
    <button
      type="button"
      className="file-hash"
      onClick={() => void copy()}
      title={`引用名（点击复制）：file:${storedId}`}
    >
      {copied ? '已复制引用' : storedId}
    </button>
  );
}
