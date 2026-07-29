export const POST_MARKDOWN_BLOCK_BOUNDARY = "\u0000";

function isEscaped(value, offset) {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findClosingDelimiter(value, from, close, boundary) {
  for (let index = from; index <= value.length - close.length; index += 1) {
    if (value[index] === boundary) return -1;
    if (value.startsWith(close, index) && !isEscaped(value, index)) {
      return index;
    }
  }
  return -1;
}

export function findPostMarkdownMath(value = "", boundary = POST_MARKDOWN_BLOCK_BOUNDARY) {
  const matches = [];

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === boundary || isEscaped(value, index)) continue;

    let open;
    let close;
    let display;

    if (value.startsWith("$$", index)) {
      open = "$$";
      close = "$$";
      display = true;
    } else if (value.startsWith("\\[", index)) {
      open = "\\[";
      close = "\\]";
      display = true;
    } else if (value.startsWith("\\(", index)) {
      open = "\\(";
      close = "\\)";
      display = false;
    } else if (value[index] === "$") {
      open = "$";
      close = "$";
      display = false;
    } else {
      continue;
    }

    const contentStart = index + open.length;
    const closeStart = findClosingDelimiter(
      value,
      contentStart,
      close,
      boundary,
    );
    if (closeStart === -1) continue;

    const end = closeStart + close.length;
    matches.push({
      start: index,
      end,
      contentStart,
      contentEnd: closeStart,
      math: value.slice(contentStart, closeStart),
      display,
      open,
      close,
    });
    index = end - 1;
  }

  return matches;
}
