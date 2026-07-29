export function getPreferredLanguage(languages) {
  for (const language of languages) {
    const primaryLanguage = language.trim().toLowerCase().split("-")[0];
    if (primaryLanguage === "zh") return "zh";
    if (primaryLanguage === "en") return "en";
  }
  return "en";
}
