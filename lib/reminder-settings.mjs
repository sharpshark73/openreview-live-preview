export const DEFAULT_REMINDER_SETTINGS = Object.freeze({
  diagnosticLevel: "recommended",
  markdownWarnings: true,
  mathJaxErrors: true,
  lostMath: Object.freeze({
    enabled: true,
    inlineDollar: true,
    displayDollar: true,
    inlineParen: true,
    displayBracket: true,
  }),
});

function booleanOrDefault(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function diagnosticLevelOrDefault(value, fallback) {
  return value === "errors" || value === "recommended" || value === "all"
    ? value
    : fallback;
}

export function parseReminderSettings(value) {
  let stored;
  try {
    stored = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    stored = null;
  }

  const root = stored && typeof stored === "object" ? stored : {};
  const lostMath =
    root.lostMath && typeof root.lostMath === "object"
      ? root.lostMath
      : {};
  const defaults = DEFAULT_REMINDER_SETTINGS;

  return {
    diagnosticLevel: diagnosticLevelOrDefault(
      root.diagnosticLevel,
      defaults.diagnosticLevel,
    ),
    markdownWarnings: booleanOrDefault(
      root.markdownWarnings,
      defaults.markdownWarnings,
    ),
    mathJaxErrors: booleanOrDefault(
      root.mathJaxErrors,
      defaults.mathJaxErrors,
    ),
    lostMath: {
      enabled: booleanOrDefault(
        lostMath.enabled,
        defaults.lostMath.enabled,
      ),
      inlineDollar: booleanOrDefault(
        lostMath.inlineDollar,
        defaults.lostMath.inlineDollar,
      ),
      displayDollar: booleanOrDefault(
        lostMath.displayDollar,
        defaults.lostMath.displayDollar,
      ),
      inlineParen: booleanOrDefault(
        lostMath.inlineParen,
        defaults.lostMath.inlineParen,
      ),
      displayBracket: booleanOrDefault(
        lostMath.displayBracket,
        defaults.lostMath.displayBracket,
      ),
    },
  };
}

export function isLostMathDelimiterEnabled(open, settings) {
  if (!settings.enabled) return false;
  if (open === "$") return settings.inlineDollar;
  if (open === "$$") return settings.displayDollar;
  if (open === "\\(") return settings.inlineParen;
  if (open === "\\[") return settings.displayBracket;
  return false;
}
