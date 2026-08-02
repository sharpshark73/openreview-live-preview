import { alignFormulaInputs } from "./formula-diff.mjs";

const MARKDOWN_ESCAPABLE_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const HIGH_IMPACT_TEX_ESCAPES = /[!,:;>|{}%#$&\\]/;

function isEscaped(value, offset) {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

export function decodeMarkdownBackslashEscapes(value = "") {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    if (
      value[index] === "\\" &&
      index + 1 < value.length &&
      MARKDOWN_ESCAPABLE_PUNCTUATION.test(value[index + 1])
    ) {
      decoded += value[index + 1];
      index += 1;
    } else {
      decoded += value[index];
    }
  }
  return decoded;
}

function decodeMarkdownEntities(value) {
  const entities = {
    "&amp;": "&",
    "&apos;": "'",
    "&gt;": ">",
    "&lt;": "<",
    "&quot;": '"',
  };
  return value.replace(
    /&(amp|apos|gt|lt|quot);/g,
    (entity) => entities[entity] ?? entity,
  );
}

function findRemovedEscapes(sourceMath, renderedMath) {
  if (decodeMarkdownBackslashEscapes(sourceMath) !== renderedMath) return [];
  const removed = [];
  for (let index = 0; index < sourceMath.length - 1; index += 1) {
    if (
      sourceMath[index] === "\\" &&
      !isEscaped(sourceMath, index) &&
      MARKDOWN_ESCAPABLE_PUNCTUATION.test(sourceMath[index + 1])
    ) {
      removed.push(`\\${sourceMath[index + 1]}`);
      index += 1;
    }
  }
  return removed;
}

function hasUnescapedMarkdownEmphasis(value) {
  for (let index = 0; index < value.length; index += 1) {
    if ((value[index] === "_" || value[index] === "*") && !isEscaped(value, index)) {
      return true;
    }
  }
  return false;
}

function classifyChangedFormula(sourceMath, renderedMath) {
  const removedEscapes = findRemovedEscapes(sourceMath, renderedMath);
  if (removedEscapes.length > 0) {
    const highImpact = removedEscapes.some((escape) =>
      HIGH_IMPACT_TEX_ESCAPES.test(escape[1]),
    );
    return {
      cause: "markdown-backslash-escape",
      confidence: "high",
      severity: highImpact ? "warning" : "debug",
      details: removedEscapes,
    };
  }
  if (decodeMarkdownEntities(sourceMath) === renderedMath) {
    return {
      cause: "markdown-html-entity",
      confidence: "high",
      severity: "debug",
      details: [],
    };
  }
  return {
    cause: "markdown-input-changed",
    confidence: "low",
    severity: "debug",
    details: [],
  };
}

function classifyLostFormula(formula) {
  if (formula.open === "\\(" || formula.open === "\\[") {
    return {
      cause: "markdown-delimiter-removed",
      confidence: "high",
      severity: "error",
      details: [formula.open, formula.close],
    };
  }
  if (hasUnescapedMarkdownEmphasis(formula.math)) {
    return {
      cause: "markdown-emphasis-interruption",
      confidence: "high",
      severity: "error",
      details: [],
    };
  }
  return {
    cause: "formula-lost-after-markdown",
    confidence: "high",
    severity: "error",
    details: [],
  };
}

export function analyzeFormulaPipeline(
  sourceFormulas = [],
  renderedFormulas = [],
  options = {},
) {
  const sourceOffset = options.sourceOffset ?? 0;
  const analyses = [];
  for (const pair of alignFormulaInputs(sourceFormulas, renderedFormulas)) {
    if (pair.originalIndex === undefined) continue;
    const source = sourceFormulas[pair.originalIndex];
    const rendered =
      pair.renderedIndex === undefined
        ? undefined
        : renderedFormulas[pair.renderedIndex];
    const base = {
      sourceIndex: pair.originalIndex,
      renderedIndex: pair.renderedIndex,
      sourceStart: sourceOffset + source.start,
      sourceEnd: sourceOffset + source.end,
      sourceMath: source.math,
      renderedMath: rendered?.math,
      open: source.open,
      close: source.close,
      display: source.display,
    };
    if (!rendered) {
      analyses.push({
        ...base,
        status: "lost",
        ...classifyLostFormula(source),
      });
    } else if (source.math === rendered.math) {
      analyses.push({
        ...base,
        status: "unchanged",
        cause: "none",
        confidence: "high",
        severity: "none",
        details: [],
      });
    } else {
      analyses.push({
        ...base,
        status: "changed",
        ...classifyChangedFormula(source.math, rendered.math),
      });
    }
  }
  return analyses;
}

export function shouldShowFormulaDiagnostic(analysis, level = "recommended") {
  if (!analysis || analysis.severity === "none") return false;
  if (level === "all") return true;
  if (level === "errors") return analysis.severity === "error";
  return analysis.severity === "error" || analysis.severity === "warning";
}
