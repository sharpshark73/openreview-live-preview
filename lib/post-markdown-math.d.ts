export const POST_MARKDOWN_BLOCK_BOUNDARY: string;

export type PostMarkdownMathMatch = {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  math: string;
  display: boolean;
  open: string;
  close: string;
};

export function findPostMarkdownMath(
  value?: string,
  boundary?: string,
): PostMarkdownMathMatch[];
