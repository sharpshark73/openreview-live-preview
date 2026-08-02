const ESCAPE_EFFECTS = {
  zh: {
    "\\!": "MathJax 的负细空格命令会变成感叹号",
    "\\,": "MathJax 的细空格命令会变成逗号",
    "\\:": "MathJax 的中等空格命令会变成冒号",
    "\\;": "MathJax 的宽空格命令会变成分号",
    "\\>": "MathJax 的空格命令会变成大于号",
    "\\|": "MathJax 的双竖线命令会变成单竖线",
    "\\{": "原本要显示的左花括号会变成不可见的分组符",
    "\\}": "原本要显示的右花括号会变成不可见的分组符",
    "\\%": "百分号会变成 TeX 注释符，可能吞掉后面的内容",
    "\\#": "井号会变成 TeX 参数符，通常会触发错误",
    "\\$": "美元符号可能被当作公式分隔符",
    "\\&": "与号会变成对齐符，通常会触发错误",
    "\\\\": "TeX 换行命令会少一个反斜杠",
  },
  en: {
    "\\!": "MathJax sees an exclamation mark instead of negative thin space",
    "\\,": "MathJax sees a comma instead of thin space",
    "\\:": "MathJax sees a colon instead of medium space",
    "\\;": "MathJax sees a semicolon instead of thick space",
    "\\>": "MathJax sees a greater-than sign instead of spacing",
    "\\|": "MathJax sees a single bar instead of a double vertical bar",
    "\\{": "the visible left brace becomes an invisible grouping brace",
    "\\}": "the visible right brace becomes an invisible grouping brace",
    "\\%": "the percent sign becomes a TeX comment marker and may hide following text",
    "\\#": "the hash becomes a TeX parameter marker and usually causes an error",
    "\\$": "the dollar sign may become a formula delimiter",
    "\\&": "the ampersand becomes an alignment marker and usually causes an error",
    "\\\\": "the TeX line-break command loses one backslash",
  },
};

function summarizeEscapes(details) {
  const counts = new Map();
  for (const detail of details ?? []) {
    counts.set(detail, (counts.get(detail) ?? 0) + 1);
  }
  return Array.from(counts, ([escape, count]) => ({ escape, count }));
}

function preservedMarkdownEscape(escape) {
  return `\\${escape}`;
}

function formatChangedEscapes(analysis, language) {
  const summaries = summarizeEscapes(analysis.details);
  const isEnglish = language === "en";
  if (analysis.severity === "debug") {
    if (
      analysis.transformations?.length > 0 &&
      analysis.transformations.every(
        ({ kind }) => kind === "protected-tex-command",
      )
    ) {
      const changes = analysis.transformations
        .map(({ escape, output }) => `${escape}→${output}`)
        .join(isEnglish ? ", " : "、");
      return isEnglish
        ? `Markdown passes ${changes} to MathJax. This is the correct way to preserve the TeX command in OpenReview and needs no change.`
        : `Markdown 会将 ${changes} 后交给 MathJax。这正是在 OpenReview 中保留该 TeX 命令的正确写法，无需修改。`;
    }
    if (summaries.length === 1 && summaries[0].escape === "\\_") {
      return isEnglish
        ? "Markdown passes \\_ to MathJax as _. MathJax treats it as a subscript. This is normally the correct OpenReview-compatible spelling and needs no change. To display a literal underscore, write \\\\_."
        : "Markdown 会把 \\_ 作为 _ 交给 MathJax，MathJax 会将它解释为下标。这通常正是 OpenReview 所需的兼容写法，无需修改；只有想显示字面下划线时才写 \\\\_。";
    }
    const changes = summaries
      .map(({ escape, count }) =>
        `${escape}→${escape.slice(1)}${count > 1 ? ` ×${count}` : ""}`,
      )
      .join(isEnglish ? ", " : "、");
    return isEnglish
      ? `Markdown passes ${changes} to MathJax. These are usually intentional compatibility escapes; “All diagnostics” shows them only for input verification.`
      : `Markdown 会将 ${changes} 后交给 MathJax。这类变化通常是有意的兼容转义；“全部诊断”仅用于核对实际输入。`;
  }

  if (summaries.length === 1) {
    const { escape, count } = summaries[0];
    const output = escape.slice(1);
    const subject = count > 1
      ? isEnglish
        ? `${count} instances of ${escape}`
        : `${count} 处 ${escape}`
      : escape;
    const effect = ESCAPE_EFFECTS[language]?.[escape];
    return isEnglish
      ? `Markdown changes ${subject} to ${output}; ${effect ?? "the TeX meaning changes"}. Write ${preservedMarkdownEscape(escape)} to preserve ${escape}.`
      : `Markdown 会把 ${subject} 变成 ${output}；${effect ?? "TeX 含义会随之改变"}。要保留 ${escape}，请写成 ${preservedMarkdownEscape(escape)}。`;
  }

  const changes = summaries
    .map(({ escape, count }) =>
      `${escape}→${escape.slice(1)}${count > 1 ? ` ×${count}` : ""}`,
    )
    .join(isEnglish ? ", " : "、");
  const example = summaries[0]?.escape ?? "\\!";
  return isEnglish
    ? `Markdown changes ${changes} before MathJax, altering their TeX meaning. Use doubled backslashes (for example ${preservedMarkdownEscape(example)}) to preserve the commands.`
    : `Markdown 会在 MathJax 之前改写 ${changes}，这些 TeX 命令的含义会改变。要保留命令，请使用双反斜杠，例如 ${preservedMarkdownEscape(example)}。`;
}

export function getFormulaDiagnosticMessage(analysis, language = "en") {
  const isEnglish = language === "en";
  if (analysis.cause === "markdown-backslash-escape") {
    return formatChangedEscapes(analysis, language);
  }
  if (analysis.cause === "markdown-delimiter-removed") {
    const replacement = analysis.open === "\\(" ? "$…$" : "$$…$$";
    return isEnglish
      ? `Markdown removes the backslashes in ${analysis.open}…${analysis.close}, so MathJax cannot see formula delimiters. Use ${replacement} in OpenReview.`
      : `Markdown 会删除 ${analysis.open}…${analysis.close} 分隔符中的反斜杠，MathJax 因而看不到公式。请在 OpenReview 中改用 ${replacement}。`;
  }
  if (analysis.cause === "markdown-emphasis-interruption") {
    if (analysis.emphasisGroup?.affectedFormulaCount > 1) {
      return isEnglish
        ? `Markdown pairs _ or * markers across ${analysis.emphasisGroup.affectedFormulaCount} formulas as one emphasis span. This removes the markers and re-pairs later $ delimiters before MathJax. Escape formula subscripts as \\_.`
        : `Markdown 把 ${analysis.emphasisGroup.affectedFormulaCount} 个公式中的 _ 或 * 跨公式配成了一段强调标记，删除标记后还会让后续 $ 分隔符错配。公式下标请写成 \\_。`;
    }
    return isEnglish
      ? "An unescaped _ or * is parsed as Markdown emphasis and splits the formula before MathJax. Write subscript _ as \\_."
      : "公式中的未转义 _ 或 * 被 Markdown 当作强调标记，公式在到达 MathJax 前被拆开。下标 _ 请写成 \\_。";
  }
  if (analysis.cause === "formula-lost-after-markdown") {
    return isEnglish
      ? "Markdown no longer contains a complete formula delimiter pair. Open Debug → Markdown to see where the formula was split."
      : "Markdown 处理后已找不到完整的公式分隔符。请打开 Debug → Markdown 查看公式在哪一步被拆开。";
  }
  if (analysis.cause === "markdown-html-entity") {
    return isEnglish
      ? "Markdown decodes an HTML entity before MathJax. This all-diagnostics notice is only for verifying the actual input."
      : "Markdown 会在 MathJax 之前解码 HTML 实体；这条“全部诊断”提醒仅用于核对实际输入。";
  }
  return isEnglish
    ? "The MathJax input differs from the source for an uncertain reason. Inspect the highlighted diff in Debug → Markdown."
    : "MathJax 输入与源公式不同，但原因尚不确定。请在 Debug → Markdown 中查看高亮差异。";
}
