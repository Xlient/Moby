/**
 * The phone's language tag (e.g. "es-MX"), sent with AI requests and device registration so
 * Moby's explanations, answers and push text come back in it. The server decides which
 * languages it translates into; anything else stays English.
 */
export function phoneLanguage(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || undefined;
  } catch {
    return undefined;
  }
}

const NAMES: Record<string, string> = {
  es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano', pt: 'Português', nl: 'Nederlands',
  pl: 'Polski', tr: 'Türkçe', ru: 'Русский', ja: '日本語', ko: '한국어', zh: '中文', vi: 'Tiếng Việt',
  th: 'ไทย', id: 'Bahasa Indonesia', tl: 'Filipino', hi: 'हिन्दी',
};

/** "Translated into Español by Moby" style label part, or undefined for English. */
export function languageName(code: string | undefined): string | undefined {
  return code && code !== 'en' ? NAMES[code] ?? code : undefined;
}
