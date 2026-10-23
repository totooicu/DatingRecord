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
  // 两种写法都要认：
  // 1. markdown 语法 ![名字](file:xxx) / [名字](file:xxx)，方括号里的名字允许转义的 `\]`；
  // 2. 内嵌 HTML 里的 <a href="file:xxx"> / <img src="file:xxx">。
  //    这类引用不经过 marked 的 link/image token，不在这里抓出来就不会加载 blob URL。
  // 名字里允许点（内容寻址后是 sha-xxxx.jpg 这种）。
  const re =
    /!?\[(?:\\.|[^\\\]])*\]\(\s*file:([A-Za-z0-9._-]+)\s*\)|(?:href|src)\s*=\s*["']?\s*file:([A-Za-z0-9._-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const id = m[1] ?? m[2];
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** 文件未加载/已删除时的占位——不用 emoji（部分安卓字体渲染成空心方块） */
function missingFile(name: string): string {
  return `<span class="md-file md-file-missing">附件已删除${name ? '：' + escapeHtml(name) : ''}</span>`;
}

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i;

/** 附件是不是图片：优先看文件库里的当前名字，老 id 没扩展名时再看 id 本身 */
function isImageFile(id: string, name: string | undefined): boolean {
  return IMAGE_EXT.test(name ?? '') || IMAGE_EXT.test(id);
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
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'img', 'span', 'mark', 'u',
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
 * 内嵌 HTML 里的 file: 引用改写成运行时 URL。
 *
 * marked 只把 [x](file:id) 当成 link token，正文里直接写
 * `<a href="file:xxx">` 会原样进入消毒流程；消毒放行 file: 协议后，
 * 浏览器不知道 file: 指的是本地文件库，点了没反应 / 图片裂开。
 * 所以在消毒后按 DOM 改写，避免手写正则改 HTML 带来的转义问题。
 */
function rewriteHtmlFileRefs(html: string, urlMap: Record<string, string>, nameMap: Record<string, string>): string {
  // 绝大多数正文没有 file 引用，省掉一次 DOM 解析
  if (!/file:/i.test(html)) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  let changed = false;
  tpl.content.querySelectorAll('a,img').forEach((el) => {
    const attr = el.tagName === 'A' ? 'href' : 'src';
    const raw = (el.getAttribute(attr) ?? '').trim();
    if (!isFileRef(raw)) return;
    const id = /^file:([A-Za-z0-9._-]+)/.exec(raw)?.[1];
    if (!id) return;
    const url = urlMap[id];
    if (url) {
      el.setAttribute(attr, url);
      if (el.tagName === 'A') {
        const label = (el.textContent ?? '').trim();
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
        el.classList.add('md-file-link');
        // 内嵌 HTML 的 a 指向图片时直接把图显示出来：日记里这么写基本是想看图，
        // 只留一行链接等于「没有渲染」。图片外面仍套着链接，点开能看原图。
        if (isImageFile(id, nameMap[id])) {
          const img = document.createElement('img');
          img.className = 'md-img';
          img.setAttribute('src', url);
          img.setAttribute('loading', 'lazy');
          img.setAttribute('alt', label || nameMap[id] || '图片附件');
          el.replaceChildren(img);
          el.classList.add('md-img-link');
        }
      } else {
        el.classList.add('md-img');
        el.setAttribute('loading', 'lazy');
      }
      changed = true;
      return;
    }
    // 文件没加载到 / 已删除：与 markdown 语法保持同样的占位
    const label =
      el.tagName === 'A' ? (el.textContent ?? '').trim() : (el.getAttribute('alt') ?? '').trim();
    const name = label || nameMap[id] || '';
    const span = document.createElement('span');
    span.className = 'md-file md-file-missing';
    span.textContent = name ? `附件已删除：${name}` : '附件已删除';
    el.replaceWith(span);
    changed = true;
  });
  return changed ? tpl.innerHTML : html;
}

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
  const clean = DOMPurify.sanitize(raw, SANITIZE_CONFIG);
  return rewriteHtmlFileRefs(clean, urlMap, nameMap);
}
