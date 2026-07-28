export type MarkdownWarning = {
  code: string;
  message: string;
  start: number;
  end: number;
};

export function lintOpenReviewMarkdown(value?: string): MarkdownWarning[];
