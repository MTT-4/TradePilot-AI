export const siteLocaleValues = [
  "en",
  "ar",
  "ru",
  "fr",
  "de",
  "pt",
  "zh",
] as const;

export type SiteLocale = (typeof siteLocaleValues)[number];

const localeAliases: Record<string, SiteLocale> = {
  cn: "zh",
  "zh-cn": "zh",
  "zh_hans": "zh",
  "zh_hant": "zh",
  "en-us": "en",
  us: "en",
};

export function normalizeSiteLocaleInput(value: string) {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");

  if (!normalized) {
    return null;
  }

  if ((siteLocaleValues as readonly string[]).includes(normalized)) {
    return normalized as SiteLocale;
  }

  return localeAliases[normalized] ?? null;
}

export function normalizeSiteLocalesInput(values: string[]) {
  const locales: SiteLocale[] = [];
  const seen = new Set<SiteLocale>();

  for (const value of values) {
    const normalized = normalizeSiteLocaleInput(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    locales.push(normalized);
  }

  return locales;
}

export const siteLocalePlaceholder = "zh,en";

export const siteLocaleHelpText = "支持 zh/en/ar/ru/fr/de/pt，cn/us 会自动映射。";
