import createDOMPurify from "dompurify";
import { marked } from "marked";

function escapeHtmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const renderer = new marked.Renderer();

// Adapted from openreview/openreview-web client/view.js::setupMarked.
renderer.image = ({ href, title, text }) => {
  if (href.startsWith("/images/")) {
    const titleAttr = title ? `title="${title}" ` : "";
    const classAttr = href.endsWith("_icon.svg") ? 'class="icon" ' : "";
    return `<img src="${href}" alt="${text}" ${titleAttr}${classAttr}/>`;
  }
  return escapeHtmlText(
    `<img src="${href}" alt="${text}" title="${title}">`,
  );
};

renderer.checkbox = ({ checked }) => (checked ? "[x]" : "[ ]");
renderer.html = ({ text }) => escapeHtmlText(text);

marked.setOptions({
  baseUrl: null,
  breaks: false,
  gfm: true,
  headerIds: false,
  langPrefix: "language-",
  mangle: false,
  renderer,
});

let injectedSanitizer = null;
let browserSanitizer = null;
let linkHookInstalledFor = null;

function getSanitizer() {
  if (injectedSanitizer) return injectedSanitizer;
  if (typeof window === "undefined") return null;
  browserSanitizer ??= createDOMPurify(window);
  return browserSanitizer;
}

function installLinkHook(sanitizer) {
  if (linkHookInstalledFor === sanitizer) return;
  sanitizer.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  linkHookInstalledFor = sanitizer;
}

function sanitizeParsedHtml(parsedHtml) {
  const sanitizer = getSanitizer();
  if (!sanitizer) {
    return parsedHtml;
  }
  installLinkHook(sanitizer);
  return sanitizer.sanitize(parsedHtml);
}

function parseMarkdownWithSourceAnchors(value) {
  const tokens = marked.lexer(value);
  let sourceOffset = 0;

  return tokens
    .map((token) => {
      const sourceStart = sourceOffset;
      sourceOffset += token.raw?.length ?? 0;

      if (token.type === "space" || token.type === "def") return "";

      const singleTokenList = [token];
      singleTokenList.links = tokens.links;
      const tokenHtml = marked.parser(singleTokenList);
      if (!tokenHtml) return "";

      return (
        `<span class="source-anchor" data-source-start="${sourceStart}" ` +
        `data-source-end="${sourceOffset}" hidden></span>${tokenHtml}`
      );
    })
    .join("");
}

export function renderOpenReviewMarkdown(value = "") {
  return sanitizeParsedHtml(marked(value));
}

export function renderOpenReviewMarkdownWithAnchors(value = "") {
  return sanitizeParsedHtml(parseMarkdownWithSourceAnchors(value));
}

export function parseOpenReviewMarkdown(value = "") {
  return marked(value);
}

export function setOpenReviewSanitizer(sanitizer) {
  injectedSanitizer = sanitizer;
  linkHookInstalledFor = null;
}
