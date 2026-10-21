// Markdown → 纯文本：给列表摘要、搜索、导出预览用

/**
 * 去掉常见标记，尽量保留可读文本。
 * 不追求完备：它只用于在时间线列表里露一两句正文，
 * 复杂的表格/嵌套列表退化成普通文字也不影响理解。
 */
export function markdownToText(md: string): string {
  if (!md) return '';
  let s = md;
  // 代码块整体去掉（内容通常不是人话）
  s = s.replace(/```[\s\S]*?```/g, '');
  s = s.replace(/`([^`]*)`/g, '$1');
  // 图片在摘要里没有意义（名字会在开头冒出来），直接去掉；链接保留文字
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 标题、引用、列表符号
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/^\s{0,3}>\s?/gm, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  // 强调符号
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2');
  s = s.replace(/(\*|_)(.*?)\1/g, '$2');
  s = s.replace(/~~(.*?)~~/g, '$1');
  // 分割线
  s = s.replace(/^\s*([-*_])\s*\1\s*\1[\s\S]*?$/gm, '');
  // 表格分隔行
  s = s.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '');
  s = s.replace(/\|/g, ' ');
  // 连续空白压成单空格，换行保留为空格（摘要是一行）
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** 裁一段摘要，超出补省略号 */
export function markdownExcerpt(md: string, maxLen = 60): string {
  const t = markdownToText(md);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}
