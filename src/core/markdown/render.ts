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

/** 方括号里写的是插入时的文件名；空方括号（老数据）回退到文件库当前名字 */
function refLabel(raw: string | undefined, nameMap: Record<string, string>, id: string, fallback: string): string {
  const text = (raw ?? '').replace(/\\([[\]\\])/g, '$1').trim();
  return text || nameMap[id] || fallback;
}

/** 抽出正文里所有被引用的文件 id（去重，保持出现顺序） */
export function extractFileRefs(md: string): string[] {
  const ids: string[] = [];
  // 匹配 ![名字](file:xxx) 与 [名字](file:xxx)
  // 方括号里的名字允许转义的 `\]`；名字里允许点（内容寻址后是 sha-xxxx.jpg 这种）
  const re = /!?\[(?:\\.|[^\\\]])*\]\(\s*file:([A-Za-z0-9._-]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** 文件未加载/已删除时的占位——不用 emoji（部分安卓字体渲染成空心方块） */
function missingFile(name: string): string {
  return `<span class="md-file md-file-missing">附件已删除${name ? '：' + escapeHtml(name) : ''}</span>`;
}

function buildMarked(urlMap: Record<string, string>, nameMap: Record<string, string>): Marked {
  return new Marked({
    gfm: true,
    // 中文记录习惯回车即换行，不开 breaks 会把所有行挤成一段
    breaks: true,
    renderer: {
      image(token: Tokens.Image) {
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        if (isFileRef(token.href)) {
          const id = fileIdOf(token.href);
          const url = urlMap[id];
          // 方括号里的名字优先（插入时的快照，改名不追着改）；空格子回退到当前名字
          const label = refLabel(token.text, nameMap, id, '');
          return url
            ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}"${title} class="md-img" loading="lazy" />`
            : missingFile(label);
        }
        const text = escapeHtml(token.text ?? '');
        return `<img src="${escapeHtml(token.href)}" alt="${text}"${title} class="md-img" loading="lazy" />`;
      },
      link(token: Tokens.Link) {
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        if (isFileRef(token.href)) {
          const id = fileIdOf(token.href);
          const url = urlMap[id];
          const label = refLabel(token.text, nameMap, id, '附件');
          return url
            ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${title} class="md-file-link">${escapeHtml(label)}</a>`
            : missingFile(label);
        }
        return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer"${title}>${token.text ?? ''}</a>`;
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
  // 只放行这些协议：blob: 给库内文件，data:image/ 给内联图，mailto: 给邮箱。
  // ftp/file/content 是映射文件（只存链接的附件）可能用的协议——注意绝不放行 javascript:。
  ALLOWED_URI_REGEXP: /^(?:https?:|ftp:|ftps:|file:|content:|blob:|data:image\/|mailto:|#)/i,
  FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
};

/**
 * 渲染正文。
 *
 * @param md 原始 markdown
 * @param urlMap fileId → objectURL。未提供时文件引用渲染成「已删除」占位，
 *               这样异步加载 URL 的过程中页面也不会闪空白。
 * @param nameMap fileId → 当前文件名。只在方括号为空（老数据）时兜底；
 *                方括号里写了名字就按正文里的名字显示，改名不会追着改既有引用。
 */
export function renderMarkdown(
  md: string,
  urlMap: Record<string, string> = {},
  nameMap: Record<string, string> = {},
): string {
  if (!md || !md.trim()) return '';
  let raw: string;
  try {
    raw = buildMarked(urlMap, nameMap).parse(md, { async: false }) as string;
  } catch {
    // 解析失败不该让整页崩：退回纯文本
    return `<p>${escapeHtml(md)}</p>`;
  }
  return DOMPurify.sanitize(raw, SANITIZE_CONFIG);
}
