export type SupportedLanguage = "zh" | "en";

export function getPreferredLanguage(
  languages: readonly string[],
): SupportedLanguage;
