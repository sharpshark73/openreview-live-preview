"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  lintGutter,
  setDiagnostics,
  type Diagnostic,
} from "@codemirror/lint";
import {
  openSearchPanel,
  search,
} from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

export type SourceDiagnostic = {
  from: number;
  to: number;
  message: string;
  severity?: "error" | "warning" | "info";
};

export type SourceEditorHandle = {
  focus: () => void;
  getCursorOffset: () => number;
  getCursorViewportY: () => number;
  getViewportCenter: () => { offset: number; viewportY: number };
  getViewportRect: () => DOMRect;
  openSearch: (focusReplacement?: boolean) => void;
  revealRange: (
    from: number,
    to?: number,
    options?: {
      focus?: boolean;
      flash?: boolean;
      viewportY?: number | "center";
    },
  ) => void;
};

type SourceEditorProps = {
  ariaLabel: string;
  diagnostics: SourceDiagnostic[];
  language: "zh" | "en";
  onChange: (value: string) => void;
  onFocus: () => void;
  onScroll: () => void;
  onUserCursorActivity: (activity: {
    highlight: boolean;
    offset: number;
    viewportY: number;
  }) => void;
  value: string;
};

type MathRange = {
  closeFrom: number;
  closeTo: number;
  contentFrom: number;
  contentTo: number;
  from: number;
  openFrom: number;
  openTo: number;
  to: number;
};

const externalDocumentUpdate = Annotation.define<boolean>();
const setSourceFlash = StateEffect.define<{ from: number; to: number }>({
  map(value, changes) {
    return {
      from: changes.mapPos(value.from),
      to: changes.mapPos(value.to),
    };
  },
});
const clearSourceFlash = StateEffect.define<null>();

const sourceFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(clearSourceFlash)) {
        value = Decoration.none;
      } else if (effect.is(setSourceFlash)) {
        const from = Math.min(
          transaction.state.doc.length,
          Math.max(0, effect.value.from),
        );
        const to = Math.min(
          transaction.state.doc.length,
          Math.max(from, effect.value.to),
        );
        const line = transaction.state.doc.lineAt(from);
        const ranges = [
          Decoration.line({ class: "cm-sourceSyncFlashLine" }).range(
            line.from,
          ),
        ];
        if (to > from) {
          ranges.push(
            Decoration.mark({ class: "cm-sourceSyncFlashRange" }).range(
              from,
              to,
            ),
          );
        }
        value = Decoration.set(ranges, true);
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function isEscaped(value: string, offset: number) {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findClosingDelimiter(
  value: string,
  delimiter: string,
  from: number,
  allowNewlines: boolean,
  excludedRanges: Array<{ from: number; to: number }>,
) {
  let excludedIndex = 0;
  for (let index = from; index <= value.length - delimiter.length; index += 1) {
    while (
      excludedIndex < excludedRanges.length &&
      excludedRanges[excludedIndex].to <= index
    ) {
      excludedIndex += 1;
    }
    const excluded = excludedRanges[excludedIndex];
    if (excluded && excluded.from <= index && excluded.to > index) {
      index = excluded.to - 1;
      continue;
    }
    if (!allowNewlines && value[index] === "\n") return -1;
    if (
      value.startsWith(delimiter, index) &&
      !isEscaped(value, index)
    ) {
      return index;
    }
  }
  return -1;
}

function findMathRanges(
  value: string,
  excludedRanges: Array<{ from: number; to: number }>,
) {
  const ranges: MathRange[] = [];
  let excludedIndex = 0;

  for (let index = 0; index < value.length; index += 1) {
    while (
      excludedIndex < excludedRanges.length &&
      excludedRanges[excludedIndex].to <= index
    ) {
      excludedIndex += 1;
    }
    const excluded = excludedRanges[excludedIndex];
    if (excluded && excluded.from <= index && excluded.to > index) {
      index = excluded.to - 1;
      continue;
    }

    let open = "";
    let close = "";
    let allowNewlines = false;
    if (value.startsWith("$$", index) && !isEscaped(value, index)) {
      open = close = "$$";
      allowNewlines = true;
    } else if (value.startsWith("\\[", index) && !isEscaped(value, index)) {
      open = "\\[";
      close = "\\]";
      allowNewlines = true;
    } else if (value.startsWith("\\(", index) && !isEscaped(value, index)) {
      open = "\\(";
      close = "\\)";
    } else if (
      value[index] === "$" &&
      value[index + 1] !== "$" &&
      !isEscaped(value, index)
    ) {
      open = close = "$";
    } else {
      continue;
    }

    const closeFrom = findClosingDelimiter(
      value,
      close,
      index + open.length,
      allowNewlines,
      excludedRanges,
    );
    if (closeFrom < 0) continue;
    const closeTo = closeFrom + close.length;
    ranges.push({
      from: index,
      to: closeTo,
      openFrom: index,
      openTo: index + open.length,
      contentFrom: index + open.length,
      contentTo: closeFrom,
      closeFrom,
      closeTo,
    });
    index = closeTo - 1;
  }

  return ranges;
}

const mathDecoration = Decoration.mark({
  class: "cm-openreviewMath",
});
const mathDelimiterDecoration = Decoration.mark({
  class: "cm-openreviewMathDelimiter",
});
const texCommandDecoration = Decoration.mark({
  class: "cm-openreviewTexCommand",
});
const texBraceDecoration = Decoration.mark({
  class: "cm-openreviewTexBrace",
});

function buildMathDecorations(view: EditorView) {
  const excludedRanges: Array<{ from: number; to: number }> = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (
        /(?:CodeBlock|FencedCode|InlineCode|CodeText)/.test(node.name)
      ) {
        excludedRanges.push({ from: node.from, to: node.to });
      }
    },
  });
  excludedRanges.sort((a, b) => a.from - b.from);

  const value = view.state.doc.toString();
  const decorations: Array<ReturnType<Decoration["range"]>> = [];
  for (const range of findMathRanges(value, excludedRanges)) {
    decorations.push(
      mathDecoration.range(range.from, range.to),
      mathDelimiterDecoration.range(range.openFrom, range.openTo),
      mathDelimiterDecoration.range(range.closeFrom, range.closeTo),
    );

    const content = value.slice(range.contentFrom, range.contentTo);
    for (const match of content.matchAll(/\\(?:[A-Za-z]+|.)/g)) {
      const from = range.contentFrom + (match.index ?? 0);
      decorations.push(texCommandDecoration.range(from, from + match[0].length));
    }
    for (const match of content.matchAll(/[{}[\]]/g)) {
      const from = range.contentFrom + (match.index ?? 0);
      decorations.push(texBraceDecoration.range(from, from + 1));
    }
  }

  return Decoration.set(decorations, true);
}

const openReviewMathHighlighting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMathDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildMathDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

const openReviewMarkdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "#173f56", fontWeight: "700" },
  { tag: tags.strong, color: "#1f2529", fontWeight: "700" },
  { tag: tags.emphasis, color: "#434c52", fontStyle: "italic" },
  { tag: tags.strikethrough, color: "#6f777c", textDecoration: "line-through" },
  { tag: tags.link, color: "#166183", textDecoration: "underline" },
  { tag: tags.url, color: "#477c91" },
  { tag: tags.quote, color: "#68747a", fontStyle: "italic" },
  { tag: tags.monospace, color: "#8c1b13" },
  { tag: tags.contentSeparator, color: "#9caaaF" },
  { tag: tags.processingInstruction, color: "#8a6500" },
  { tag: tags.meta, color: "#68747a" },
]);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--or-input)",
  },
  "&.cm-focused": {
    outline: "none",
    boxShadow: "inset 2px 0 var(--or-blue)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily:
      '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: "0.82rem",
    lineHeight: "1.7",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "20px 22px 32px 10px",
    caretColor: "var(--or-blue-dark)",
  },
  ".cm-line": {
    padding: "0 2px",
  },
  ".cm-gutters": {
    color: "#92989c",
    backgroundColor: "#f4f2ed",
    borderRight: "1px solid #dedbd4",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(23, 83, 113, 0.055)",
  },
  ".cm-activeLineGutter": {
    color: "#43545d",
    backgroundColor: "rgba(23, 83, 113, 0.09)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(45, 119, 151, 0.2)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--or-blue-dark)",
  },
  ".cm-panels": {
    color: "#2f3439",
    backgroundColor: "#fff",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid #aaa69f",
  },
  ".cm-searchMatch": {
    backgroundColor: "rgba(255, 218, 92, 0.62)",
    outline: "1px solid rgba(169, 126, 0, 0.25)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "rgba(255, 137, 69, 0.72)",
  },
  ".cm-tooltip": {
    border: "1px solid #c7c4be",
    boxShadow: "0 6px 18px rgba(44, 58, 74, 0.18)",
  },
});

const chinesePhrases: Record<string, string> = {
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全部",
  "match case": "区分大小写",
  regexp: "正则表达式",
  "by word": "全字匹配",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭",
  "current match": "当前匹配",
  "on line": "位于第",
  Diagnostics: "问题",
  "No diagnostics": "没有问题",
  "Go to line": "转到行",
  go: "转到",
};

export const SourceEditor = forwardRef<
  SourceEditorHandle,
  SourceEditorProps
>(function SourceEditor(
  {
    ariaLabel,
    diagnostics,
    language,
    onChange,
    onFocus,
    onScroll,
    onUserCursorActivity,
    value,
  },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const callbacksRef = useRef({
    onChange,
    onFocus,
    onScroll,
    onUserCursorActivity,
  });
  const initialConfigRef = useRef({ ariaLabel, language, value });
  const phrasesCompartmentRef = useRef(new Compartment());

  callbacksRef.current = {
    onChange,
    onFocus,
    onScroll,
    onUserCursorActivity,
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const initialConfig = initialConfigRef.current;

    const reportCursor = (view: EditorView, highlight: boolean) => {
      const offset = view.state.selection.main.head;
      const cursorRect = view.coordsAtPos(offset);
      const viewportRect = view.scrollDOM.getBoundingClientRect();
      const viewportY = cursorRect
        ? Math.min(
            viewportRect.height,
            Math.max(0, cursorRect.top - viewportRect.top),
          )
        : viewportRect.height / 2;
      callbacksRef.current.onUserCursorActivity({
        highlight,
        offset,
        viewportY,
      });
    };

    const view = new EditorView({
      parent: mount,
      state: EditorState.create({
        doc: initialConfig.value,
        extensions: [
          basicSetup,
          markdown({
            base: markdownLanguage,
            completeHTMLTags: false,
          }),
          syntaxHighlighting(openReviewMarkdownHighlightStyle),
          openReviewMathHighlighting,
          sourceFlashField,
          lintGutter(),
          search({ top: true }),
          keymap.of([indentWithTab]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": initialConfig.ariaLabel,
            autocapitalize: "sentences",
            autocorrect: "on",
            spellcheck: "true",
          }),
          phrasesCompartmentRef.current.of(
            initialConfig.language === "zh"
              ? EditorState.phrases.of(chinesePhrases)
              : [],
          ),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) =>
                transaction.annotation(externalDocumentUpdate),
              )
            ) {
              callbacksRef.current.onChange(update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            click(_event, currentView) {
              window.requestAnimationFrame(() =>
                reportCursor(currentView, true),
              );
              return false;
            },
            focus() {
              callbacksRef.current.onFocus();
              return false;
            },
            keyup(event, currentView) {
              if (
                event.key !== "Meta" &&
                event.key !== "Control" &&
                event.key !== "Alt" &&
                event.key !== "Shift"
              ) {
                window.requestAnimationFrame(() =>
                  reportCursor(currentView, false),
                );
              }
              return false;
            },
          }),
        ],
      }),
    });

    const handleScroll = () => callbacksRef.current.onScroll();
    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });
    viewRef.current = view;

    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [
        externalDocumentUpdate.of(true),
        Transaction.addToHistory.of(false),
      ],
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const length = view.state.doc.length;
    const mappedDiagnostics: Diagnostic[] = diagnostics.map((diagnostic) => {
      const from = Math.min(length, Math.max(0, diagnostic.from));
      return {
        from,
        to: Math.min(length, Math.max(from, diagnostic.to)),
        severity: diagnostic.severity ?? "warning",
        message: diagnostic.message,
      };
    });
    view.dispatch(setDiagnostics(view.state, mappedDiagnostics));
  }, [diagnostics]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: phrasesCompartmentRef.current.reconfigure(
        language === "zh"
          ? EditorState.phrases.of(chinesePhrases)
          : [],
      ),
    });
  }, [language]);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        viewRef.current?.focus();
      },
      getCursorOffset() {
        return viewRef.current?.state.selection.main.head ?? 0;
      },
      getCursorViewportY() {
        const view = viewRef.current;
        if (!view) return 0;
        const cursor = view.coordsAtPos(view.state.selection.main.head);
        const viewport = view.scrollDOM.getBoundingClientRect();
        return cursor
          ? Math.min(
              viewport.height,
              Math.max(0, cursor.top - viewport.top),
            )
          : viewport.height / 2;
      },
      getViewportCenter() {
        const view = viewRef.current;
        if (!view) return { offset: 0, viewportY: 0 };
        const viewport = view.scrollDOM.getBoundingClientRect();
        const content = view.contentDOM.getBoundingClientRect();
        const viewportY = viewport.height / 2;
        return {
          offset:
            view.posAtCoords(
              {
                x: Math.min(content.right - 1, content.left + 12),
                y: viewport.top + viewportY,
              },
              false,
            ) ?? view.state.selection.main.head,
          viewportY,
        };
      },
      getViewportRect() {
        return (
          viewRef.current?.scrollDOM.getBoundingClientRect() ??
          new DOMRect()
        );
      },
      openSearch(focusReplacement = false) {
        const view = viewRef.current;
        if (!view) return;
        openSearchPanel(view);
        if (focusReplacement) {
          window.requestAnimationFrame(() => {
            view.dom
              .querySelector<HTMLInputElement>('[name="replace"]')
              ?.focus();
          });
        }
      },
      revealRange(from, to = from, options = {}) {
        const view = viewRef.current;
        if (!view) return;
        const start = Math.min(view.state.doc.length, Math.max(0, from));
        const end = Math.min(
          view.state.doc.length,
          Math.max(start, to),
        );
        view.dispatch({
          selection: { anchor: start, head: end },
          effects: EditorView.scrollIntoView(start, {
            y:
              options.viewportY === undefined
                ? "nearest"
                : "center",
          }),
        });
        if (options.focus) view.focus();

        window.requestAnimationFrame(() => {
          if (typeof options.viewportY === "number") {
            const cursor = view.coordsAtPos(start);
            const viewport = view.scrollDOM.getBoundingClientRect();
            if (cursor) {
              view.scrollDOM.scrollTop +=
                cursor.top - viewport.top - options.viewportY;
            }
          }
          if (options.flash) {
            view.dispatch({
              effects: setSourceFlash.of({ from: start, to: end }),
            });
            if (flashTimerRef.current !== null) {
              window.clearTimeout(flashTimerRef.current);
            }
            flashTimerRef.current = window.setTimeout(() => {
              flashTimerRef.current = null;
              if (viewRef.current === view) {
                view.dispatch({ effects: clearSourceFlash.of(null) });
              }
            }, 720);
          }
        });
      },
    }),
    [],
  );

  return (
    <div
      ref={mountRef}
      className="sourceEditor sourceCodeMirror"
      data-codemirror-editor
    />
  );
});
