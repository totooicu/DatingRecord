import { useMemo } from 'react';
import { renderMarkdown } from '../../core/markdown';
import { useFileRefs } from './useFileRefs';

/**
 * 正文渲染。
 *
 * HTML 来自 renderMarkdown：marked 解析后经 DOMPurify 消毒，
 * 脚本/事件属性/非法协议都已被清掉，这里才敢用 dangerouslySetInnerHTML。
 */
export function MarkdownView({
  source,
  className = 'md-body',
}: {
  source: string;
  className?: string;
}) {
  const { urls, names } = useFileRefs(source);
  const html = useMemo(() => renderMarkdown(source, urls, names), [source, urls, names]);
  if (!source || !source.trim()) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
