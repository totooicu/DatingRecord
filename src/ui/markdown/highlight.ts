/**
 * 正文编辑器的语法高亮。
 *
 * textarea 本身不能上色，所以把同一段文字切词后渲染到它背后的高亮层。
 * 关键约束：高亮层与 textarea 必须逐字对齐，否则文字和光标会错位。
 * 因此这里只用颜色 / 背景 / 删除线 / 下划线来表达样式，绝不改字体、
 * 字号、字重、斜体、字距——任何会改变字形宽度的样式都会让换行位置对不上。
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 行内 token，一次扫描避免互相污染：
 * 行内代码 → 链接/图片 → 粗体 → 删除线 → 斜体 → 内嵌 HTML 标签。
 */
const INLINE =
  /(`[^`\n]*`)|(!?\[[^\]\n]*\]\([^)\n]*\))|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*|(?<![\w])_[^_\n]+_(?![\w]))|(<\/?[a-zA-Z][^>]*>)/g;

function inline(text: string): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out += `<span class="md-hl-code">${esc(t)}</span>`;
    else if (m[2]) out += `<span class="md-hl-link">${esc(t)}</span>`;
    else if (m[3]) out += `<span class="md-hl-strong">${esc(t)}</span>`;
    else if (m[4]) out += `<span class="md-hl-strike">${esc(t)}</span>`;
    else if (m[5]) out += `<span class="md-hl-em">${esc(t)}</span>`;
    else out += `<span class="md-hl-html">${esc(t)}</span>`;
    last = m.index + t.length;
  }
  out += esc(text.slice(last));
  return out;
}

/** 行首标记（# / > / - / 1.）单独淡显，后面的正文正常高亮 */
function withMark(line: string, mark: string, cls: string): string {
  return `<span class="md-hl-line ${cls}"><span class="md-hl-mark">${esc(mark)}</span>${inline(
    line.slice(mark.length),
  )}</span>`;
}

function renderLine(line: string, inFence: boolean): { html: string; fence: boolean } {
  // 围栏代码块：开/关都算围栏行，中间内容一律按代码上色
  if (/^\s{0,3}(?:```|~~~)/.test(line)) {
    return { html: `<span class="md-hl-line md-hl-fence">${esc(line)}</span>`, fence: !inFence };
  }
  if (inFence) {
    return { html: `<span class="md-hl-line md-hl-codeblock">${esc(line)}</span>`, fence: true };
  }
  // 分隔线要先于列表判断：``- - -`` 也能被列表规则吃掉
  if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) {
    return { html: `<span class="md-hl-line md-hl-dim">${esc(line)}</span>`, fence: false };
  }
  const heading = /^\s{0,3}#{1,6}\s/.exec(line);
  if (heading) return { html: withMark(line, heading[0], 'md-hl-h'), fence: false };
  const quote = /^\s{0,3}>\s?/.exec(line);
  if (quote) return { html: withMark(line, quote[0], 'md-hl-quote'), fence: false };
  const list = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(line);
  if (list) return { html: withMark(line, list[0], 'md-hl-list'), fence: false };
  if (/^\s*\|/.test(line)) {
    return { html: `<span class="md-hl-line md-hl-table">${inline(line)}</span>`, fence: false };
  }
  return { html: `<span class="md-hl-line">${inline(line)}</span>`, fence: false };
}

/**
 * 返回与原文逐字对应的 HTML。用 span 换行（而不是每行一个块），
 * 保证空行、末尾空行的高度与 textarea 完全一致。
 */
export function highlightMarkdown(src: string): string {
  if (!src) return '';
  const out: string[] = [];
  let fence = false;
  for (const line of src.split('\n')) {
    const r = renderLine(line, fence);
    fence = r.fence;
    out.push(r.html);
  }
  return out.join('\n');
}
