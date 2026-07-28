import {
  applyFixes,
  lint,
} from "./vendor/markdownlint-browser.mjs";

const SAFE_LINT_CONFIG = {
  default: false,
  MD012: true,
  MD018: true,
  MD019: true,
  MD027: true,
  MD030: true,
  MD037: true,
  MD039: true,
  MD047: true,
};

function getLine(source, lineNumber) {
  return source.split("\n")[lineNumber - 1] ?? "";
}

function isSafeEmphasisWhitespaceFix(source, error) {
  const { fixInfo } = error;
  if (!fixInfo || fixInfo.editColumn === undefined) return false;

  const line = getLine(source, error.lineNumber);
  const editIndex = fixInfo.editColumn - 1;
  const deleteCount = fixInfo.deleteCount ?? 0;
  const context = error.errorContext ?? "";
  const openingMarker = context.match(/^([*_]{1,3})\s/)?.[1];
  const closingMarker = context.match(/\s([*_]{1,3})$/)?.[1];

  if (openingMarker) {
    const markerStart = editIndex - openingMarker.length;
    const outsideCharacter = line[markerStart - 1];
    return (
      outsideCharacter === undefined ||
      !/[\p{L}\p{N}]/u.test(outsideCharacter)
    );
  }

  if (closingMarker) {
    const markerStart = editIndex + deleteCount;
    const outsideCharacter = line[markerStart + closingMarker.length];
    return (
      outsideCharacter === undefined ||
      !/[\p{L}\p{N}]/u.test(outsideCharacter)
    );
  }

  return false;
}

export function lintAndFixMarkdown(source) {
  const results = lint({
    strings: { source },
    config: SAFE_LINT_CONFIG,
  }).source;
  const fixes = results.filter(
    (error) =>
      error.fixInfo &&
      (error.ruleNames[0] !== "MD037" ||
        isSafeEmphasisWhitespaceFix(source, error)),
  );

  return {
    text: applyFixes(source, fixes),
    fixedCount: fixes.length,
  };
}
