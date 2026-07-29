export type MarkdownWarning = {
  code: string;
  message: string;
  start: number;
  end: number;
};

export type SourceMarkdownMathMatch = {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  math: string;
  display: boolean;
  open: string;
  close: string;
};

export function findSourceMarkdownMath(
  value?: string,
): SourceMarkdownMathMatch[];
export function lintOpenReviewMarkdown(value?: string): MarkdownWarning[];
