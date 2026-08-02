import {
  alignFormulaInputs,
  getFormulaDiffCost,
} from "./formula-diff.mjs";

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
      removed.push({
        escape: `\\${sourceMath[index + 1]}`,
        offset: index,
      });
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

function getUnescapedMarkdownEmphasisOffsets(value, formula) {
  const offsets = [];
  for (let index = formula.contentStart; index < formula.contentEnd; index += 1) {
    if (
      (value[index] === "_" || value[index] === "*") &&
      !isEscaped(value, index)
    ) {
      offsets.push(index);
    }
  }
  return offsets;
}

export function protectFormulaMarkdownEmphasis(
  value = "",
  formulas = [],
  requestedOffsets,
) {
  const formulaOffsets = formulas.flatMap((formula) =>
    getUnescapedMarkdownEmphasisOffsets(value, formula),
  );
  const protectedOffsets = Array.isArray(requestedOffsets)
    ? [...new Set(requestedOffsets)].filter(
        (offset) =>
          value[offset] === "_" || value[offset] === "*",
      )
    : formulaOffsets;
  if (protectedOffsets.length === 0) {
    return { value, protectedOffsets };
  }
  const protectedOffsetSet = new Set(protectedOffsets);
  let protectedValue = "";
  for (let index = 0; index < value.length; index += 1) {
    if (protectedOffsetSet.has(index)) protectedValue += "\\";
    protectedValue += value[index];
  }
  return { value: protectedValue, protectedOffsets };
}

function createCause(analysis) {
  if (analysis.severity === "none" || analysis.cause === "none") return [];
  return [{
    code: analysis.cause,
    confidence: analysis.confidence,
    severity: analysis.severity,
    details: analysis.details,
    sourceStart: analysis.sourceStart,
    sourceEnd: analysis.sourceEnd,
  }];
}

function getAnalysisDistance(analysis) {
  if (!analysis || analysis.status === "lost" || analysis.renderedMath === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return getFormulaDiffCost(analysis.sourceMath, analysis.renderedMath);
}

function applyEmphasisCounterfactual(
  analyses,
  sourceFormulas,
  counterfactual,
  sourceOffset,
) {
  if (!counterfactual?.renderedFormulas || !counterfactual.protectedOffsets?.length) {
    return analyses;
  }
  const protectedAnalyses = analyzeFormulaPipeline(
    sourceFormulas,
    counterfactual.renderedFormulas,
    { sourceOffset },
  );
  const protectedBySource = new Map(
    protectedAnalyses.map((analysis) => [analysis.sourceIndex, analysis]),
  );
  const affected = [];

  for (const analysis of analyses) {
    const sourceFormula = sourceFormulas[analysis.sourceIndex];
    const markerOffsets = counterfactual.protectedOffsets.filter(
      (offset) => offset >= sourceFormula.contentStart && offset < sourceFormula.contentEnd,
    );
    const protectedAnalysis = protectedBySource.get(analysis.sourceIndex);
    if (!protectedAnalysis || protectedAnalysis.status === "lost") continue;
    if (getAnalysisDistance(protectedAnalysis) >= getAnalysisDistance(analysis)) {
      continue;
    }
    affected.push({ analysis, markerOffsets, protectedAnalysis });
  }

  if (affected.length === 0) return analyses;
  const groupStart = sourceOffset + Math.min(
    ...counterfactual.protectedOffsets,
  );
  const groupEnd = sourceOffset + Math.max(
    ...counterfactual.protectedOffsets,
  ) + 1;
  const groupId = `markdown-emphasis:${groupStart}:${groupEnd}`;
  const directlyAffectedFormulaCount = new Set(
    affected
      .filter(({ markerOffsets }) => markerOffsets.length > 0)
      .map(({ analysis }) => analysis.sourceIndex),
  ).size;

  for (const { analysis, markerOffsets, protectedAnalysis } of affected) {
    const emphasisCause = {
      code: "markdown-emphasis-interruption",
      confidence: "high",
      severity: "error",
      details: markerOffsets.map((offset) => sourceFormulas[analysis.sourceIndex].math[
        offset - sourceFormulas[analysis.sourceIndex].contentStart
      ]),
      sourceStart:
        markerOffsets.length > 0
          ? sourceOffset + Math.min(...markerOffsets)
          : groupStart,
      sourceEnd:
        markerOffsets.length > 0
          ? sourceOffset + Math.max(...markerOffsets) + 1
          : groupEnd,
      groupId,
    };
    const secondaryCauses = protectedAnalysis.causes.filter(
      ({ code }) => code !== "none" && code !== "markdown-input-changed",
    );
    // Inline Markdown containers split MathJax's DOM string stream. Any
    // delimiter pairs recovered from the remaining text are new/spurious
    // formulas, not mutated versions of these source formulas.
    analysis.status = "lost";
    analysis.renderedIndex = undefined;
    analysis.renderedMath = undefined;
    analysis.cause = emphasisCause.code;
    analysis.confidence = emphasisCause.confidence;
    analysis.severity = emphasisCause.severity;
    analysis.details = emphasisCause.details;
    analysis.causes = [emphasisCause, ...secondaryCauses];
    analysis.transformations = protectedAnalysis.transformations;
    analysis.ignoredDetails = protectedAnalysis.ignoredDetails;
    analysis.emphasisGroup = {
      id: groupId,
      sourceStart: groupStart,
      sourceEnd: groupEnd,
      affectedFormulaCount: directlyAffectedFormulaCount,
    };
  }
  return analyses;
}

function classifyChangedFormula(sourceMath, renderedMath) {
  const removedEscapes = findRemovedEscapes(sourceMath, renderedMath);
  if (removedEscapes.length > 0) {
    const transformations = removedEscapes.map((transformation) => {
      const protectedCharacter =
        transformation.escape === "\\\\" &&
        MARKDOWN_ESCAPABLE_PUNCTUATION.test(
          sourceMath[transformation.offset + 2] ?? "",
        )
          ? sourceMath[transformation.offset + 2]
          : undefined;
      if (protectedCharacter !== undefined) {
        return {
          escape: `${transformation.escape}${protectedCharacter}`,
          output: `\\${protectedCharacter}`,
          offset: transformation.offset,
          kind: "protected-tex-command",
          severity: "debug",
        };
      }
      return {
        ...transformation,
        output: transformation.escape.slice(1),
        kind: "markdown-escape",
        severity: HIGH_IMPACT_TEX_ESCAPES.test(transformation.escape[1])
          ? "warning"
          : "debug",
      };
    });
    const highImpactEscapes = transformations.filter(
      (transformation) => transformation.severity === "warning",
    );
    const highImpact = highImpactEscapes.length > 0;
    return {
      cause: "markdown-backslash-escape",
      confidence: "high",
      severity: highImpact ? "warning" : "debug",
      // Recommended warnings name only the transformations that actually
      // triggered them. Expected transport escapes such as \_ remain
      // available in all-diagnostics mode without muddying the warning.
      details: (highImpact ? highImpactEscapes : transformations).map(
        ({ escape }) => escape,
      ),
      ignoredDetails: highImpact
        ? transformations
            .filter(({ severity }) => severity === "debug")
            .map(({ escape }) => escape)
        : [],
      transformations,
    };
  }
  if (decodeMarkdownEntities(sourceMath) === renderedMath) {
    return {
      cause: "markdown-html-entity",
      confidence: "high",
      severity: "debug",
      details: [],
      ignoredDetails: [],
      transformations: [],
    };
  }
  return {
    cause: "markdown-input-changed",
    confidence: "low",
    severity: "debug",
    details: [],
    ignoredDetails: [],
    transformations: [],
  };
}

function classifyLostFormula(formula) {
  if (formula.open === "\\(" || formula.open === "\\[") {
    return {
      cause: "markdown-delimiter-removed",
      confidence: "high",
      severity: "error",
      details: [formula.open, formula.close],
      ignoredDetails: [],
      transformations: [],
    };
  }
  if (hasUnescapedMarkdownEmphasis(formula.math)) {
    return {
      cause: "markdown-emphasis-interruption",
      confidence: "high",
      severity: "error",
      details: [],
      ignoredDetails: [],
      transformations: [],
    };
  }
  return {
    cause: "formula-lost-after-markdown",
    confidence: "high",
    severity: "error",
    details: [],
    ignoredDetails: [],
    transformations: [],
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
        ignoredDetails: [],
        transformations: [],
      });
    } else {
      analyses.push({
        ...base,
        status: "changed",
        ...classifyChangedFormula(source.math, rendered.math),
      });
    }
  }
  for (const analysis of analyses) {
    analysis.causes = createCause(analysis);
  }
  return applyEmphasisCounterfactual(
    analyses,
    sourceFormulas,
    options.emphasisCounterfactual,
    sourceOffset,
  );
}

export function shouldShowFormulaDiagnostic(analysis, level = "recommended") {
  if (!analysis || analysis.severity === "none") return false;
  if (level === "all") return true;
  if (level === "errors") return analysis.severity === "error";
  return analysis.severity === "error" || analysis.severity === "warning";
}
