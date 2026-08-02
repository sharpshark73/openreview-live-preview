export type LostMathReminderSettings = {
  enabled: boolean;
  inlineDollar: boolean;
  displayDollar: boolean;
  inlineParen: boolean;
  displayBracket: boolean;
};

export type ReminderSettings = {
  diagnosticLevel: "errors" | "recommended" | "all";
  markdownWarnings: boolean;
  mathJaxErrors: boolean;
  lostMath: LostMathReminderSettings;
};

export const DEFAULT_REMINDER_SETTINGS: Readonly<ReminderSettings>;

export function parseReminderSettings(
  value?: string | object | null,
): ReminderSettings;

export function isLostMathDelimiterEnabled(
  open: string,
  settings: LostMathReminderSettings,
): boolean;
