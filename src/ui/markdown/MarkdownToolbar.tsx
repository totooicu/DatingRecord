import { insertText as insert, toggleLineMark as mark, wrapSelection as wrapFn, type Caret } from './insert';

/**
 * 编辑工具栏。
 *
 * 图标一律用文字而非 emoji：之前踩过部分安卓字体把 emoji 渲染成空心方块的坑。
 * 移动端横向可滚动（.md-toolbar）。
 */
export function MarkdownToolbar({
  apply,
  onPickFile,
  onOpenFiles,
}: {
  apply: (fn: (c: Caret) => Caret) => void;
  /** 从本机上传新文件 */
  onPickFile: () => void;
  /** 打开悬浮文件库，挑一个已有文件插入引用 */
  onOpenFiles: () => void;
}) {
  const wrap = (before: string, after: string, placeholder: string) =>
    apply((c) => ({
      ...c,
      ...wrapFn(c, before, after, placeholder),
    }));

  return (
    <div className="md-toolbar">
      <button type="button" className="md-tool" onClick={() => apply((c) => mark(c, '## '))} title="标题">
        H
      </button>
      <button type="button" className="md-tool md-tool-b" onClick={() => wrap('**', '**', '粗体')} title="加粗">
        B
      </button>
      <button type="button" className="md-tool md-tool-i" onClick={() => wrap('*', '*', '斜体')} title="斜体">
        I
      </button>
      <button type="button" className="md-tool md-tool-s" onClick={() => wrap('~~', '~~', '删除线')} title="删除线">
        S
      </button>
      <button type="button" className="md-tool" onClick={() => apply((c) => mark(c, '- '))} title="列表">
        列表
      </button>
      <button type="button" className="md-tool" onClick={() => apply((c) => mark(c, '> '))} title="引用">
        引用
      </button>
      <button type="button" className="md-tool" onClick={() => wrap('`', '`', '代码')} title="行内代码">
        代码
      </button>
      <button
        type="button"
        className="md-tool"
        onClick={() => apply((c) => insert(c, '[链接文字](https://)'))}
        title="链接"
      >
        链接
      </button>
      <button type="button" className="md-tool md-tool-file" onClick={onPickFile} title="上传并插入图片或文件">
        插图
      </button>
      <button type="button" className="md-tool md-tool-file" onClick={onOpenFiles} title="从文件库选择已有文件">
        文件
      </button>
    </div>
  );
}
