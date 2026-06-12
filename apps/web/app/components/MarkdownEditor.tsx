import {
  useEffect,
  useReducer,
  useRef,
  type ComponentType,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Extension, type Editor, type Range } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  SquareCode,
  Strikethrough,
  TextQuote,
} from "lucide-react";
import { cn } from "@/app/lib/utils";

// ── Agent-friendly serialization ───────────────────────────────────

/* The serializer entity-escapes `<` `>` `&` and backslash-escapes `~` in
 * non-code text. Valid markdown, but agents read these fields as raw text
 * (task bodies, personas), where `&lt;example&gt;` is corruption. Undo
 * those escapes outside code spans; they re-parse to the same document.
 * Formatting escapes (\* \_ \[) stay — removing them would change meaning. */
const CODE_SPANS = /(```[\s\S]*?(?:```|$)|``[^`]*``|`[^`\n]*`)/g;

function relaxMarkdownEscapes(md: string): string {
  return md
    .split(CODE_SPANS)
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : seg
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\\~/g, "~")
            .replace(/&amp;/g, "&")
    )
    .join("");
}

// ── Slash commands ─────────────────────────────────────────────────

interface SlashCommand {
  title: string;
  keywords: string;
  icon: ComponentType<{ className?: string }>;
  run: (editor: Editor, range: Range) => void;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    title: "Text",
    keywords: "text paragraph plain",
    icon: Pilcrow,
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    title: "Heading 1",
    keywords: "heading h1 title",
    icon: Heading1,
    run: (e, r) =>
      e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Heading 2",
    keywords: "heading h2 subtitle",
    icon: Heading2,
    run: (e, r) =>
      e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    keywords: "heading h3",
    icon: Heading3,
    run: (e, r) =>
      e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bullet list",
    keywords: "bullet unordered list ul",
    icon: List,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    keywords: "numbered ordered list ol",
    icon: ListOrdered,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    title: "Quote",
    keywords: "quote blockquote",
    icon: TextQuote,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    keywords: "code block fence pre",
    icon: SquareCode,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    keywords: "divider rule hr separator",
    icon: Minus,
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
];

function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) => c.title.toLowerCase().includes(q) || c.keywords.includes(q)
  );
}

interface SlashPopupState {
  props: SuggestionProps<SlashCommand>;
  index: number;
}

type SlashRef = MutableRefObject<SlashPopupState | null>;

/* The Suggestion plugin drives lifecycle + keyboard; React renders the
 * popup from a ref the handlers mutate (bump forces the re-render). */
function createSlashExtension(slashRef: SlashRef, bump: () => void) {
  return Extension.create({
    name: "slashCommands",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommand>({
          editor: this.editor,
          char: "/",
          allowSpaces: false,
          command: ({ editor, range, props }) => props.run(editor, range),
          items: ({ query }) => filterSlashCommands(query),
          render: () => ({
            onStart: (props) => {
              slashRef.current = { props, index: 0 };
              bump();
            },
            onUpdate: (props) => {
              const cur = slashRef.current;
              slashRef.current = {
                props,
                index: Math.min(
                  cur?.index ?? 0,
                  Math.max(0, props.items.length - 1)
                ),
              };
              bump();
            },
            onKeyDown: (p: SuggestionKeyDownProps) => {
              const s = slashRef.current;
              if (!s) return false;
              const len = s.props.items.length;
              if (p.event.key === "ArrowDown" && len > 0) {
                s.index = (s.index + 1) % len;
                bump();
                return true;
              }
              if (p.event.key === "ArrowUp" && len > 0) {
                s.index = (s.index - 1 + len) % len;
                bump();
                return true;
              }
              if (p.event.key === "Enter" && len > 0) {
                const item = s.props.items[s.index];
                if (item) s.props.command(item);
                return true;
              }
              if (p.event.key === "Escape") {
                slashRef.current = null;
                bump();
                return true;
              }
              return false;
            },
            onExit: () => {
              slashRef.current = null;
              bump();
            },
          }),
        }),
      ];
    },
  });
}

function SlashMenu({
  slash,
  onHover,
}: {
  slash: SlashPopupState;
  onHover: (index: number) => void;
}) {
  const rect = slash.props.clientRect?.();
  if (!rect || slash.props.items.length === 0) return null;
  // max-h-[324px] fits all 9 commands plus padding without an inner
  // scroll; flip above the caret when the bottom edge would land
  // outside the viewport.
  const fitsBelow = rect.bottom + 330 <= window.innerHeight;
  return createPortal(
    <div
      role="listbox"
      aria-label="Insert block"
      className="fixed z-50 max-h-[324px] w-52 overflow-y-auto border border-paper-rule bg-paper py-1 shadow-sm"
      style={
        fitsBelow
          ? { left: rect.left, top: rect.bottom + 4 }
          : {
              left: rect.left,
              top: rect.top - 4,
              transform: "translateY(-100%)",
            }
      }
    >
      {slash.props.items.map((item, i) => {
        const Icon = item.icon;
        const isHi = i === slash.index;
        return (
          <button
            key={item.title}
            type="button"
            role="option"
            aria-selected={isHi}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(i)}
            onClick={() => slash.props.command(item)}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors",
              isHi ? "bg-paper-sunk text-ink" : "text-ink-soft"
            )}
          >
            <Icon className="size-3.5 shrink-0 text-ink-faint" />
            {item.title}
          </button>
        );
      })}
    </div>,
    document.body
  );
}

/*
 * WYSIWYG markdown editor: markdown string in, markdown string out.
 * StarterKit input rules give Linear-style shortcuts (`# `, `- `, `**b**`,
 * backticks); a selection bubble menu covers discoverable formatting and
 * `/` opens a block-insert menu. Prose styling lives in globals.css under
 * `.tiptap-prose` so the editing surface matches the read-only <Markdown>
 * renderer.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  className,
  contentClassName,
  onSubmit,
  autoFocus = false,
  editable = true,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** Wrapper class (sizing, padding). */
  className?: string;
  /** Class on the contenteditable itself (min-height etc.). */
  contentClassName?: string;
  /** Invoked on mod+Enter — comment composers. */
  onSubmit?: () => void;
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  // Extensions can dispatch doc-shaping transactions at mount; nothing may
  // reach onChange until the user has actually interacted, or untouched
  // content gets silently rewritten as normalized markdown.
  const touchedRef = useRef(false);
  // What we last handed to onChange — relaxed escapes mean it differs
  // from getMarkdown(), so the external-reset effect compares against
  // this to avoid resetting (and cursor-jumping) on our own echo.
  const lastEmittedRef = useRef<string | null>(null);
  const slashRef: SlashRef = useRef(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Appends an empty paragraph after trailing non-paragraph nodes —
        // a doc-changing transaction at mount, and stray blank lines in
        // the serialized markdown. Not wanted in a markdown editor.
        trailingNode: false,
        link: { openOnClick: false },
      }),
      Markdown,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      createSlashExtension(slashRef, bump),
    ],
    content: value,
    contentType: "markdown",
    editable,
    autofocus: autoFocus ? "end" : false,
    onFocus: () => {
      touchedRef.current = true;
    },
    onUpdate: ({ editor: e }) => {
      if (!touchedRef.current) return;
      const md = relaxMarkdownEscapes(e.getMarkdown());
      lastEmittedRef.current = md;
      onChangeRef.current(md);
    },
    editorProps: {
      attributes: {
        class: cn("tiptap-prose outline-none", contentClassName),
      },
      handleKeyDown: (_view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key === "Enter" &&
          onSubmitRef.current
        ) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        return false;
      },
    },
  });

  // External resets only (task switch, composer clear). While the user
  // types, `value` is the markdown we just emitted, so this no-ops.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value === lastEmittedRef.current) return;
    if (value !== editor.getMarkdown()) {
      lastEmittedRef.current = value;
      editor.commands.setContent(value, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
  }, [value, editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable);
  }, [editable, editor]);

  return (
    <>
      {editor && editable && <FormatBubble editor={editor} />}
      {editable && slashRef.current && (
        <SlashMenu
          slash={slashRef.current}
          onHover={(i) => {
            if (slashRef.current) {
              slashRef.current.index = i;
              bump();
            }
          }}
        />
      )}
      <EditorContent
        editor={editor}
        className={cn("cursor-text", className)}
        onClick={() => editor?.commands.focus()}
      />
    </>
  );
}

// ── Selection formatting toolbar ───────────────────────────────────

function FormatBubble({ editor }: { editor: Editor }) {
  // useEditor doesn't re-render on transactions (v3 default); subscribe to
  // the active states the buttons reflect.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
      inCodeBlock: e.isActive("codeBlock"),
    }),
  });

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="md-format"
      shouldShow={({ editor: e, state }) =>
        e.isEditable && !state.selection.empty && !e.isActive("codeBlock")
      }
      options={{ placement: "top", offset: 6 }}
      className="flex items-stretch border border-paper-rule bg-paper shadow-sm"
    >
      <BubbleButton
        icon={Heading1}
        label="Heading 1"
        isActive={active.h1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <BubbleButton
        icon={Heading2}
        label="Heading 2"
        isActive={active.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <BubbleButton
        icon={Heading3}
        label="Heading 3"
        isActive={active.h3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />
      <BubbleRule />
      <BubbleButton
        icon={Bold}
        label="Bold"
        isActive={active.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <BubbleButton
        icon={Italic}
        label="Italic"
        isActive={active.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <BubbleButton
        icon={Strikethrough}
        label="Strikethrough"
        isActive={active.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <BubbleButton
        icon={Code}
        label="Inline code"
        isActive={active.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <BubbleRule />
      <BubbleButton
        icon={List}
        label="Bullet list"
        isActive={active.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <BubbleButton
        icon={ListOrdered}
        label="Numbered list"
        isActive={active.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <BubbleButton
        icon={TextQuote}
        label="Quote"
        isActive={active.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
    </BubbleMenu>
  );
}

function BubbleButton({
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={isActive}
      // Mousedown would steal the selection the button acts on.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center transition-colors hover:bg-paper-sunk",
        isActive ? "bg-paper-sunk text-plot-red" : "text-ink-soft"
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function BubbleRule() {
  return <span aria-hidden className="my-1 w-px self-stretch bg-paper-rule" />;
}
