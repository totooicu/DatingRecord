import { useMemo } from 'react';
import { renderMarkdown } from '../../core/markdown';
import { useFileUrls } from './useFileUrls';

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
  const urls = useFileUrls(source);
  const html = useMemo(() => renderMarkdown(source, urls), [source, urls]);
  if (!source || !source.trim()) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 只读渲染（调用方已备好 URL 时用，省一次扫描） */
export function MarkdownHtml({
  source,
  urlMap,
  className = 'md-body',
}: {
  source: string;
  urlMap?: Record<string, string>;
  className?: string;
}) {
  const html = useMemo(() => renderMarkdown(source, urlMap ?? {}), [source, urlMap]);
  if (!source || !source.trim()) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
