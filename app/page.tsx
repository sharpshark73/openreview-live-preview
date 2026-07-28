"use client";

import {
  ChangeEvent,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  parseOpenReviewMarkdown,
  renderOpenReviewMarkdownWithAnchors,
} from "../lib/openreview-renderer.mjs";
import {
  lintOpenReviewMarkdown,
  type MarkdownWarning,
} from "../lib/markdown-warnings.mjs";
import { lintAndFixMarkdown } from "../lib/markdown-lint-fix.mjs";
import {
  findLiteralMatches,
  type TextMatch,
} from "../lib/text-search.mjs";

const STORAGE_KEY = "openreview-live-renderer:draft:v1";
const SYNC_MODE_KEY = "openreview-live-renderer:sync-mode:v1";
const LANGUAGE_KEY = "openreview-live-preview:language:v1";

const DEFAULT_TEXT = "";

type PreviewMode = "published" | "form";
type MathJaxState = "loading" | "ready" | "error";
type SyncMode = "none" | "click" | "auto";
type SearchScope = "source" | "preview";
type Language = "zh" | "en";

const UI_TEXT = {
  zh: {
    published: "正文",
    form: "表单",
    syncMode: "同步方式",
    noSync: "不同步",
    clickSync: "点击同步",
    autoSync: "自动同步",
    manualSync: "手动同步",
    manualSyncTitle: "按当前左侧光标位置同步一次，不改变同步模式",
    import: "导入",
    download: "下载",
    lintTitle: "自动修复安全的 Markdown 格式问题",
    undo: "撤销",
    reset: "重置",
    copy: "复制",
    copied: "已复制",
    resetConfirm: "清空当前草稿？",
    findAndReplace: "查找与替换",
    edit: "编辑",
    preview: "预览",
    find: "查找",
    findContent: "查找内容",
    caseSensitive: "区分大小写",
    previous: "上一个",
    previousTitle: "上一个（Shift+Enter）",
    next: "下一个",
    nextTitle: "下一个（Enter）",
    closeFind: "关闭查找",
    closeFindTitle: "关闭（Esc）",
    replace: "替换",
    replaceWith: "替换为",
    replaceAll: "全部",
    unsupported: "不支持",
    markdownWarning: "Markdown 警告",
    warningCount: (count: number) => `${count} 条 Markdown 警告`,
    warningLocation: (line: number, column: number) =>
      `第 ${line} 行，第 ${column} 列`,
    sourceFindTitle: "查找与替换（Ctrl/⌘+F）",
    previewFindTitle: "查找（Ctrl/⌘+F）",
    mathJaxError: "MathJax 错误",
    switchLanguage: "Switch to English",
  },
  en: {
    published: "Published",
    form: "Form",
    syncMode: "Sync mode",
    noSync: "No sync",
    clickSync: "Click sync",
    autoSync: "Auto sync",
    manualSync: "Sync now",
    manualSyncTitle:
      "Sync once from the current editor cursor without changing the sync mode",
    import: "Import",
    download: "Download",
    lintTitle: "Automatically fix safe Markdown formatting issues",
    undo: "Undo",
    reset: "Reset",
    copy: "Copy",
    copied: "Copied",
    resetConfirm: "Clear the current draft?",
    findAndReplace: "Find and replace",
    edit: "Editor",
    preview: "Preview",
    find: "Find",
    findContent: "Find text",
    caseSensitive: "Match case",
    previous: "Previous",
    previousTitle: "Previous (Shift+Enter)",
    next: "Next",
    nextTitle: "Next (Enter)",
    closeFind: "Close find",
    closeFindTitle: "Close (Esc)",
    replace: "Replace",
    replaceWith: "Replace with",
    replaceAll: "All",
    unsupported: "Unsupported",
    markdownWarning: "Markdown warning",
    warningCount: (count: number) =>
      `${count} Markdown warning${count === 1 ? "" : "s"}`,
    warningLocation: (line: number, column: number) =>
      `Line ${line}, column ${column}`,
    sourceFindTitle: "Find and replace (Ctrl/⌘+F)",
    previewFindTitle: "Find (Ctrl/⌘+F)",
    mathJaxError: "MathJax error",
    switchLanguage: "切换到中文",
  },
} satisfies Record<Language, Record<string, unknown>>;

const ENGLISH_WARNING_MESSAGES: Record<string, string> = {
  "unclosed-fence": "The fenced code block is not closed",
  "multiline-inline-math":
    "Inline math $…$ crosses a line break and will be split by Markdown; keep it on one line or use $$",
  "unmatched-display-math": "This $$ delimiter may be unmatched",
  "unmatched-inline-math": "This $ delimiter may be unmatched",
  "unsupported-image": "OpenReview will not render this image URL",
  "unsafe-link": "The safety filter will remove this link",
  "raw-html": "OpenReview will display raw HTML as plain text",
  "html-comment": "OpenReview will not hide this HTML comment",
  "escaped-emphasis":
    "Escaped consecutive * characters are displayed literally and do not create bold text",
  "empty-emphasis":
    "Consecutive **** markers create empty or malformed bold text",
  "strong-inner-whitespace":
    "Spaces cannot touch the inside of ** markers; move the space outside",
  "unmatched-strong": "The ** bold markers are not correctly paired",
  "markdown-emphasis-in-math":
    "Markdown parses _ before the formula; write \\_ for OpenReview",
  "indented-code":
    "Markdown interprets this four-space indentation as a code block",
};

type HighlightRegistryLike = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
};

type HighlightConstructorLike = new (...ranges: Range[]) => unknown;

type MathJaxLike = {
  startup?: {
    defaultReady?: () => void;
    document?: {
      safe?: {
        filterAttributes: Map<string, string>;
        filterMethods: Record<string, unknown>;
      };
    };
    promise?: Promise<unknown>;
  };
  typesetPromise?: (elements?: Element[]) => Promise<unknown>;
};

declare global {
  interface Window {
    MathJax?: MathJaxLike;
    isMathJaxLoaded?: boolean;
  }
}

function configureAndLoadMathJax(onState: (state: MathJaxState) => void) {
  const existingMathJax = window.MathJax;
  if (existingMathJax?.typesetPromise && existingMathJax.startup?.promise) {
    onState("ready");
    return () => undefined;
  }

  window.MathJax = {
    loader: { load: ["ui/safe"] },
    options: {
      ignoreHtmlClass: "disable-tex-rendering",
    },
    tex: {
      inlineMath: [
        ["$", "$"],
        ["\\(", "\\)"],
      ],
    },
    chtml: {
      scale: 1,
      minScale: 0.5,
      matchFontHeight: true,
      mtextInheritFont: false,
      merrorInheritFont: true,
      mathmlSpacing: false,
      skipAttributes: {},
      exFactor: 0.5,
      displayAlign: "left",
      displayIndent: "0",
    },
    startup: {
      typeset: false,
      ready() {
        const mathJax = window.MathJax;
        mathJax?.startup?.defaultReady?.();
        const safe = mathJax?.startup?.document?.safe;
        if (safe) {
          safe.filterAttributes.set("fontfamily", "filterFamily");
          safe.filterMethods.filterFamily = (
            _safe: unknown,
            family: string,
          ) => family.split(/;/)[0];
        }
      },
    },
  } as MathJaxLike;

  const existingScript = document.querySelector<HTMLScriptElement>(
    "script[data-openreview-mathjax]",
  );
  const script = existingScript ?? document.createElement("script");

  const handleLoad = () => {
    window.isMathJaxLoaded = true;
    window.MathJax?.startup?.promise
      ?.then(() => onState("ready"))
      .catch(() => onState("error"));
  };
  const handleError = () => onState("error");

  script.addEventListener("load", handleLoad);
  script.addEventListener("error", handleError);

  if (!existingScript) {
    script.src =
      "https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml-full.js";
    script.async = true;
    script.dataset.openreviewMathjax = "3.2.2";
    document.head.appendChild(script);
  }

  return () => {
    script.removeEventListener("load", handleLoad);
    script.removeEventListener("error", handleError);
  };
}

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.appendChild(fallback);
  fallback.select();
  document.execCommand("copy");
  fallback.remove();
  return Promise.resolve();
}

function downloadText(text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "openreview-draft.md";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getCaretViewportY(
  textarea: HTMLTextAreaElement,
  sourceOffset: number,
  clampToViewport = true,
) {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const mirroredProperties = [
    "box-sizing",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "font-variant",
    "letter-spacing",
    "line-height",
    "tab-size",
    "text-align",
    "text-indent",
    "text-transform",
    "word-spacing",
    "overflow-wrap",
  ];

  for (const property of mirroredProperties) {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  }

  mirror.style.position = "fixed";
  mirror.style.top = "0";
  mirror.style.left = "-10000px";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.height = "auto";
  mirror.style.overflow = "hidden";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "normal";

  mirror.append(document.createTextNode(textarea.value.slice(0, sourceOffset)));
  const caretMarker = document.createElement("span");
  caretMarker.textContent = "\u200b";
  mirror.append(caretMarker);
  document.body.append(mirror);

  const caretY = caretMarker.offsetTop - textarea.scrollTop;
  mirror.remove();
  if (!clampToViewport) return caretY;
  return Math.min(textarea.clientHeight, Math.max(0, caretY));
}

function getSourceLocation(value: string, offset: number) {
  const before = value.slice(0, offset);
  const lastLineBreak = before.lastIndexOf("\n");
  return {
    line: before.split("\n").length,
    column: offset - lastLineBreak,
  };
}

function getHighlightApi() {
  const css = window.CSS as typeof CSS & {
    highlights?: HighlightRegistryLike;
  };
  const HighlightClass = (
    window as typeof window & {
      Highlight?: HighlightConstructorLike;
    }
  ).Highlight;

  return css?.highlights && HighlightClass
    ? { registry: css.highlights, HighlightClass }
    : null;
}

function annotateMathJaxErrors(
  container: HTMLElement,
  language: Language,
) {
  const errors = container.querySelectorAll<HTMLElement>("mjx-merror");

  for (const error of errors) {
    const message =
      error.getAttribute("data-mjx-error") ||
      error.getAttribute("data-mjx-message") ||
      error.textContent?.trim();
    if (!message) continue;

    error.dataset.openreviewMathError = message;
    error.classList.add("mathJaxError");
    error.tabIndex = 0;
    error.setAttribute(
      "aria-label",
      `${UI_TEXT[language].mathJaxError}: ${message}`,
    );
  }
}

export default function Home() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [sanitizationReady, setSanitizationReady] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("published");
  const [mathJaxState, setMathJaxState] =
    useState<MathJaxState>("loading");
  const [copied, setCopied] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>("click");
  const [canUndoLint, setCanUndoLint] = useState(false);
  const [language, setLanguage] = useState<Language>("zh");
  const ui = UI_TEXT[language];

  const sourceEditorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const mathErrorTooltipRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const sourceHighlightRef = useRef<HTMLDivElement>(null);
  const sourceHighlightTimerRef = useRef<number | null>(null);
  const sourceScrollFrameRef = useRef<number | null>(null);
  const suppressSourceScrollRef = useRef(false);
  const suppressSourceScrollTimerRef = useRef<number | null>(null);
  const typesetQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const mathErrorTargetRef = useRef<HTMLElement | null>(null);
  const lintUndoRef = useRef<string | null>(null);
  const textRef = useRef(text);
  const findBarRef = useRef<HTMLElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const findScopeLabelRef = useRef<HTMLSpanElement>(null);
  const findCountRef = useRef<HTMLSpanElement>(null);
  const findReplaceRowRef = useRef<HTMLDivElement>(null);
  const findCaseSensitiveRef = useRef<HTMLInputElement>(null);
  const searchScopeRef = useRef<SearchScope>("source");
  const sourceMatchesRef = useRef<TextMatch[]>([]);
  const previewRangesRef = useRef<Range[]>([]);
  const searchMatchIndexRef = useRef(-1);
  const previewSearchRefreshRef = useRef<(() => void) | null>(null);
  const sourceSearchRefreshRef = useRef<
    ((value: string) => void) | null
  >(null);
  const openSearchRef = useRef<
    ((scope: SearchScope, selectReplacement?: boolean) => void) | null
  >(null);
  const closeSearchRef = useRef<(() => void) | null>(null);

  const sanitizedHtml = useMemo(
    () =>
      sanitizationReady
        ? renderOpenReviewMarkdownWithAnchors(text)
        : parseOpenReviewMarkdown(text),
    [sanitizationReady, text],
  );
  const markdownWarnings = useMemo(
    () => lintOpenReviewMarkdown(text),
    [text],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const storedSyncMode = window.localStorage.getItem(SYNC_MODE_KEY);
    const storedLanguage = window.localStorage.getItem(LANGUAGE_KEY);
    queueMicrotask(() => {
      const isOldStarterExample =
        stored?.startsWith("## Summary\n\nThis is an **OpenReview-compatible**") &&
        stored.includes("[OpenReview TeX documentation]");
      if (stored !== null) setText(isOldStarterExample ? "" : stored);
      if (
        storedSyncMode === "none" ||
        storedSyncMode === "click" ||
        storedSyncMode === "auto"
      ) {
        setSyncMode(storedSyncMode);
      }
      if (storedLanguage === "zh" || storedLanguage === "en") {
        setLanguage(storedLanguage);
      }
      setDraftLoaded(true);
      setSanitizationReady(true);
    });
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    window.localStorage.setItem(STORAGE_KEY, text);
  }, [draftLoaded, text]);

  useEffect(() => {
    textRef.current = text;
    const frame = window.requestAnimationFrame(() => {
      if (
        findBarRef.current?.dataset.open === "true" &&
        searchScopeRef.current === "source"
      ) {
        sourceSearchRefreshRef.current?.(text);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [text]);

  useEffect(() => {
    if (!draftLoaded) return;
    window.localStorage.setItem(SYNC_MODE_KEY, syncMode);
  }, [draftLoaded, syncMode]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    if (!draftLoaded) return;
    window.localStorage.setItem(LANGUAGE_KEY, language);
  }, [draftLoaded, language]);

  useEffect(() => configureAndLoadMathJax(setMathJaxState), []);

  useEffect(() => {
    const mathJax = window.MathJax;
    const container = previewRef.current;
    if (
      mathJaxState !== "ready" ||
      !mathJax?.typesetPromise ||
      !container
    ) {
      return;
    }

    let cancelled = false;
    mathErrorTargetRef.current = null;
    if (mathErrorTooltipRef.current) {
      mathErrorTooltipRef.current.hidden = true;
    }
    typesetQueueRef.current = typesetQueueRef.current
      .catch(() => undefined)
      .then(() => mathJax.typesetPromise?.([container]))
      .then(() => {
        if (!cancelled && container.isConnected) {
          annotateMathJaxErrors(container, language);
          previewSearchRefreshRef.current?.();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMathJaxState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sanitizedHtml, mathJaxState, previewMode, language]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      previewSearchRefreshRef.current?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sanitizedHtml, previewMode]);

  useEffect(() => {
    const highlightStyle = document.createElement("style");
    highlightStyle.dataset.openreviewSearchHighlights = "true";
    highlightStyle.textContent = `
      ::highlight(openreview-search-results) {
        color: inherit;
        background-color: rgba(255, 218, 92, 0.72);
      }
      ::highlight(openreview-search-active) {
        color: inherit;
        background-color: rgba(255, 137, 69, 0.9);
      }
    `;
    document.head.append(highlightStyle);

    const handleShortcut = (event: KeyboardEvent) => {
      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        const target = event.target;
        let scope = searchScopeRef.current;
        if (
          target instanceof Node &&
          previewViewportRef.current?.contains(target)
        ) {
          scope = "preview";
        } else if (
          target instanceof Node &&
          sourceEditorRef.current?.contains(target)
        ) {
          scope = "source";
        }
        openSearchRef.current?.(scope);
        return;
      }

      if (commandKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        openSearchRef.current?.("source", true);
        return;
      }

      if (
        event.key === "Escape" &&
        findBarRef.current?.dataset.open === "true"
      ) {
        event.preventDefault();
        closeSearchRef.current?.();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      highlightStyle.remove();
    };
  }, []);

  useEffect(
    () => () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
      if (sourceHighlightTimerRef.current) {
        window.clearTimeout(sourceHighlightTimerRef.current);
      }
      if (sourceScrollFrameRef.current) {
        window.cancelAnimationFrame(sourceScrollFrameRef.current);
      }
      if (suppressSourceScrollTimerRef.current) {
        window.clearTimeout(suppressSourceScrollTimerRef.current);
      }
      const highlightApi = getHighlightApi();
      highlightApi?.registry.delete("openreview-search-results");
      highlightApi?.registry.delete("openreview-search-active");
    },
    [],
  );

  const handleCopy = async () => {
    await copyText(text);
    setCopied(true);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      lintUndoRef.current = null;
      setCanUndoLint(false);
      setText(String(reader.result ?? ""));
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const flashPreviewTarget = (targetElement: HTMLElement) => {
    const preview = previewRef.current;
    if (!preview) return;

    preview
      .querySelectorAll(".syncHighlight")
      .forEach((element) => element.classList.remove("syncHighlight"));
    targetElement.classList.remove("syncHighlight");
    void targetElement.offsetWidth;
    targetElement.classList.add("syncHighlight");
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      targetElement.classList.remove("syncHighlight");
    }, 720);
  };

  const flashSourcePosition = (viewportY: number) => {
    const highlight = sourceHighlightRef.current;
    if (!highlight) return;

    highlight.style.top = `${Math.max(0, viewportY - 2)}px`;
    highlight.classList.remove("active");
    void highlight.offsetWidth;
    highlight.classList.add("active");
    if (sourceHighlightTimerRef.current) {
      window.clearTimeout(sourceHighlightTimerRef.current);
    }
    sourceHighlightTimerRef.current = window.setTimeout(() => {
      highlight.classList.remove("active");
    }, 720);
  };

  const temporarilySuppressSourceScroll = () => {
    suppressSourceScrollRef.current = true;
    if (suppressSourceScrollTimerRef.current) {
      window.clearTimeout(suppressSourceScrollTimerRef.current);
    }
    suppressSourceScrollTimerRef.current = window.setTimeout(() => {
      suppressSourceScrollRef.current = false;
      suppressSourceScrollTimerRef.current = null;
    }, 160);
  };

  const syncPreviewToSourceOffset = (
    sourceOffset: number,
    sourceViewportY: number,
    behavior: ScrollBehavior,
    highlight: boolean,
  ) => {
    const viewport = previewViewportRef.current;
    const preview = previewRef.current;
    if (!viewport || !preview) return;

    const anchors = Array.from(
      preview.querySelectorAll<HTMLElement>(".source-anchor"),
    );
    let matchedAnchor: HTMLElement | undefined;
    let matchedStart = 0;
    let matchedEnd = 0;

    for (const anchor of anchors) {
      const start = Number(anchor.dataset.sourceStart ?? 0);
      if (start > sourceOffset) break;
      matchedAnchor = anchor;
      const end = Number(anchor.dataset.sourceEnd ?? start);
      matchedStart = start;
      matchedEnd = end;
      if (sourceOffset <= end) break;
    }

    let targetElement = matchedAnchor?.nextElementSibling as
      | HTMLElement
      | null
      | undefined;
    while (targetElement?.classList.contains("source-anchor")) {
      targetElement = targetElement.nextElementSibling as HTMLElement | null;
    }

    if (targetElement) {
      const viewportRect = viewport.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      const blockProgress =
        matchedEnd > matchedStart
          ? Math.min(
              1,
              Math.max(
                0,
                (sourceOffset - matchedStart) / (matchedEnd - matchedStart),
              ),
            )
          : 0;
      viewport.scrollTo({
        top: Math.max(
          0,
          viewport.scrollTop +
            targetRect.top -
            viewportRect.top +
            targetRect.height * blockProgress -
            sourceViewportY,
        ),
        behavior,
      });

      if (highlight) flashPreviewTarget(targetElement);
      return;
    }

    const scrollRange = viewport.scrollHeight - viewport.clientHeight;
    const progress = text.length ? sourceOffset / text.length : 0;
    viewport.scrollTo({
      top: Math.max(0, scrollRange * progress),
      behavior,
    });
  };

  const syncPreviewToCursor = (
    target: HTMLTextAreaElement,
    highlight = true,
    force = false,
  ) => {
    if (syncMode === "none" && !force) return;
    const sourceOffset = target.selectionStart;
    const caretY = getCaretViewportY(target, sourceOffset);
    window.requestAnimationFrame(() => {
      syncPreviewToSourceOffset(sourceOffset, caretY, "smooth", highlight);
    });
  };

  const handleSourceScroll = (target: HTMLTextAreaElement) => {
    if (
      syncMode !== "auto" ||
      suppressSourceScrollRef.current ||
      sourceScrollFrameRef.current
    ) {
      return;
    }

    sourceScrollFrameRef.current = window.requestAnimationFrame(() => {
      sourceScrollFrameRef.current = null;
      const sourceViewportY = target.clientHeight / 2;
      const sourceProgress = Math.min(
        1,
        Math.max(
          0,
          (target.scrollTop + sourceViewportY) /
            Math.max(1, target.scrollHeight),
        ),
      );
      syncPreviewToSourceOffset(
        Math.round(text.length * sourceProgress),
        sourceViewportY,
        "auto",
        false,
      );
    });
  };

  const handlePreviewDoubleClick = (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    const preview = previewRef.current;
    const source = sourceEditorRef.current;
    if (!preview || !source || !(event.target instanceof HTMLElement)) return;

    let targetBlock: HTMLElement | null = event.target;
    while (targetBlock.parentElement && targetBlock.parentElement !== preview) {
      targetBlock = targetBlock.parentElement;
    }
    if (targetBlock.parentElement !== preview) return;

    let anchor = targetBlock.previousElementSibling as HTMLElement | null;
    while (anchor && !anchor.classList.contains("source-anchor")) {
      anchor = anchor.previousElementSibling as HTMLElement | null;
    }
    if (!anchor) return;

    const sourceStart = Number(anchor.dataset.sourceStart ?? 0);
    const sourceEnd = Number(anchor.dataset.sourceEnd ?? sourceStart);
    const targetRect = targetBlock.getBoundingClientRect();
    const blockProgress = targetRect.height
      ? Math.min(
          1,
          Math.max(0, (event.clientY - targetRect.top) / targetRect.height),
        )
      : 0;
    const sourceOffset = Math.round(
      sourceStart + (sourceEnd - sourceStart) * blockProgress,
    );
    const sourceRect = source.getBoundingClientRect();
    const desiredCaretY = Math.min(
      source.clientHeight,
      Math.max(0, event.clientY - sourceRect.top),
    );

    source.selectionStart = sourceOffset;
    source.selectionEnd = sourceOffset;
    source.focus({ preventScroll: true });
    temporarilySuppressSourceScroll();
    window.requestAnimationFrame(() => {
      const currentCaretY = getCaretViewportY(source, sourceOffset, false);
      source.scrollTop += currentCaretY - desiredCaretY;
      flashSourcePosition(getCaretViewportY(source, sourceOffset));
    });
    flashPreviewTarget(targetBlock);
  };

  const handleReset = () => {
    if (!window.confirm(ui.resetConfirm)) {
      return;
    }
    lintUndoRef.current = null;
    setCanUndoLint(false);
    setText(DEFAULT_TEXT);
  };

  const handleLint = () => {
    const result = lintAndFixMarkdown(text);
    if (result.text === text) return;

    lintUndoRef.current = text;
    setCanUndoLint(true);
    setText(result.text);
  };

  const handleUndoLint = () => {
    const previousText = lintUndoRef.current;
    if (previousText === null) return;

    lintUndoRef.current = null;
    setCanUndoLint(false);
    setText(previousText);
    sourceEditorRef.current?.focus();
  };

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextText = event.target.value;
    lintUndoRef.current = null;
    setCanUndoLint(false);
    textRef.current = nextText;
    setText(nextText);
  };

  const updateFindCount = (index: number, total: number) => {
    if (!findCountRef.current) return;
    findCountRef.current.textContent =
      total > 0 ? `${index + 1}/${total}` : "0/0";
  };

  const clearPreviewSearchHighlights = () => {
    const highlightApi = getHighlightApi();
    highlightApi?.registry.delete("openreview-search-results");
    highlightApi?.registry.delete("openreview-search-active");
    previewRangesRef.current = [];
  };

  const revealSourceMatch = (match: TextMatch) => {
    const source = sourceEditorRef.current;
    if (!source) return;

    source.setSelectionRange(match.start, match.end);
    temporarilySuppressSourceScroll();
    window.requestAnimationFrame(() => {
      const currentY = getCaretViewportY(source, match.start, false);
      source.scrollTop += currentY - source.clientHeight / 2;
      flashSourcePosition(getCaretViewportY(source, match.start));
    });
  };

  const refreshSourceSearch = (
    value = textRef.current,
    reveal = false,
    preferredOffset?: number,
  ) => {
    const query = findInputRef.current?.value ?? "";
    const matches = findLiteralMatches(
      value,
      query,
      findCaseSensitiveRef.current?.checked ?? false,
    );
    sourceMatchesRef.current = matches;

    let index = searchMatchIndexRef.current;
    if (matches.length === 0) {
      index = -1;
    } else if (preferredOffset !== undefined) {
      const nextIndex = matches.findIndex(
        (match) => match.start >= preferredOffset,
      );
      index = nextIndex === -1 ? 0 : nextIndex;
    } else if (index < 0 || index >= matches.length) {
      index = 0;
    }

    searchMatchIndexRef.current = index;
    updateFindCount(index, matches.length);
    if (reveal && index >= 0) revealSourceMatch(matches[index]);
  };

  const buildPreviewSearchRanges = (query: string, caseSensitive: boolean) => {
    const preview = previewRef.current;
    if (!preview || !query) return [];

    const textNodes: Array<{
      node: Text;
      start: number;
      end: number;
    }> = [];
    const parts: string[] = [];
    let length = 0;
    const walker = document.createTreeWalker(
      preview,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const value = node.nodeValue ?? "";
          const parent = node.parentElement;
          if (
            !value ||
            !parent ||
            parent.closest(
              ".source-anchor, script, style, mjx-assistive-mml, [hidden]",
            )
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    let currentNode = walker.nextNode();
    while (currentNode) {
      const node = currentNode as Text;
      const value = node.nodeValue ?? "";
      textNodes.push({ node, start: length, end: length + value.length });
      parts.push(value);
      length += value.length;
      currentNode = walker.nextNode();
    }

    const flatText = parts.join("");
    const matches = findLiteralMatches(flatText, query, caseSensitive);
    const ranges: Range[] = [];
    let startNodeIndex = 0;
    let endNodeIndex = 0;

    for (const match of matches) {
      while (
        startNodeIndex < textNodes.length &&
        textNodes[startNodeIndex].end <= match.start
      ) {
        startNodeIndex += 1;
      }
      endNodeIndex = Math.max(endNodeIndex, startNodeIndex);
      while (
        endNodeIndex < textNodes.length &&
        textNodes[endNodeIndex].end < match.end
      ) {
        endNodeIndex += 1;
      }

      const startEntry = textNodes[startNodeIndex];
      const endEntry = textNodes[endNodeIndex];
      if (!startEntry || !endEntry) continue;

      const range = new Range();
      range.setStart(startEntry.node, match.start - startEntry.start);
      range.setEnd(endEntry.node, match.end - endEntry.start);
      ranges.push(range);
    }

    return ranges;
  };

  const renderPreviewSearchHighlights = () => {
    const highlightApi = getHighlightApi();
    if (!highlightApi) {
      if (findCountRef.current) {
        findCountRef.current.textContent = ui.unsupported;
      }
      return;
    }

    const { registry, HighlightClass } = highlightApi;
    registry.delete("openreview-search-results");
    registry.delete("openreview-search-active");
    const ranges = previewRangesRef.current;
    if (ranges.length === 0) return;

    registry.set(
      "openreview-search-results",
      new HighlightClass(...ranges),
    );
    const activeRange = ranges[searchMatchIndexRef.current];
    if (activeRange) {
      registry.set(
        "openreview-search-active",
        new HighlightClass(activeRange),
      );
    }
  };

  const revealPreviewMatch = (range: Range) => {
    const viewport = previewViewportRef.current;
    if (!viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const matchRect = range.getBoundingClientRect();
    viewport.scrollTo({
      top: Math.max(
        0,
        viewport.scrollTop +
          matchRect.top -
          viewportRect.top -
          viewport.clientHeight / 2,
      ),
      behavior: "smooth",
    });
  };

  const refreshPreviewSearch = (
    reveal = false,
    resetActiveMatch = false,
  ) => {
    clearPreviewSearchHighlights();
    if (
      findBarRef.current?.dataset.open !== "true" ||
      searchScopeRef.current !== "preview"
    ) {
      return;
    }

    const query = findInputRef.current?.value ?? "";
    const ranges = buildPreviewSearchRanges(
      query,
      findCaseSensitiveRef.current?.checked ?? false,
    );
    previewRangesRef.current = ranges;

    let index = resetActiveMatch ? 0 : searchMatchIndexRef.current;
    if (ranges.length === 0) {
      index = -1;
    } else if (index < 0 || index >= ranges.length) {
      index = 0;
    }
    searchMatchIndexRef.current = index;
    updateFindCount(index, ranges.length);
    renderPreviewSearchHighlights();
    if (reveal && index >= 0) revealPreviewMatch(ranges[index]);
  };

  const refreshActiveSearch = (reveal = true, resetActiveMatch = false) => {
    if (searchScopeRef.current === "source") {
      refreshSourceSearch(
        textRef.current,
        reveal,
        resetActiveMatch
          ? sourceEditorRef.current?.selectionStart ?? 0
          : undefined,
      );
    } else {
      refreshPreviewSearch(reveal, resetActiveMatch);
    }
  };

  const moveSearchMatch = (direction: -1 | 1) => {
    const matches =
      searchScopeRef.current === "source"
        ? sourceMatchesRef.current
        : previewRangesRef.current;
    if (matches.length === 0) {
      refreshActiveSearch(true, true);
      return;
    }

    const nextIndex =
      (searchMatchIndexRef.current + direction + matches.length) %
      matches.length;
    searchMatchIndexRef.current = nextIndex;
    updateFindCount(nextIndex, matches.length);

    if (searchScopeRef.current === "source") {
      revealSourceMatch(sourceMatchesRef.current[nextIndex]);
    } else {
      renderPreviewSearchHighlights();
      revealPreviewMatch(previewRangesRef.current[nextIndex]);
    }
  };

  const closeSearch = () => {
    if (findBarRef.current) findBarRef.current.dataset.open = "false";
    clearPreviewSearchHighlights();
    searchMatchIndexRef.current = -1;
    updateFindCount(-1, 0);
  };

  const openSearch = (
    scope: SearchScope,
    selectReplacement = false,
  ) => {
    if (scope !== searchScopeRef.current) clearPreviewSearchHighlights();
    searchScopeRef.current = scope;
    searchMatchIndexRef.current = -1;

    if (findBarRef.current) {
      findBarRef.current.dataset.open = "true";
      findBarRef.current.dataset.scope = scope;
    }
    if (findScopeLabelRef.current) {
      findScopeLabelRef.current.textContent =
        scope === "source" ? ui.edit : ui.preview;
    }
    if (findReplaceRowRef.current) {
      findReplaceRowRef.current.dataset.visible =
        scope === "source" ? "true" : "false";
    }

    window.requestAnimationFrame(() => {
      refreshActiveSearch(true, true);
      const target =
        selectReplacement && scope === "source"
          ? replaceInputRef.current
          : findInputRef.current;
      target?.focus();
      target?.select();
    });
  };

  useEffect(() => {
    previewSearchRefreshRef.current = () => refreshPreviewSearch(false);
    sourceSearchRefreshRef.current = (value) =>
      refreshSourceSearch(
        value,
        false,
        sourceEditorRef.current?.selectionStart ?? 0,
      );
    openSearchRef.current = openSearch;
    closeSearchRef.current = closeSearch;
  });

  const replaceCurrentSearchMatch = () => {
    if (searchScopeRef.current !== "source") return;
    refreshSourceSearch(textRef.current);
    const match = sourceMatchesRef.current[searchMatchIndexRef.current];
    if (!match) return;

    const replacement = replaceInputRef.current?.value ?? "";
    const nextText =
      textRef.current.slice(0, match.start) +
      replacement +
      textRef.current.slice(match.end);
    lintUndoRef.current = null;
    setCanUndoLint(false);
    textRef.current = nextText;
    setText(nextText);
    window.requestAnimationFrame(() => {
      refreshSourceSearch(
        nextText,
        true,
        match.start + replacement.length,
      );
    });
  };

  const replaceAllSearchMatches = () => {
    if (searchScopeRef.current !== "source") return;
    refreshSourceSearch(textRef.current);
    const matches = sourceMatchesRef.current;
    if (matches.length === 0) return;

    const replacement = replaceInputRef.current?.value ?? "";
    const parts: string[] = [];
    let offset = 0;
    for (const match of matches) {
      parts.push(textRef.current.slice(offset, match.start), replacement);
      offset = match.end;
    }
    parts.push(textRef.current.slice(offset));
    const nextText = parts.join("");

    lintUndoRef.current = null;
    setCanUndoLint(false);
    textRef.current = nextText;
    setText(nextText);
    window.requestAnimationFrame(() => {
      refreshSourceSearch(nextText, true, 0);
    });
  };

  const jumpToMarkdownWarning = (warning: MarkdownWarning) => {
    const source = sourceEditorRef.current;
    if (!source) return;

    source.selectionStart = warning.start;
    source.selectionEnd = warning.end;
    source.focus({ preventScroll: true });
    temporarilySuppressSourceScroll();
    window.requestAnimationFrame(() => {
      const currentY = getCaretViewportY(source, warning.start, false);
      source.scrollTop += currentY - source.clientHeight / 2;
      flashSourcePosition(getCaretViewportY(source, warning.start));
    });
  };

  const getMathErrorTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement
      ? target.closest<HTMLElement>("[data-openreview-math-error]")
      : null;

  const hideMathErrorTooltip = () => {
    mathErrorTargetRef.current = null;
    if (mathErrorTooltipRef.current) {
      mathErrorTooltipRef.current.hidden = true;
    }
  };

  const showMathErrorTooltip = (target: EventTarget | null) => {
    const error = getMathErrorTarget(target);
    const message = error?.dataset.openreviewMathError;
    if (!error || !message) {
      hideMathErrorTooltip();
      return;
    }

    const rect = error.getBoundingClientRect();
    const placement =
      rect.bottom + 118 > window.innerHeight && rect.top > 118
        ? "above"
        : "below";
    const tooltip = mathErrorTooltipRef.current;
    if (!tooltip) return;

    mathErrorTargetRef.current = error;
    tooltip.textContent = message;
    tooltip.className = `mathErrorTooltip ${placement}`;
    tooltip.style.left = `${Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - 392),
    )}px`;
    tooltip.style.top = `${
      placement === "above" ? rect.top - 8 : rect.bottom + 8
    }px`;
    tooltip.hidden = false;
  };

  const handleMathErrorPointerMove = (target: EventTarget | null) => {
    const error = getMathErrorTarget(target);
    if (error === mathErrorTargetRef.current) return;
    if (error) {
      showMathErrorTooltip(error);
    } else {
      hideMathErrorTooltip();
    }
  };

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="brand" aria-label="OpenReview Live Preview">
          <strong>OR</strong>
          <span>Live Preview</span>
        </div>
          <div className="controlGroup">
            <button
              className={previewMode === "published" ? "active" : ""}
              onClick={() => setPreviewMode("published")}
              type="button"
            >
              {ui.published}
            </button>
            <button
              className={previewMode === "form" ? "active" : ""}
              onClick={() => setPreviewMode("form")}
              type="button"
            >
              {ui.form}
            </button>
          </div>

          <div
            className="controlGroup syncModeGroup"
            aria-label={ui.syncMode}
          >
            {[
              ["none", ui.noSync],
              ["click", ui.clickSync],
              ["auto", ui.autoSync],
            ].map(([mode, label]) => (
              <button
                key={mode}
                className={syncMode === mode ? "active" : ""}
                type="button"
                aria-pressed={syncMode === mode}
                onClick={() => setSyncMode(mode as SyncMode)}
              >
                {label}
              </button>
            ))}
            <button
              className="manualSyncAction"
              type="button"
              title={ui.manualSyncTitle}
              onClick={() => {
                const source = sourceEditorRef.current;
                if (source) syncPreviewToCursor(source, true, true);
              }}
            >
              {ui.manualSync}
            </button>
          </div>

          <div className="toolbarActions">
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt,text/plain,text/markdown"
              onChange={handleFile}
              hidden
            />
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              {ui.import}
            </button>
            <button type="button" onClick={() => downloadText(text)}>
              {ui.download}
            </button>
            <button type="button" onClick={handleLint} title={ui.lintTitle}>
              Lint
            </button>
            {canUndoLint ? (
              <button type="button" onClick={handleUndoLint}>
                {ui.undo}
              </button>
            ) : null}
            <button type="button" onClick={handleReset}>
              {ui.reset}
            </button>
            <button className="primaryAction" type="button" onClick={handleCopy}>
              {copied ? ui.copied : ui.copy}
            </button>
            <button
              className="languageSwitch"
              type="button"
              title={ui.switchLanguage}
              aria-label={ui.switchLanguage}
              onClick={() =>
                setLanguage((current) => (current === "zh" ? "en" : "zh"))
              }
            >
              {language === "zh" ? "EN" : "中文"}
            </button>
          </div>
      </header>

      <aside
        ref={findBarRef}
        className="findBar"
        data-open="false"
        data-scope="source"
        aria-label={ui.findAndReplace}
      >
        <div className="findRow">
          <span ref={findScopeLabelRef} className="findScope">
            {ui.edit}
          </span>
          <input
            ref={findInputRef}
            className="findInput"
            type="text"
            placeholder={ui.find}
            aria-label={ui.findContent}
            autoComplete="off"
            onInput={() => refreshActiveSearch(true, true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                moveSearchMatch(event.shiftKey ? -1 : 1);
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
          />
          <label className="findCaseToggle" title={ui.caseSensitive}>
            <input
              ref={findCaseSensitiveRef}
              type="checkbox"
              aria-label={ui.caseSensitive}
              onChange={() => refreshActiveSearch(true, true)}
            />
            Aa
          </label>
          <span ref={findCountRef} className="findCount" aria-live="polite">
            0/0
          </span>
          <button
            className="findIconButton"
            type="button"
            aria-label={ui.previous}
            title={ui.previousTitle}
            onClick={() => moveSearchMatch(-1)}
          >
            ↑
          </button>
          <button
            className="findIconButton"
            type="button"
            aria-label={ui.next}
            title={ui.nextTitle}
            onClick={() => moveSearchMatch(1)}
          >
            ↓
          </button>
          <button
            className="findIconButton"
            type="button"
            aria-label={ui.closeFind}
            title={ui.closeFindTitle}
            onClick={closeSearch}
          >
            ×
          </button>
        </div>
        <div
          ref={findReplaceRowRef}
          className="findRow findReplaceRow"
          data-visible="true"
        >
          <span className="findScope">{ui.replace}</span>
          <input
            ref={replaceInputRef}
            className="findInput"
            type="text"
            placeholder={ui.replaceWith}
            aria-label={ui.replaceWith}
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                replaceCurrentSearchMatch();
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
          />
          <button type="button" onClick={replaceCurrentSearchMatch}>
            {ui.replace}
          </button>
          <button type="button" onClick={replaceAllSearchMatches}>
            {ui.replaceAll}
          </button>
        </div>
      </aside>

      <main className="workspace">
          <article className="pane editorPane">
            <header className="paneHeader">
              <strong>{ui.edit}</strong>
              <div className="paneHeaderActions">
                {markdownWarnings.length ? (
                  <details className="warningMenu">
                    <summary
                      aria-label={ui.warningCount(markdownWarnings.length)}
                      title={ui.markdownWarning}
                    >
                      ⚠ {markdownWarnings.length}
                    </summary>
                    <div className="warningPanel">
                      {markdownWarnings.map((warning) => {
                        const location = getSourceLocation(text, warning.start);
                        return (
                          <button
                            key={`${warning.code}-${warning.start}`}
                            type="button"
                            onClick={(event) => {
                              jumpToMarkdownWarning(warning);
                              event.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                          }}
                        >
                          <span>
                            {ui.warningLocation(
                              location.line,
                              location.column,
                            )}
                          </span>
                          {language === "en"
                            ? ENGLISH_WARNING_MESSAGES[warning.code] ??
                              warning.message
                            : warning.message}
                        </button>
                        );
                      })}
                    </div>
                  </details>
                ) : null}
                <button
                  className="paneFindButton"
                  type="button"
                  title={ui.sourceFindTitle}
                  onClick={() => openSearch("source")}
                >
                  {ui.find}
                </button>
              </div>
            </header>

            <div className="sourceEditorWrap">
              <textarea
                ref={sourceEditorRef}
                aria-label="OpenReview Markdown source"
                className="sourceEditor"
                value={text}
                spellCheck
                onChange={handleTextChange}
                onFocus={() => {
                  searchScopeRef.current = "source";
                }}
                onClick={(event) => syncPreviewToCursor(event.currentTarget)}
                onKeyUp={(event) =>
                  syncPreviewToCursor(event.currentTarget, false)
                }
                onScroll={(event) => handleSourceScroll(event.currentTarget)}
              />
              <div
                ref={sourceHighlightRef}
                className="sourceSyncFlash"
                aria-hidden="true"
              />
            </div>
          </article>

          <article className="pane previewPane">
            <header className="paneHeader">
              <strong>{ui.preview}</strong>
              <button
                className="paneFindButton"
                type="button"
                title={ui.previewFindTitle}
                onClick={() => openSearch("preview")}
              >
                {ui.find}
              </button>
            </header>

            <div
              ref={previewViewportRef}
              className="previewViewport"
              onPointerDown={() => {
                searchScopeRef.current = "preview";
              }}
              onScroll={hideMathErrorTooltip}
              onPointerMove={(event) =>
                handleMathErrorPointerMove(event.target)
              }
              onPointerLeave={hideMathErrorTooltip}
              onFocus={(event) => showMathErrorTooltip(event.target)}
              onBlur={hideMathErrorTooltip}
            >
              <div
                className={`openreviewFrame ${
                  previewMode === "published" ? "publishedFrame" : "formFrame"
                }`}
              >
                {previewMode === "published" ? (
                  <div className="note-content">
                    <strong className="note-content-field disable-tex-rendering">
                      Preview:
                    </strong>{" "}
                    <div
                      ref={previewRef}
                      className="note-content-value markdown-rendered"
                      data-rendered-html
                      onDoubleClick={handlePreviewDoubleClick}
                      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                    />
                  </div>
                ) : (
                  <div
                    ref={previewRef}
                    className="form-preview markdown-rendered"
                    data-rendered-html
                    onDoubleClick={handlePreviewDoubleClick}
                    dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                  />
                )}
              </div>
            </div>
          </article>
      </main>
      <div
        ref={mathErrorTooltipRef}
        className="mathErrorTooltip below"
        role="tooltip"
        hidden
      />
    </div>
  );
}
