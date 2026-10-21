// Markdown 渲染：marked 解析 → 自定义 renderer 处理附件引用 → DOMPurify 消毒
//
// 为什么要在 marked 阶段就替换掉 file:<id>：
// DOMPurify 只放行白名单协议，自定义协议会被整段抹掉。所以先把
// file:<id> 换成运行时拿到的 blob: URL，再交给消毒，输出就是干净可用的 HTML。

import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';

/** 正文里引用库内文件的前缀：![说明](file:<id>) */
export const FILE_REF_PREFIX = 'file:';

function isFileRef(href: string): boolean {
  return href.startsWith(FILE_REF_PREFIX);
}

function fileIdOf(href: string): string {
  return href.slice(FILE_REF_PREFIX.length).trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 抽出正文里所有被引用的文件 id（去重，保持出现顺序） */
export function extractFileRefs(md: string): string[] {
  const ids: string[] = [];
  // 匹配 ![alt](file:xxx) 与 [text](file:xxx)
  const re = /!?\[[^\]]*\]\(\s*file:([A-Za-z0-9_-]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** 文件未加载/已删除时的占位——不用 emoji（部分安卓字体渲染成空心方块） */
function missingFile(label: string): string {
  return `<span class="md-file md-file-missing">附件已删除：${escapeHtml(label || '未命名')}</span>`;
}

function buildMarked(urlMap: Record<string, string>): Marked {
  return new Marked({
    gfm: true,
    // 中文记录习惯回车即换行，不开 breaks 会把所有行挤成一段
    breaks: true,
    renderer: {
      image(token: Tokens.Image) {
        const text = escapeHtml(token.text ?? '');
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        if (isFileRef(token.href)) {
          const url = urlMap[fileIdOf(token.href)];
          return url
            ? `<img src="${escapeHtml(url)}" alt="${text}"${title} class="md-img" loading="lazy" />`
            : missingFile(token.text);
        }
        return `<img src="${escapeHtml(token.href)}" alt="${text}"${title} class="md-img" loading="lazy" />`;
      },
      link(token: Tokens.Link) {
        const text = token.text ?? '';
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        if (isFileRef(token.href)) {
          const url = urlMap[fileIdOf(token.href)];
          return url
            ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${title} class="md-file-link">${text}</a>`
            : missingFile(token.text.replace(/<[^>]+>/g, ''));
        }
        return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer"${title}>${text}</a>`;
      },
    },
  });
}

const SANITIZE_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'strong', 'em', 'del', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'img', 'span',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'loading', 'colspan', 'rowspan'],
  // 只放行这些协议：blob: 给库内文件，data:image/ 给内联图，mailto: 给邮箱
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|blob:|data:image\/|#)/i,
  FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
};

/**
 * 渲染正文。
 *
 * @param md 原始 markdown
 * @param urlMap fileId → objectURL。未提供时文件引用渲染成「已删除」占位，
 *               这样异步加载 URL 的过程中页面也不会闪空白。
 */
export function renderMarkdown(md: string, urlMap: Record<string, string> = {}): string {
  if (!md || !md.trim()) return '';
  let raw: string;
  try {
    raw = buildMarked(urlMap).parse(md, { async: false }) as string;
  } catch {
    // 解析失败不该让整页崩：退回纯文本
    return `<p>${escapeHtml(md)}</p>`;
  }
  return DOMPurify.sanitize(raw, SANITIZE_CONFIG);
}
