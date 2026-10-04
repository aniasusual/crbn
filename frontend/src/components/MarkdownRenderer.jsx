import { memo, useMemo } from 'react';
import { marked } from 'marked';
import './MarkdownRenderer.css';

marked.setOptions({
  gfm: true,
  breaks: true,
});

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }) {
  const html = useMemo(() => {
    if (!content || typeof content !== 'string') return '';
    try {
      return marked.parse(content);
    } catch {
      return content;
    }
  }, [content]);

  return (
    <div
      className="markdown-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export default MarkdownRenderer;
