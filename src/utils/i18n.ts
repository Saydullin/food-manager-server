/**
 * Picks the entry matching `lang`, falling back to `defaultLang`, then to
 * whatever entry exists first — so a partially-translated row never breaks a
 * read, it just serves the closest thing to what was asked for. Shared by
 * every *Translation table (FoodTranslation, IngredientTranslation, ...).
 */
export const pickByLanguage = <T extends { language: string }>(
  items: T[],
  lang: string,
  defaultLang: string,
): T | undefined =>
  items.find((t) => t.language === lang) ?? items.find((t) => t.language === defaultLang) ?? items[0];
