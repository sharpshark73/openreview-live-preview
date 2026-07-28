import { marked } from "marked";

function isEscaped(value, offset) {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function collectFenceRanges(value, warnings) {
  const ranges = [];
  const linePattern = /.*(?:\n|$)/g;
  let openFence = null;

  for (const match of value.matchAll(linePattern)) {
    if (!match[0]) continue;
    const line = match[0].replace(/\n$/, "");
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence) continue;

    const marker = fence[1];
    const markerCharacter = marker[0];
    const remainder = fence[2];
    if (!openFence) {
      openFence = {
        start: match.index,
        markerCharacter,
        markerLength: marker.length,
      };
      continue;
    }

    if (
      markerCharacter === openFence.markerCharacter &&
      marker.length >= openFence.markerLength &&
      remainder.trim() === ""
    ) {
      ranges.push([openFence.start, match.index + match[0].length]);
      openFence = null;
    }
  }

  if (openFence) {
    ranges.push([openFence.start, value.length]);
    warnings.push({
      code: "unclosed-fence",
      message: "代码块没有闭合",
      start: openFence.start,
      end: Math.min(value.length, openFence.start + openFence.markerLength),
    });
  }

  return ranges;
}

function isInsideRange(offset, ranges) {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

function collectInlineCodeRanges(value, fenceRanges) {
  const ranges = [];
  for (const match of value.matchAll(/(`+)([\s\S]*?)\1/g)) {
    if (!isInsideRange(match.index, fenceRanges)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

function addMatches(value, pattern, ranges, createWarning, warnings) {
  for (const match of value.matchAll(pattern)) {
    if (isInsideRange(match.index, ranges)) continue;
    const warning = createWarning(match);
    if (warning) warnings.push(warning);
  }
}

function collectMathRanges(value, ignoredRanges, warnings) {
  const ranges = [];
  let displayStart = null;
  let inlineStart = null;

  for (let offset = 0; offset < value.length; offset += 1) {
    if (
      value[offset] !== "$" ||
      isEscaped(value, offset) ||
      isInsideRange(offset, ignoredRanges)
    ) {
      continue;
    }

    if (value[offset + 1] === "$") {
      if (displayStart === null) {
        displayStart = offset;
      } else {
        ranges.push([displayStart, offset + 2]);
        displayStart = null;
      }
      offset += 1;
      continue;
    }

    if (displayStart !== null) continue;
    if (inlineStart === null) {
      inlineStart = offset;
      continue;
    }

    ranges.push([inlineStart, offset + 1]);
    if (value.slice(inlineStart + 1, offset).includes("\n")) {
      warnings.push({
        code: "multiline-inline-math",
        message: "行内公式 $…$ 跨行，会被 Markdown 拆开；请放在同一行或改用 $$",
        start: inlineStart,
        end: offset + 1,
      });
    }
    inlineStart = null;
  }

  if (displayStart !== null) {
    warnings.push({
      code: "unmatched-display-math",
      message: "这处 $$ 可能没有配对",
      start: displayStart,
      end: displayStart + 2,
    });
  }
  if (inlineStart !== null) {
    warnings.push({
      code: "unmatched-inline-math",
      message: "这处 $ 可能没有配对",
      start: inlineStart,
      end: inlineStart + 1,
    });
  }

  return ranges;
}

export function lintOpenReviewMarkdown(value = "") {
  const warnings = [];
  const fenceRanges = collectFenceRanges(value, warnings);
  const ignoredRanges = [
    ...fenceRanges,
    ...collectInlineCodeRanges(value, fenceRanges),
  ];

  addMatches(
    value,
    /!\[[^\]\n]*\]\(\s*(<?[^)\s>]+>?)/g,
    ignoredRanges,
    (match) => {
      const href = match[1].replace(/^<|>$/g, "");
      if (href.startsWith("/images/")) return null;
      return {
        code: "unsupported-image",
        message: "OpenReview 不会渲染这个图片地址",
        start: match.index,
        end: match.index + match[0].length,
      };
    },
    warnings,
  );

  addMatches(
    value,
    /\[[^\]\n]*\]\(\s*(?:javascript|vbscript|data):[^)]*\)/gi,
    ignoredRanges,
    (match) => ({
      code: "unsafe-link",
      message: "这个链接会被安全过滤器移除",
      start: match.index,
      end: match.index + match[0].length,
    }),
    warnings,
  );

  addMatches(
    value,
    /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^>\n]*|\/?)>/g,
    ignoredRanges,
    (match) => ({
      code: "raw-html",
      message: "OpenReview 会把原始 HTML 显示为普通文本",
      start: match.index,
      end: match.index + match[0].length,
    }),
    warnings,
  );

  addMatches(
    value,
    /<!--[\s\S]*?-->/g,
    ignoredRanges,
    (match) => ({
      code: "html-comment",
      message: "OpenReview 不会隐藏这段 HTML 注释",
      start: match.index,
      end: match.index + match[0].length,
    }),
    warnings,
  );

  addMatches(
    value,
    /(?:\\\*){2,}/g,
    ignoredRanges,
    (match) => ({
      code: "escaped-emphasis",
      message: "连续转义的 * 只会显示星号，不会形成粗体",
      start: match.index,
      end: match.index + match[0].length,
    }),
    warnings,
  );

  addMatches(
    value,
    /\*{4,}/g,
    ignoredRanges,
    (match) =>
      isEscaped(value, match.index)
        ? null
        : {
            code: "empty-emphasis",
            message: "连续的 **** 会形成空的或错乱的粗体标记",
            start: match.index,
            end: match.index + match[0].length,
          },
    warnings,
  );

  addMatches(
    value,
    /\*\*([^\n]*?)\*\*/g,
    ignoredRanges,
    (match) => {
      const closingOffset = match.index + match[0].length - 2;
      if (
        isEscaped(value, match.index) ||
        isEscaped(value, closingOffset) ||
        (!/^\s/.test(match[1]) && !/\s$/.test(match[1]))
      ) {
        return null;
      }
      return {
        code: "strong-inner-whitespace",
        message: "粗体标记 ** 的内侧不能紧邻空格；请把空格移到 ** 外面",
        start: match.index,
        end: match.index + match[0].length,
      };
    },
    warnings,
  );

  const strongOffsets = [];
  for (let offset = value.indexOf("**"); offset !== -1; ) {
    if (!isEscaped(value, offset) && !isInsideRange(offset, ignoredRanges)) {
      strongOffsets.push(offset);
    }
    offset = value.indexOf("**", offset + 2);
  }
  if (strongOffsets.length % 2 === 1) {
    warnings.push({
      code: "unmatched-strong",
      message: "粗体标记 ** 没有正确配对",
      start: strongOffsets[0],
      end: strongOffsets.at(-1) + 2,
    });
  }

  const mathRanges = collectMathRanges(value, ignoredRanges, warnings);
  for (const [start, end] of mathRanges) {
    for (let offset = start + 1; offset < end - 1; offset += 1) {
      if (value[offset] === "_" && !isEscaped(value, offset)) {
        warnings.push({
          code: "markdown-emphasis-in-math",
          message: "公式中的 _ 会先被 Markdown 解析；在 OpenReview 中请写成 \\_",
          start: offset,
          end: offset + 1,
        });
        break;
      }
    }
  }

  let sourceOffset = 0;
  for (const token of marked.lexer(value)) {
    const tokenStart = sourceOffset;
    sourceOffset += token.raw?.length ?? 0;
    if (token.type === "code" && /^(?: {4}|\t)/.test(token.raw)) {
      warnings.push({
        code: "indented-code",
        message: "这段四空格缩进会被 Markdown 当作代码块",
        start: tokenStart,
        end: sourceOffset,
      });
    }
  }

  return warnings
    .sort((left, right) => left.start - right.start)
    .slice(0, 100);
}
