import fastDiff from "fast-diff";

export const DIFF_DELETE = -1;
export const DIFF_EQUAL = 0;
export const DIFF_INSERT = 1;

export function diffFormulaText(original = "", rendered = "") {
  return fastDiff(original, rendered);
}

export function getFormulaDiffCost(original = "", rendered = "") {
  return diffFormulaText(original, rendered).reduce(
    (cost, [operation, value]) =>
      operation === DIFF_EQUAL ? cost : cost + value.length,
    0,
  );
}

function getAlignmentMatchCost(original, rendered) {
  const length = Math.max(original.math.length, rendered.math.length, 1);
  const textCost = (getFormulaDiffCost(original.math, rendered.math) / length) * 4;
  return textCost + (original.display === rendered.display ? 0 : 2);
}

/**
 * Align two ordered formula streams. Unlike the previous greedy matcher, this
 * keeps formulas after an insertion or loss paired with their real counterpart.
 */
export function alignFormulaInputs(original = [], rendered = []) {
  const rowCount = original.length + 1;
  const columnCount = rendered.length + 1;
  const gapCost = 2.5;
  const costs = Array.from({ length: rowCount }, () =>
    Array(columnCount).fill(Number.POSITIVE_INFINITY),
  );
  const steps = Array.from({ length: rowCount }, () =>
    Array(columnCount).fill(null),
  );
  costs[0][0] = 0;

  for (let originalIndex = 0; originalIndex < rowCount; originalIndex += 1) {
    for (let renderedIndex = 0; renderedIndex < columnCount; renderedIndex += 1) {
      const current = costs[originalIndex][renderedIndex];
      if (!Number.isFinite(current)) continue;

      if (originalIndex < original.length && renderedIndex < rendered.length) {
        const next =
          current +
          getAlignmentMatchCost(
            original[originalIndex],
            rendered[renderedIndex],
          );
        if (next <= costs[originalIndex + 1][renderedIndex + 1]) {
          costs[originalIndex + 1][renderedIndex + 1] = next;
          steps[originalIndex + 1][renderedIndex + 1] = "match";
        }
      }
      if (originalIndex < original.length) {
        const next = current + gapCost;
        if (next < costs[originalIndex + 1][renderedIndex]) {
          costs[originalIndex + 1][renderedIndex] = next;
          steps[originalIndex + 1][renderedIndex] = "original-only";
        }
      }
      if (renderedIndex < rendered.length) {
        const next = current + gapCost;
        if (next < costs[originalIndex][renderedIndex + 1]) {
          costs[originalIndex][renderedIndex + 1] = next;
          steps[originalIndex][renderedIndex + 1] = "rendered-only";
        }
      }
    }
  }

  const pairs = [];
  let originalIndex = original.length;
  let renderedIndex = rendered.length;
  while (originalIndex > 0 || renderedIndex > 0) {
    const step = steps[originalIndex][renderedIndex];
    if (step === "match") {
      pairs.push({
        originalIndex: originalIndex - 1,
        renderedIndex: renderedIndex - 1,
      });
      originalIndex -= 1;
      renderedIndex -= 1;
    } else if (step === "original-only") {
      pairs.push({ originalIndex: originalIndex - 1 });
      originalIndex -= 1;
    } else {
      pairs.push({ renderedIndex: renderedIndex - 1 });
      renderedIndex -= 1;
    }
  }
  return pairs.reverse();
}

export function matchFormulaInputs(rendered = [], original = []) {
  const matches = Array(rendered.length).fill(undefined);
  for (const pair of alignFormulaInputs(original, rendered)) {
    if (pair.renderedIndex !== undefined) {
      matches[pair.renderedIndex] = pair.originalIndex;
    }
  }
  return matches;
}

export function pairFormulaInputs(rendered = [], original = []) {
  return matchFormulaInputs(rendered, original).map((originalIndex) =>
    originalIndex === undefined ? undefined : original[originalIndex].math,
  );
}
