export type MarkdownLintFixResult = {
  text: string;
  fixedCount: number;
};

export function lintAndFixMarkdown(source: string): MarkdownLintFixResult;
