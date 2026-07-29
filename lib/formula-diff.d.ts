export const DIFF_DELETE: -1;
export const DIFF_EQUAL: 0;
export const DIFF_INSERT: 1;

export type FormulaDiffPart = [-1 | 0 | 1, string];
export type FormulaInput = {
  display: boolean;
  math: string;
};

export function diffFormulaText(
  original?: string,
  rendered?: string,
): FormulaDiffPart[];
export function getFormulaDiffCost(
  original?: string,
  rendered?: string,
): number;
export function pairFormulaInputs(
  rendered?: FormulaInput[],
  original?: FormulaInput[],
): Array<string | undefined>;
export function matchFormulaInputs(
  rendered?: FormulaInput[],
  original?: FormulaInput[],
): Array<number | undefined>;
