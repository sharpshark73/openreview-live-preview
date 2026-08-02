import type { FormulaInput } from "./formula-diff.mjs";

export type DiagnosticLevel = "errors" | "recommended" | "all";
export type FormulaAnalysisSeverity = "none" | "error" | "warning" | "debug";
export type FormulaAnalysisCause =
  | "none"
  | "markdown-backslash-escape"
  | "markdown-html-entity"
  | "markdown-input-changed"
  | "markdown-delimiter-removed"
  | "markdown-emphasis-interruption"
  | "formula-lost-after-markdown";
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
  cause: FormulaAnalysisCause;
  confidence: "high" | "low";
  severity: FormulaAnalysisSeverity;
  details: string[];
  ignoredDetails: string[];
  transformations: Array<{
    escape: string;
    output: string;
    offset: number;
    kind: "markdown-escape" | "protected-tex-command";
    severity: "warning" | "debug";
  }>;
  causes: Array<{
    code: FormulaAnalysisCause;
    confidence: "high" | "low";
    severity: FormulaAnalysisSeverity;
    details: string[];
    sourceStart: number;
    sourceEnd: number;
    groupId?: string;
  }>;
  emphasisGroup?: {
    id: string;
    sourceStart: number;
    sourceEnd: number;
    affectedFormulaCount: number;
  };
};

export function decodeMarkdownBackslashEscapes(value?: string): string;
export function protectFormulaMarkdownEmphasis(
  value?: string,
  formulas?: FormulaMatch[],
  requestedOffsets?: number[],
): { value: string; protectedOffsets: number[] };
export function analyzeFormulaPipeline(
  sourceFormulas?: FormulaMatch[],
  renderedFormulas?: FormulaInput[],
  options?: {
    sourceOffset?: number;
    emphasisCounterfactual?: {
      renderedFormulas: FormulaInput[];
      protectedOffsets: number[];
    };
  },
): FormulaAnalysis[];
export function shouldShowFormulaDiagnostic(
  analysis: FormulaAnalysis,
  level?: DiagnosticLevel,
): boolean;
