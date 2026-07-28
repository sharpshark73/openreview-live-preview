export function findLiteralMatches(value, query, caseSensitive = false) {
  if (!query) return [];

  const haystack = caseSensitive ? value : value.toLocaleLowerCase();
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches = [];
  let offset = 0;

  while (offset <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, offset);
    if (start === -1) break;
    matches.push({ start, end: start + needle.length });
    offset = start + Math.max(1, needle.length);
  }

  return matches;
}
