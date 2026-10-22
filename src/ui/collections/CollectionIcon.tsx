// 事件集图标渲染（F-C08）。
//
// 四类图标共用同一个方块外形，只有内容不同：
//   text  单文字  —— 任意 1 个字符（汉字 / 符号 / emoji）
//   alpha 双字母  —— 2 个字符，字号自动缩小
//   svg   矢量图  —— 作为 <img> 渲染，不内联进 DOM
//   image 位图    —— 铺满方块（cover）
//
// svg 为什么走 <img> 而不是 dangerouslySetInnerHTML：用户上传的 SVG 可能带脚本，
// 内联进文档等于把执行权交出去；objectURL + <img> 是浏览器隔离的渲染上下文，
// SVG 里的 script 不会执行，外链资源也拿不到。
//
// 尺寸只有三档（sm/md/lg），够用且不容易在列表里对不齐。
import { useEffect, useState } from 'react';
import { urlForFile } from '../../core/repo/files';
import type { CollectionIcon } from '../../core/types';

export type IconSize = 'sm' | 'md' | 'lg';

/** 没设图标时的默认底色（和集合树里的中性灰一致） */
const DEFAULT_BG = 'var(--panel)';
const DEFAULT_FG = 'var(--muted)';

/** 单/双文字的取字规则：去掉首尾空白，双字母按「字符」而不是 UTF-16 码元切 */
export function iconChars(icon: CollectionIcon): string {
  const raw = (icon.text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '?';
  const chars = Array.from(raw);
  const n = icon.type === 'alpha' ? 2 : 1;
  return chars.slice(0, n).join('');
}

export function CollectionIconView({
  icon,
  size = 'md',
  /** 覆盖前景/背景（用于「今天」高亮这类需要反色的场合） */
  fg,
  bg,
  /** 无图标时显示的回退文字 */
  fallback,
  title,
}: {
  icon: CollectionIcon | null | undefined;
  size?: IconSize;
  fg?: string;
  bg?: string;
  fallback?: string;
  title?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const fileId = icon && (icon.type === 'svg' || icon.type === 'image') ? icon.fileId : undefined;

  useEffect(() => {
    let alive = true;
    if (!fileId) {
      setUrl(null);
      return;
    }
    void urlForFile(fileId).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [fileId]);

  const cls = `coll-icon coll-icon-${size}`;
  const style: React.CSSProperties = {
    background: bg ?? icon?.bg ?? DEFAULT_BG,
    color: fg ?? icon?.fg ?? DEFAULT_FG,
  };

  if (!icon) {
    // 没图标：给一个浅底的首字，比空白格子好认，也不至于抢眼
    return (
      <span className={`${cls} coll-icon-fallback`} style={style} title={title} aria-hidden>
        {(fallback ?? '').slice(0, 1)}
      </span>
    );
  }

  if (icon.type === 'svg' || icon.type === 'image') {
    return (
      <span className={cls} style={style} title={title}>
        {url ? (
          <img
            className={icon.type === 'svg' ? 'coll-icon-img coll-icon-svg' : 'coll-icon-img'}
            src={url}
            alt=""
            draggable={false}
          />
        ) : (
          // 二进制还没读回来（或已被清掉）：留个占位，别闪成空白
          <span className="coll-icon-ph" />
        )}
      </span>
    );
  }

  return (
    <span className={`${cls} coll-icon-text`} style={style} title={title} aria-hidden>
      {fallback && !icon.text ? fallback.slice(0, 1) : iconChars(icon)}
    </span>
  );
}
