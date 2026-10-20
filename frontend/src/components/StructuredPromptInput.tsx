import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ClipboardEvent as ReactClipboardEvent,
} from 'react';
import { composerKeyAction } from '../lib/composerKeys';

/**
 * S5-B1c：带结构化引用 token 的创作输入。
 *
 * 为什么不是 textarea：行内引用必须是**一个原子对象**（缩略/名称 + 稳定 id），
 * 删除、撤销、复制粘贴都不能把它退化成一段可能失效的文本。contenteditable 里
 * 使用 `contenteditable=false` 的 span 承载 token；正文只保存普通文本。
 *
 * 纪律：
 * - 粘贴一律走纯文本，不接收外部 HTML；token 复制到纯文本目标时只剩名称；
 * - 原生撤销/重做保留 span 时，组件把 id 报回宿主，由宿主从 ref catalog 恢复引用；
 * - 组件不持久化 HTML，宿主仍只存 prompt 文本 + assetId/role/order。
 */
export interface InlinePromptToken {
  id: string;
  label: string;
  kind: 'image' | 'video';
}

export interface StructuredPromptHandle {
  /** 在最近一次光标处插入 token（没有光标则追加到末尾） */
  insertToken(token: InlinePromptToken): void;
  /** 外部移除 chip 时同步移除 token（不触发 onRemoveToken） */
  removeToken(id: string): void;
  /** 预览/标签解析完成后更新 token 文案（不改正文） */
  updateTokenLabel(id: string, label: string): void;
  /** 复用历史参数时替换正文；现有 token 保留并追加到末尾 */
  replaceText(text: string): void;
  focus(): void;
}

interface StructuredPromptProps {
  /** 只在挂载时读取；之后的正文由组件内部维护 */
  initialText: string;
  /** 只在挂载时读取；之后的 token 由 insertToken/removeToken 维护 */
  initialTokens: readonly InlinePromptToken[];
  placeholder: string;
  ariaLabel: string;
  className?: string;
  onChange(text: string): void;
  onRemoveToken(id: string): void;
  onRestoreToken(id: string): void;
  /** 节点宿主没有 @ 弹层；关闭后 `@` 只作为普通字符 */
  enableMentions?: boolean;
  onOpenMentions?(): void;
  onPasteFiles(files: File[]): void;
  onSubmit(): void;
}

interface ParsedEditor {
  text: string;
  ids: string[];
}

function readEditor(root: HTMLElement): ParsedEditor {
  const out: ParsedEditor = { text: '', ids: [] };

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.text += (node as Text).data.replace(/\u00a0/g, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    const id = element.dataset.refId;
    if (id !== undefined && id !== '') {
      out.ids.push(id);
      return;
    }
    if (element.tagName === 'BR') {
      out.text += '\n';
      return;
    }
    const block = element.tagName === 'DIV' || element.tagName === 'P';
    if (block && out.text !== '' && !out.text.endsWith('\n')) out.text += '\n';
    for (const child of Array.from(element.childNodes)) walk(child);
  };

  for (const child of Array.from(root.childNodes)) walk(child);
  return out;
}

function tokenSpan(token: InlinePromptToken): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'cr-inline-ref';
  span.contentEditable = 'false';
  span.dataset.refId = token.id;
  span.dataset.kind = token.kind;
  span.title = token.label;
  span.textContent = `@${token.label}`;
  return span;
}

function rangeInside(root: HTMLElement, range: Range | null): range is Range {
  return range !== null && root.contains(range.commonAncestorContainer);
}

export const StructuredPromptInput = forwardRef<StructuredPromptHandle, StructuredPromptProps>(
  function StructuredPromptInput(
    {
      initialText,
      initialTokens,
      placeholder,
      ariaLabel,
      className,
      onChange,
      onRemoveToken,
      onRestoreToken,
      enableMentions = true,
      onOpenMentions,
      onPasteFiles,
      onSubmit,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const knownIds = useRef<Set<string>>(new Set());
    const savedRange = useRef<Range | null>(null);
    const lastText = useRef(initialText);
    const initialTextRef = useRef(initialText);
    const initialTokensRef = useRef(initialTokens);

    const createAtRange = (token: InlinePromptToken): void => {
      const editor = editorRef.current;
      if (editor === null) return;
      const selection = window.getSelection();
      let range = savedRange.current;
      if (!rangeInside(editor, range)) {
        range = null;
      }
      if (range === null && selection !== null && selection.rangeCount > 0) {
        const candidate = selection.getRangeAt(0);
        if (rangeInside(editor, candidate)) range = candidate;
      }
      if (range === null) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }

      const span = tokenSpan(token);
      range.deleteContents();
      range.insertNode(span);
      const spacer = document.createTextNode(' ');
      span.after(spacer);
      const after = document.createRange();
      after.setStart(spacer, spacer.length);
      after.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(after);
      savedRange.current = after.cloneRange();
      knownIds.current.add(token.id);
      editor.focus();
    };

    useLayoutEffect(() => {
      const editor = editorRef.current;
      if (editor === null) return;
      editor.replaceChildren();
      if (initialTextRef.current !== '') {
        editor.appendChild(document.createTextNode(initialTextRef.current));
      }
      for (const token of initialTokensRef.current) {
        editor.appendChild(document.createTextNode(' '));
        editor.appendChild(tokenSpan(token));
      }
      knownIds.current = new Set(initialTokensRef.current.map((token) => token.id));
      lastText.current = initialTextRef.current;
      // 只在挂载时读一次；之后正文/ token 由 DOM 与 imperative handle 维护
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      return () => {
        savedRange.current = null;
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        insertToken(token) {
          const editor = editorRef.current;
          if (editor === null) return;
          if (knownIds.current.has(token.id)) return;
          if (editor.querySelector(`[data-ref-id="${CSS.escape(token.id)}"]`) !== null) return;
          createAtRange(token);
        },
        removeToken(id) {
          const editor = editorRef.current;
          if (editor === null) return;
          const span = Array.from(editor.querySelectorAll<HTMLElement>('[data-ref-id]')).find(
            (item) => item.dataset.refId === id,
          );
          if (span === undefined) return;
          const next = span.nextSibling;
          if (next !== null && next.nodeType === Node.TEXT_NODE && next.textContent === ' ') {
            next.remove();
          }
          span.remove();
          knownIds.current.delete(id);
        },
        updateTokenLabel(id, label) {
          const editor = editorRef.current;
          if (editor === null) return;
          const span = Array.from(editor.querySelectorAll<HTMLElement>('[data-ref-id]')).find(
            (item) => item.dataset.refId === id,
          );
          if (span === undefined) return;
          span.textContent = `@${label}`;
          span.title = label;
        },
        replaceText(text) {
          const editor = editorRef.current;
          if (editor === null) return;
          const tokens = Array.from(editor.querySelectorAll<HTMLElement>('[data-ref-id]')).map(
            (span) => span.cloneNode(true) as HTMLElement,
          );
          editor.textContent = '';
          if (text !== '') editor.appendChild(document.createTextNode(text));
          for (const token of tokens) {
            editor.appendChild(document.createTextNode(' '));
            editor.appendChild(token);
          }
          lastText.current = text;
          onChange(text);
        },
        focus() {
          editorRef.current?.focus();
        },
      }),
      [],
    );

    const rememberRange = (): void => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (editor === null || selection === null || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (rangeInside(editor, range)) savedRange.current = range.cloneRange();
    };

    /** 光标在正文末尾且末尾是 `@` 时删掉它；返回是否删除 */
    const stripTrailingAt = (): boolean => {
      const editor = editorRef.current;
      if (editor === null) return false;
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      if (!range.collapsed) return false;
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return false;
      const text = node.textContent ?? '';
      if (!text.endsWith('@') || range.startOffset !== text.length) return false;
      range.setStart(node, text.length - 1);
      range.deleteContents();
      return true;
    };

    const sync = (): void => {
      const editor = editorRef.current;
      if (editor === null) return;
      let parsed = readEditor(editor);
      if (
        enableMentions &&
        onOpenMentions !== undefined &&
        parsed.text.endsWith('@') &&
        !lastText.current.endsWith('@') &&
        stripTrailingAt()
      ) {
        parsed = readEditor(editor);
        rememberRange();
        onOpenMentions();
      }

      const current = new Set(parsed.ids);
      const removed = [...knownIds.current].filter((id) => !current.has(id));
      const added = [...current].filter((id) => !knownIds.current.has(id));
      knownIds.current = current;
      lastText.current = parsed.text;
      onChange(parsed.text);
      for (const id of removed) onRemoveToken(id);
      for (const id of added) onRestoreToken(id);
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const action = composerKeyAction(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          isComposing: event.nativeEvent.isComposing,
        },
        { mentionOpen: false },
      );
      if (action === 'submit') {
        event.preventDefault();
        onSubmit();
        return;
      }
      // Enter / Shift+Enter 交给 contenteditable 原生换行；输入法组合也走原生
    };

    const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
      const files = Array.from(event.clipboardData.files);
      if (files.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        onPasteFiles(files);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const text = event.clipboardData.getData('text/plain');
      if (text === '') return;
      // 纯文本插入：复制出去的 token 只保留名称，不会把 data-ref-id 漏给外部
      document.execCommand('insertText', false, text);
    };

    return (
      <div
        ref={editorRef}
        className={className === undefined ? 'cr-input cr-input-rich' : className}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        spellCheck={false}
        onInput={sync}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onSelect={rememberRange}
        onKeyUp={rememberRange}
        onMouseUp={rememberRange}
      />
    );
  },
);
