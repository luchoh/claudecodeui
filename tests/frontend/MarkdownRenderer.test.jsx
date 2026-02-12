// @vitest-environment jsdom
/**
 * Tests for MarkdownRenderer components
 * src/components/chat/MarkdownRenderer.jsx
 *
 * Tests the Markdown wrapper, CodeBlock, and markdownComponents.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock normalizeInlineCodeFences (simple passthrough unless we need to test it)
vi.mock('../../src/utils/chatUtils', () => ({
  normalizeInlineCodeFences: vi.fn((text) => {
    if (!text || typeof text !== 'string') return text;
    // Replicate the real logic: ```code``` -> `code`
    try {
      return text.replace(/```\s*([^\n\r]+?)\s*```/g, '`$1`');
    } catch {
      return text;
    }
  }),
}));

import { Markdown, CodeBlock, markdownComponents } from '../../src/components/chat/MarkdownRenderer.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMarkdown(content, props = {}) {
  return render(<Markdown {...props}>{content}</Markdown>);
}

// ---------------------------------------------------------------------------
// Tests — Markdown wrapper
// ---------------------------------------------------------------------------

describe('Markdown', () => {
  it('renders plain text', () => {
    renderMarkdown('Hello, world!');
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
  });

  it('renders multiple paragraphs', () => {
    renderMarkdown('First paragraph\n\nSecond paragraph');
    expect(screen.getByText('First paragraph')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph')).toBeInTheDocument();
  });

  it('handles empty string content', () => {
    const { container } = renderMarkdown('');
    // Should render the wrapper div but no meaningful text
    expect(container.firstChild).toBeInTheDocument();
  });

  it('handles null content', () => {
    const { container } = renderMarkdown(null);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('handles undefined content', () => {
    const { container } = renderMarkdown(undefined);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('applies className to wrapper div', () => {
    const { container } = renderMarkdown('text', { className: 'my-custom-class' });
    expect(container.firstChild).toHaveClass('my-custom-class');
  });

  it('renders inline code', () => {
    renderMarkdown('Use the `console.log` function');
    const codeEl = screen.getByText('console.log');
    expect(codeEl.tagName).toBe('CODE');
  });

  it('renders code blocks with language label', () => {
    const code = '```javascript\nconst x = 1;\n```';
    renderMarkdown(code);
    // The language label should appear
    expect(screen.getByText('javascript')).toBeInTheDocument();
  });

  it('renders links with target="_blank"', () => {
    renderMarkdown('[Visit](https://example.com)');
    const link = screen.getByText('Visit');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('renders blockquotes', () => {
    renderMarkdown('> This is a quote');
    const blockquote = screen.getByText('This is a quote').closest('blockquote');
    expect(blockquote).toBeInTheDocument();
  });

  it('renders GFM tables', () => {
    const tableMarkdown = [
      '| Name | Age |',
      '| ---- | --- |',
      '| Alice | 30 |',
      '| Bob | 25 |',
    ].join('\n');

    renderMarkdown(tableMarkdown);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();

    // Verify a <table> element is rendered
    const table = screen.getByText('Alice').closest('table');
    expect(table).toBeInTheDocument();
  });

  it('renders bold and italic text', () => {
    renderMarkdown('**bold** and *italic*');
    const bold = screen.getByText('bold');
    expect(bold.tagName).toBe('STRONG');
    const italic = screen.getByText('italic');
    expect(italic.tagName).toBe('EM');
  });
});

// ---------------------------------------------------------------------------
// Tests — CodeBlock component (copy button)
// ---------------------------------------------------------------------------

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders inline code when inline prop is true', () => {
    const { container } = render(
      <CodeBlock inline={true} className="">
        inlineCode
      </CodeBlock>,
    );
    const code = container.querySelector('code');
    expect(code).toBeInTheDocument();
    expect(code.textContent).toBe('inlineCode');
  });

  it('renders a code block with copy button for multiline content', () => {
    render(
      <CodeBlock className="language-javascript">
        {'const a = 1;\nconst b = 2;'}
      </CodeBlock>,
    );
    const copyButton = screen.getByLabelText('Copy code');
    expect(copyButton).toBeInTheDocument();
  });

  it('copy button updates text to "Copied" on click', async () => {
    // Mock clipboard API
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(
      <CodeBlock className="language-javascript">
        {'const a = 1;\nconst b = 2;'}
      </CodeBlock>,
    );

    const copyButton = screen.getByLabelText('Copy code');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
    expect(writeTextMock).toHaveBeenCalledWith('const a = 1;\nconst b = 2;');
  });

  it('shows the language label for known languages', () => {
    render(
      <CodeBlock className="language-python">
        {'print("hello")\nprint("world")'}
      </CodeBlock>,
    );
    expect(screen.getByText('python')).toBeInTheDocument();
  });

  it('does not show a language label for "text"', () => {
    render(
      <CodeBlock className="language-text">
        {'some plain text\nwith newlines'}
      </CodeBlock>,
    );
    // There should be no visible language label for "text"
    expect(screen.queryByText('text')).not.toBeInTheDocument();
  });

  it('single-line content without inline prop renders as inline code', () => {
    const { container } = render(
      <CodeBlock className="language-javascript">
        singleLine
      </CodeBlock>,
    );
    // Single-line code without inline explicitly set falls back to inline rendering
    const code = container.querySelector('code');
    expect(code).toBeInTheDocument();
    // Should NOT have a copy button since it's inline
    expect(screen.queryByLabelText('Copy code')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — markdownComponents config
// ---------------------------------------------------------------------------

describe('markdownComponents', () => {
  it('has custom renderers for expected elements', () => {
    expect(markdownComponents.code).toBe(CodeBlock);
    expect(markdownComponents.blockquote).toBeDefined();
    expect(markdownComponents.a).toBeDefined();
    expect(markdownComponents.p).toBeDefined();
    expect(markdownComponents.table).toBeDefined();
    expect(markdownComponents.thead).toBeDefined();
    expect(markdownComponents.th).toBeDefined();
    expect(markdownComponents.td).toBeDefined();
  });

  it('link renderer sets target="_blank" and rel', () => {
    const { container } = render(
      React.createElement(markdownComponents.a, { href: 'https://example.com' }, 'Click me'),
    );
    const anchor = container.querySelector('a');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
