export function renderOpenReviewMarkdown(value?: string): string;
export function renderOpenReviewMarkdownWithAnchors(value?: string): string;
export function parseOpenReviewMarkdown(value?: string): string;
export function setOpenReviewSanitizer(sanitizer: {
  addHook(name: string, hook: (node: Element) => void): void;
  sanitize(value: string): string;
}): void;
