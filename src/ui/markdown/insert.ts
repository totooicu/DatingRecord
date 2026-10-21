// 编辑器光标操作：所有变换都是纯函数（输入光标状态 → 输出光标状态），
// 方便单独测，也不依赖 DOM。

export interface Caret {
  text: string;
  start: number;
  end: number;
}

/** 包裹选区（加粗/斜体/删除线/行内代码）。已包裹再点一次则脱掉。 */
export function wrapSelection(c: Caret, before: string, after: string, placeholder: string): Caret {
  const sel = c.text.slice(c.start, c.end) || placeholder;
  const outerStart = c.start - before.length;
  const outerEnd = c.end + after.length;
  const already =
    outerStart >= 0 &&
    c.text.slice(outerStart, c.start) === before &&
    c.text.slice(c.end, outerEnd) === after;
  if (already) {
    return {
      text: c.text.slice(0, outerStart) + sel + c.text.slice(outerEnd),
      start: outerStart,
      end: outerStart + sel.length,
    };
  }
  return {
    text: c.text.slice(0, c.start) + before + sel + after + c.text.slice(c.end),
    start: c.start + before.length,
    end: c.start + before.length + sel.length,
  };
}

/** 在光标处插入片段（文件引用、链接等） */
export function insertText(c: Caret, snippet: string): Caret {
  const start = c.start + snippet.length;
  return {
    text: c.text.slice(0, c.start) + snippet + c.text.slice(c.end),
    start,
    end: start,
  };
}

/** 行首标记（标题 / 引用 / 列表）。整块一起加，再点一次整块一起去掉。 */
export function toggleLineMark(c: Caret, mark: string): Caret {
  const text = c.text;
  const lineStart = text.lastIndexOf('\n', Math.max(c.start - 1, 0)) + 1;
  let lineEnd = text.indexOf('\n', c.end);
  if (lineEnd === -1) lineEnd = text.length;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  // 先剥掉已有的同类标记，避免叠加成 "> > ## 标题"
  const stripped = lines.map((l) => l.replace(/^\s*(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)?/, ''));
  const allHave = lines.every((l) => l.trimStart().startsWith(mark.trim()));
  const next = stripped.map((l) => (allHave ? l : mark + l));
  return {
    text: text.slice(0, lineStart) + next.join('\n') + text.slice(lineEnd),
    start: lineStart + (next[next.length - 1]?.length ?? 0),
    end: lineStart + (next[next.length - 1]?.length ?? 0),
  };
}

/** 从 textarea 读出当前光标状态 */
export function caretOf(el: HTMLTextAreaElement): Caret {
  return { text: el.value, start: el.selectionStart, end: el.selectionEnd };
}
