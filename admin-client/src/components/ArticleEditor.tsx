import { useEffect, useRef } from 'react';

// A dependency-free rich-text editor for the recipe article body. Uses
// `document.execCommand` — deprecated but still broadly supported in the
// Chromium-based browsers this internal admin panel runs in, and avoids
// pulling in a full editor library for what's otherwise a small feature.
const exec = (command: string, value?: string) => document.execCommand(command, false, value);

const TOOLBAR: Array<{ label: string; title: string; command: string; value?: string; className?: string }> = [
  { label: 'B', title: 'Bold', command: 'bold', className: 'font-bold' },
  { label: 'I', title: 'Italic', command: 'italic', className: 'italic' },
  { label: 'U', title: 'Underline', command: 'underline', className: 'underline' },
  { label: 'H2', title: 'Heading', command: 'formatBlock', value: 'H2' },
  { label: 'H3', title: 'Subheading', command: 'formatBlock', value: 'H3' },
  { label: 'P', title: 'Paragraph', command: 'formatBlock', value: 'P' },
  { label: '•—', title: 'Bullet list', command: 'insertUnorderedList' },
  { label: '1.', title: 'Numbered list', command: 'insertOrderedList' },
];

export function ArticleEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Syncs the contentEditable body from `value` — on mount (loading an
  // existing article) and whenever it changes from outside (e.g. switching
  // the active language tab). Comparing against the DOM's own innerHTML
  // (rather than the last-emitted value) means this never fights the
  // browser's cursor position while typing: by the time this effect runs
  // after a keystroke, the DOM already matches `value`, so it's a no-op.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? '';
    onChange(html);
  };

  const run = (command: string, cmdValue?: string) => {
    ref.current?.focus();
    exec(command, cmdValue);
    emit();
  };

  const addLink = () => {
    const url = window.prompt('Link URL');
    if (!url) return;
    run('createLink', url);
  };

  return (
    <div className="rounded-md border border-neutral-300 dark:border-neutral-700">
      <div className="flex flex-wrap gap-1 border-b border-neutral-300 bg-neutral-50 p-1 dark:border-neutral-700 dark:bg-neutral-800">
        {TOOLBAR.map((btn) => (
          <button
            key={btn.label}
            type="button"
            title={btn.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(btn.command, btn.value)}
            className={`min-w-[1.75rem] rounded px-2 py-1 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700 ${btn.className ?? ''}`}
          >
            {btn.label}
          </button>
        ))}
        <button
          type="button"
          title="Link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addLink}
          className="min-w-[1.75rem] rounded px-2 py-1 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          🔗
        </button>
        <button
          type="button"
          title="Clear formatting"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('removeFormat')}
          className="min-w-[1.75rem] rounded px-2 py-1 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          Tx
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        data-placeholder={placeholder}
        className="article-editor-body min-h-[180px] w-full px-3 py-2 text-sm focus:outline-none dark:bg-neutral-900 [&_a]:text-blue-600 [&_a]:underline [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  );
}
