export type TextMatch = {
  start: number;
  end: number;
};

export function findLiteralMatches(
  value: string,
  query: string,
  caseSensitive?: boolean,
): TextMatch[];
