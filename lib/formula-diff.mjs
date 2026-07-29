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

export function matchFormulaInputs(rendered = [], original = []) {
  const matches = [];
  let originalCursor = 0;

  rendered.forEach((renderedFormula, renderedIndex) => {
    const remainingRendered = rendered.length - renderedIndex - 1;
    const constrainedEnd =
      original.length >= rendered.length
        ? original.length - remainingRendered
        : original.length;
    const candidateIndexes = Array.from(
      { length: Math.max(0, constrainedEnd - originalCursor) },
      (_, index) => originalCursor + index,
    );
    const sameDisplayIndexes = candidateIndexes.filter(
      (index) => original[index].display === renderedFormula.display,
    );
    const indexes =
      sameDisplayIndexes.length > 0 ? sameDisplayIndexes : candidateIndexes;

    let bestIndex;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const index of indexes) {
      const cost = getFormulaDiffCost(
        original[index].math,
        renderedFormula.math,
      );
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }

    matches.push(bestIndex);
    if (bestIndex !== undefined) originalCursor = bestIndex + 1;
  });

  return matches;
}

export function pairFormulaInputs(rendered = [], original = []) {
  return matchFormulaInputs(rendered, original).map((originalIndex) =>
    originalIndex === undefined ? undefined : original[originalIndex].math,
  );
}
