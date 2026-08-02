import type { FormulaInput } from "./formula-diff.mjs";

export type DiagnosticLevel = "errors" | "recommended" | "all";
export type FormulaAnalysisSeverity = "none" | "error" | "warning" | "debug";
export type FormulaMatch = FormulaInput & {
  start: number;
  end: number;
  open: string;
  close: string;
};
export type FormulaAnalysis = {
  sourceIndex: number;
  renderedIndex?: number;
  sourceStart: number;
  sourceEnd: number;
  sourceMath: string;
  renderedMath?: string;
  open: string;
  close: string;
  display: boolean;
  status: "unchanged" | "changed" | "lost";
  cause:
    | "none"
    | "markdown-backslash-escape"
    | "markdown-html-entity"
    | "markdown-input-changed"
    | "markdown-delimiter-removed"
    | "markdown-emphasis-interruption"
    | "formula-lost-after-markdown";
  confidence: "high" | "low";
  severity: FormulaAnalysisSeverity;
  details: string[];
};

export function decodeMarkdownBackslashEscapes(value?: string): string;
export function analyzeFormulaPipeline(
  sourceFormulas?: FormulaMatch[],
  renderedFormulas?: FormulaInput[],
  options?: { sourceOffset?: number },
): FormulaAnalysis[];
export function shouldShowFormulaDiagnostic(
  analysis: FormulaAnalysis,
  level?: DiagnosticLevel,
): boolean;
