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
import { lintOpenReviewMarkdown } from "../lib/markdown-warnings.mjs";
import { lintAndFixMarkdown } from "../lib/markdown-lint-fix.mjs";
import { findLiteralMatches } from "../lib/text-search.mjs";
import { getPreferredLanguage } from "../lib/language-preference.mjs";
import {
  findPostMarkdownMath,
  POST_MARKDOWN_BLOCK_BOUNDARY,
} from "../lib/post-markdown-math.mjs";
import {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  diffFormulaText,
  pairFormulaInputs,
} from "../lib/formula-diff.mjs";
import {
  SourceEditor,
  type SourceDiagnostic,
  type SourceEditorHandle,
} from "./source-editor";

const STORAGE_KEY = "openreview-live-renderer:draft:v1";
const SYNC_MODE_KEY = "openreview-live-renderer:sync-mode:v1";
const LANGUAGE_KEY = "openreview-live-preview:language:v2";
const NOTICE_KEY = "openreview-live-preview:notice:v1";
const SOURCE_URL = (
  process.env.NEXT_PUBLIC_SOURCE_URL?.trim() ||
  "https://github.com/sharpshark73/openreview-live-preview"
).replace(/\/$/, "");
const LICENSE_URL = `${SOURCE_URL}/blob/main/LICENSE.md`;

const DEFAULT_TEXT = "";

type PreviewMode = "published" | "form";
type PreviewStage = "final" | "markdown";
type MathJaxState = "loading" | "ready" | "error";
type SyncMode = "none" | "click" | "auto";
type SearchScope = "source" | "preview";
type Language = "zh" | "en";
type MarkdownWarning = {
  code: string;
  end: number;
  message: string;
  start: number;
};

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
    edit: "编辑",
    preview: "预览",
    debug: "Debug",
    previewStage: "预览阶段",
    finalPreview: "最终",
    markdownPreview: "Markdown",
    markdownMathInput: "Markdown 后的 MathJax 输入",
    originalMarkdownMath: "Markdown 原文中的公式",
    markdownMathMismatch: "与原 Markdown 不一致",
    formulaPreview: "单公式预览",
    renderingFormula: "正在渲染…",
    mathJaxUnavailable: "MathJax 尚未就绪",
    formulaRenderFailed: "公式渲染失败",
    find: "查找",
    findContent: "查找内容",
    caseSensitive: "区分大小写",
    previous: "上一个",
    previousTitle: "上一个（Shift+Enter）",
    next: "下一个",
    nextTitle: "下一个（Enter）",
    closeFind: "关闭查找",
    closeFindTitle: "关闭（Esc）",
    unsupported: "不支持",
    markdownWarning: "Markdown 警告",
    warningCount: (count: number) => `${count} 条 Markdown 警告`,
    warningLocation: (line: number, column: number) =>
      `第 ${line} 行，第 ${column} 列`,
    sourceFindTitle: "查找与替换（Ctrl/⌘+F）",
    previewFindTitle: "查找（Ctrl/⌘+F）",
    mathJaxError: "MathJax 错误",
    mathJaxInput: "MathJax 读取到的公式",
    mathJaxMessage: "错误信息",
    moreMenu: "更多",
    switchLanguage: "Switch to English",
    notice: "声明",
    source: "源码",
    license: "许可证",
    noticeTitle: "使用声明",
    noticeIntro:
      "OpenReview Live Preview 是独立、非官方工具，与 OpenReview 不存在隶属、授权或背书关系。",
    noticePrivacy:
      "草稿仅保存在当前浏览器的本地存储中，不会发送给 OpenReview 或本工具的服务器。",
    noticeCompatibility:
      "本工具以兼容 OpenReview 渲染为目标；OpenReview 更新后仍可能出现差异，请在正式提交前复核最终预览。",
    noticeLicense:
      "本工具以 GNU AGPL v3 或更高版本发布，并保留 OpenReview 及其他第三方项目的版权声明。",
    acceptNotice: "我已了解",
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
    edit: "Editor",
    preview: "Preview",
    debug: "Debug",
    previewStage: "Preview stage",
    finalPreview: "Final",
    markdownPreview: "Markdown",
    markdownMathInput: "MathJax input after Markdown",
    originalMarkdownMath: "Formula in the original Markdown",
    markdownMathMismatch: "Differs from original Markdown",
    formulaPreview: "Formula preview",
    renderingFormula: "Rendering…",
    mathJaxUnavailable: "MathJax is not ready",
    formulaRenderFailed: "Formula rendering failed",
    find: "Find",
    findContent: "Find text",
    caseSensitive: "Match case",
    previous: "Previous",
    previousTitle: "Previous (Shift+Enter)",
    next: "Next",
    nextTitle: "Next (Enter)",
    closeFind: "Close find",
    closeFindTitle: "Close (Esc)",
    unsupported: "Unsupported",
    markdownWarning: "Markdown warning",
    warningCount: (count: number) =>
      `${count} Markdown warning${count === 1 ? "" : "s"}`,
    warningLocation: (line: number, column: number) =>
      `Line ${line}, column ${column}`,
    sourceFindTitle: "Find and replace (Ctrl/⌘+F)",
    previewFindTitle: "Find (Ctrl/⌘+F)",
    mathJaxError: "MathJax error",
    mathJaxInput: "MathJax input",
    mathJaxMessage: "Error message",
    moreMenu: "More",
    switchLanguage: "切换到中文",
    notice: "Notice",
    source: "Source",
    license: "License",
    noticeTitle: "Before you continue",
    noticeIntro:
      "OpenReview Live Preview is an independent, unofficial tool. It is not affiliated with, authorized by, or endorsed by OpenReview.",
    noticePrivacy:
      "Drafts are stored only in this browser's local storage and are not sent to OpenReview or this tool's server.",
    noticeCompatibility:
      "This tool aims to match OpenReview rendering, but differences may appear after OpenReview updates. Verify the final preview before submitting.",
    noticeLicense:
      "This tool is released under GNU AGPL v3 or later and preserves the notices of OpenReview and other third-party projects.",
    acceptNotice: "I understand",
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

type MathJaxMathItemLike = {
  display?: boolean;
  math?: string;
  typesetRoot?: Element | null;
};

type MathJaxDocumentLike = {
  getMathItemsWithin?: (
    elements: Element | Element[],
  ) => MathJaxMathItemLike[];
  safe?: {
    filterAttributes: Map<string, string>;
    filterMethods: Record<string, unknown>;
  };
};

type MathJaxLike = {
  startup?: {
    defaultReady?: () => void;
    document?: MathJaxDocumentLike;
    promise?: Promise<unknown>;
  };
  typesetPromise?: (elements?: Element[]) => Promise<unknown>;
  tex2chtmlPromise?: (
    math: string,
    options?: Record<string, unknown>,
  ) => Promise<Element>;
  getMetricsFor?: (
    element: Element,
    display?: boolean,
  ) => Record<string, unknown>;
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

function getTextFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}-${hash >>> 0}`;
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

type RenderedTextSegment = {
  node: Text;
  start: number;
  end: number;
};

type MarkdownMathCandidate = {
  id: string;
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  math: string;
  originalMath?: string;
  display: boolean;
  open: string;
  close: string;
};

const BLOCK_ELEMENTS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "DL",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

function collectPostMarkdownText(container: HTMLElement) {
  const parts: string[] = [];
  const segments: RenderedTextSegment[] = [];
  let length = 0;

  const appendBoundary = () => {
    if (parts.at(-1) === POST_MARKDOWN_BLOCK_BOUNDARY) return;
    parts.push(POST_MARKDOWN_BLOCK_BOUNDARY);
    length += POST_MARKDOWN_BLOCK_BOUNDARY.length;
  };

  const visit = (node: Node) => {
    if (node instanceof Text) {
      const value = node.nodeValue ?? "";
      if (!value) return;
      segments.push({ node, start: length, end: length + value.length });
      parts.push(value);
      length += value.length;
      return;
    }

    if (!(node instanceof HTMLElement)) return;
    if (node.matches(".source-anchor, [hidden]")) {
      return;
    }
    if (
      node.matches(
        "pre, code, script, style, textarea, annotation, annotation-xml, mjx-container",
      )
    ) {
      appendBoundary();
      return;
    }

    if (node.tagName === "BR") {
      parts.push("\n");
      length += 1;
      return;
    }

    const isBlock = BLOCK_ELEMENTS.has(node.tagName);
    if (isBlock) appendBoundary();
    for (const child of node.childNodes) visit(child);
    if (isBlock) appendBoundary();
  };

  for (const child of container.childNodes) visit(child);
  return { value: parts.join(""), segments };
}

type RenderedMathReference = {
  display: boolean;
  element: Element;
  math: string;
};

function getSourceAnchorForElement(
  element: Element,
  container: HTMLElement,
) {
  let topLevelElement: Element | null = element;
  while (
    topLevelElement?.parentElement &&
    topLevelElement.parentElement !== container
  ) {
    topLevelElement = topLevelElement.parentElement;
  }
  if (topLevelElement?.parentElement !== container) return null;

  let anchor = topLevelElement.previousElementSibling as HTMLElement | null;
  while (anchor && !anchor.classList.contains("source-anchor")) {
    anchor = anchor.previousElementSibling as HTMLElement | null;
  }
  return anchor;
}

function mapOriginalMathByElement(
  container: HTMLElement,
  sourceText: string,
  rendered: RenderedMathReference[],
) {
  const groups = new Map<
    HTMLElement,
    RenderedMathReference[]
  >();
  for (const formula of rendered) {
    const anchor = getSourceAnchorForElement(formula.element, container);
    if (!anchor) continue;
    const group = groups.get(anchor) ?? [];
    group.push(formula);
    groups.set(anchor, group);
  }

  const originalByElement = new Map<Element, string>();
  for (const [anchor, formulas] of groups) {
    const sourceStart = Number(anchor.dataset.sourceStart ?? 0);
    const sourceEnd = Number(anchor.dataset.sourceEnd ?? sourceStart);
    const sourceFormulas = findPostMarkdownMath(
      sourceText.slice(sourceStart, sourceEnd),
    );
    const pairs = pairFormulaInputs(formulas, sourceFormulas);
    pairs.forEach((originalMath, index) => {
      if (originalMath !== undefined) {
        originalByElement.set(formulas[index].element, originalMath);
      }
    });
  }

  return originalByElement;
}

function annotatePostMarkdownMath(
  container: HTMLElement,
  inputLabel: string,
  sourceText: string,
) {
  const { value, segments } = collectPostMarkdownText(container);
  const candidates: MarkdownMathCandidate[] = findPostMarkdownMath(value).map(
    (match, index) => ({
      ...match,
      id: `markdown-math-${index}`,
    }),
  );

  for (const candidate of [...candidates].reverse()) {
    const affectedSegments = segments
      .filter(
        (segment) =>
          segment.start < candidate.end && segment.end > candidate.start,
      )
      .reverse();

    for (const segment of affectedSegments) {
      const localStart = Math.max(0, candidate.start - segment.start);
      const localEnd = Math.min(
        segment.end - segment.start,
        candidate.end - segment.start,
      );
      if (localStart >= localEnd) continue;

      const after = segment.node.splitText(localEnd);
      const selected =
        localStart === 0 ? segment.node : segment.node.splitText(localStart);
      const marker = document.createElement("span");
      marker.className = "markdownMathCandidate";
      marker.dataset.markdownMathId = candidate.id;
      marker.setAttribute("role", "button");
      marker.tabIndex = 0;
      marker.setAttribute(
        "aria-label",
        `${inputLabel}: ${candidate.math}`,
      );
      selected.parentNode?.insertBefore(marker, after);
      marker.append(selected);
    }
  }

  for (const candidate of candidates) {
    const markers = Array.from(
      container.querySelectorAll<HTMLElement>(
        `[data-markdown-math-id="${candidate.id}"]`,
      ),
    );
    markers.forEach((marker, index) => {
      marker.tabIndex = index === 0 ? 0 : -1;
    });
  }

  const renderedReferences = candidates.flatMap((candidate) => {
    const marker = container.querySelector<HTMLElement>(
      `[data-markdown-math-id="${candidate.id}"]`,
    );
    return marker
      ? [{
          display: candidate.display,
          element: marker,
          math: candidate.math,
        }]
      : [];
  });
  const originalByElement = mapOriginalMathByElement(
    container,
    sourceText,
    renderedReferences,
  );
  for (const candidate of candidates) {
    const marker = container.querySelector<HTMLElement>(
      `[data-markdown-math-id="${candidate.id}"]`,
    );
    candidate.originalMath = marker
      ? originalByElement.get(marker)
      : undefined;
  }

  return new Map(candidates.map((candidate) => [candidate.id, candidate]));
}

function annotateMathJaxErrors(
  container: HTMLElement,
  language: Language,
  mathDocument?: MathJaxDocumentLike,
  sourceText = "",
) {
  const formulaByTypesetRoot = new Map<
    Element,
    { math: string; originalMath?: string }
  >();
  const mathItems = (mathDocument?.getMathItemsWithin?.(container) ?? [])
    .filter(
      (item) => item.typesetRoot && typeof item.math === "string",
    )
    .sort((left, right) => {
      const leftRoot = left.typesetRoot;
      const rightRoot = right.typesetRoot;
      if (!leftRoot || !rightRoot) return 0;
      return leftRoot.compareDocumentPosition(rightRoot) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1;
    });
  const renderedReferences: RenderedMathReference[] = mathItems.map(
    (item) => ({
      display: Boolean(item.display),
      element: item.typesetRoot as Element,
      math: item.math as string,
    }),
  );
  const originalByElement = mapOriginalMathByElement(
    container,
    sourceText,
    renderedReferences,
  );

  for (const item of mathItems) {
    if (item.typesetRoot && typeof item.math === "string") {
      formulaByTypesetRoot.set(item.typesetRoot, {
        math: item.math,
        originalMath: originalByElement.get(item.typesetRoot),
      });
    }
  }

  const errors = container.querySelectorAll<HTMLElement>("mjx-merror");

  for (const error of errors) {
    const message = getMathJaxErrorMessage(error);
    if (!message) continue;

    const typesetRoot = error.closest("mjx-container");
    const formulaDetails = typesetRoot
      ? formulaByTypesetRoot.get(typesetRoot)
      : undefined;
    const formula = formulaDetails?.math;

    error.dataset.openreviewMathError = message;
    if (formula !== undefined) {
      error.dataset.openreviewMathSource = formula;
    }
    if (formulaDetails?.originalMath !== undefined) {
      error.dataset.openreviewMathOriginal = formulaDetails.originalMath;
    }
    error.classList.add("mathJaxError");
    error.tabIndex = 0;
    error.setAttribute(
      "aria-label",
      [
        `${UI_TEXT[language].mathJaxError}: ${message}`,
        formula === undefined
          ? null
          : `${UI_TEXT[language].mathJaxInput}: ${formula}`,
      ]
        .filter(Boolean)
        .join(". "),
    );
  }
}

function getMathJaxErrorMessage(error: Element) {
  return (
    error.getAttribute("data-mjx-error") ||
    error.getAttribute("data-mjx-message") ||
    error.textContent?.trim() ||
    ""
  );
}

function getMathJaxErrorMessages(container: ParentNode) {
  return Array.from(container.querySelectorAll("mjx-merror"))
    .map(getMathJaxErrorMessage)
    .filter((message, index, messages) => (
      Boolean(message) && messages.indexOf(message) === index
    ));
}

function showMarkdownMathErrors(
  output: HTMLElement,
  label: string,
  messages: string[],
) {
  const existing = output.nextElementSibling;
  if (existing?.classList.contains("markdownMathTooltipError")) {
    existing.remove();
  }
  if (messages.length === 0) return;

  const section = document.createElement("section");
  section.className = "markdownMathTooltipError";
  const heading = document.createElement("div");
  heading.className = "markdownMathTooltipErrorLabel";
  heading.textContent = label;
  const messageList = document.createElement("div");
  messageList.className = "markdownMathTooltipErrorMessages";
  for (const message of messages) {
    const item = document.createElement("div");
    item.textContent = message;
    messageList.append(item);
  }
  section.append(heading, messageList);
  output.insertAdjacentElement("afterend", section);
}

type FormulaComparisonOptions = {
  afterLabel: string;
  current: string;
  formulaClassName: string;
  inputLabelClassName: string;
  mismatchLabel: string;
  onToggle?: () => void;
  original?: string;
  originalLabel: string;
  sectionClassName: string;
};

function createFormulaComparison({
  afterLabel,
  current,
  formulaClassName,
  inputLabelClassName,
  mismatchLabel,
  onToggle,
  original,
  originalLabel,
  sectionClassName,
}: FormulaComparisonOptions) {
  const section = document.createElement("section");
  section.className = sectionClassName;
  const labelRow = document.createElement("div");
  labelRow.className = "mathFormulaLabelRow";
  const label = document.createElement("div");
  label.className = inputLabelClassName;
  label.textContent = afterLabel;
  labelRow.append(label);

  const currentFormula = document.createElement("code");
  currentFormula.className = formulaClassName;
  currentFormula.textContent = current;
  section.append(labelRow, currentFormula);

  if (original === undefined || original === current) return section;

  const changes = diffFormulaText(original, current);
  const mismatch = document.createElement("button");
  mismatch.className = "mathFormulaMismatch";
  mismatch.type = "button";
  mismatch.textContent = mismatchLabel;
  mismatch.setAttribute("aria-expanded", "false");
  labelRow.append(mismatch);

  const diffPanel = document.createElement("div");
  diffPanel.className = "mathFormulaDiff";
  diffPanel.hidden = true;

  const appendDiffLine = (
    lineLabel: string,
    side: "original" | "rendered",
  ) => {
    const row = document.createElement("section");
    const rowLabel = document.createElement("div");
    const value = document.createElement("code");
    row.className = "mathFormulaDiffRow";
    rowLabel.className = "mathFormulaDiffLabel";
    rowLabel.textContent = lineLabel;
    value.className = "mathFormulaDiffValue";

    for (const [operation, text] of changes) {
      if (
        (side === "original" && operation === DIFF_INSERT) ||
        (side === "rendered" && operation === DIFF_DELETE)
      ) {
        continue;
      }
      const span = document.createElement("span");
      span.textContent = text;
      if (operation === DIFF_DELETE) {
        span.className = "mathFormulaDiffRemoved";
      } else if (operation === DIFF_INSERT) {
        span.className = "mathFormulaDiffAdded";
      } else if (operation !== DIFF_EQUAL) {
        continue;
      }
      value.append(span);
    }
    row.append(rowLabel, value);
    diffPanel.append(row);
  };

  appendDiffLine(originalLabel, "original");
  appendDiffLine(afterLabel, "rendered");
  section.append(diffPanel);

  mismatch.addEventListener("click", () => {
    const expanded = diffPanel.hidden;
    diffPanel.hidden = !expanded;
    mismatch.setAttribute("aria-expanded", String(expanded));
    window.requestAnimationFrame(() => onToggle?.());
  });

  return section;
}

export default function Editor() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [sanitizationReady, setSanitizationReady] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("published");
  const [previewStage, setPreviewStage] =
    useState<PreviewStage>("final");
  const [mathJaxState, setMathJaxState] =
    useState<MathJaxState>("loading");
  const [copied, setCopied] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>("click");
  const [canUndoLint, setCanUndoLint] = useState(false);
  const [language, setLanguage] = useState<Language>("zh");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [debugMenuOpen, setDebugMenuOpen] = useState(false);
  const ui = UI_TEXT[language];

  const sourceEditorRef = useRef<SourceEditorHandle>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const mathErrorTooltipRef = useRef<HTMLDivElement>(null);
  const markdownMathTooltipRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const debugMenuRef = useRef<HTMLDivElement>(null);
  const debugMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const mathErrorHideTimerRef = useRef<number | null>(null);
  const markdownMathHideTimerRef = useRef<number | null>(null);
  const markdownMathRenderTimerRef = useRef<number | null>(null);
  const sourceScrollFrameRef = useRef<number | null>(null);
  const suppressSourceScrollRef = useRef(false);
  const suppressSourceScrollTimerRef = useRef<number | null>(null);
  const typesetQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const mathErrorTargetRef = useRef<HTMLElement | null>(null);
  const markdownMathTargetIdRef = useRef<string | null>(null);
  const markdownMathRequestRef = useRef(0);
  const markdownMathCandidatesRef = useRef<
    Map<string, MarkdownMathCandidate>
  >(new Map());
  const markdownMathCacheRef = useRef<Map<string, Element>>(new Map());
  const lintUndoRef = useRef<string | null>(null);
  const findBarRef = useRef<HTMLElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const findScopeLabelRef = useRef<HTMLSpanElement>(null);
  const findCountRef = useRef<HTMLSpanElement>(null);
  const findCaseSensitiveRef = useRef<HTMLInputElement>(null);
  const searchScopeRef = useRef<SearchScope>("source");
  const previewRangesRef = useRef<Range[]>([]);
  const searchMatchIndexRef = useRef(-1);
  const previewSearchRefreshRef = useRef<(() => void) | null>(null);
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
  const sourceFingerprint = useMemo(() => getTextFingerprint(text), [text]);
  const markdownWarnings = useMemo(
    () => lintOpenReviewMarkdown(text),
    [text],
  );
  const sourceDiagnostics = useMemo<SourceDiagnostic[]>(
    () =>
      markdownWarnings.map((warning) => ({
        from: warning.start,
        to: warning.end,
        message:
          language === "en"
            ? ENGLISH_WARNING_MESSAGES[warning.code] ?? warning.message
            : warning.message,
      })),
    [language, markdownWarnings],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const storedSyncMode = window.localStorage.getItem(SYNC_MODE_KEY);
    const storedLanguage = window.localStorage.getItem(LANGUAGE_KEY);
    const noticeAccepted = window.localStorage.getItem(NOTICE_KEY) === "accepted";
    const browserLanguages =
      navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];
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
      setLanguage(
        storedLanguage === "zh" || storedLanguage === "en"
          ? storedLanguage
          : getPreferredLanguage(browserLanguages),
      );
      setNoticeOpen(!noticeAccepted);
      setDraftLoaded(true);
      setSanitizationReady(true);
    });
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    window.localStorage.setItem(STORAGE_KEY, text);
  }, [draftLoaded, text]);

  useEffect(() => {
    if (!draftLoaded) return;
    window.localStorage.setItem(SYNC_MODE_KEY, syncMode);
  }, [draftLoaded, syncMode]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  useEffect(() => {
    if (!moreMenuOpen && !debugMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        moreMenuOpen &&
        !moreMenuRef.current?.contains(event.target)
      ) {
        setMoreMenuOpen(false);
      }
      if (
        debugMenuOpen &&
        !debugMenuRef.current?.contains(event.target)
      ) {
        setDebugMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (debugMenuOpen) {
        setDebugMenuOpen(false);
        debugMenuTriggerRef.current?.focus();
      } else {
        setMoreMenuOpen(false);
        moreMenuTriggerRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [debugMenuOpen, moreMenuOpen]);

  useEffect(() => configureAndLoadMathJax(setMathJaxState), []);

  useEffect(() => {
    const mathJax = window.MathJax;
    const container = previewRef.current;
    if (
      previewStage !== "final" ||
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
          annotateMathJaxErrors(
            container,
            language,
            mathJax.startup?.document,
            text,
          );
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
  }, [
    sanitizedHtml,
    mathJaxState,
    previewMode,
    previewStage,
    language,
    text,
  ]);

  useEffect(() => {
    markdownMathCandidatesRef.current.clear();
    markdownMathTargetIdRef.current = null;
    markdownMathRequestRef.current += 1;
    if (markdownMathTooltipRef.current) {
      markdownMathTooltipRef.current.hidden = true;
    }
    if (previewStage !== "markdown") return;

    const frame = window.requestAnimationFrame(() => {
      const container = previewRef.current;
      if (!container) return;
      markdownMathCandidatesRef.current = annotatePostMarkdownMath(
        container,
        ui.markdownMathInput,
        text,
      );
      previewSearchRefreshRef.current?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    sanitizedHtml,
    previewMode,
    previewStage,
    text,
    ui.markdownMathInput,
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      previewSearchRefreshRef.current?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sanitizedHtml, previewMode, previewStage]);

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
          target instanceof Element &&
          target.closest("[data-codemirror-editor]")
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
      if (mathErrorHideTimerRef.current) {
        window.clearTimeout(mathErrorHideTimerRef.current);
      }
      if (markdownMathHideTimerRef.current) {
        window.clearTimeout(markdownMathHideTimerRef.current);
      }
      if (markdownMathRenderTimerRef.current) {
        window.clearTimeout(markdownMathRenderTimerRef.current);
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

  const syncPreviewToCursor = (highlight = true, force = false) => {
    if (syncMode === "none" && !force) return;
    const source = sourceEditorRef.current;
    if (!source) return;
    const sourceOffset = source.getCursorOffset();
    const caretY = source.getCursorViewportY();
    window.requestAnimationFrame(() => {
      syncPreviewToSourceOffset(sourceOffset, caretY, "smooth", highlight);
    });
  };

  const handleSourceScroll = () => {
    if (
      syncMode !== "auto" ||
      suppressSourceScrollRef.current ||
      sourceScrollFrameRef.current
    ) {
      return;
    }

    sourceScrollFrameRef.current = window.requestAnimationFrame(() => {
      sourceScrollFrameRef.current = null;
      const source = sourceEditorRef.current;
      if (!source) return;
      const { offset, viewportY } = source.getViewportCenter();
      syncPreviewToSourceOffset(
        offset,
        viewportY,
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
    const sourceRect = source.getViewportRect();
    const desiredCaretY = Math.min(
      sourceRect.height,
      Math.max(0, event.clientY - sourceRect.top),
    );

    temporarilySuppressSourceScroll();
    source.revealRange(sourceOffset, sourceOffset, {
      focus: true,
      flash: true,
      viewportY: desiredCaretY,
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

  const handleTextChange = (nextText: string) => {
    lintUndoRef.current = null;
    setCanUndoLint(false);
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

  const moveSearchMatch = (direction: -1 | 1) => {
    const matches = previewRangesRef.current;
    if (matches.length === 0) {
      refreshPreviewSearch(true, true);
      return;
    }

    const nextIndex =
      (searchMatchIndexRef.current + direction + matches.length) %
      matches.length;
    searchMatchIndexRef.current = nextIndex;
    updateFindCount(nextIndex, matches.length);

    renderPreviewSearchHighlights();
    revealPreviewMatch(previewRangesRef.current[nextIndex]);
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
    if (scope === "source") {
      clearPreviewSearchHighlights();
      searchScopeRef.current = "source";
      if (findBarRef.current) findBarRef.current.dataset.open = "false";
      sourceEditorRef.current?.openSearch(selectReplacement);
      return;
    }

    if (scope !== searchScopeRef.current) clearPreviewSearchHighlights();
    searchScopeRef.current = scope;
    searchMatchIndexRef.current = -1;

    if (findBarRef.current) {
      findBarRef.current.dataset.open = "true";
      findBarRef.current.dataset.scope = scope;
    }
    if (findScopeLabelRef.current) {
      findScopeLabelRef.current.textContent = ui.preview;
    }

    window.requestAnimationFrame(() => {
      refreshPreviewSearch(true, true);
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  };

  useEffect(() => {
    previewSearchRefreshRef.current = () => refreshPreviewSearch(false);
    openSearchRef.current = openSearch;
    closeSearchRef.current = closeSearch;
  });

  const jumpToMarkdownWarning = (warning: MarkdownWarning) => {
    const source = sourceEditorRef.current;
    if (!source) return;

    temporarilySuppressSourceScroll();
    source.revealRange(warning.start, warning.end, {
      focus: true,
      flash: true,
      viewportY: "center",
    });
  };

  const getMathErrorTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement
      ? target.closest<HTMLElement>("[data-openreview-math-error]")
      : null;

  const hideMathErrorTooltip = () => {
    if (mathErrorHideTimerRef.current !== null) {
      window.clearTimeout(mathErrorHideTimerRef.current);
      mathErrorHideTimerRef.current = null;
    }
    mathErrorTargetRef.current = null;
    if (mathErrorTooltipRef.current) {
      mathErrorTooltipRef.current.hidden = true;
    }
  };

  const scheduleMathErrorTooltipHide = () => {
    if (mathErrorHideTimerRef.current !== null) return;
    mathErrorHideTimerRef.current = window.setTimeout(() => {
      mathErrorHideTimerRef.current = null;
      hideMathErrorTooltip();
    }, 140);
  };

  const cancelMathErrorTooltipHide = () => {
    if (mathErrorHideTimerRef.current === null) return;
    window.clearTimeout(mathErrorHideTimerRef.current);
    mathErrorHideTimerRef.current = null;
  };

  const positionMathErrorTooltip = (
    target: HTMLElement,
    tooltip: HTMLElement,
  ) => {
    const rect = target.getBoundingClientRect();
    tooltip.style.left = "12px";
    tooltip.style.top = "12px";
    tooltip.hidden = false;
    const tooltipRect = tooltip.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const placeAbove =
      tooltipRect.height > spaceBelow && rect.top > spaceBelow;
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - tooltipRect.width - 12),
    );
    const top = placeAbove
      ? Math.max(12, rect.top - tooltipRect.height - 10)
      : Math.min(
          Math.max(12, rect.bottom + 10),
          Math.max(12, window.innerHeight - tooltipRect.height - 12),
        );
    tooltip.classList.toggle("above", placeAbove);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const showMathErrorTooltip = (target: EventTarget | null) => {
    const error = getMathErrorTarget(target);
    const message = error?.dataset.openreviewMathError;
    if (!error || !message) {
      hideMathErrorTooltip();
      return;
    }

    cancelMathErrorTooltipHide();
    const tooltip = mathErrorTooltipRef.current;
    if (!tooltip) return;

    mathErrorTargetRef.current = error;
    const formula = error.dataset.openreviewMathSource;
    const originalFormula = error.dataset.openreviewMathOriginal;
    const header = document.createElement("div");
    header.className = "mathErrorTooltipHeader";
    header.textContent = ui.mathJaxError;

    const content = document.createElement("div");
    content.className = "mathErrorTooltipContent";

    if (formula !== undefined) {
      content.append(
        createFormulaComparison({
          afterLabel: ui.mathJaxInput,
          current: formula,
          formulaClassName: "mathErrorTooltipFormula",
          inputLabelClassName: "mathErrorTooltipLabel",
          mismatchLabel: ui.markdownMathMismatch,
          onToggle: () => positionMathErrorTooltip(error, tooltip),
          original: originalFormula,
          originalLabel: ui.originalMarkdownMath,
          sectionClassName: "mathErrorTooltipSection",
        }),
      );
    }

    const messageSection = document.createElement("section");
    const messageLabel = document.createElement("div");
    const messageText = document.createElement("div");
    messageSection.className =
      "mathErrorTooltipSection markdownMathTooltipError";
    messageLabel.className = "markdownMathTooltipErrorLabel";
    messageLabel.textContent = ui.mathJaxMessage;
    messageText.className =
      "mathErrorTooltipMessage markdownMathTooltipErrorMessages";
    messageText.textContent = message;
    messageSection.append(messageLabel, messageText);
    content.append(messageSection);

    tooltip.replaceChildren(header, content);
    tooltip.className = "mathErrorTooltip";
    positionMathErrorTooltip(error, tooltip);
  };

  const handleMathErrorPointerMove = (target: EventTarget | null) => {
    const error = getMathErrorTarget(target);
    if (error === mathErrorTargetRef.current) return;
    if (error) {
      showMathErrorTooltip(error);
    } else {
      scheduleMathErrorTooltipHide();
    }
  };

  const getMarkdownMathTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement
      ? target.closest<HTMLElement>("[data-markdown-math-id]")
      : null;

  const clearMarkdownMathTarget = () => {
    previewRef.current
      ?.querySelectorAll(".markdownMathCandidateActive")
      .forEach((element) =>
        element.classList.remove("markdownMathCandidateActive"),
      );
    markdownMathTargetIdRef.current = null;
  };

  const hideMarkdownMathTooltip = () => {
    if (markdownMathHideTimerRef.current !== null) {
      window.clearTimeout(markdownMathHideTimerRef.current);
      markdownMathHideTimerRef.current = null;
    }
    if (markdownMathRenderTimerRef.current !== null) {
      window.clearTimeout(markdownMathRenderTimerRef.current);
      markdownMathRenderTimerRef.current = null;
    }
    markdownMathRequestRef.current += 1;
    clearMarkdownMathTarget();
    if (markdownMathTooltipRef.current) {
      markdownMathTooltipRef.current.hidden = true;
    }
  };

  const scheduleMarkdownMathTooltipHide = () => {
    if (markdownMathHideTimerRef.current !== null) return;
    markdownMathHideTimerRef.current = window.setTimeout(() => {
      markdownMathHideTimerRef.current = null;
      hideMarkdownMathTooltip();
    }, 140);
  };

  const cancelMarkdownMathTooltipHide = () => {
    if (markdownMathHideTimerRef.current === null) return;
    window.clearTimeout(markdownMathHideTimerRef.current);
    markdownMathHideTimerRef.current = null;
  };

  const positionMarkdownMathTooltip = (
    target: HTMLElement,
    tooltip: HTMLElement,
  ) => {
    const rect = target.getBoundingClientRect();
    tooltip.style.left = "12px";
    tooltip.style.top = "12px";
    tooltip.hidden = false;
    const tooltipRect = tooltip.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const placeAbove =
      tooltipRect.height > spaceBelow && rect.top > spaceBelow;
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - tooltipRect.width - 12),
    );
    const top = placeAbove
      ? Math.max(12, rect.top - tooltipRect.height - 10)
      : Math.min(
          Math.max(12, rect.bottom + 10),
          Math.max(12, window.innerHeight - tooltipRect.height - 12),
        );
    tooltip.classList.toggle("above", placeAbove);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const renderMarkdownMathCandidate = (
    candidate: MarkdownMathCandidate,
    target: HTMLElement,
    output: HTMLElement,
  ) => {
    const requestId = ++markdownMathRequestRef.current;
    const cacheKey = `${candidate.display ? "display" : "inline"}:${candidate.math}`;
    const cached = markdownMathCacheRef.current.get(cacheKey);
    if (cached) {
      const rendered = cached.cloneNode(true);
      output.replaceChildren(rendered);
      showMarkdownMathErrors(
        output,
        ui.mathJaxMessage,
        getMathJaxErrorMessages(output),
      );
      const tooltip = markdownMathTooltipRef.current;
      if (tooltip) positionMarkdownMathTooltip(target, tooltip);
      return;
    }

    const mathJax = window.MathJax;
    if (
      mathJaxState !== "ready" ||
      !mathJax?.tex2chtmlPromise
    ) {
      output.textContent = ui.mathJaxUnavailable;
      return;
    }

    const metrics = mathJax.getMetricsFor?.(target, candidate.display) ?? {};
    typesetQueueRef.current = typesetQueueRef.current
      .catch(() => undefined)
      .then(() =>
        mathJax.tex2chtmlPromise?.(candidate.math, {
          ...metrics,
          display: candidate.display,
        }),
      )
      .then((rendered) => {
        if (
          !rendered ||
          requestId !== markdownMathRequestRef.current ||
          markdownMathTargetIdRef.current !== candidate.id
        ) {
          return;
        }
        markdownMathCacheRef.current.set(cacheKey, rendered.cloneNode(true) as Element);
        output.replaceChildren(rendered);
        showMarkdownMathErrors(
          output,
          ui.mathJaxMessage,
          getMathJaxErrorMessages(output),
        );
        const tooltip = markdownMathTooltipRef.current;
        if (tooltip) positionMarkdownMathTooltip(target, tooltip);
      })
      .catch((error: unknown) => {
        if (requestId === markdownMathRequestRef.current) {
          output.textContent = ui.formulaRenderFailed;
          showMarkdownMathErrors(output, ui.mathJaxMessage, [
            error instanceof Error ? error.message : String(error),
          ]);
          const tooltip = markdownMathTooltipRef.current;
          if (tooltip) positionMarkdownMathTooltip(target, tooltip);
        }
      });
  };

  const showMarkdownMathTooltip = (target: EventTarget | null) => {
    const marker = getMarkdownMathTarget(target);
    const id = marker?.dataset.markdownMathId;
    const candidate = id
      ? markdownMathCandidatesRef.current.get(id)
      : undefined;
    if (!marker || !id || !candidate) {
      scheduleMarkdownMathTooltipHide();
      return;
    }
    if (id === markdownMathTargetIdRef.current) {
      cancelMarkdownMathTooltipHide();
      return;
    }

    cancelMarkdownMathTooltipHide();
    clearMarkdownMathTarget();
    markdownMathTargetIdRef.current = id;
    previewRef.current
      ?.querySelectorAll<HTMLElement>("[data-markdown-math-id]")
      .forEach((element) => {
        if (element.dataset.markdownMathId === id) {
          element.classList.add("markdownMathCandidateActive");
        }
      });

    const tooltip = markdownMathTooltipRef.current;
    if (!tooltip) return;
    const header = document.createElement("div");
    header.className = "markdownMathTooltipHeader";
    header.textContent = ui.formulaPreview;
    const content = document.createElement("div");
    content.className = "markdownMathTooltipContent";
    const output = document.createElement("div");
    output.className = "markdownMathTooltipOutput";
    output.textContent = ui.renderingFormula;
    content.append(
      createFormulaComparison({
        afterLabel: ui.markdownMathInput,
        current: candidate.math,
        formulaClassName: "markdownMathTooltipFormula",
        inputLabelClassName: "markdownMathTooltipLabel",
        mismatchLabel: ui.markdownMathMismatch,
        onToggle: () => positionMarkdownMathTooltip(marker, tooltip),
        original: candidate.originalMath,
        originalLabel: ui.originalMarkdownMath,
        sectionClassName: "markdownMathTooltipInput",
      }),
      output,
    );
    tooltip.replaceChildren(header, content);
    tooltip.className = "markdownMathTooltip";
    positionMarkdownMathTooltip(marker, tooltip);

    if (markdownMathRenderTimerRef.current !== null) {
      window.clearTimeout(markdownMathRenderTimerRef.current);
    }
    markdownMathRenderTimerRef.current = window.setTimeout(() => {
      markdownMathRenderTimerRef.current = null;
      renderMarkdownMathCandidate(candidate, marker, output);
    }, 160);
  };

  const handleMarkdownMathPointerMove = (target: EventTarget | null) => {
    const marker = getMarkdownMathTarget(target);
    if (marker) {
      showMarkdownMathTooltip(marker);
    } else {
      scheduleMarkdownMathTooltipHide();
    }
  };

  const acceptNotice = () => {
    window.localStorage.setItem(NOTICE_KEY, "accepted");
    setNoticeOpen(false);
  };

  const toggleLanguage = () => {
    setLanguage((current) => {
      const nextLanguage = current === "zh" ? "en" : "zh";
      window.localStorage.setItem(LANGUAGE_KEY, nextLanguage);
      return nextLanguage;
    });
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
              onClick={() => syncPreviewToCursor(true, true)}
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
            <div ref={moreMenuRef} className="moreMenu">
              <button
                ref={moreMenuTriggerRef}
                className="moreMenuTrigger"
                type="button"
                aria-label={ui.moreMenu}
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                onClick={() => setMoreMenuOpen((current) => !current)}
              >
                <span aria-hidden="true">•••</span>
              </button>
              <div
                className="moreMenuPanel"
                role="menu"
                aria-label={ui.moreMenu}
                hidden={!moreMenuOpen}
              >
                <a
                  className="legalLink"
                  href={SOURCE_URL}
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                  onClick={() => setMoreMenuOpen(false)}
                >
                  {ui.source}
                </a>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setNoticeOpen(true);
                  }}
                >
                  {ui.notice}
                </button>
                <button
                  className="languageMenuItem"
                  type="button"
                  role="menuitem"
                  title={ui.switchLanguage}
                  aria-label={ui.switchLanguage}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    toggleLanguage();
                  }}
                >
                  {language === "zh" ? "English" : "中文"}
                </button>
              </div>
            </div>
          </div>
      </header>

      <aside
        ref={findBarRef}
        className="findBar"
        data-open="false"
        data-scope="preview"
        aria-label={ui.previewFindTitle}
      >
        <div className="findRow">
          <span ref={findScopeLabelRef} className="findScope">
            {ui.preview}
          </span>
          <input
            ref={findInputRef}
            className="findInput"
            type="text"
            placeholder={ui.find}
            aria-label={ui.findContent}
            autoComplete="off"
            onInput={() => refreshPreviewSearch(true, true)}
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
              onChange={() => refreshPreviewSearch(true, true)}
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
              <SourceEditor
                ref={sourceEditorRef}
                ariaLabel="OpenReview Markdown source"
                diagnostics={sourceDiagnostics}
                language={language}
                value={text}
                onChange={handleTextChange}
                onFocus={() => {
                  searchScopeRef.current = "source";
                }}
                onScroll={handleSourceScroll}
                onUserCursorActivity={({ highlight, offset, viewportY }) => {
                  if (syncMode === "none") return;
                  window.requestAnimationFrame(() => {
                    syncPreviewToSourceOffset(
                      offset,
                      viewportY,
                      "smooth",
                      highlight,
                    );
                  });
                }}
              />
            </div>
          </article>

          <article className="pane previewPane">
            <header className="paneHeader">
              <div className="paneTitleGroup">
                <strong>{ui.preview}</strong>
                <div
                  ref={debugMenuRef}
                  className="previewDebugMenu"
                >
                  <button
                    ref={debugMenuTriggerRef}
                    className={`previewDebugTrigger ${
                      previewStage === "markdown" ? "active" : ""
                    }`}
                    type="button"
                    aria-label={ui.debug}
                    aria-haspopup="menu"
                    aria-expanded={debugMenuOpen}
                    onClick={() => setDebugMenuOpen((current) => !current)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowDown") return;
                      event.preventDefault();
                      setDebugMenuOpen(true);
                      window.requestAnimationFrame(() => {
                        debugMenuRef.current
                          ?.querySelector<HTMLButtonElement>(
                            '[role="menuitemradio"]',
                          )
                          ?.focus();
                      });
                    }}
                  >
                    <span>{ui.debug}</span>
                    <span aria-hidden="true">▾</span>
                  </button>
                  <div
                    className="previewDebugPanel"
                    role="menu"
                    aria-label={ui.previewStage}
                    hidden={!debugMenuOpen}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "ArrowDown" &&
                        event.key !== "ArrowUp" &&
                        event.key !== "Home" &&
                        event.key !== "End"
                      ) {
                        return;
                      }
                      event.preventDefault();
                      const items = Array.from(
                        event.currentTarget.querySelectorAll<HTMLButtonElement>(
                          '[role="menuitemradio"]',
                        ),
                      );
                      const currentIndex = items.indexOf(
                        document.activeElement as HTMLButtonElement,
                      );
                      const nextIndex =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? items.length - 1
                            : event.key === "ArrowDown"
                              ? (currentIndex + 1) % items.length
                              : (currentIndex - 1 + items.length) %
                                items.length;
                      items[nextIndex]?.focus();
                    }}
                  >
                    {[
                      ["final", ui.finalPreview],
                      ["markdown", ui.markdownPreview],
                    ].map(([stage, label]) => (
                      <button
                        key={stage}
                        type="button"
                        role="menuitemradio"
                        aria-checked={previewStage === stage}
                        onClick={() => {
                          setPreviewStage(stage as PreviewStage);
                          setDebugMenuOpen(false);
                        }}
                      >
                        <span className="previewDebugCheck" aria-hidden="true">
                          {previewStage === stage ? "✓" : ""}
                        </span>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
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
              onScroll={() => {
                hideMathErrorTooltip();
                hideMarkdownMathTooltip();
              }}
              onPointerMove={(event) => {
                if (previewStage === "markdown") {
                  handleMarkdownMathPointerMove(event.target);
                } else {
                  handleMathErrorPointerMove(event.target);
                }
              }}
              onPointerLeave={() => {
                if (previewStage === "markdown") {
                  scheduleMarkdownMathTooltipHide();
                } else {
                  scheduleMathErrorTooltipHide();
                }
              }}
              onFocus={(event) => {
                if (previewStage === "markdown") {
                  showMarkdownMathTooltip(event.target);
                } else {
                  showMathErrorTooltip(event.target);
                }
              }}
              onBlur={() => {
                if (previewStage === "markdown") {
                  scheduleMarkdownMathTooltipHide();
                } else {
                  scheduleMathErrorTooltipHide();
                }
              }}
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
                      key={`published-${previewStage}-${language}-${sourceFingerprint}`}
                      ref={previewRef}
                      className={`note-content-value markdown-rendered ${
                        previewStage === "markdown"
                          ? "markdownStagePreview"
                          : ""
                      }`}
                      data-rendered-html
                      onDoubleClick={handlePreviewDoubleClick}
                      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                    />
                  </div>
                ) : (
                  <div
                    key={`form-${previewStage}-${language}-${sourceFingerprint}`}
                    ref={previewRef}
                    className={`form-preview markdown-rendered ${
                      previewStage === "markdown"
                        ? "markdownStagePreview"
                        : ""
                    }`}
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
        onPointerEnter={cancelMathErrorTooltipHide}
        onPointerLeave={hideMathErrorTooltip}
        hidden
      />
      <div
        ref={markdownMathTooltipRef}
        className="markdownMathTooltip"
        role="tooltip"
        onPointerEnter={cancelMarkdownMathTooltipHide}
        onPointerLeave={hideMarkdownMathTooltip}
        hidden
      />
      {noticeOpen ? (
        <div className="noticeBackdrop">
          <section
            className="noticeDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notice-title"
          >
            <div className="noticeEyebrow">OpenReview Live Preview</div>
            <h2 id="notice-title">{ui.noticeTitle}</h2>
            <p>{ui.noticeIntro}</p>
            <ul>
              <li>{ui.noticePrivacy}</li>
              <li>{ui.noticeCompatibility}</li>
              <li>{ui.noticeLicense}</li>
            </ul>
            <div className="noticeActions">
              <div className="noticeLinks">
                <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                  {ui.source}
                </a>
                <a href={LICENSE_URL} target="_blank" rel="noreferrer">
                  {ui.license}
                </a>
              </div>
              <button type="button" autoFocus onClick={acceptNotice}>
                {ui.acceptNotice}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
